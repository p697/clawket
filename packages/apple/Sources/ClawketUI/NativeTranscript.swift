#if os(iOS)
import SwiftUI
import UIKit

/// UIKit owns scrolling geometry. SwiftUI owns each native message's content.
/// Appending/streaming never chooses a new route or replays a send.
@MainActor
struct NativeTranscript: UIViewRepresentable {
    let messages: [MessagePresentation]
    let conversationID: ConversationID
    let model: ClientPresentation
    @Binding var following: Bool
    let scrollRequest: Int
    let historyAvailability: ActionAvailability
    let isLoadingHistory: Bool
    let onIntent: @MainActor (ClientIntent) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }
    func makeUIView(context: Context) -> TranscriptTableView {
        let table = TranscriptTableView(frame: .zero, style: .plain)
        table.backgroundColor = .systemBackground
        table.separatorStyle = .none
        table.allowsSelection = false
        table.keyboardDismissMode = .interactive
        table.contentInsetAdjustmentBehavior = .never
        table.rowHeight = UITableView.automaticDimension
        table.estimatedRowHeight = 130
        table.selfSizingInvalidation = .enabledIncludingConstraints
        table.contentInset = UIEdgeInsets(top: 14, left: 0, bottom: 16, right: 0)
        table.delegate = context.coordinator
        table.register(UITableViewCell.self, forCellReuseIdentifier: "message")
        table.onGeometryChanged = { [weak coordinator = context.coordinator] in coordinator?.geometryChanged() }
        context.coordinator.install(table)
        return table
    }
    func updateUIView(_ table: TranscriptTableView, context: Context) { context.coordinator.update(self, table: table) }

    @MainActor
    final class Coordinator: NSObject, UITableViewDelegate {
        private var parent: NativeTranscript
        private weak var table: TranscriptTableView?
        private var dataSource: UITableViewDiffableDataSource<Int, String>?
        private var items: [String: MessagePresentation] = [:]
        private var followsBottom = true
        private var initialized = false
        private var applying = false
        private var geometryScheduled = false
        private var lastScrollRequest = 0
        private var generation = 0
        private let historyButton = UIButton(type: .system)

        init(parent: NativeTranscript) { self.parent = parent }

        func install(_ table: TranscriptTableView) {
            self.table = table
            historyButton.addTarget(self, action: #selector(loadEarlier), for: .touchUpInside)
            dataSource = UITableViewDiffableDataSource<Int, String>(tableView: table) { [weak self] table, indexPath, id in
                let cell = table.dequeueReusableCell(withIdentifier: "message", for: indexPath)
                guard let self, let message = self.items[id] else { return cell }
                cell.backgroundColor = .clear
                cell.selectionStyle = .none
                cell.contentConfiguration = UIHostingConfiguration {
                    NativeMessageRow(message: message, conversationID: self.parent.conversationID,
                                     model: self.parent.model, onIntent: self.parent.onIntent,
                                     onReadingInteraction: { [weak self] in self?.pauseFollowing() })
                }.margins(.horizontal, 20).margins(.vertical, 12)
                return cell
            }
        }

        func update(_ parent: NativeTranscript, table: TranscriptTableView) {
            let anchor = readingAnchor(in: table)
            self.parent = parent
            if parent.scrollRequest != lastScrollRequest {
                lastScrollRequest = parent.scrollRequest
                followsBottom = true
            }
            configureHistory(in: table)
            var next: [String: MessagePresentation] = [:]
            var ids: [String] = []
            for item in parent.messages where next[item.id] == nil {
                next[item.id] = item; ids.append(item.id)
            }
            let changed = ids.filter { items[$0] != nil && items[$0] != next[$0] }
            let previousIDs = dataSource?.snapshot().itemIdentifiers ?? []
            guard previousIDs != ids || !changed.isEmpty || !initialized else {
                if followsBottom && parent.scrollRequest != 0 { scrollToBottom(table) }
                return
            }
            items = next
            generation += 1
            let updateGeneration = generation
            var snapshot = NSDiffableDataSourceSnapshot<Int, String>()
            snapshot.appendSections([0]); snapshot.appendItems(ids)
            snapshot.reconfigureItems(changed)
            applying = true
            dataSource?.apply(snapshot, animatingDifferences: false) { [weak self, weak table] in
                guard let self, let table, self.generation == updateGeneration else { return }
                table.layoutIfNeeded()
                if self.followsBottom && !table.isDragging && !table.isDecelerating { self.scrollToBottom(table) }
                else if let anchor { self.restore(anchor, in: table) }
                self.initialized = true
                self.applying = false
                self.publishFollowing()
            }
        }

        private func configureHistory(in table: UITableView) {
            guard parent.historyAvailability.isVisible else { table.tableHeaderView = nil; return }
            historyButton.setTitle(parent.isLoadingHistory ? String(localized: "Loading earlier messages…") : String(localized: "Earlier messages"), for: .normal)
            historyButton.titleLabel?.font = UIFont.preferredFont(forTextStyle: .footnote)
            historyButton.titleLabel?.adjustsFontForContentSizeCategory = true
            historyButton.isEnabled = parent.historyAvailability.isEnabled && !parent.isLoadingHistory
            historyButton.accessibilityIdentifier = "load-earlier-messages"
            let height = max(44, (historyButton.titleLabel?.font.lineHeight ?? 18) + 24)
            historyButton.frame = CGRect(x: 0, y: 0, width: table.bounds.width, height: height)
            table.tableHeaderView = historyButton
        }

        @objc private func loadEarlier() { parent.onIntent(.loadEarlier(parent.conversationID)) }

        private func readingAnchor(in table: UITableView) -> (id: String, offset: CGFloat)? {
            guard !followsBottom, let index = table.indexPathsForVisibleRows?.sorted().first,
                  let id = dataSource?.itemIdentifier(for: index) else { return nil }
            return (id, table.rectForRow(at: index).minY - table.contentOffset.y)
        }

        private func restore(_ anchor: (id: String, offset: CGFloat), in table: UITableView) {
            guard !table.isDragging && !table.isDecelerating,
                  let index = dataSource?.indexPath(for: anchor.id) else { return }
            let wanted = table.rectForRow(at: index).minY - anchor.offset
            let minY = -table.adjustedContentInset.top
            let maxY = max(minY, table.contentSize.height - table.bounds.height + table.adjustedContentInset.bottom)
            table.setContentOffset(CGPoint(x: 0, y: min(maxY, max(minY, wanted))), animated: false)
        }

        private func scrollToBottom(_ table: UITableView) {
            let y = max(-table.adjustedContentInset.top, table.contentSize.height - table.bounds.height + table.adjustedContentInset.bottom)
            if abs(table.contentOffset.y - y) > 0.5 { table.setContentOffset(CGPoint(x: 0, y: y), animated: false) }
        }

        func geometryChanged() {
            guard initialized, !applying, !geometryScheduled, followsBottom else { return }
            geometryScheduled = true
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.geometryScheduled = false
                guard let table = self.table, self.followsBottom, !table.isDragging, !table.isDecelerating else { return }
                self.scrollToBottom(table)
            }
        }

        func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
            pauseFollowing()
        }
        private func pauseFollowing() {
            followsBottom = false
            publishFollowing()
        }
        func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
            if !decelerate { updateFollowing(scrollView) }
        }
        func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) { updateFollowing(scrollView) }

        private func updateFollowing(_ scrollView: UIScrollView) {
            let distance = scrollView.contentSize.height - scrollView.bounds.height + scrollView.adjustedContentInset.bottom - scrollView.contentOffset.y
            followsBottom = distance < 44
            publishFollowing()
        }
        private func publishFollowing() {
            let value = followsBottom
            Task { @MainActor [weak self] in
                guard let self, self.followsBottom == value, self.parent.following != value else { return }
                self.parent.following = value
            }
        }
    }
}

@MainActor
final class TranscriptTableView: UITableView {
    var onGeometryChanged: (() -> Void)?
    private var lastSize = CGSize.zero
    private var lastContentSize = CGSize.zero
    override func layoutSubviews() {
        super.layoutSubviews()
        if bounds.size != lastSize || contentSize != lastContentSize {
            lastSize = bounds.size; lastContentSize = contentSize
            onGeometryChanged?()
        }
    }
}
#endif
