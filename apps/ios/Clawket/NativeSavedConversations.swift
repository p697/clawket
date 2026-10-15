import ClawketPersistence
import Foundation

struct NativePublicTranscript: Codable, Equatable, Sendable {
    enum Role: String, Codable, Sendable { case user, assistant }
    struct Message: Codable, Equatable, Sendable {
        let role: Role
        let text: String
        let timestampMs: Double?
        let attachments: [String]
        static func == (lhs: Self, rhs: Self) -> Bool {
            lhs.role == rhs.role && historySame(lhs.text, rhs.text) && lhs.timestampMs == rhs.timestampMs &&
                lhs.attachments.map { Data($0.utf8) } == rhs.attachments.map { Data($0.utf8) }
        }
    }
    let title: String
    let messages: [Message]
    static func == (lhs: Self, rhs: Self) -> Bool { historySame(lhs.title, rhs.title) && lhs.messages == rhs.messages }

    var textUnits: Int { title.utf16.count + messages.reduce(0) { $0 + $1.text.utf16.count + $1.attachments.reduce(0) { $0 + $1.utf16.count } } }
    var hasFiles: Bool { messages.contains { !$0.attachments.isEmpty } }
    func validate() throws {
        guard title.utf16.count <= 200, messages.count <= 10_000 else { throw NativeHistoryFailure.invalid }
        for message in messages {
            guard message.timestampMs == nil || (message.timestampMs!.isFinite && message.timestampMs! > 0),
                  message.attachments.count <= 100, message.attachments.allSatisfy({ $0.utf16.count <= 1_000 }) else { throw NativeHistoryFailure.invalid }
        }
    }
}

struct NativeSavedConversation: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let connectionId: String
    let agentId: String
    let sessionKey: String
    let savedAt: Double
    let transcript: NativePublicTranscript
    var name: String? = nil
    var pinned: Bool? = nil
    var title: String { name ?? transcript.title }
    var scope: NativeHistoryScope { .init(connectionID: connectionId, agentID: agentId, sessionID: sessionKey) }
    var metadata: NativeSavedMetadata { .init(id: id, scope: scope, savedAt: savedAt, title: title, originalTitle: transcript.title, pinned: pinned == true, hasFiles: transcript.hasFiles) }
}

struct NativeSavedMetadata: Sendable, Identifiable {
    let id: String
    let scope: NativeHistoryScope
    let savedAt: Double
    let title: String
    let originalTitle: String
    let pinned: Bool
    let hasFiles: Bool
}

struct NativeSavedListing: Sendable {
    let entries: [NativeSavedMetadata]
    let recoveredFromRollback: Bool
}

enum NativeSavedFilter: String, CaseIterable, Hashable, Sendable { case all, pinned, files }

/// Public text/name snapshots only. Full native frames, local URLs, attachment bytes and action tokens have no representation here.
actor NativeSavedConversations {
    private struct Identity: Encodable { let scope: NativeHistoryScope; let transcript: NativePublicTranscript }
    private struct Document: Codable, Sendable {
        let values: [NativeSavedConversation]
        init(_ values: [NativeSavedConversation]) { self.values = values }
        init(from decoder: any Decoder) throws {
            values = try decoder.singleValueContainer().decode([NativeSavedConversation].self)
            try NativeSavedConversations.validate(values)
        }
        func encode(to encoder: any Encoder) throws {
            var container = encoder.singleValueContainer(); try container.encode(values)
        }
    }
    private let documents: DocumentStore
    private var unavailable = false
    private var locked = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    init(directory: URL? = nil, values: (any ValueStore)? = nil) throws {
        if let values { documents = try DocumentStore(values: values, maximumBytes: 8 * 1_024 * 1_024) }
        else {
            let root = try directory ?? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                appropriateFor: nil, create: true).appendingPathComponent("NativeSavedConversations", isDirectory: true)
            documents = try DocumentStore(values: FileValueStore(directory: root), maximumBytes: 8 * 1_024 * 1_024)
        }
    }

    func list() async throws -> NativeSavedListing {
        await acquire(); defer { release() }
        let (entries, rollback) = try await read()
        return .init(entries: Self.order(entries).map(\.metadata), recoveredFromRollback: rollback)
    }

    func conversation(_ id: String) async throws -> NativeSavedConversation {
        await acquire(); defer { release() }
        let entries = try await read().0
        guard let value = entries.first(where: { $0.id == id }) else { throw NativeHistoryFailure.missing }
        return value
    }

    func conversations(_ ids: [String]) async throws -> [NativeSavedConversation] {
        await acquire(); defer { release() }
        guard ids.count <= 100, Set(ids).count == ids.count else { throw NativeHistoryFailure.invalid }
        let values = try await read().0
        return try ids.map { id in
            guard let value = values.first(where: { $0.id == id }) else { throw NativeHistoryFailure.changed }
            return value
        }
    }

    /// Search is explicit and remains entitlement-gated by the host. Ordinary list/open never makes a network request.
    func search(_ query: String, filter: NativeSavedFilter) async throws -> [NativeSavedMetadata] {
        await acquire(); defer { release() }
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return Self.order(try await read().0.filter { entry in
            (filter != .pinned || entry.pinned == true) && (filter != .files || entry.transcript.hasFiles) &&
            (needle.isEmpty || entry.title.localizedStandardContains(needle) || entry.transcript.title.localizedStandardContains(needle) ||
                entry.transcript.messages.contains { $0.text.localizedStandardContains(needle) || $0.attachments.contains { $0.localizedStandardContains(needle) } })
        }).map(\.metadata)
    }

    func save(scope: NativeHistoryScope, transcript: NativePublicTranscript) async throws -> NativeSavedConversation {
        try scope.validate(); try transcript.validate()
        await acquire(); defer { release() }
        var entries = try await read().0
        // Preserve an imported Mobile identity/name/pin when saving the exact scoped public transcript again.
        if let existing = entries.first(where: { $0.scope == scope && $0.transcript == transcript }) { return existing }
        guard entries.count < 100 else { throw NativeHistoryFailure.full }
        let id = historyHash(try historyEncode(Identity(scope: scope, transcript: transcript)))
        guard !entries.contains(where: { $0.id == id }) else { throw NativeHistoryFailure.invalid }
        let entry = NativeSavedConversation(id: id, connectionId: scope.connectionID, agentId: scope.agentID,
            sessionKey: scope.sessionID, savedAt: Date().timeIntervalSince1970 * 1_000, transcript: transcript)
        entries.insert(entry, at: 0); try await write(entries); return entry
    }

    func rename(_ id: String, name: String) async throws -> NativeSavedConversation {
        await acquire(); defer { release() }
        var entries = try await read().0
        guard let index = entries.firstIndex(where: { $0.id == id }) else { throw NativeHistoryFailure.missing }
        entries[index].name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        try await write(entries); return entries[index]
    }

    func setPinned(_ id: String, pinned: Bool) async throws -> NativeSavedConversation {
        await acquire(); defer { release() }
        var entries = try await read().0
        guard let index = entries.firstIndex(where: { $0.id == id }) else { throw NativeHistoryFailure.missing }
        entries[index].pinned = pinned; try await write(entries); return entries[index]
    }

    func remove(_ id: String) async throws {
        await acquire(); defer { release() }
        let entries = try await read().0
        try await write(entries.filter { $0.id != id })
    }

    private func read() async throws -> ([NativeSavedConversation], Bool) {
        try Task.checkCancellation()
        guard !unavailable else { throw NativeHistoryFailure.commitUncertain }
        guard let stored = try await documents.read(Document.self, key: "conversation-archives.v1") else { return ([], false) }
        return (stored.value.values, stored.recoveredFromRollback)
    }

    private func write(_ values: [NativeSavedConversation]) async throws {
        try Self.validate(values)
        try Task.checkCancellation()
        do { try await documents.write(Document(values), key: "conversation-archives.v1") }
        catch { unavailable = true; throw NativeHistoryFailure.commitUncertain }
    }

    private static func validate(_ entries: [NativeSavedConversation]) throws {
        guard entries.count <= 100, Set(entries.map(\.id)).count == entries.count else { throw NativeHistoryFailure.invalid }
        var total = 0
        for entry in entries {
            try entry.scope.validate(); try entry.transcript.validate()
            guard historyDigest(entry.id), entry.savedAt.isFinite, entry.savedAt > 0,
                  entry.name == nil || (!entry.name!.isEmpty && entry.name!.utf16.count <= 200 && entry.name == entry.name?.trimmingCharacters(in: .whitespacesAndNewlines)) else { throw NativeHistoryFailure.invalid }
            let units = entry.transcript.textUnits + (entry.name?.utf16.count ?? 0)
            guard units <= 500_000 else { throw NativeHistoryFailure.full }
            total += units
        }
        guard total <= 1_000_000 else { throw NativeHistoryFailure.full }
        let raw = try historyEncode(entries)
        let jsonUnits = String(data: raw, encoding: .utf8)?.utf16.count ?? Int.max
        guard jsonUnits <= 4_000_000 else { throw NativeHistoryFailure.full }
    }

    private static func order(_ entries: [NativeSavedConversation]) -> [NativeSavedConversation] {
        entries.sorted {
            if ($0.pinned == true) != ($1.pinned == true) { return $0.pinned == true }
            return $0.savedAt == $1.savedAt ? $0.id < $1.id : $0.savedAt > $1.savedAt
        }
    }
    private func acquire() async {
        if !locked { locked = true; return }
        await withCheckedContinuation { waiters.append($0) }
    }
    private func release() { if waiters.isEmpty { locked = false } else { waiters.removeFirst().resume() } }
}
