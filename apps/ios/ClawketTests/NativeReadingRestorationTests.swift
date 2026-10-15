import SwiftUI
import UIKit
import XCTest
@testable import ClawketUI

final class NativeReadingRestorationTests: XCTestCase {
    @MainActor
    func testPublishedReadingScopeAndFontChangesReachTheExistingTranscriptWithoutRootReplacement() async throws {
        let route = ConversationID(connectionID: "reading", agentID: "agent", sessionID: "published")
        let initial = ConversationReadingPresentation(restoration: .init(followsBottom: false, messageID: "m3", offset: 4))
        let model = ClientPresentation(readingContexts: [route: initial])
        let messages = (0..<60).map { index in
            MessagePresentation(id: "m\(index)", author: .agent(name: "Agent", label: nil),
                content: [.markdown(String(repeating: "Row \(index) selectable 中文 text. ", count: 10))])
        }
        var publishedScopes: [UUID] = []
        let host = UIHostingController(rootView: NativeTranscript(messages: messages, conversationID: route,
            model: model, following: .constant(false), scrollRequest: 0, historyAvailability: .unsupported,
            isLoadingHistory: false, onIntent: {
                if case let .readingContextChanged(_, id, _) = $0 { publishedScopes.append(id) }
            }))
        let window = attach(host)
        defer { window.isHidden = true; window.rootViewController = nil }
        await settle(host)
        let table = try XCTUnwrap(descendants(host.view, of: UITableView.self).first)
        let source = try XCTUnwrap(table.dataSource as? UITableViewDiffableDataSource<Int, String>)
        let originalTable = table
        let replacement = ConversationReadingPresentation(restoration: .init(followsBottom: false, messageID: "m40", offset: -18))
        model.readingContexts[route] = replacement
        await settle(host)
        let target = try XCTUnwrap(source.indexPath(for: "m40"))
        XCTAssertTrue(table.indexPathsForVisibleRows?.contains(target) == true)
        XCTAssertEqual(table.rectForRow(at: target).minY - table.contentOffset.y, -18, accuracy: 3)
        XCTAssertEqual(publishedScopes.last, replacement.id)
        model.appearance.chatFontSize = 20
        await settle(host)
        XCTAssertTrue(descendants(host.view, of: UITableView.self).first === originalTable)
        XCTAssertEqual(table.rectForRow(at: target).minY - table.contentOffset.y, -18, accuracy: 3)
        let latest = ConversationReadingPresentation(restoration: .init(followsBottom: false, messageID: "m50", offset: 8))
        model.readingContexts[route] = latest
        await settle(host)
        let last = try XCTUnwrap(source.indexPath(for: "m50"))
        XCTAssertEqual(table.rectForRow(at: last).minY - table.contentOffset.y, 8, accuracy: 3)
        XCTAssertEqual(publishedScopes.last, latest.id)
    }

    @MainActor
    func testCachedAnchorRestoresInRealTranscriptAndFontReflowKeepsReadingPosition() async throws {
        let route = ConversationID(connectionID: "reading", agentID: "agent", sessionID: "secondary")
        let model = ClientPresentation(readingContexts: [route: .init(restoration: .init(followsBottom: false, messageID: "m12", offset: 8))])
        let messages = (0..<45).map { index in
            MessagePresentation(id: "m\(index)", author: .agent(name: "Agent", label: nil),
                content: [.markdown(String(repeating: "Message \(index) with selectable text 中文. ", count: 8))])
        }
        func transcript() -> NativeTranscript {
            .init(messages: messages, conversationID: route, model: model, following: .constant(false), scrollRequest: 0,
                historyAvailability: .unsupported, isLoadingHistory: false, onIntent: { _ in })
        }
        let host = UIHostingController(rootView: transcript()), window = attach(host)
        defer { window.isHidden = true; window.rootViewController = nil }
        await settle(host)
        let table = try XCTUnwrap(descendants(host.view, of: UITableView.self).first)
        let source = try XCTUnwrap(table.dataSource as? UITableViewDiffableDataSource<Int, String>)
        let target = try XCTUnwrap(source.indexPath(for: "m12"))
        XCTAssertTrue(table.indexPathsForVisibleRows?.contains(target) == true)
        XCTAssertEqual(table.rectForRow(at: target).minY - table.contentOffset.y, 8, accuracy: 3)
        let first = try XCTUnwrap(table.indexPathsForVisibleRows?.sorted().first)
        let id = try XCTUnwrap(source.itemIdentifier(for: first))
        let offset = table.rectForRow(at: first).minY - table.contentOffset.y
        model.appearance.chatFontSize = 20
        host.rootView = transcript()
        await settle(host)
        let preserved = try XCTUnwrap(source.indexPath(for: id))
        XCTAssertTrue(table.indexPathsForVisibleRows?.contains(preserved) == true)
        XCTAssertEqual(table.rectForRow(at: preserved).minY - table.contentOffset.y, offset, accuracy: 3)
        model.readingContexts[route] = .init(restoration: .init(followsBottom: false, messageID: "m15", offset: -30))
        host.rootView = transcript()
        await settle(host)
        let reopened = try XCTUnwrap(source.indexPath(for: "m15"))
        XCTAssertEqual(table.rectForRow(at: reopened).minY - table.contentOffset.y, -30, accuracy: 3)
    }

    @MainActor
    func testMissingSavedRenderAnchorDoesNotPublishAGuessedPosition() async throws {
        let route = ConversationID(connectionID: "reading", agentID: "agent", sessionID: "secondary"), scope = UUID()
        let model = ClientPresentation(readingContexts: [route: .init(id: scope,
            restoration: .init(followsBottom: false, messageID: "not-loaded", offset: 0))])
        var captures: [ConversationReadingContext] = []
        let messages = (0..<30).map { MessagePresentation(id: "m\($0)", author: .local, content: [.markdown("A retained row \($0).")]) }
        let host = UIHostingController(rootView: NativeTranscript(messages: messages, conversationID: route, model: model,
            following: .constant(false), scrollRequest: 0, historyAvailability: .unsupported, isLoadingHistory: false,
            onIntent: { if case let .readingContextChanged(_, id, value) = $0, id == scope { captures.append(value) } }))
        let window = attach(host)
        defer { window.isHidden = true; window.rootViewController = nil }
        await settle(host)
        let table = try XCTUnwrap(descendants(host.view, of: UITableView.self).first)
        XCTAssertFalse(table.indexPathsForVisibleRows?.isEmpty ?? true)
        XCTAssertTrue(captures.isEmpty)
        // Explicit reading interaction retires the missing restore; no RPC or paging is inferred.
        table.delegate?.scrollViewWillBeginDragging?(table)
        XCTAssertEqual(captures.count, 1)
        XCTAssertEqual(captures.first?.followsBottom, false)
        XCTAssertNotEqual(captures.first?.messageID, "not-loaded")
    }

    @MainActor
    func testActualTextKitFontSettingScalesAndKeepsNativeSelectionAndViewIdentity() async throws {
        let host = UIHostingController(rootView: SelectableMessageText(text: "A selectable **message** with 中文.", fontSize: 12, onURL: { _ in }))
        let window = attach(host)
        defer { window.isHidden = true; window.rootViewController = nil }
        await settle(host)
        let view = try XCTUnwrap(descendants(host.view, of: UITextView.self).first)
        let small = try XCTUnwrap(view.attributedText.attribute(.font, at: 0, effectiveRange: nil) as? UIFont)
        view.selectedRange = NSRange(location: 2, length: 10)
        host.rootView = SelectableMessageText(text: "A selectable **message** with 中文.", fontSize: 20, onURL: { _ in })
        await settle(host)
        let larger = try XCTUnwrap(descendants(host.view, of: UITextView.self).first)
        let font = try XCTUnwrap(larger.attributedText.attribute(.font, at: 0, effectiveRange: nil) as? UIFont)
        XCTAssertTrue(larger === view); XCTAssertEqual(larger.selectedRange, NSRange(location: 2, length: 10))
        XCTAssertGreaterThan(font.pointSize, small.pointSize)
        XCTAssertTrue(larger.adjustsFontForContentSizeCategory); XCTAssertTrue(larger.isSelectable)
        XCTAssertLessThanOrEqual(larger.convert(larger.bounds, to: host.view).maxX, 321)
    }

    @MainActor private func attach<Content: View>(_ host: UIHostingController<Content>) -> UIWindow {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 700))
        window.rootViewController = host; window.isHidden = false
        return window
    }
    @MainActor private func settle<Content: View>(_ host: UIHostingController<Content>) async {
        for _ in 0..<24 {
            host.view.setNeedsLayout(); host.view.layoutIfNeeded(); CATransaction.flush()
            try? await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertNotNil(host.view.window)
    }
    @MainActor private func descendants<T: UIView>(_ view: UIView, of type: T.Type) -> [T] {
        (view as? T).map { [$0] } ?? view.subviews.flatMap { descendants($0, of: type) }
    }
}
