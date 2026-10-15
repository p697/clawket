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
    var media: [NativeMediaReference] = []
}

struct NativeConversation: Codable, Sendable {
    var version = 1
    var revision: Int64 = 0
    var draft = ""
    var messages: [NativeMessage] = []
    var nextCursor: String?
    var historyLimit = 80
    var hasMore = false
    var draftResourceIDs: [UUID] = []

    mutating func holdForEditing(messageID: String) throws -> NativePendingEdit {
        guard let index = editableIndex(messageID: messageID), let key = messages[index].idempotencyKey else {
            throw StoreFailure.invalidDocument
        }
        messages[index].delivery = .held; revision += 1
        return .init(messageID: messageID, idempotencyKey: key, originalText: messages[index].text,
                     originalMedia: messages[index].media)
    }

    mutating func apply(_ edit: NativePendingEdit, text: String, media: [NativeMediaReference]? = nil) throws {
        let selected = media ?? edit.originalMedia
        guard let index = editableIndex(messageID: edit.messageID), messages[index].delivery == .held,
              messages[index].idempotencyKey == edit.idempotencyKey, messages[index].text == edit.originalText,
              messages[index].media == edit.originalMedia, selected.count <= 6,
              Set(selected.map(\.id)).count == selected.count,
              selected.allSatisfy({ edit.originalMedia.contains($0) }),
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !selected.isEmpty else { throw StoreFailure.invalidDocument }
        messages[index].text = text; messages[index].media = selected; revision += 1
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
    let originalMedia: [NativeMediaReference]
}

actor NativeConversationStore {
    private let documents: DocumentStore
    private let directory: URL
    private var latestRevision: [String: Int64] = [:]
    private var mediaSnapshotLocked = false
    private var mediaSnapshotWaiters: [CheckedContinuation<Void, Never>] = []

    init(directory: URL? = nil) throws {
        let root: URL
        if let directory { root = directory }
        else {
            let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                     appropriateFor: nil, create: true)
            root = support.appendingPathComponent("NativeConversations", isDirectory: true)
        }
        self.directory = root
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
        try conversation.validateMedia()
        await acquireMediaSnapshot()
        defer { releaseMediaSnapshot() }
        let key = try scopedKey(connectionID, agentID, sessionID)
        guard conversation.revision >= latestRevision[key, default: 0] else { return }
        latestRevision[key] = conversation.revision
        try await documents.write(conversation, key: key)
    }

    /// Include both verified document generations before releasing any owned file.
    /// An unreadable source disables reclamation; it never means an empty registry.
    func allMediaResourceIDs() async throws -> Set<UUID> {
        // DocumentStore/FileValueStore are separate actors. Keep this snapshot
        // outside every current→rollback replacement, including across awaits.
        await acquireMediaSnapshot()
        defer { releaseMediaSnapshot() }
        try Task.checkCancellation()
        let files = try FileManager.default.contentsOfDirectory(at: directory,
            includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard files.count <= 4_096 else { throw StoreFailure.tooLarge }
        var result: Set<UUID> = []
        for file in files {
            guard file.lastPathComponent.range(of: "^[a-f0-9]{64}\\.json$", options: .regularExpression) != nil else {
                throw StoreFailure.invalidDocument
            }
            let metadata = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
            guard metadata.isRegularFile == true, metadata.isSymbolicLink != true,
                  let size = metadata.fileSize, size > 0, size <= 8 * 1_024 * 1_024 else { throw StoreFailure.invalidDocument }
            let handle = try FileHandle(forReadingFrom: file)
            let bytes: Data
            do { bytes = try handle.read(upToCount: 8 * 1_024 * 1_024 + 1) ?? Data(); try handle.close() }
            catch { try? handle.close(); throw StoreFailure.unavailable }
            guard bytes.count <= 8 * 1_024 * 1_024 else { throw StoreFailure.tooLarge }
            let conversation = try JSONDecoder().decode(NativeConversation.self, from: bytes)
            result.formUnion(conversation.mediaResourceIDs)
            guard result.count <= 128 else { throw StoreFailure.tooLarge }
        }
        return result
    }

    private func acquireMediaSnapshot() async {
        if !mediaSnapshotLocked { mediaSnapshotLocked = true; return }
        await withCheckedContinuation { mediaSnapshotWaiters.append($0) }
    }

    private func releaseMediaSnapshot() {
        if mediaSnapshotWaiters.isEmpty { mediaSnapshotLocked = false }
        else { mediaSnapshotWaiters.removeFirst().resume() }
    }

    func recoverImport(_ pending: NativePendingMediaImport) async throws -> Bool {
        var conversation = try await read(connectionID: pending.connectionID, agentID: pending.agentID, sessionID: pending.sessionID)
        if conversation.mediaResourceIDs.contains(pending.id) { return true }
        if let messageID = pending.messageID, let referenceID = pending.referenceID {
            guard let message = conversation.messages.firstIndex(where: { $0.id == messageID }),
                  let reference = conversation.messages[message].media.firstIndex(where: { $0.id == referenceID }) else { return false }
            conversation.messages[message].media[reference].resourceID = pending.id
        } else {
            guard conversation.draftResourceIDs.count < 6 else { throw StoreFailure.tooLarge }
            conversation.draftResourceIDs.append(pending.id)
        }
        conversation.revision += 1
        try await write(conversation, connectionID: pending.connectionID, agentID: pending.agentID, sessionID: pending.sessionID)
        return true
    }

    private func scopedKey(_ connectionID: String, _ agentID: String, _ sessionID: String) throws -> String {
        guard !connectionID.isEmpty, !agentID.isEmpty, !sessionID.isEmpty else { throw StoreFailure.invalidKey }
        return try DocumentStore.scopedKey(namespace: "conversation.v1", parts: [connectionID, agentID, sessionID])
    }
}
