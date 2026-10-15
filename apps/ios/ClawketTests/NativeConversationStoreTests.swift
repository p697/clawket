import ClawketPersistence
import Foundation
import XCTest
@testable import Clawket

final class NativeConversationStoreTests: XCTestCase, @unchecked Sendable {
    func testQueuedEditPreservesComposerAndIdempotencyWithoutDispatching() throws {
        var conversation = NativeConversation()
        conversation.draft = "Keep my current unsent draft"
        conversation.messages = [NativeMessage(id: "pending", role: .user, local: true,
            text: "Original queued text", idempotencyKey: "same-request", delivery: .queued)]
        let edit = try conversation.holdForEditing(messageID: "pending")
        XCTAssertEqual(conversation.messages[0].delivery, .held)
        try conversation.apply(edit, text: "Edited queued text")
        XCTAssertEqual(conversation.draft, "Keep my current unsent draft")
        XCTAssertEqual(conversation.messages.count, 1)
        XCTAssertEqual(conversation.messages[0].id, "pending")
        XCTAssertEqual(conversation.messages[0].idempotencyKey, "same-request")
        XCTAssertEqual(conversation.messages[0].text, "Edited queued text")
        XCTAssertEqual(conversation.messages[0].delivery, .held)
    }

    func testClosingQueuedEditorKeepsMessageHeldAfterRecovery() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try NativeConversationStore(directory: directory)
        var conversation = NativeConversation()
        conversation.draft = "A separate draft"
        conversation.messages = [NativeMessage(id: "pending", role: .user, local: true,
            text: "Original", idempotencyKey: "stable-request", delivery: .queued)]
        _ = try conversation.holdForEditing(messageID: "pending")
        // Dismissing has no apply/send operation. Persisting the paused state is enough.
        try await store.write(conversation, connectionID: "c", agentID: "a", sessionID: "s")
        let reopened = try NativeConversationStore(directory: directory)
        let recovered = try await reopened.read(connectionID: "c", agentID: "a", sessionID: "s")
        XCTAssertEqual(recovered.messages[0].text, "Original")
        XCTAssertEqual(recovered.messages[0].delivery, .held)
        XCTAssertEqual(recovered.draft, "A separate draft")
    }

    func testStaleEditorCannotChangeDeliveredOrReplacedMessage() throws {
        var original = NativeConversation()
        original.messages = [NativeMessage(id: "pending", role: .user, local: true,
            text: "Original", idempotencyKey: "stable-request", delivery: .queued)]
        let edit = try original.holdForEditing(messageID: "pending")
        let states: [NativeDelivery] = [.sending, .sent, .delivered, .uncertain, .failed, .queued]
        for state in states {
            var changed = original; changed.messages[0].delivery = state
            XCTAssertThrowsError(try changed.apply(edit, text: "Replacement"))
            XCTAssertEqual(changed.messages[0].text, "Original")
        }
        var changed = original; changed.messages[0].text = "Newer text"
        XCTAssertThrowsError(try changed.apply(edit, text: "Replacement"))
        changed = original; changed.messages[0].idempotencyKey = "another-request"
        XCTAssertThrowsError(try changed.apply(edit, text: "Replacement"))
        changed = original; changed.messages = []
        XCTAssertThrowsError(try changed.apply(edit, text: "Replacement"))
    }

    func testOnlyUndispatchedLocalUserMessagesCanBeEditedOrRemoved() throws {
        let states: [NativeDelivery] = [.queued, .held, .failed, .sending, .sent, .delivered, .uncertain]
        for state in states {
            var conversation = NativeConversation()
            conversation.messages = [NativeMessage(id: "pending", role: .user, local: true,
                text: "Original", idempotencyKey: "stable-request", delivery: state)]
            if [.queued, .held, .failed].contains(state) {
                var edited = conversation
                XCTAssertNoThrow(try edited.holdForEditing(messageID: "pending"))
                XCTAssertNoThrow(try conversation.removePending(messageID: "pending"))
                XCTAssertTrue(conversation.messages.isEmpty)
            } else {
                XCTAssertThrowsError(try conversation.holdForEditing(messageID: "pending"))
                XCTAssertThrowsError(try conversation.removePending(messageID: "pending"))
            }
        }
        for message in [
            NativeMessage(id: "pending", role: .user, text: "External participant", idempotencyKey: "remote", delivery: .queued),
            NativeMessage(id: "pending", role: .assistant, local: true, text: "Assistant", idempotencyKey: "remote", delivery: .held),
            NativeMessage(id: "pending", role: .user, local: true, text: "No identity", delivery: .held),
        ] {
            var conversation = NativeConversation(); conversation.messages = [message]
            XCTAssertThrowsError(try conversation.holdForEditing(messageID: "pending"))
            XCTAssertThrowsError(try conversation.removePending(messageID: "pending"))
        }
    }

    func testEmptyEditDoesNotDestroyOriginalOrComposer() throws {
        var conversation = NativeConversation(); conversation.draft = "Separate draft"
        conversation.messages = [NativeMessage(id: "pending", role: .user, local: true,
            text: "Original", idempotencyKey: "stable-request", delivery: .queued)]
        let edit = try conversation.holdForEditing(messageID: "pending")
        XCTAssertThrowsError(try conversation.apply(edit, text: " \n\t"))
        XCTAssertEqual(conversation.messages[0].text, "Original")
        XCTAssertEqual(conversation.draft, "Separate draft")
    }

    func testDevelopmentAppCanRoundTripItsOwnKeychainItem() async throws {
        let values = try KeychainValueStore(service: "com.p697.clawket.nativeqa.tests." + UUID().uuidString)
        let original = Data("native development keychain".utf8)
        try await values.write(original, for: "credential")
        let recovered = try await values.read("credential")
        XCTAssertEqual(recovered, original)
        try await values.remove("credential")
        let removed = try await values.read("credential")
        XCTAssertNil(removed)
    }

    func testInterruptedSendingBecomesUncertainAndQueuedBecomesHeld() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try NativeConversationStore(directory: directory)
        let states: [NativeDelivery] = [.queued, .sending, .sent, .uncertain, .failed, .delivered]
        var conversation = NativeConversation()
        conversation.revision = 5
        conversation.draft = "下一条尚未发送"
        conversation.messages = states.enumerated().map { index, delivery in
            NativeMessage(id: "local-\(index)", role: .user, local: true, text: "original \(index)",
                idempotencyKey: "idempotency-\(index)", delivery: delivery)
        }
        try await store.write(conversation, connectionID: "c", agentID: "a", sessionID: "s")
        let recovered = try await store.read(connectionID: "c", agentID: "a", sessionID: "s")
        XCTAssertEqual(recovered.messages.map(\.delivery), [.held, .uncertain, .sent, .uncertain, .failed, .delivered])
        XCTAssertEqual(recovered.messages.map(\.idempotencyKey), conversation.messages.map(\.idempotencyKey))
        XCTAssertEqual(recovered.messages.map(\.text), conversation.messages.map(\.text))
        XCTAssertEqual(recovered.draft, conversation.draft)
        let reopened = try NativeConversationStore(directory: directory)
        let again = try await reopened.read(connectionID: "c", agentID: "a", sessionID: "s")
        XCTAssertEqual(again.revision, recovered.revision)
        XCTAssertEqual(again.messages.map(\.delivery), recovered.messages.map(\.delivery))
    }

    func testScopesCannotMixConnectionsAgentsOrSessions() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try NativeConversationStore(directory: directory)
        var conversation = NativeConversation(); conversation.draft = "private"
        try await store.write(conversation, connectionID: "first", agentID: "main", sessionID: "main")
        let otherConnection = try await store.read(connectionID: "second", agentID: "main", sessionID: "main")
        let otherAgent = try await store.read(connectionID: "first", agentID: "other", sessionID: "main")
        let otherSession = try await store.read(connectionID: "first", agentID: "main", sessionID: "other")
        XCTAssertTrue(otherConnection.draft.isEmpty); XCTAssertTrue(otherAgent.draft.isEmpty); XCTAssertTrue(otherSession.draft.isEmpty)
    }

    func testLateOlderRevisionCannotOverwriteNewDraft() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try NativeConversationStore(directory: directory)
        var current = NativeConversation(); current.revision = 9; current.draft = "current"
        try await store.write(current, connectionID: "c", agentID: "a", sessionID: "s")
        var stale = current; stale.revision = 8; stale.draft = "stale"
        try await store.write(stale, connectionID: "c", agentID: "a", sessionID: "s")
        let recovered = try await store.read(connectionID: "c", agentID: "a", sessionID: "s")
        XCTAssertEqual(recovered.draft, "current")
    }

    func testCorruptCacheAndDuplicatePresentationIDsFailClosed() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let documents = try DocumentStore(values: FileValueStore(directory: directory), maximumBytes: 8 * 1024 * 1024)
        let key = try DocumentStore.scopedKey(namespace: "conversation.v1", parts: ["c", "a", "s"])
        var invalid = NativeConversation()
        invalid.messages = [NativeMessage(id: "same", role: .assistant, text: "one"), NativeMessage(id: "same", role: .assistant, text: "two")]
        try await documents.write(invalid, key: key)
        let store = try NativeConversationStore(directory: directory)
        do { _ = try await store.read(connectionID: "c", agentID: "a", sessionID: "s"); XCTFail("Accepted duplicate IDs") }
        catch { XCTAssertEqual(error as? StoreFailure, .invalidDocument) }
    }
}
