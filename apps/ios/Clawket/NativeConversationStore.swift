import ClawketPersistence
import ClawketRuntime
import Foundation

enum NativeDelivery: String, Codable, Sendable { case queued, held, sending, sent, delivered, uncertain, failed }

struct NativeMessage: Codable, Sendable, Identifiable, Equatable {
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
    var providedID: String?
    var idSource: RuntimeMessageIDSource?
    var attribution: RuntimeMessageAttribution?
    var transcriptPosition: RuntimeTranscriptPosition?
    var transcriptBoundary: RuntimeTranscriptBoundary?
    var historyEpoch: UUID?
    var sourceRevisionHash: String?
    var isOwnedUser: Bool { local && role == .user && attribution == nil }

    static func == (left: Self, right: Self) -> Bool {
        guard byteEqual(left.id, right.id), byteEqual(left.remoteID, right.remoteID),
              byteEqual(left.providedID, right.providedID), byteEqual(left.runID, right.runID),
              byteEqual(left.segmentID, right.segmentID), byteEqual(left.idempotencyKey, right.idempotencyKey),
              byteEqual(left.text, right.text) else { return false }
        return left.role == right.role && left.local == right.local && left.timestampMs == right.timestampMs
            && left.delivery == right.delivery && left.streaming == right.streaming && left.isWork == right.isWork
            && left.media == right.media && left.idSource == right.idSource && left.attribution == right.attribution
            && left.transcriptPosition == right.transcriptPosition && left.transcriptBoundary == right.transcriptBoundary
            && left.historyEpoch == right.historyEpoch && left.sourceRevisionHash == right.sourceRevisionHash
    }

    private static func byteEqual(_ left: String?, _ right: String?) -> Bool {
        switch (left, right) {
        case (nil, nil): true
        case let (left?, right?): left.utf8.elementsEqual(right.utf8)
        default: false
        }
    }
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
    var historyEpoch: UUID? = nil
    var physicalSessionID: String? = nil

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
        messages.firstIndex { $0.id == messageID && $0.isOwnedUser && $0.idempotencyKey?.isEmpty == false &&
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
    let documents: DocumentStore
    let values: FileValueStore
    let historyFiles: NativeHistoryFiles
    let historyFault: @Sendable (NativeHistoryFault) throws -> Void
    var historyUnavailable = false
    private let directory: URL
    var latestRevision: [String: Int64] = [:]
    private var mediaSnapshotLocked = false
    private var mediaSnapshotWaiters: [CheckedContinuation<Void, Never>] = []

    init(directory: URL? = nil, historyFault: @escaping @Sendable (NativeHistoryFault) throws -> Void = { _ in }) throws {
        let root: URL
        if let directory { root = directory }
        else {
            let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                     appropriateFor: nil, create: true)
            root = support.appendingPathComponent("NativeConversations", isDirectory: true)
        }
        self.directory = root
        self.historyFault = historyFault
        values = try FileValueStore(directory: root)
        historyFiles = try NativeHistoryFiles(directory: root.appendingPathComponent("History", isDirectory: true))
        documents = try DocumentStore(values: values,
                                      maximumBytes: 8 * 1024 * 1024)
    }

    func read(connectionID: String, agentID: String, sessionID: String) async throws -> NativeConversation {
        await acquireMediaSnapshot()
        defer { releaseMediaSnapshot() }
        try await recoverHistory()
        return try await readLocked(connectionID: connectionID, agentID: agentID, sessionID: sessionID)
    }

    private func readLocked(connectionID: String, agentID: String, sessionID: String) async throws -> NativeConversation {
        let key = try scopedKey(connectionID, agentID, sessionID)
        guard var conversation = try await documents.read(NativeConversation.self, key: key)?.value else { return .init() }
        guard conversation.version == 1, conversation.revision >= 0,
              Set(conversation.messages.map(\.id)).count == conversation.messages.count else { throw StoreFailure.invalidDocument }
        latestRevision[key] = max(latestRevision[key, default: 0], conversation.revision)
        // A process exit cannot prove whether a request reached the backend.
        // Recovery keeps its exact idempotency key and never dispatches it automatically.
        var changed = false
        for index in conversation.messages.indices {
            if conversation.messages[index].isOwnedUser && conversation.messages[index].delivery == .sending {
                conversation.messages[index].delivery = .uncertain
                changed = true
            }
            if conversation.messages[index].isOwnedUser && conversation.messages[index].delivery == .queued {
                conversation.messages[index].delivery = .held
                changed = true
            }
            conversation.messages[index].streaming = false
        }
        if changed {
            conversation.revision += 1
            try await writeLocked(conversation, connectionID: connectionID, agentID: agentID, sessionID: sessionID)
        }
        return conversation
    }

    func write(_ conversation: NativeConversation, connectionID: String, agentID: String, sessionID: String) async throws {
        try conversation.validateMedia()
        await acquireMediaSnapshot()
        defer { releaseMediaSnapshot() }
        try await recoverHistory()
        try await writeLocked(conversation, connectionID: connectionID, agentID: agentID, sessionID: sessionID)
    }

    private func writeLocked(_ conversation: NativeConversation, connectionID: String, agentID: String, sessionID: String) async throws {
        try conversation.validateMedia()
        let key = try scopedKey(connectionID, agentID, sessionID)
        let previous = try await documents.read(NativeConversation.self, key: key)
        if let previous {
            guard previous.value.historyEpoch == conversation.historyEpoch,
                  historySame(previous.value.physicalSessionID, conversation.physicalSessionID) else { throw NativeHistoryFailure.changed }
        }
        guard conversation.revision >= latestRevision[key, default: 0] else { return }
        let replacement = try historyEncode(conversation)
        guard replacement.count <= NativeHistoryLimits.recordBytes else { throw NativeHistoryFailure.full }
        let currentSize = try await values.read(key)?.count ?? 0
        let rollbackSize = try await values.read(key + ".rollback")?.count ?? 0
        let historySize = try historyFiles.inventory().values.reduce(0, +)
        // FileValueStore replaces rollback before current. Count the actual
        // largest atomic temporary, including a preserved recovery rollback.
        let footprint: Int
        if previous?.recoveredFromRollback == false {
            footprint = historySize + 2 * currentSize + max(rollbackSize, replacement.count)
        } else {
            footprint = historySize + currentSize + rollbackSize + replacement.count
        }
        guard footprint <= NativeHistoryLimits.physicalBytes else { throw NativeHistoryFailure.full }
        try Task.checkCancellation()
        latestRevision[key] = conversation.revision
        try await documents.write(conversation, key: key)
    }

    /// A native input ACK is not a durable handoff. Verify the current serialized
    /// document before the voice owner removes its recoverable source audio.
    func verifiedVoiceDraft(_ text: String, minimumRevision: Int64,
                            connectionID: String, agentID: String, sessionID: String) async throws -> Bool {
        await acquireMediaSnapshot(); defer { releaseMediaSnapshot() }
        try await recoverHistory()
        let key = try scopedKey(connectionID, agentID, sessionID)
        guard let saved = try await documents.read(NativeConversation.self, key: key), !saved.recoveredFromRollback else { return false }
        try saved.value.validateMedia()
        return saved.value.version == 1 && saved.value.revision >= minimumRevision && saved.value.draft == text
    }

    /// Include both verified document generations before releasing any owned file.
    /// An unreadable source disables reclamation; it never means an empty registry.
    func allMediaResourceIDs() async throws -> Set<UUID> {
        // DocumentStore/FileValueStore are separate actors. Keep this snapshot
        // outside every current→rollback replacement, including across awaits.
        await acquireMediaSnapshot()
        defer { releaseMediaSnapshot() }
        try await recoverHistory()
        try Task.checkCancellation()
        let files = try FileManager.default.contentsOfDirectory(at: directory,
            includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard files.count <= 4_096 else { throw StoreFailure.tooLarge }
        var result = try historyResourceIDs()
        for file in files {
            if file.lastPathComponent == "History" { continue }
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

    func acquireMediaSnapshot() async {
        if !mediaSnapshotLocked { mediaSnapshotLocked = true; return }
        await withCheckedContinuation { mediaSnapshotWaiters.append($0) }
    }

    func releaseMediaSnapshot() {
        if mediaSnapshotWaiters.isEmpty { mediaSnapshotLocked = false }
        else { mediaSnapshotWaiters.removeFirst().resume() }
    }

    func recoverImport(_ pending: NativePendingMediaImport) async throws -> Bool {
        await acquireMediaSnapshot(); defer { releaseMediaSnapshot() }
        try await recoverHistory()
        var conversation = try await readLocked(connectionID: pending.connectionID, agentID: pending.agentID, sessionID: pending.sessionID)
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
        try await writeLocked(conversation, connectionID: pending.connectionID, agentID: pending.agentID, sessionID: pending.sessionID)
        return true
    }

    func scopedKey(_ connectionID: String, _ agentID: String, _ sessionID: String) throws -> String {
        guard !connectionID.isEmpty, !agentID.isEmpty, !sessionID.isEmpty else { throw StoreFailure.invalidKey }
        return try DocumentStore.scopedKey(namespace: "conversation.v1", parts: [connectionID, agentID, sessionID])
    }
}
