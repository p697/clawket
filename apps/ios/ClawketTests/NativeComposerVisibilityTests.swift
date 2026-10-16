import SwiftUI
import UIKit
import XCTest
@testable import ClawketUI

final class NativeComposerVisibilityTests: XCTestCase {
    @MainActor func testFocusedCaretStaysVisibleThroughAttachmentsResizeAndMarkedText() async throws {
        let route = ConversationID(connectionID: "caret", agentID: "agent", sessionID: "draft")
        let original = String(repeating: "Retained editable draft 中文。\n", count: 15)
        let draft = ComposerDraft(conversationID: route, text: original)
        draft.attachments = (0..<3).map {
            .init(id: "image-\($0)", name: "Long attachment filename \($0).png", kind: .image, detail: "4 KB")
        }
        let conversation = ConversationPresentation(id: route, agentName: "Agent", sessionTitle: "Conversation",
            modelTitle: "Current model", features: [.send: .available, .models: .available, .photos: .available])
        func composer(_ height: CGFloat) -> some View {
            NativeComposer(draft: draft, conversation: conversation, expanded: .constant(false),
                onIntent: { _ in }, showModels: {}, maximumHeight: height).dynamicTypeSize(.accessibility5)
        }
        let host = UIHostingController(rootView: composer(340))
        host.safeAreaRegions = []
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive })
        let priorKeyWindow = scene.windows.first { $0.isKeyWindow }
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 402, height: 874)
        let container = UIViewController()
        window.rootViewController = container
        container.loadViewIfNeeded()
        container.addChild(host)
        container.view.addSubview(host.view)
        host.didMove(toParent: container)
        window.makeKeyAndVisible()
        XCTAssertTrue(window.isKeyWindow)
        defer {
            host.view.endEditing(true)
            window.isHidden = true
            window.rootViewController = nil
            priorKeyWindow?.makeKey()
        }
        await layout(host, height: 340)
        let editor = try XCTUnwrap(descendants(host.view, UITextView.self).first)
        editor.font = UIFont.preferredFont(forTextStyle: .body,
            compatibleWith: .init(preferredContentSizeCategory: .accessibilityExtraExtraExtraLarge))
        editor.setNeedsLayout()
        await layout(host, height: 340)
        let viewport = try XCTUnwrap(enclosingScrollView(editor))
        XCTAssertGreaterThan(viewport.contentSize.height, viewport.bounds.height + 20)
        XCTAssertTrue(editor.becomeFirstResponder())
        editor.selectedRange = NSRange(location: original.utf16.count - 12, length: 0)
        editor.delegate?.textViewDidChangeSelection?(editor)
        let selection = editor.selectedRange
        for height in [CGFloat(340), 150, 340] {
            host.rootView = composer(height)
            await layout(host, height: height)
            XCTAssertTrue(descendants(host.view, UITextView.self).first === editor)
            XCTAssertEqual(editor.selectedRange, selection)
            XCTAssertEqual(editor.text, original)
            XCTAssertEqual(draft.text, original)
            try assertVisibleCaret(editor, in: host.view)
        }

        // Reviewing attachments may move the outer viewport away. The next
        // actual edit must reveal the caret again without rebuilding TextKit.
        viewport.setContentOffset(CGPoint(x: 0, y: -viewport.adjustedContentInset.top), animated: false)
        let reviewingOffset = viewport.contentOffset
        editor.setNeedsLayout()
        await layout(host, height: 340)
        XCTAssertEqual(viewport.contentOffset.y, reviewingOffset.y, accuracy: 0.5,
            "Layout alone must not pull a reader away from the attachments")
        XCTAssertEqual(editor.selectedRange, selection)
        editor.insertText("追加")
        await layout(host, height: 340)
        try assertVisibleCaret(editor, in: host.view)
        XCTAssertTrue(editor.text.contains("追加"))
        XCTAssertEqual(draft.text, editor.text)

        editor.setMarkedText("zhong", selectedRange: NSRange(location: 5, length: 0))
        let markedText = try XCTUnwrap(editor.text)
        let markedSelection = editor.selectedRange
        let marked = try XCTUnwrap(editor.markedTextRange)
        let markedStart = editor.offset(from: editor.beginningOfDocument, to: marked.start)
        let markedEnd = editor.offset(from: editor.beginningOfDocument, to: marked.end)
        host.rootView = composer(150)
        await layout(host, height: 150)
        let retainedMarked = try XCTUnwrap(editor.markedTextRange)
        XCTAssertEqual(editor.offset(from: editor.beginningOfDocument, to: retainedMarked.start), markedStart)
        XCTAssertEqual(editor.offset(from: editor.beginningOfDocument, to: retainedMarked.end), markedEnd)
        XCTAssertTrue((editor.text ?? "").utf8.elementsEqual(markedText.utf8))
        XCTAssertEqual(editor.selectedRange, markedSelection)
        XCTAssertTrue(descendants(host.view, UITextView.self).first === editor)
        try assertVisibleCaret(editor, in: host.view)
    }

    @MainActor private func assertVisibleCaret(_ editor: UITextView, in root: UIView,
                                              file: StaticString = #filePath, line: UInt = #line) throws {
        XCTAssertTrue(editor.isFirstResponder, "The fixture must retain editing focus", file: file, line: line)
        let selection = try XCTUnwrap(editor.selectedTextRange, file: file, line: line)
        let caret = editor.textInputView.convert(editor.caretRect(for: selection.end), to: root)
        var visible = root.bounds
        var ancestor: UIView? = editor
        while let view = ancestor, view !== root {
            if view.clipsToBounds { visible = visible.intersection(view.convert(view.bounds, to: root)) }
            ancestor = view.superview
        }
        XCTAssertGreaterThan(caret.height, 40, file: file, line: line)
        XCTAssertGreaterThanOrEqual(caret.minY, visible.minY - 1, file: file, line: line)
        XCTAssertLessThanOrEqual(caret.maxY, visible.maxY + 1,
            "Editor offset \(editor.contentOffset.y), content \(editor.contentSize.height), height \(editor.bounds.height), scroll \(editor.isScrollEnabled), input is editor \(editor.textInputView === editor), input frame \(editor.textInputView.frame), input bounds \(editor.textInputView.bounds), TextKit2 \(editor.textLayoutManager != nil), usage \(String(describing: editor.textLayoutManager?.usageBoundsForTextContainer)), local caret \(editor.caretRect(for: selection.end)), frame \(editor.convert(editor.bounds, to: root)), viewport \(String(describing: enclosingScrollView(editor)?.bounds))",
            file: file, line: line)
        XCTAssertGreaterThanOrEqual(caret.minX, visible.minX - 1, file: file, line: line)
        XCTAssertLessThanOrEqual(caret.maxX, visible.maxX + 1, file: file, line: line)
    }

    @MainActor private func enclosingScrollView(_ editor: UITextView) -> UIScrollView? {
        var ancestor = editor.superview
        while let view = ancestor {
            if let scroll = view as? UIScrollView { return scroll }
            ancestor = view.superview
        }
        return nil
    }

    @MainActor private func layout<Content: View>(_ host: UIHostingController<Content>, height: CGFloat) async {
        host.view.frame = CGRect(x: 0, y: 0, width: 402, height: height)
        for _ in 0..<12 {
            host.view.setNeedsLayout()
            host.view.layoutIfNeeded()
            CATransaction.flush()
            try? await Task.sleep(for: .milliseconds(10))
        }
    }

    @MainActor private func descendants<T: UIView>(_ root: UIView, _ type: T.Type) -> [T] {
        (root as? T).map { [$0] } ?? root.subviews.flatMap { descendants($0, type) }
    }
}
