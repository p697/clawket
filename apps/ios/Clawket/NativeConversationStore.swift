import ClawketPersistence
import ClawketRuntime
import Foundation

enum NativeDelivery: String, Codable, Sendable { case queued, held, sending, sent, delivered, uncertain, failed }

struct NativeMessage: Codable, Sendable, Identifiable {
    var id: String
    var remoteID: String?
    var role: RuntimeMessage.Role
    var local = false
    var text: String
    var runID: String?
    var segmentID: String?
    var idempotencyKey: String?
    var timestampMs: Int64?
    var delivery: NativeDelivery?
    var streaming = false
    var isWork = false
}

struct NativeConversation: Codable, Sendable {
    var version = 1
    var revision: Int64 = 0
    var draft = ""
    var messages: [NativeMessage] = []
    var nextCursor: String?
    var historyLimit = 80
    var hasMore = false

    mutating func holdForEditing(messageID: String) throws -> NativePendingEdit {
        guard let index = editableIndex(messageID: messageID), let key = messages[index].idempotencyKey else {
            throw StoreFailure.invalidDocument
        }
        messages[index].delivery = .held; revision += 1
        return .init(messageID: messageID, idempotencyKey: key, originalText: messages[index].text)
    }

    mutating func apply(_ edit: NativePendingEdit, text: String) throws {
        guard let index = editableIndex(messageID: edit.messageID), messages[index].delivery == .held,
              messages[index].idempotencyKey == edit.idempotencyKey, messages[index].text == edit.originalText,
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw StoreFailure.invalidDocument }
        messages[index].text = text; revision += 1
    }

    mutating func removePending(messageID: String) throws {
        guard let index = editableIndex(messageID: messageID) else { throw StoreFailure.invalidDocument }
        messages.remove(at: index); revision += 1
    }

    private func editableIndex(messageID: String) -> Int? {
        messages.firstIndex { $0.id == messageID && $0.local && $0.role == .user && $0.idempotencyKey?.isEmpty == false &&
            [.queued, .held, .failed].contains($0.delivery) }
    }
}

/// A local editing snapshot, never authority to dispatch or to replace the composer's draft.
struct NativePendingEdit: Identifiable, Sendable {
    let id = UUID()
    let messageID: String
    let idempotencyKey: String
    let originalText: String
}

actor NativeConversationStore {
    private let documents: DocumentStore
    private var latestRevision: [String: Int64] = [:]

    init(directory: URL? = nil) throws {
        let root: URL
        if let directory { root = directory }
        else {
            let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                     appropriateFor: nil, create: true)
            root = support.appendingPathComponent("NativeConversations", isDirectory: true)
        }
        documents = try DocumentStore(values: FileValueStore(directory: root),
                                      maximumBytes: 8 * 1024 * 1024)
    }

    func read(connectionID: String, agentID: String, sessionID: String) async throws -> NativeConversation {
        let key = try scopedKey(connectionID, agentID, sessionID)
        guard var conversation = try await documents.read(NativeConversation.self, key: key)?.value else { return .init() }
        guard conversation.version == 1, conversation.revision >= 0,
              Set(conversation.messages.map(\.id)).count == conversation.messages.count else { throw StoreFailure.invalidDocument }
        latestRevision[key] = max(latestRevision[key, default: 0], conversation.revision)
        // A process exit cannot prove whether a request reached the backend.
        // Recovery keeps its exact idempotency key and never dispatches it automatically.
        var changed = false
        for index in conversation.messages.indices {
            if conversation.messages[index].local && conversation.messages[index].delivery == .sending {
                conversation.messages[index].delivery = .uncertain
                changed = true
            }
            if conversation.messages[index].local && conversation.messages[index].delivery == .queued {
                conversation.messages[index].delivery = .held
                changed = true
            }
            conversation.messages[index].streaming = false
        }
        if changed {
            conversation.revision += 1
            try await write(conversation, connectionID: connectionID, agentID: agentID, sessionID: sessionID)
        }
        return conversation
    }

    func write(_ conversation: NativeConversation, connectionID: String, agentID: String, sessionID: String) async throws {
        let key = try scopedKey(connectionID, agentID, sessionID)
        guard conversation.revision >= latestRevision[key, default: 0] else { return }
        latestRevision[key] = conversation.revision
        try await documents.write(conversation, key: key)
    }

    private func scopedKey(_ connectionID: String, _ agentID: String, _ sessionID: String) throws -> String {
        guard !connectionID.isEmpty, !agentID.isEmpty, !sessionID.isEmpty else { throw StoreFailure.invalidKey }
        return try DocumentStore.scopedKey(namespace: "conversation.v1", parts: [connectionID, agentID, sessionID])
    }
}
