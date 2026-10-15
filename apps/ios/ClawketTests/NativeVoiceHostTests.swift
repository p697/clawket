import ClawketSpeech
import ClawketTransport
import CryptoKit
import Foundation
import SwiftUI
import UIKit
import XCTest
@testable import Clawket
@testable import ClawketUI

private actor VoiceHostDriver: SpeechAudioDriver {
    let deny: Bool
    let wait: Bool
    var permission: CheckedContinuation<Void, Never>?
    var starts = 0
    var stops = 0
    init(deny: Bool = false, wait: Bool = false) { self.deny = deny; self.wait = wait }
    func requestPermission() async throws {
        if deny { throw SpeechFailure(.permission) }
        if wait { await withCheckedContinuation { permission = $0 } }
    }
    func allow() { let old = permission; permission = nil; old?.resume() }
    func start(id: UUID) -> AsyncThrowingStream<SpeechCaptureChunk, any Error> { starts += 1; return AsyncThrowingStream { $0.finish() } }
    func stop(id: UUID) { stops += 1 }
}

private actor VoiceHostSocket: SpeechSocket {
    var first = true
    var waiter: CheckedContinuation<WebSocketFrame, any Error>?
    var finishing = false
    var closed = false
    func open() {}
    func send(_ frame: WebSocketFrame) { if case .text = frame { finishing = true } }
    func receive() async throws -> WebSocketFrame {
        if first { first = false; return .text("{\"type\":\"ready\",\"maxSeconds\":120,\"flowControl\":\"ack.v1\"}") }
        guard !closed else { throw SpeechFailure(.cancelled) }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { waiter = $0 }
        } onCancel: { Task { await self.close() } }
    }
    func close() { closed = true; let old = waiter; waiter = nil; old?.resume(throwing: SpeechFailure(.cancelled)) }
}
private struct VoiceHostSocketFactory: SpeechSocketFactory {
    let socket: VoiceHostSocket
    func makeSocket(request: URLRequest) -> any SpeechSocket { socket }
}

final class NativeVoiceHostTests: XCTestCase, @unchecked Sendable {
    private var route: ConversationID { .init(connectionID: "voice", agentID: "agent", sessionID: "session") }
    private func root() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("voice-host-" + UUID().uuidString) }
    @MainActor private func context(_ draft: ComposerDraft) -> NativeVoiceContext {
        .init(route: route, activation: UUID(), selection: UUID(), draftRevision: draft.editRevision, text: draft.text, attachments: [])
    }
    private func recording(_ store: SpeechRecordingStore) async throws -> SpeechRecording {
        let value = try await store.create(scope: .init(connectionID: route.connectionID, agentID: route.agentID, sessionKey: route.sessionID), draft: "prefix")
        _ = try await store.append(Data([0, 0]), to: value.id); try await store.close(value.id)
        try await store.checkpoint(value.id, index: 0, byteCount: 2, text: "transcript")
        return try await store.recording(value.id)
    }

    @MainActor func testFreshExplicitSendRejectsDraftABASelectionActivationAndUncertainOutbox() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let saved = try await recording(SpeechRecordingStore(directory: directory))
        let draft = ComposerDraft(conversationID: route, text: "prefix"), captured = context(draft)
        let result = NativeVoiceResult(id: UUID(), context: captured, recording: saved, text: "transcript", isRecovery: false, explicitlySend: true)
        XCTAssertTrue(NativeVoicePolicy.canFinishAndSend(result, current: captured, uncertain: false))
        XCTAssertFalse(NativeVoicePolicy.canFinishAndSend(result, current: captured, uncertain: true))
        draft.text = "changed"; draft.text = "prefix"
        let aba = NativeVoiceContext(route: route, activation: captured.activation, selection: captured.selection,
            draftRevision: draft.editRevision, text: draft.text, attachments: [])
        XCTAssertFalse(NativeVoicePolicy.canFinishAndSend(result, current: aba, uncertain: false))
        for replacement in [NativeVoiceContext(route: route, activation: UUID(), selection: captured.selection, draftRevision: captured.draftRevision, text: captured.text, attachments: []),
                            NativeVoiceContext(route: route, activation: captured.activation, selection: UUID(), draftRevision: captured.draftRevision, text: captured.text, attachments: [])] {
            XCTAssertFalse(NativeVoicePolicy.canFinishAndSend(result, current: replacement, uncertain: false))
        }
    }
    @MainActor func testRecoveredTextNeverRevivesAnExplicitSendIntent() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let saved = try await recording(SpeechRecordingStore(directory: directory))
        let current = context(ComposerDraft(conversationID: route))
        let result = NativeVoiceResult(id: UUID(), context: current, recording: saved, text: "transcript", isRecovery: true, explicitlySend: true)
        XCTAssertFalse(NativeVoicePolicy.canFinishAndSend(result, current: current, uncertain: false))
        XCTAssertFalse(NativeVoicePolicy.canFinishAndSend(result, current: nil, uncertain: false))
    }
    func testPrefixMatchesMobileTrimEndWithoutDiscardingLeadingWhitespace() {
        XCTAssertEqual(NativeVoicePolicy.combined("  typed \n", transcript: "spoken"), "  typed spoken")
        XCTAssertEqual(NativeVoicePolicy.combined("", transcript: "spoken"), "spoken")
    }
    @MainActor func testAttachmentIdentityChangesDraftGenerationButThumbnailUpdatesDoNot() {
        let draft = ComposerDraft(conversationID: route, text: "same"), original = draft.editRevision
        draft.attachments = [.init(id: "one", name: "photo", kind: .image)]
        let attached = draft.editRevision; XCTAssertNotEqual(attached, original)
        draft.attachments[0].thumbnailData = Data([1]); XCTAssertEqual(draft.editRevision, attached)
        draft.attachments = []; XCTAssertNotEqual(draft.editRevision, original); XCTAssertNotEqual(draft.editRevision, attached)
    }
    @MainActor func testNativeInsertionPreservesCaretUndoAndReturnsExplicitResult() async throws {
        let draft = ComposerDraft(conversationID: route, text: "left right")
        var acknowledgements: [(UUID, String?)] = []
        let host = UIHostingController(rootView: NativeComposer(draft: draft,
            conversation: .init(id: route, agentName: "Agent", sessionTitle: "Voice", features: [.send: .available]),
            expanded: .constant(false), onIntent: { intent in
                if case let .composerInsertionApplied(_, id, text) = intent { acknowledgements.append((id, text)) }
            }, showModels: {}))
        let window = attach(host); defer { window.isHidden = true; window.rootViewController = nil }
        await layout(host)
        let editor = try XCTUnwrap(descendants(host.view, of: UITextView.self).first)
        editor.becomeFirstResponder(); defer { editor.resignFirstResponder() }
        editor.selectedRange = NSRange(location: 5, length: 0)
        let id = draft.insertText("spoken ", acknowledgement: true, expectedRevision: draft.editRevision)
        await layout(host)
        XCTAssertEqual(editor.text, "left spoken right"); XCTAssertEqual(acknowledgements.first?.0, id)
        XCTAssertEqual(acknowledgements.first?.1, "left spoken right"); XCTAssertTrue(editor.undoManager?.canUndo == true)
        editor.undoManager?.undo(); XCTAssertEqual(editor.text, "left right")
    }
    @MainActor func testQueuedInsertionRejectsChangedDraftEvenAfterTextReturnsToOriginal() async throws {
        let draft = ComposerDraft(conversationID: route, text: "original")
        var rejected: UUID?
        let host = UIHostingController(rootView: NativeComposer(draft: draft,
            conversation: .init(id: route, agentName: "Agent", sessionTitle: "Voice", features: [.send: .available]),
            expanded: .constant(false), onIntent: { intent in
                if case let .composerInsertionApplied(_, id, nil) = intent { rejected = id }
            }, showModels: {}))
        let window = attach(host); defer { window.isHidden = true; window.rootViewController = nil }
        await layout(host)
        let expected = draft.editRevision
        let id = draft.insertText("late", acknowledgement: true, expectedRevision: expected)
        draft.text = "other"; draft.text = "original"
        await layout(host)
        XCTAssertEqual(rejected, id); XCTAssertEqual(draft.text, "original")
        XCTAssertNil(draft.insertion)
    }
    func testDurableHandoffChecksActualCurrentDocumentRevisionAndExactScope() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let cache = try NativeConversationStore(directory: directory)
        let before = try await cache.verifiedVoiceDraft("spoken", minimumRevision: 1, connectionID: "voice", agentID: "agent", sessionID: "session")
        XCTAssertFalse(before)
        try await cache.write(.init(revision: 2, draft: "spoken"), connectionID: "voice", agentID: "agent", sessionID: "session")
        let committed = try await cache.verifiedVoiceDraft("spoken", minimumRevision: 2, connectionID: "voice", agentID: "agent", sessionID: "session")
        let stale = try await cache.verifiedVoiceDraft("spoken", minimumRevision: 3, connectionID: "voice", agentID: "agent", sessionID: "session")
        let wrong = try await cache.verifiedVoiceDraft("spoken", minimumRevision: 2, connectionID: "other", agentID: "agent", sessionID: "session")
        XCTAssertTrue(committed); XCTAssertFalse(stale); XCTAssertFalse(wrong)
        try await cache.write(.init(revision: 3, draft: "later edit"), connectionID: "voice", agentID: "agent", sessionID: "session")
        let replaced = try await cache.verifiedVoiceDraft("spoken", minimumRevision: 2, connectionID: "voice", agentID: "agent", sessionID: "session")
        XCTAssertFalse(replaced)
    }
    @MainActor func testCompletedRecordingReviewsOfflineWithoutIdentityOrMicrophone() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let driver = VoiceHostDriver(), controller = try NativeVoiceController(directory: directory, serviceURL: "", driver: driver) {
            XCTFail("Cached review must not read an identity"); throw SpeechFailure(.authentication)
        }
        let saved = try await recording(controller.store), current = context(ComposerDraft(conversationID: route))
        var result: NativeVoiceResult?
        controller.onResult = { result = $0 }
        controller.retry(saved, context: current)
        await eventually { result != nil }
        XCTAssertEqual(result?.text, "transcript"); XCTAssertTrue(result?.isRecovery == true); XCTAssertFalse(result?.explicitlySend == true)
        let starts = await driver.starts; XCTAssertEqual(starts, 0)
        let retained = try await controller.store.recording(saved.id); XCTAssertEqual(retained.bytes, 2)
    }
    @MainActor func testRetiredCachedReviewCannotPublishLateResult() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let controller = try NativeVoiceController(directory: directory, serviceURL: "", driver: VoiceHostDriver()) { throw SpeechFailure(.authentication) }
        let saved = try await recording(controller.store)
        var results = 0; controller.onResult = { _ in results += 1 }
        controller.retry(saved, context: context(ComposerDraft(conversationID: route))); controller.retire()
        for _ in 0..<30 { await Task.yield() }
        XCTAssertEqual(results, 0)
        let retained = try await controller.store.recording(saved.id); XCTAssertEqual(retained.bytes, 2)
    }
    @MainActor func testDeniedAndLatePermissionCannotCreatePCMOrStartAnOldCapture() async throws {
        for denied in [true, false] {
            let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
            let driver = VoiceHostDriver(deny: denied, wait: !denied)
            let controller = try NativeVoiceController(directory: directory, serviceURL: "wss://speech.invalid/v1/speech", driver: driver) { throw SpeechFailure(.authentication) }
            controller.start(context(ComposerDraft(conversationID: route)))
            if denied { await eventually { controller.failure?.code == .permission } }
            else {
                await eventually { await driver.permission != nil }; controller.retire(); await driver.allow()
                for _ in 0..<30 { await Task.yield() }
            }
            let starts = await driver.starts, saved = try await controller.store.recordings()
            XCTAssertEqual(starts, 0); XCTAssertTrue(saved.isEmpty)
        }
    }
    @MainActor func testOldSheetCannotAdoptAndCancelNewRecoveryAttempt() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let socket = VoiceHostSocket()
        let controller = try NativeVoiceController(directory: directory, serviceURL: "wss://speech.invalid/v1/speech",
            driver: VoiceHostDriver(), socketFactory: VoiceHostSocketFactory(socket: socket)) {
                let seed = Data(0..<32), key = try Curve25519.Signing.PrivateKey(rawRepresentation: seed)
                return .init(publicKey: key.publicKey.rawRepresentation, tweetNaClSecretKey: seed + key.publicKey.rawRepresentation)
            }
        let created = try await controller.store.create(scope: .init(connectionID: route.connectionID, agentID: route.agentID, sessionKey: route.sessionID), draft: "")
        _ = try await controller.store.append(Data([0, 0]), to: created.id); try await controller.store.close(created.id)
        let saved = try await controller.store.recording(created.id)
        let firstContext = context(ComposerDraft(conversationID: route))
        let firstID = try XCTUnwrap(controller.retry(saved, context: firstContext))
        let oldRequest = NativeVoiceSheetRequest(context: firstContext, attemptID: firstID)
        controller.retire()
        let secondContext = context(ComposerDraft(conversationID: route))
        let secondID = try XCTUnwrap(controller.retry(saved, context: secondContext))
        let newRequest = NativeVoiceSheetRequest(context: secondContext, attemptID: secondID)
        await eventually { await socket.finishing }
        let client = NativeAppModel(); client.voice = controller; client.voiceSheet = newRequest
        XCTAssertNil(client.retryVoice(saved, sheet: oldRequest))
        let host = UIHostingController(rootView: NativeVoiceSheet(client: client, voice: controller, request: oldRequest))
        let window = attach(host); await layout(host)
        window.isHidden = true; window.rootViewController = nil
        for _ in 0..<30 { await Task.yield() }
        XCTAssertEqual(controller.attempt?.id, secondID)
        controller.retire()
    }
    @MainActor func testHiddenConversationStopsOnlyItsExactVoiceViewAndPreservesAudio() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let socket = VoiceHostSocket()
        let controller = try NativeVoiceController(directory: directory, serviceURL: "wss://speech.invalid/v1/speech",
            driver: VoiceHostDriver(), socketFactory: VoiceHostSocketFactory(socket: socket)) {
                let seed = Data(0..<32), key = try Curve25519.Signing.PrivateKey(rawRepresentation: seed)
                return .init(publicKey: key.publicKey.rawRepresentation, tweetNaClSecretKey: seed + key.publicKey.rawRepresentation)
            }
        let created = try await controller.store.create(scope: .init(connectionID: route.connectionID, agentID: route.agentID, sessionKey: route.sessionID), draft: "unsent")
        _ = try await controller.store.append(Data([0, 0]), to: created.id); try await controller.store.close(created.id)
        let saved = try await controller.store.recording(created.id)
        let attempt = try XCTUnwrap(controller.retry(saved, context: context(ComposerDraft(conversationID: route))))
        let client = NativeAppModel(); client.voice = controller
        let oldView = UUID(), currentView = UUID(), selection = client.selectionRevision
        client.handle(.conversationVisibilityChanged(route, viewID: oldView, visible: true))
        client.handle(.conversationVisibilityChanged(route, viewID: currentView, visible: true))
        client.handle(.conversationVisibilityChanged(route, viewID: oldView, visible: false))
        XCTAssertEqual(controller.attempt?.id, attempt)
        client.handle(.conversationVisibilityChanged(route, viewID: currentView, visible: false))
        XCTAssertNil(controller.attempt)
        XCTAssertEqual(client.selectionRevision, selection) // Native Back does not cancel the selected route's read.
        let retained = try await controller.store.recording(saved.id); XCTAssertEqual(retained.bytes, 2)
    }

    @MainActor func testComposerVoiceActionsExposeActual44PointAccessibilityButtons() async throws {
        let cases: [(String, VoicePresentation, VoiceIntent)] = [
            ("voice-stop", .init(phase: .recording, label: "Recording", canStop: true), .stop),
            ("voice-retry", .init(phase: .failed, label: "Saved", canRetry: true), .retry),
            ("voice-saved-recording", .init(phase: .recoverable, label: "Saved", canReview: true), .showRecordings)]
        for (identifier, voice, expected) in cases {
            let draft = ComposerDraft(conversationID: route); draft.voice = voice
            var actions: [VoiceIntent] = []
            let host = UIHostingController(rootView: NativeComposer(draft: draft,
                conversation: .init(id: route, agentName: "Agent", sessionTitle: "Voice"), expanded: .constant(false),
                onIntent: { if case let .voice(_, action) = $0 { actions.append(action) } }, showModels: {}))
            let window = attach(host); defer { window.isHidden = true; window.rootViewController = nil }
            await layout(host)
            let element = try XCTUnwrap(accessibilityElement(identifier, in: host.view))
            XCTAssertGreaterThanOrEqual(element.accessibilityFrame.width, 44)
            XCTAssertGreaterThanOrEqual(element.accessibilityFrame.height, 44)
            XCTAssertTrue(element.accessibilityTraits.contains(.button))
            XCTAssertTrue(element.accessibilityActivate())
            XCTAssertEqual(actions, [expected])
        }
    }

    @MainActor func testSavedRecordingRetryAndDeleteHave44PointAccessibilityFrames() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let controller = try NativeVoiceController(directory: directory, serviceURL: "", driver: VoiceHostDriver()) { throw SpeechFailure(.authentication) }
        _ = try await recording(controller.store); await controller.restore()
        let request = NativeVoiceSheetRequest(context: context(ComposerDraft(conversationID: route)))
        let client = NativeAppModel(); client.voice = controller; client.voiceSheet = request
        let host = UIHostingController(rootView: NativeVoiceSheet(client: client, voice: controller, request: request))
        let window = attach(host); defer { window.isHidden = true; window.rootViewController = nil }
        await layout(host)
        for identifier in ["voice-recording-retry", "voice-recording-delete"] {
            let element = try XCTUnwrap(accessibilityElement(identifier, in: host.view))
            XCTAssertGreaterThanOrEqual(element.accessibilityFrame.width, 44)
            XCTAssertGreaterThanOrEqual(element.accessibilityFrame.height, 44)
            XCTAssertTrue(element.accessibilityTraits.contains(.button))
        }
    }

    @MainActor private func accessibilityElement(_ identifier: String, in root: NSObject) -> NSObject? {
        var visited: Set<ObjectIdentifier> = []
        func find(_ object: NSObject, depth: Int) -> NSObject? {
            guard depth < 32, visited.insert(ObjectIdentifier(object)).inserted else { return nil }
            if (object as? any UIAccessibilityIdentification)?.accessibilityIdentifier == identifier { return object }
            if let children = object.accessibilityElements as? [NSObject] {
                for child in children { if let match = find(child, depth: depth + 1) { return match } }
            }
            let count = object.accessibilityElementCount()
            if (0...1_024).contains(count) {
                for index in 0..<count {
                    if let child = object.accessibilityElement(at: index) as? NSObject,
                       let match = find(child, depth: depth + 1) { return match }
                }
            }
            if let view = object as? UIView {
                for child in view.subviews { if let match = find(child, depth: depth + 1) { return match } }
            }
            return nil
        }
        return find(root, depth: 0)
    }

    @MainActor private func eventually(_ condition: () async -> Bool) async {
        let deadline = ContinuousClock.now.advanced(by: .seconds(3))
        while ContinuousClock.now < deadline { if await condition() { return }; await Task.yield() }
        XCTFail("Voice host fixture condition was not reached")
    }
    @MainActor private func attach<Content: View>(_ host: UIHostingController<Content>) -> UIWindow {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 360, height: 700))
        window.rootViewController = host; window.isHidden = false; return window
    }
    @MainActor private func layout<Content: View>(_ host: UIHostingController<Content>) async {
        for _ in 0..<8 { host.view.setNeedsLayout(); host.view.layoutIfNeeded(); CATransaction.flush(); try? await Task.sleep(for: .milliseconds(10)) }
    }
    @MainActor private func descendants<T: UIView>(_ view: UIView, of type: T.Type) -> [T] {
        (view as? T).map { [$0] } ?? view.subviews.flatMap { descendants($0, of: type) }
    }
}
