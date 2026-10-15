import ClawketSpeech
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
