import ClawketPersistence
import Foundation
import XCTest
@testable import Clawket

final class NativeConversationStoreTests: XCTestCase, @unchecked Sendable {
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
