import SwiftUI
import UIKit
import XCTest
@testable import ClawketUI

final class NativeCopyFeedbackTests: XCTestCase {
    @MainActor func testAssistantCopyConfirmsExactBytesWithoutMovingTheCodeCard() async throws {
        let route = ConversationID(connectionID: "copy", agentID: "agent", sessionID: "code")
        let model = ClientPresentation(), prefix = "Explanation\n"
        let body = "  let name = \"é\"\r\n\tprint(name) // **literal**\r\n"
        var beforeCopy: [String?] = []
        func row(_ body: String) -> NativeMessageRow {
            NativeMessageRow(message: .init(id: "reply", author: .agent(name: "Agent", label: nil),
                content: [.markdown(prefix + "```swift\r\n" + body + "```\r\nAfter")], isStreaming: true),
                conversationID: route, model: model, onIntent: { _ in },
                onReadingInteraction: { beforeCopy.append(UIPasteboard.general.string) })
        }
        let host = UIHostingController(rootView: row(body)), fixture = try attach(host, largest: true)
        defer { fixture.close() }
        await layout(host)
        let id = "copy-code-reply-0-fence-\(prefix.utf8.count)"
        let button = try XCTUnwrap(descendants(host.view, UIButton.self).first { $0.accessibilityIdentifier == id })
        let code = try XCTUnwrap(descendants(host.view, UITextView.self).first { $0.text.utf8.elementsEqual(body.utf8) })
        let attributed = button.titleLabel?.attributedText
        let displayedFont = attributed.flatMap { $0.length > 0 ? $0.attribute(.font, at: 0, effectiveRange: nil) as? UIFont : nil }
            ?? button.titleLabel?.font
        XCTAssertGreaterThan(try XCTUnwrap(displayedFont).pointSize, 40)
        let frame = button.convert(button.bounds, to: host.view), codeFrame = code.convert(code.bounds, to: host.view)
        UIPasteboard.general.string = "before copy"
        button.sendActions(for: .touchUpInside)
        XCTAssertEqual(beforeCopy, ["before copy"], "Reading pauses before the clipboard write")
        XCTAssertEqual(Data(try XCTUnwrap(UIPasteboard.general.string).utf8), Data(body.utf8))
        XCTAssertEqual(button.configuration?.title, String(localized: "Copied"))
        XCTAssertEqual(button.accessibilityLabel, String(localized: "Copy code"))
        XCTAssertEqual(button.accessibilityValue, String(localized: "Copied"))
        await layout(host)
        assertSameFrame(button.convert(button.bounds, to: host.view), frame)
        assertSameFrame(code.convert(code.bounds, to: host.view), codeFrame)
        XCTAssertGreaterThanOrEqual(button.bounds.width, 44); XCTAssertGreaterThanOrEqual(button.bounds.height, 44)

        let corrected = body.replacingOccurrences(of: "é", with: "e\u{301}") + "// latest\r\n"
        host.rootView = row(corrected)
        await layout(host)
        let updated = try XCTUnwrap(descendants(host.view, UIButton.self).first { $0.accessibilityIdentifier == id })
        XCTAssertTrue(updated === button)
        updated.sendActions(for: .touchUpInside)
        XCTAssertEqual(Data(try XCTUnwrap(beforeCopy.last ?? nil).utf8), Data(body.utf8))
        XCTAssertEqual(Data(try XCTUnwrap(UIPasteboard.general.string).utf8), Data(corrected.utf8))
        XCTAssertEqual(updated.accessibilityValue, String(localized: "Copied"))
    }

    @MainActor func testToolOriginalCopyUsesTheSameFeedbackAndRetainsLiteralText() async throws {
        let model = ClientPresentation(), route = ConversationID(connectionID: "copy", agentID: "agent", sessionID: "tool")
        let text = "# raw **output**\r\n\t```literal``` e\u{301}\r\n"
        model.expandedContentIDs.insert("tool-0")
        var paused = false
        let row = NativeMessageRow(message: .init(id: "tool", author: .system, content: [.toolOutput(.init(text: text))]),
            conversationID: route, model: model, onIntent: { _ in }, onReadingInteraction: {
                XCTAssertEqual(UIPasteboard.general.string, "tool sentinel")
                paused = true
            })
        let host = UIHostingController(rootView: row), fixture = try attach(host)
        defer { fixture.close() }
        await layout(host)
        let button = try XCTUnwrap(descendants(host.view, UIButton.self).first {
            $0.accessibilityIdentifier == "copy-tool-output-tool-0"
        })
        let frame = button.convert(button.bounds, to: host.view)
        UIPasteboard.general.string = "tool sentinel"
        button.sendActions(for: .touchUpInside)
        XCTAssertTrue(paused)
        XCTAssertEqual(Data(try XCTUnwrap(UIPasteboard.general.string).utf8), Data(text.utf8))
        XCTAssertEqual(button.configuration?.title, String(localized: "Copied"))
        XCTAssertEqual(button.accessibilityValue, String(localized: "Copied"))
        await layout(host)
        assertSameFrame(button.convert(button.bounds, to: host.view), frame)
    }

    @MainActor func testRepeatedCopiesAndDetachedControlsRetireOnlyTheirOwnFeedback() async throws {
        let gate = CopyResetGate()
        var successes = 0, pauses = 0
        let effects = NativeCopyFeedbackEffects(delay: { await gate.wait() }, succeeded: { _ in successes += 1 })
        func control(_ id: String, text: String = "first\r\n") -> some View {
            NativeCopyButton(text: text, accessibilityIdentifier: id, effects: effects) { pauses += 1 }.id(id)
        }
        let host = UIHostingController(rootView: control("first")), fixture = try attach(host)
        defer { gate.finishAll(); fixture.close() }
        await layout(host)
        let first = try XCTUnwrap(descendants(host.view, UIButton.self).first { $0.accessibilityIdentifier == "first" })
        first.sendActions(for: .touchUpInside)
        try await waitUntil { gate.pending == 1 }
        first.sendActions(for: .touchUpInside)
        try await waitUntil { gate.pending == 2 }
        gate.finish(0)
        await settle()
        XCTAssertEqual(first.accessibilityValue, String(localized: "Copied"), "An older reset cannot clear a newer click")
        XCTAssertEqual(successes, 2); XCTAssertEqual(pauses, 2)
        gate.finish(1)
        try await waitUntil { first.accessibilityValue == nil }
        XCTAssertEqual(first.configuration?.title, String(localized: "Copy"))

        first.sendActions(for: .touchUpInside)
        try await waitUntil { gate.pending == 1 }
        host.rootView = control("replacement", text: "e\u{301}\r\nreplacement")
        await layout(host)
        let replacement = try XCTUnwrap(descendants(host.view, UIButton.self).first { $0.accessibilityIdentifier == "replacement" })
        XCTAssertFalse(first === replacement)
        replacement.sendActions(for: .touchUpInside)
        try await waitUntil { gate.pending == 2 }
        gate.finish(2)
        await settle()
        XCTAssertEqual(replacement.accessibilityValue, String(localized: "Copied"))
        XCTAssertEqual(Data(try XCTUnwrap(UIPasteboard.general.string).utf8), Data("e\u{301}\r\nreplacement".utf8))
        host.view.removeFromSuperview()
        XCTAssertNil(replacement.window)
        XCTAssertNil(replacement.accessibilityValue)
        UIPasteboard.general.string = "after disappearance"
        gate.finish(3)
        await settle()
        XCTAssertEqual(UIPasteboard.general.string, "after disappearance")
        XCTAssertEqual(successes, 4); XCTAssertEqual(pauses, 4)

        fixture.container.view.addSubview(host.view)
        host.rootView = control("empty", text: "")
        await layout(host)
        let empty = try XCTUnwrap(descendants(host.view, UIButton.self).first { $0.accessibilityIdentifier == "empty" })
        XCTAssertFalse(empty.isEnabled)
        empty.sendActions(for: .touchUpInside)
        XCTAssertNil(empty.accessibilityValue)
        XCTAssertEqual(successes, 4); XCTAssertEqual(pauses, 4)
        XCTAssertEqual(UIPasteboard.general.string, "after disappearance")
    }

    @MainActor private struct Fixture {
        let window: UIWindow
        let container: UIViewController
        let prior: UIWindow?
        func close() { window.isHidden = true; window.rootViewController = nil; prior?.makeKeyAndVisible() }
    }
    @MainActor private func attach<Content: View>(_ host: UIHostingController<Content>, largest: Bool = false) throws -> Fixture {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive })
        let prior = scene.windows.first { $0.isKeyWindow }, window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 320, height: 850)
        let container = UIViewController(); window.rootViewController = container
        container.loadViewIfNeeded(); container.addChild(host); container.view.addSubview(host.view); host.didMove(toParent: container)
        if largest { container.setOverrideTraitCollection(.init(preferredContentSizeCategory: .accessibilityExtraExtraExtraLarge), forChild: host) }
        host.safeAreaRegions = []; window.makeKeyAndVisible()
        return .init(window: window, container: container, prior: prior)
    }
    @MainActor private func layout<Content: View>(_ host: UIHostingController<Content>) async {
        host.view.frame = CGRect(x: 0, y: 0, width: 320, height: 850)
        for _ in 0..<8 {
            host.view.setNeedsLayout(); host.view.layoutIfNeeded(); CATransaction.flush()
            try? await Task.sleep(for: .milliseconds(10))
        }
    }
    @MainActor private func settle() async { for _ in 0..<8 { await Task.yield() } }
    @MainActor private func waitUntil(_ condition: () -> Bool) async throws {
        let deadline = ContinuousClock.now + .seconds(3)
        while !condition() {
            guard ContinuousClock.now < deadline else { XCTFail("Copy state did not settle"); throw CopyWaitFailure.timeout }
            try await Task.sleep(for: .milliseconds(10))
        }
    }
    @MainActor private func assertSameFrame(_ actual: CGRect, _ expected: CGRect, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(actual.minX, expected.minX, accuracy: 0.5, file: file, line: line)
        XCTAssertEqual(actual.minY, expected.minY, accuracy: 0.5, file: file, line: line)
        XCTAssertEqual(actual.width, expected.width, accuracy: 0.5, file: file, line: line)
        XCTAssertEqual(actual.height, expected.height, accuracy: 0.5, file: file, line: line)
    }
    @MainActor private func descendants<T: UIView>(_ root: UIView, _ type: T.Type) -> [T] {
        (root as? T).map { [$0] } ?? root.subviews.flatMap { descendants($0, type) }
    }
}

private enum CopyWaitFailure: Error { case timeout }
@MainActor private final class CopyResetGate {
    private var next = 0
    private var continuations: [Int: CheckedContinuation<Void, Never>] = [:]
    var pending: Int { continuations.count }
    func wait() async {
        await withCheckedContinuation { continuation in
            continuations[next] = continuation; next += 1
        }
    }
    func finish(_ id: Int) { continuations.removeValue(forKey: id)?.resume() }
    func finishAll() {
        let values = Array(continuations.values); continuations.removeAll()
        for continuation in values { continuation.resume() }
    }
}
