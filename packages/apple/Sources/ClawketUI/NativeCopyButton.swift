#if os(iOS)
import SwiftUI
import UIKit

@MainActor
struct NativeCopyFeedbackEffects {
    var delay: @MainActor () async throws -> Void
    var succeeded: @MainActor (String) -> Void
    static let system = Self(delay: { try await Task.sleep(for: .milliseconds(1_500)) }, succeeded: { title in
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        UIAccessibility.post(notification: .announcement, argument: title)
    })
}

/// Feedback belongs to this visible control, never to a message or wire identity.
@MainActor
struct NativeCopyButton: UIViewRepresentable {
    let text: String
    let accessibilityIdentifier: String
    var accessibilityLabel = String(localized: "Copy")
    var effects = NativeCopyFeedbackEffects.system
    let beforeCopy: @MainActor () -> Void
    @Environment(\.isEnabled) private var enabled

    init(text: String, accessibilityIdentifier: String, accessibilityLabel: String = String(localized: "Copy"),
         effects: NativeCopyFeedbackEffects = .system, beforeCopy: @escaping @MainActor () -> Void) {
        self.text = text; self.accessibilityIdentifier = accessibilityIdentifier
        self.accessibilityLabel = accessibilityLabel; self.effects = effects; self.beforeCopy = beforeCopy
    }

    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> UIButton {
        let button = CopyFeedbackButton(type: .system)
        button.titleLabel?.adjustsFontForContentSizeCategory = true
        button.titleLabel?.numberOfLines = 0
        button.addTarget(context.coordinator, action: #selector(Coordinator.activate), for: .touchUpInside)
        button.detached = { [weak coordinator = context.coordinator] in coordinator?.reset() }
        updateUIView(button, context: context)
        return button
    }
    func updateUIView(_ button: UIButton, context: Context) {
        guard let button = button as? CopyFeedbackButton else { return }
        let coordinator = context.coordinator
        if button.accessibilityIdentifier != accessibilityIdentifier { coordinator.reset() }
        coordinator.button = button; coordinator.text = text; coordinator.beforeCopy = beforeCopy; coordinator.effects = effects
        button.copyTitle = String(localized: "Copy"); button.copiedTitle = String(localized: "Copied")
        button.accessibilityIdentifier = accessibilityIdentifier; button.copyAccessibilityLabel = accessibilityLabel
        button.isEnabled = enabled && !text.isEmpty
        if !button.isEnabled { coordinator.reset() }
        button.refresh()
    }
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UIButton, context: Context) -> CGSize? {
        uiView.sizeThatFits(CGSize(width: proposal.width.flatMap { $0.isFinite && $0 > 0 ? $0 : nil } ?? .greatestFiniteMagnitude,
                                  height: .greatestFiniteMagnitude))
    }
    static func dismantleUIView(_ button: UIButton, coordinator: Coordinator) {
        coordinator.reset(); coordinator.button = nil; coordinator.beforeCopy = nil
        coordinator.text = ""; coordinator.effects = .system
        (button as? CopyFeedbackButton)?.detached = nil
    }

    @MainActor final class Coordinator: NSObject {
        fileprivate weak var button: CopyFeedbackButton?
        fileprivate var text = ""
        fileprivate var beforeCopy: (@MainActor () -> Void)?
        fileprivate var effects = NativeCopyFeedbackEffects.system
        private var generation = UUID()
        private var resetTask: Task<Void, Never>?

        @objc fileprivate func activate() {
            guard let button, button.isEnabled, button.window != nil else { return }
            let text = self.text
            beforeCopy?()
            UIPasteboard.general.string = text
            guard self.button === button, button.isEnabled, button.window != nil else { return }
            resetTask?.cancel()
            let token = UUID(); generation = token
            button.copied = true; button.refresh()
            effects.succeeded(button.copiedTitle)
            let delay = effects.delay
            resetTask = Task { @MainActor [weak self, weak button] in
                do { try await delay() } catch { return }
                guard !Task.isCancelled, let self, self.generation == token,
                      let button, button.window != nil else { return }
                self.resetTask = nil; button.copied = false; button.refresh()
            }
        }
        fileprivate func reset() {
            generation = UUID(); resetTask?.cancel(); resetTask = nil
            button?.copied = false; button?.refresh()
        }
    }
}

@MainActor
fileprivate final class CopyFeedbackButton: UIButton {
    var copyTitle = "", copiedTitle = ""
    var copyAccessibilityLabel = ""
    var copied = false
    var detached: (() -> Void)?
    private var copyFont: UIFont { .preferredFont(forTextStyle: .body, compatibleWith: traitCollection) }

    func refresh() {
        var configuration = UIButton.Configuration.plain()
        configuration.title = copied ? copiedTitle : copyTitle
        configuration.titleAlignment = .center; configuration.titleLineBreakMode = .byWordWrapping
        configuration.contentInsets = .init(top: 0, leading: 8, bottom: 0, trailing: 8)
        let font = copyFont
        configuration.titleTextAttributesTransformer = .init { attributes in
            var value = attributes; value.font = font; return value
        }
        self.configuration = configuration
        isAccessibilityElement = true; accessibilityTraits = isEnabled ? .button : [.button, .notEnabled]
        accessibilityLabel = copyAccessibilityLabel
        accessibilityValue = copied ? copiedTitle : nil
        invalidateIntrinsicContentSize()
    }
    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window == nil { detached?() }
    }
    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        if previousTraitCollection?.preferredContentSizeCategory != traitCollection.preferredContentSizeCategory { refresh() }
    }
    override var intrinsicContentSize: CGSize { reservedSize(width: .greatestFiniteMagnitude) }
    override func sizeThatFits(_ size: CGSize) -> CGSize { reservedSize(width: size.width) }
    private func reservedSize(width: CGFloat) -> CGSize {
        let titles = [copyTitle, copiedTitle], font = copyFont
        let natural = titles.map { ($0 as NSString).size(withAttributes: [.font: font]).width }.max() ?? 0
        let width = max(44, min(width, ceil(natural) + 16))
        let height = titles.map {
            ($0 as NSString).boundingRect(with: CGSize(width: max(1, width - 16), height: .greatestFiniteMagnitude),
                options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: font], context: nil).height
        }.max() ?? 0
        return CGSize(width: width, height: max(44, ceil(height)))
    }
}
#endif
