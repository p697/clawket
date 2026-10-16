import SwiftUI
import UIKit
import XCTest
@testable import ClawketUI

final class NativeReadingLayoutTests: XCTestCase {
    @MainActor func testPreviewPauseKeepsTheRealTranscriptAnchorAndRetiresOnlyItsOwner() async throws {
        let route = ConversationID(connectionID: "layout", agentID: "agent", sessionID: "preview")
        let model = ClientPresentation(readingContexts: [route: .init()])
        let firstInteraction = NativeTranscriptReadingInteraction()
        var messages = (0..<30).map {
            MessagePresentation(id: "preview-\($0)", author: .agent(name: "Agent", label: nil),
                content: [.markdown("Readable message \($0) 中文.\nSecond line.")])
        }
        var captures: [ConversationReadingContext] = []
        func transcript(_ interaction: NativeTranscriptReadingInteraction, scroll: Int = 0) -> AnyView {
            AnyView(NativeTranscript(messages: messages, conversationID: route, model: model,
                following: .constant(true), scrollRequest: scroll, historyAvailability: .unsupported,
                isLoadingHistory: false, onIntent: {
                    if case let .readingContextChanged(_, _, value) = $0 { captures.append(value) }
                }, readingInteraction: interaction))
        }
        let host = UIHostingController(rootView: transcript(firstInteraction)), window = attach(host)
        defer { window.isHidden = true; window.rootViewController = nil }
        await layout(host, width: 320, height: 420)
        let table = try XCTUnwrap(descendants(host.view, of: UITableView.self).first)
        let source = try XCTUnwrap(table.dataSource as? UITableViewDiffableDataSource<Int, String>)
        XCTAssertEqual(captures.last?.followsBottom, true)

        // This is synchronous, before the host prepares or opens a preview.
        var forwarded = false
        firstInteraction.forwardComposerIntent(.openAttachment(attachmentID: "draft-image")) { intent in
            guard case let .openAttachment(id) = intent else { return XCTFail("The original intent must be forwarded") }
            XCTAssertEqual(id, "draft-image")
            XCTAssertEqual(captures.last?.followsBottom, false, "Pause must precede host preview preparation")
            forwarded = true
        }
        XCTAssertTrue(forwarded)
        let reading = try XCTUnwrap(captures.last)
        XCTAssertFalse(reading.followsBottom)
        let id = try XCTUnwrap(reading.messageID)
        let index = try XCTUnwrap(source.indexPath(for: id))
        let offset = table.rectForRow(at: index).minY - table.contentOffset.y
        messages.append(.init(id: "new-reply", author: .agent(name: "Agent", label: nil),
            content: [.markdown(String(repeating: "New streamed content.\n", count: 18))], isStreaming: true))
        host.rootView = transcript(firstInteraction)
        await layout(host, width: 320, height: 420)
        XCTAssertEqual(table.rectForRow(at: index).minY - table.contentOffset.y, offset, accuracy: 2)
        XCTAssertEqual(captures.last?.messageID, id)
        XCTAssertEqual(captures.last?.followsBottom, false)

        // Expanded editing hides the transcript without retiring its confirmed
        // reading scope. A preview must not capture this empty geometry.
        let frame = table.frame, beforeHidden = captures
        table.frame.size.height = 0
        firstInteraction.pause()
        XCTAssertEqual(captures, beforeHidden)
        table.frame = frame

        let replacement = NativeTranscriptReadingInteraction()
        host.rootView = transcript(replacement, scroll: 1)
        await layout(host, width: 320, height: 420)
        XCTAssertEqual(captures.last?.followsBottom, true)
        let bottom = max(-table.adjustedContentInset.top, table.contentSize.height - table.bounds.height + table.adjustedContentInset.bottom)
        XCTAssertEqual(table.contentOffset.y, bottom, accuracy: 2)
        let beforeRetired = captures
        firstInteraction.pause()
        XCTAssertEqual(captures, beforeRetired, "A replaced handle cannot control the current table")

        let secondRoute = ConversationID(connectionID: "layout", agentID: "agent", sessionID: "replacement")
        let secondModel = ClientPresentation(readingContexts: [secondRoute: .init()])
        var secondCaptures: [ConversationReadingContext] = []
        let secondHost = UIHostingController(rootView: NativeTranscript(messages: messages,
            conversationID: secondRoute, model: secondModel, following: .constant(true), scrollRequest: 0,
            historyAvailability: .unsupported, isLoadingHistory: false, onIntent: {
                if case let .readingContextChanged(_, _, value) = $0 { secondCaptures.append(value) }
            }, readingInteraction: replacement))
        let secondWindow = attach(secondHost)
        defer { secondWindow.isHidden = true; secondWindow.rootViewController = nil }
        await layout(secondHost, width: 320, height: 420)
        XCTAssertEqual(secondCaptures.last?.followsBottom, true)
        host.rootView = AnyView(EmptyView())
        await layout(host, width: 320, height: 420)
        replacement.pause()
        XCTAssertEqual(secondCaptures.last?.followsBottom, false,
            "Dismantling the old table cannot retire a new owner of the same handle")
        XCTAssertNotNil(secondCaptures.last?.messageID)
    }

    @MainActor func testActualAssistantMarkdownCodeCardCopiesExactBytesAcrossStreamingAndFinal() async throws {
        let route = ConversationID(connectionID: "layout", agentID: "agent", sessionID: "code")
        let model = ClientPresentation(), prefix = "Explanation 中文\n"
        let body = "  let name = \"é\"\r\n\tprint(name) // **literal** `raw`\r\n"
        var interactions = 0
        func row(_ raw: String, streaming: Bool, author: MessageAuthor = .agent(name: "Agent", label: nil)) -> NativeMessageRow {
            NativeMessageRow(message: .init(id: "reply", author: author, content: [.markdown(raw)], isStreaming: streaming),
                conversationID: route, model: model, onIntent: { _ in }, onReadingInteraction: { interactions += 1 })
        }
        let host = UIHostingController(rootView: row(prefix + "```swift\r\n" + body, streaming: true)), window = attach(host)
        defer { window.isHidden = true; window.rootViewController = nil }
        let copyID = "copy-code-reply-0-fence-\(prefix.utf8.count)"
        for width in [CGFloat(320), 420, 768] {
            await layout(host, width: width, height: 900)
            let copy = try XCTUnwrap(descendants(host.view, of: UIButton.self).first { $0.accessibilityIdentifier == copyID })
            XCTAssertGreaterThanOrEqual(copy.bounds.width, 44); XCTAssertGreaterThanOrEqual(copy.bounds.height, 44)
            let code = try XCTUnwrap(descendants(host.view, of: UITextView.self).first { $0.text.utf8.elementsEqual(body.utf8) })
            XCTAssertTrue(code.isSelectable); XCTAssertFalse(code.isScrollEnabled)
            let frame = code.convert(code.bounds, to: host.view)
            XCTAssertGreaterThanOrEqual(frame.minX, -1); XCTAssertLessThanOrEqual(frame.maxX, width + 1)
            copy.sendActions(for: .touchUpInside)
            XCTAssertEqual(Data(try XCTUnwrap(UIPasteboard.general.string).utf8), Data(body.utf8))
        }
        let copy = try XCTUnwrap(descendants(host.view, of: UIButton.self).first { $0.accessibilityIdentifier == copyID })
        let code = try XCTUnwrap(descendants(host.view, of: UITextView.self).first { $0.text.utf8.elementsEqual(body.utf8) })
        let corrected = body.replacingOccurrences(of: "é", with: "e\u{301}")
        host.rootView = row(prefix + "```swift\r\n" + corrected + "```\r\nAfter", streaming: false)
        await layout(host, width: 420, height: 900)
        let finalCopy = try XCTUnwrap(descendants(host.view, of: UIButton.self).first { $0.accessibilityIdentifier == copyID })
        XCTAssertTrue(finalCopy === copy)
        XCTAssertTrue(descendants(host.view, of: UITextView.self).contains { $0 === code })
        XCTAssertEqual(Data(code.text.utf8), Data(corrected.utf8))
        finalCopy.sendActions(for: .touchUpInside)
        XCTAssertEqual(Data(try XCTUnwrap(UIPasteboard.general.string).utf8), Data(corrected.utf8))
        XCTAssertEqual(interactions, 4)
        let readingTexts = descendants(host.view, of: UITextView.self).map(\.text)
        XCTAssertTrue(readingTexts.contains(prefix)); XCTAssertTrue(readingTexts.contains("After"))
        host.rootView = row("```sw", streaming: true)
        await layout(host, width: 320, height: 900)
        let openingTail = try XCTUnwrap(descendants(host.view, of: UITextView.self).first { $0.text == "```sw" })
        host.rootView = row("```sw", streaming: false) // Lost current-wire proof is not final text.
        await layout(host, width: 320, height: 900)
        XCTAssertTrue(descendants(host.view, of: UITextView.self).contains { $0 === openingTail && $0.text == "```sw" })
        XCTAssertFalse(descendants(host.view, of: UIButton.self).contains { $0.accessibilityIdentifier?.hasPrefix("copy-code-") == true })
        let closingTail = prefix + "```swift\r\n" + body + "```"
        host.rootView = row(closingTail, streaming: true)
        await layout(host, width: 320, height: 900)
        let closingCopy = try XCTUnwrap(descendants(host.view, of: UIButton.self).first { $0.accessibilityIdentifier == copyID })
        let closingCode = try XCTUnwrap(descendants(host.view, of: UITextView.self).first { $0.text.utf8.elementsEqual(body.utf8) })
        closingCopy.sendActions(for: .touchUpInside)
        XCTAssertEqual(Data(try XCTUnwrap(UIPasteboard.general.string).utf8), Data(body.utf8))
        host.rootView = row(closingTail, streaming: false)
        await layout(host, width: 320, height: 900)
        let disconnectedCopy = try XCTUnwrap(descendants(host.view, of: UIButton.self).first { $0.accessibilityIdentifier == copyID })
        XCTAssertTrue(disconnectedCopy === closingCopy)
        XCTAssertTrue(descendants(host.view, of: UITextView.self).contains { $0 === closingCode && $0.text.utf8.elementsEqual(body.utf8) })
        disconnectedCopy.sendActions(for: .touchUpInside)
        XCTAssertEqual(Data(try XCTUnwrap(UIPasteboard.general.string).utf8), Data(body.utf8))
        XCTAssertEqual(interactions, 6)
        host.rootView = row(prefix + "```swift\ncode\n```", streaming: false, author: .local)
        await layout(host, width: 320, height: 900)
        XCTAssertFalse(descendants(host.view, of: UIButton.self).contains { $0.accessibilityIdentifier?.hasPrefix("copy-code-") == true })
    }

    @MainActor func testConversationKeepsWorkAndUpgradeAccessibleBesideBoundedComposer() async throws {
        let route = ConversationID(connectionID: "layout", agentID: "agent", sessionID: "accessories")
        let draft = ComposerDraft(conversationID: route, text: "A retained draft\nSecond line\nThird line")
        draft.attachments = (0..<3).map { .init(id: "accessory-\($0)", name: "Attachment \($0).png", kind: .image, detail: "4 KB") }
        let conversation = ConversationPresentation(id: route, agentName: "Agent", sessionTitle: "Conversation",
            features: [.pro: .available, .send: .available, .photos: .available],
            work: .init(id: "work", title: "Current work record", status: .succeeded, inspect: .available))
        let host = UIHostingController(rootView: NativeConversationView(model: ClientPresentation(), conversation: conversation,
            draft: draft, obscured: false, onIntent: { _ in }, showSheet: { _ in }).dynamicTypeSize(.accessibility5))
        host.safeAreaRegions = []
        let window = attach(host)
        defer { window.isHidden = true; window.rootViewController = nil }
        await layout(host, width: 402, height: 340)
        let editor = try XCTUnwrap(descendants(host.view, of: UITextView.self).first)
        editor.font = UIFont.preferredFont(forTextStyle: .body,
            compatibleWith: .init(preferredContentSizeCategory: .accessibilityExtraExtraExtraLarge))
        for height in [CGFloat(340), 150] {
            await layout(host, width: 402, height: height)
            let vertical = descendants(host.view, of: UIScrollView.self).filter {
                !($0 is UITextView) && !($0 is UITableView) && $0.bounds.width > 0 && $0.contentSize.width <= $0.bounds.width + 1
            }
            XCTAssertEqual(vertical.count, 2, "Both accessory and composer content remain separate reachable viewports")
            for view in vertical {
                let frame = view.convert(view.bounds, to: host.view)
                XCTAssertGreaterThan(frame.height, 0)
                XCTAssertGreaterThan(view.contentSize.height, 0)
                XCTAssertGreaterThanOrEqual(frame.minY, -1)
                XCTAssertLessThanOrEqual(frame.maxY, height + 1)
            }
        }
    }

    @MainActor func testLargestAccessibilityTextKeepsCompactEditorBoundedAndScrollable() async throws {
        let route = ConversationID(connectionID: "layout", agentID: "agent", sessionID: "large")
        let draft = ComposerDraft(conversationID: route, text: String(repeating: "Large editable draft 中文。", count: 12))
        draft.attachments = (0..<3).map { .init(id: "large-\($0)", name: "Long attachment \($0).png", kind: .image,
            detail: "4 KB", canOpen: true) }
        let conversation = ConversationPresentation(id: route, agentName: "Agent", sessionTitle: "Conversation",
            modelTitle: "Long current model name", features: [.send: .available, .models: .available, .photos: .available])
        let host = UIHostingController(rootView: NativeComposer(draft: draft, conversation: conversation,
            expanded: .constant(false), onIntent: { _ in }, showModels: {}, maximumHeight: 340).dynamicTypeSize(.accessibility5))
        // The production parent already supplies the keyboard-safe viewport;
        // do not add the test window's system safe area to that same budget.
        host.safeAreaRegions = []
        let window = attach(host)
        defer { window.isHidden = true; window.rootViewController = nil }
        await layout(host, width: 402, height: 340)
        let editor = try XCTUnwrap(descendants(host.view, of: UITextView.self).first)
        editor.font = UIFont.preferredFont(forTextStyle: .body,
            compatibleWith: .init(preferredContentSizeCategory: .accessibilityExtraExtraExtraLarge))
        editor.setNeedsLayout()
        await layout(host, width: 402, height: 340)
        XCTAssertGreaterThan(try XCTUnwrap(editor.font).pointSize, 40)
        XCTAssertLessThanOrEqual(editor.bounds.height, 160)
        XCTAssertTrue(editor.isScrollEnabled)
        XCTAssertTrue(editor.isEditable); XCTAssertEqual(editor.text, draft.text)
        XCTAssertLessThanOrEqual(host.sizeThatFits(in: CGSize(width: 402, height: 340)).height, 340.5)
        XCTAssertTrue(descendants(host.view, of: UIScrollView.self).contains {
            !($0 is UITextView) && $0.bounds.height > 0 && $0.contentSize.height > $0.bounds.height + 20
        }, "Attachments and large text must scroll instead of displacing the action row")
        editor.selectedRange = NSRange(location: 4, length: 8)
        for expanded in [false, true] {
            host.rootView = NativeComposer(draft: draft, conversation: conversation, expanded: .constant(expanded),
                onIntent: { _ in }, showModels: {}, maximumHeight: 150).dynamicTypeSize(.accessibility5)
            await layout(host, width: 402, height: 150)
            let current = try XCTUnwrap(descendants(host.view, of: UITextView.self).first)
            XCTAssertTrue(current === editor); XCTAssertEqual(current.selectedRange, NSRange(location: 4, length: 8))
            XCTAssertEqual(current.text, draft.text)
            XCTAssertLessThanOrEqual(host.sizeThatFits(in: CGSize(width: 402, height: 150)).height, 150.5)
            XCTAssertGreaterThanOrEqual(current.bounds.height, try XCTUnwrap(current.font).lineHeight)
        }
    }

    @MainActor func testJumpToLatestPublishesFollowingAndReadingEvenWhenNoMessageChanged() async throws {
        let route = ConversationID(connectionID: "layout", agentID: "agent", sessionID: "jump")
        let model = ClientPresentation(readingContexts: [route: .init(restoration: .init(followsBottom: false, messageID: "m3", offset: 0))])
        let messages = (0..<30).map { MessagePresentation(id: "m\($0)", author: .local,
            content: [.markdown(String(repeating: "Retained message \($0). ", count: 5))]) }
        var following = false
        var captures: [ConversationReadingContext] = []
        func transcript(_ request: Int) -> NativeTranscript {
            .init(messages: messages, conversationID: route, model: model,
                  following: .init(get: { following }, set: { following = $0 }), scrollRequest: request,
                  historyAvailability: .unsupported, isLoadingHistory: false, onIntent: {
                      if case let .readingContextChanged(_, _, value) = $0 { captures.append(value) }
                  })
        }
        let host = UIHostingController(rootView: transcript(0)), window = attach(host)
        defer { window.isHidden = true; window.rootViewController = nil }
        await layout(host, width: 420, height: 500)
        let table = try XCTUnwrap(descendants(host.view, of: UITableView.self).first)
        XCTAssertFalse(following); XCTAssertEqual(captures.last?.followsBottom, false)
        host.rootView = transcript(1)
        await layout(host, width: 420, height: 500)
        // UIKit may replace an estimated tail height on a later run-loop turn.
        // Require stable real geometry, not a fixed delay or a wider tolerance.
        var settledFrames = 0
        var lastGeometry: [CGFloat]?
        for _ in 0..<30 {
            host.view.layoutIfNeeded(); table.layoutIfNeeded(); CATransaction.flush()
            let bottom = max(-table.adjustedContentInset.top,
                table.contentSize.height - table.bounds.height + table.adjustedContentInset.bottom)
            let geometry = [table.bounds.width, table.bounds.height, table.contentSize.height,
                table.adjustedContentInset.top, table.adjustedContentInset.bottom, bottom]
            let stable = lastGeometry.map { zip($0, geometry).allSatisfy { abs($0 - $1) <= 0.5 } } ?? false
            settledFrames = stable && table.window === window && abs(table.contentOffset.y - bottom) <= 2 ? settledFrames + 1 : 0
            lastGeometry = geometry
            if settledFrames >= 3 { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(descendants(host.view, of: UITableView.self).first === table)
        XCTAssertTrue(following); XCTAssertEqual(captures.last?.followsBottom, true)
        XCTAssertGreaterThanOrEqual(settledFrames, 3)
        XCTAssertEqual(table.contentOffset.y, max(-table.adjustedContentInset.top,
            table.contentSize.height - table.bounds.height + table.adjustedContentInset.bottom), accuracy: 2)
    }

    func testImageGroupsKeepOriginalContentOrderAndDisclosureIndicesWithoutNeedingPixels() throws {
        let image = AttachmentPresentation(id: "same-reference", name: "Image", kind: .image, phase: .preparing)
        let file = AttachmentPresentation(id: "file", name: "Notes", kind: .file)
        let content: [MessageContent] = [.attachment(image), .attachment(image), .attachment(file),
            .markdown("Between images"), .attachment(image), .toolOutput(.init(text: "Literal output")),
            .attachment(image), .attachment(image)]
        let groups = NativeMessageContentGroup.group(content)
        XCTAssertEqual(groups.map(\.id), [0, 2, 3, 4, 5, 6])
        guard case let .images(first) = groups[0], case let .item(fileIndex, fileContent) = groups[1],
              case let .item(toolIndex, toolContent) = groups[4], case let .images(last) = groups[5] else {
            return XCTFail("Only adjacent images belong in a gallery")
        }
        XCTAssertEqual(first.map(\.id), [0, 1])
        XCTAssertEqual(first.map(\.attachment.id), [image.id, image.id])
        XCTAssertEqual(fileIndex, 2); XCTAssertEqual(fileContent, .attachment(file))
        XCTAssertEqual(toolIndex, 5); XCTAssertEqual(toolContent, .toolOutput(.init(text: "Literal output")))
        XCTAssertEqual(last.map(\.id), [6, 7])
        XCTAssertEqual(NativeMessageContentGroup.group([]).count, 0)
        XCTAssertEqual(content.count, 8)
    }

    @MainActor
    func testThreeTallImagesUseCompactGalleryInActualTranscriptCells() async throws {
        let route = ConversationID(connectionID: "layout", agentID: "agent", sessionID: "session")
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 80, height: 400))
        let pixels = renderer.pngData { context in
            UIColor.systemTeal.setFill(); context.fill(CGRect(x: 0, y: 0, width: 80, height: 400))
        }
        let images: [MessageContent] = (0..<3).map {
            .attachment(.init(id: "image-\($0)", name: "Image \($0).png", kind: .image,
                              thumbnailData: pixels, aspectRatio: 0.2, canOpen: true))
        }
        for author in [MessageAuthor.local, .agent(name: "Agent", label: nil)] {
            for width in [CGFloat(320), 420, 768] {
                let message = MessagePresentation(id: "gallery", author: author, content: images)
                let host = UIHostingController(rootView: NativeTranscript(messages: [message], conversationID: route,
                    model: ClientPresentation(), following: .constant(false), scrollRequest: 0,
                    historyAvailability: .unsupported, isLoadingHistory: false, onIntent: { _ in }))
                let window = attach(host)
                await layout(host, width: width, height: 900)
                let table = try XCTUnwrap(descendants(host.view, of: UITableView.self).first)
                for _ in 0..<20 {
                    table.layoutIfNeeded(); CATransaction.flush()
                    if table.cellForRow(at: IndexPath(row: 0, section: 0)) != nil { break }
                    try await Task.sleep(for: .milliseconds(10))
                }
                XCTAssertNotNil(table.cellForRow(at: IndexPath(row: 0, section: 0)))
                let height = table.rectForRow(at: IndexPath(row: 0, section: 0)).height
                XCTAssertGreaterThan(height, 150)
                XCTAssertLessThan(height, 600, "One image selection must not become three full-height posters")
                window.isHidden = true; window.rootViewController = nil
            }
        }
    }

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
            // The editor uses the full surface width; actions occupy the separate bottom row.
            XCTAssertLessThanOrEqual(frame.maxX, width - 12)
            XCTAssertGreaterThan(editor.contentSize.height, editor.font?.lineHeight ?? 0)
        }
        let editor = try XCTUnwrap(descendants(host.view, of: UITextView.self).first)
        editor.selectedRange = NSRange(location: 4, length: 8)
        host.rootView = NativeComposer(draft: draft, conversation: conversation,
            expanded: .constant(true), onIntent: { _ in }, showModels: {}, maximumHeight: 500)
        await layout(host, width: 320, height: 500)
        let expanded = try XCTUnwrap(descendants(host.view, of: UITextView.self).first)
        XCTAssertTrue(expanded === editor)
        XCTAssertEqual(expanded.text, text)
        XCTAssertEqual(expanded.selectedRange, NSRange(location: 4, length: 8))
        XCTAssertLessThanOrEqual(expanded.convert(expanded.bounds, to: host.view).maxX, 308)
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
