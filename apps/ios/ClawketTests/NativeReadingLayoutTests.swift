import SwiftUI
import UIKit
import XCTest
@testable import ClawketUI

final class NativeReadingLayoutTests: XCTestCase {
    @MainActor
    func testLongComposerLeavesRoomForActionsAndKeepsTheSameExpandedEditor() async throws {
        let route = ConversationID(connectionID: "layout", agentID: "agent", sessionID: "session")
        let text = String(repeating: "A long unsent draft 中文 日本語 ", count: 18)
        let draft = ComposerDraft(conversationID: route, text: text)
        let conversation = ConversationPresentation(id: route, agentName: "Agent", sessionTitle: "Conversation",
            modelTitle: String(repeating: "Long model title ", count: 8),
            features: [.send: .available, .stop: .available, .models: .available, .photos: .available])
        let host = UIHostingController(rootView: NativeComposer(draft: draft, conversation: conversation,
            expanded: .constant(false), onIntent: { _ in }, showModels: {}))
        let window = attach(host)
        defer { window.isHidden = true; window.rootViewController = nil }
        for width in [CGFloat(320), 420, 768] {
            await layout(host, width: width, height: 280)
            let editor = try XCTUnwrap(descendants(host.view, of: UITextView.self).first)
            XCTAssertEqual(editor.text, text)
            let frame = editor.convert(editor.bounds, to: host.view)
            XCTAssertGreaterThan(frame.width, 64)
            XCTAssertGreaterThanOrEqual(frame.minX, -1)
            // Add, Send and Stop must fit next to the editor rather than outside the screen.
            XCTAssertLessThanOrEqual(frame.maxX, width - 44)
            XCTAssertGreaterThan(editor.contentSize.height, editor.font?.lineHeight ?? 0)
        }
        let editor = try XCTUnwrap(descendants(host.view, of: UITextView.self).first)
        editor.selectedRange = NSRange(location: 4, length: 8)
        host.rootView = NativeComposer(draft: draft, conversation: conversation,
            expanded: .constant(true), onIntent: { _ in }, showModels: {})
        await layout(host, width: 320, height: 500)
        let expanded = try XCTUnwrap(descendants(host.view, of: UITextView.self).first)
        XCTAssertTrue(expanded === editor)
        XCTAssertEqual(expanded.text, text)
        XCTAssertEqual(expanded.selectedRange, NSRange(location: 4, length: 8))
        XCTAssertLessThanOrEqual(expanded.convert(expanded.bounds, to: host.view).maxX, 276)
    }

    @MainActor
    func testLocalAndAgentLongMessagesWrapInsideTheWindow() async throws {
        let route = ConversationID(connectionID: "layout", agentID: "agent", sessionID: "session")
        let model = ClientPresentation()
        let text = String(repeating: "Long message with **Markdown** and 中文 without truncating. ", count: 10)
        for author in [MessageAuthor.local, .agent(name: "Agent", label: nil)] {
            for width in [CGFloat(320), 420, 768] {
                let message = MessagePresentation(id: "long", author: author, content: [.markdown(text)])
                let row = NativeMessageRow(message: message, conversationID: route, model: model,
                    onIntent: { _ in }, onReadingInteraction: {})
                let host = UIHostingController(rootView: row)
                let window = attach(host)
                await layout(host, width: width, height: 1_200)
                let reading = try XCTUnwrap(descendants(host.view, of: UITextView.self).first)
                let frame = reading.convert(reading.bounds, to: host.view)
                XCTAssertGreaterThan(frame.width, 64)
                XCTAssertGreaterThanOrEqual(frame.minX, -1)
                XCTAssertLessThanOrEqual(frame.maxX, width + 1)
                XCTAssertGreaterThan(frame.height, 3 * (reading.font?.lineHeight ?? 16))
                XCTAssertTrue(reading.isSelectable)
                XCTAssertFalse(reading.isScrollEnabled)
                XCTAssertTrue(reading.text.contains("without truncating."))
                window.isHidden = true; window.rootViewController = nil
            }
        }
    }

    @MainActor
    func testHostedTranscriptCellMeasuresLongTextAtItsActualWidth() async throws {
        let route = ConversationID(connectionID: "layout", agentID: "agent", sessionID: "session")
        let text = String(repeating: "An uninterrupted long transcript row 中文. ", count: 16)
        let message = MessagePresentation(id: "long", author: .local, content: [.markdown(text)])
        let model = ClientPresentation()
        let host = UIHostingController(rootView: NativeTranscript(messages: [message], conversationID: route,
            model: model, following: .constant(false), scrollRequest: 0,
            historyAvailability: .unsupported, isLoadingHistory: false, onIntent: { _ in }))
        let window = attach(host)
        defer { window.isHidden = true; window.rootViewController = nil }
        await layout(host, width: 320, height: 700)
        let table = try XCTUnwrap(descendants(host.view, of: UITableView.self).first)
        // A real diffable-data-source cell, not a separate rendering fixture.
        for _ in 0..<20 {
            table.layoutIfNeeded(); CATransaction.flush()
            if table.cellForRow(at: IndexPath(row: 0, section: 0)) != nil { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        let cell = try XCTUnwrap(table.cellForRow(at: IndexPath(row: 0, section: 0)))
        let reading = try XCTUnwrap(descendants(cell, of: UITextView.self).first)
        let frame = reading.convert(reading.bounds, to: table)
        XCTAssertGreaterThanOrEqual(frame.minX, -1)
        XCTAssertLessThanOrEqual(frame.maxX, 321)
        XCTAssertGreaterThan(table.rectForRow(at: IndexPath(row: 0, section: 0)).height, 150)
    }

    @MainActor
    func testToolOutputStartsCollapsedThenShowsSelectableVerbatimTextAndCopiesAtRealWidths() async throws {
        let route = ConversationID(connectionID: "layout", agentID: "agent", sessionID: "session")
        let raw = "{\"stdout\":\"**literal** # heading\",\"unknown\":true}\n" + String(repeating: "  [raw] > result 中文 e\u{0301} \n", count: 12) + "```\n"
        let model = ClientPresentation()
        let message = MessagePresentation(id: "tool", author: .system, content: [.toolOutput(.init(text: raw))])
        var interactions = 0
        let row = NativeMessageRow(message: message, conversationID: route, model: model,
            onIntent: { _ in }, onReadingInteraction: { interactions += 1 })
        let host = UIHostingController(rootView: row)
        let window = attach(host)
        defer { window.isHidden = true; window.rootViewController = nil }
        await layout(host, width: 420, height: 1_200)
        let collapsedHeight = host.sizeThatFits(in: CGSize(width: 420, height: CGFloat.greatestFiniteMagnitude)).height
        XCTAssertGreaterThanOrEqual(collapsedHeight, 44)
        XCTAssertLessThan(collapsedHeight, 120)
        XCTAssertFalse(model.expandedContentIDs.contains("tool-0"))
        model.expandedContentIDs.insert("tool-0")
        for width in [CGFloat(320), 420, 768] {
            await layout(host, width: width, height: 1_200)
            let text = try XCTUnwrap(descendants(host.view, of: UITextView.self).first)
            XCTAssertTrue(text.text.utf8.elementsEqual(raw.utf8))
            XCTAssertTrue(text.isSelectable); XCTAssertFalse(text.isEditable)
            let frame = text.convert(text.bounds, to: host.view)
            XCTAssertGreaterThan(frame.width, 64); XCTAssertGreaterThan(frame.height, 44)
            XCTAssertGreaterThanOrEqual(frame.minX, -1); XCTAssertLessThanOrEqual(frame.maxX, width + 1)
            let copy = try XCTUnwrap(descendants(host.view, of: UIButton.self).first { $0.accessibilityIdentifier == "copy-tool-output-tool-0" })
            XCTAssertTrue(copy.isAccessibilityElement); XCTAssertEqual(copy.accessibilityLabel, String(localized: "Copy"))
            XCTAssertGreaterThanOrEqual(copy.bounds.width, 44); XCTAssertGreaterThanOrEqual(copy.bounds.height, 44)
            let middle = CGPoint(x: copy.bounds.midX, y: copy.bounds.midY)
            XCTAssertTrue(copy.point(inside: middle, with: nil))
            XCTAssertTrue(window.hitTest(copy.convert(middle, to: window), with: nil) === copy)
            copy.sendActions(for: .touchUpInside)
            XCTAssertTrue((UIPasteboard.general.string ?? "").utf8.elementsEqual(raw.utf8))
        }
        XCTAssertGreaterThanOrEqual(interactions, 3)
        model.expandedContentIDs.remove("tool-0")
        await layout(host, width: 420, height: 1_200)
        XCTAssertEqual(host.sizeThatFits(in: CGSize(width: 420, height: CGFloat.greatestFiniteMagnitude)).height, collapsedHeight, accuracy: 1)
        XCTAssertTrue(message.content == [.toolOutput(.init(text: raw))])

        // Reuse the same TextKit view while the literal source changes only
        // in Unicode normalization. Swift String equality alone misses this.
        let composed = "file-\u{00e9}", decomposed = "file-e\u{0301}"
        let exactHost = UIHostingController(rootView: SelectableMessageText(text: composed, monospaced: true, onURL: { _ in }))
        let exactWindow = attach(exactHost)
        defer { exactWindow.isHidden = true; exactWindow.rootViewController = nil }
        await layout(exactHost, width: 420, height: 200)
        let originalView = try XCTUnwrap(descendants(exactHost.view, of: UITextView.self).first)
        exactHost.rootView = SelectableMessageText(text: decomposed, monospaced: true, onURL: { _ in })
        await layout(exactHost, width: 420, height: 200)
        let updatedView = try XCTUnwrap(descendants(exactHost.view, of: UITextView.self).first)
        XCTAssertTrue(originalView === updatedView)
        XCTAssertTrue(updatedView.attributedText.string.utf8.elementsEqual(decomposed.utf8))
        XCTAssertFalse(updatedView.attributedText.string.utf8.elementsEqual(composed.utf8))
    }

    @MainActor
    private func layout<Content: View>(_ host: UIHostingController<Content>, width: CGFloat, height: CGFloat) async {
        host.loadViewIfNeeded()
        host.view.window?.frame = CGRect(x: 0, y: 0, width: width, height: height)
        host.view.frame = CGRect(x: 0, y: 0, width: width, height: height)
        for _ in 0..<8 {
            host.view.setNeedsLayout()
            host.view.layoutIfNeeded()
            CATransaction.flush()
            try? await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertNotNil(host.view.window)
    }

    @MainActor
    private func attach<Content: View>(_ host: UIHostingController<Content>) -> UIWindow {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 700))
        window.rootViewController = host
        window.isHidden = false
        host.view.layoutIfNeeded()
        return window
    }

    @MainActor
    private func descendants<T: UIView>(_ view: UIView, of type: T.Type) -> [T] {
        (view as? T).map { [$0] } ?? view.subviews.flatMap { descendants($0, of: type) }
    }
}
