import ClawketPersistence
import ClawketUI
import Foundation

/// Free-session exception is earned only by an actual create receipt. A row's
/// title/kind/native source or an archived conversation can never mint this record.
struct NativeManualSession: Codable, Sendable, Equatable {
    let connectionID: String
    let agentID: String
    let sessionKey: String
    init(_ route: ConversationID) { connectionID = route.connectionID; agentID = route.agentID; sessionKey = route.sessionID }
    var route: ConversationID { .init(connectionID: connectionID, agentID: agentID, sessionID: sessionKey) }
    var valid: Bool { [connectionID, agentID, sessionKey].allSatisfy { !$0.isEmpty && $0.utf16.count <= 512 } }
    static func == (lhs: Self, rhs: Self) -> Bool {
        [lhs.connectionID, lhs.agentID, lhs.sessionKey].map { Data($0.utf8) } ==
        [rhs.connectionID, rhs.agentID, rhs.sessionKey].map { Data($0.utf8) }
    }
}

actor NativeManualSessions {
    private struct Table: Codable, Sendable { var version = 1; var records: [NativeManualSession] = [] }
    private let documents: DocumentStore
    private var busy = false
    private var uncertain = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    init(values: any ValueStore) throws { documents = try DocumentStore(values: values, maximumBytes: 4 * 1_024 * 1_024) }
    init() throws {
        let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
            appropriateFor: nil, create: true).appendingPathComponent("NativeManualSessions", isDirectory: true)
        documents = try DocumentStore(values: FileValueStore(directory: directory), maximumBytes: 4 * 1_024 * 1_024)
    }
    func read() async throws -> [NativeManualSession] {
        try await acquire(); defer { release() }; return try await table().records
    }
    func checkCapacity() async throws {
        try await acquire(); defer { release() }
        guard try await table().records.count < 1_000 else { throw StoreFailure.tooLarge }
    }
    func rememberCreated(_ route: ConversationID) async throws -> [NativeManualSession] {
        try await acquire(); defer { release() }
        let receipt = NativeManualSession(route); guard receipt.valid else { throw StoreFailure.invalidDocument }
        var next = try await table()
        if next.records.contains(receipt) { return next.records }
        guard next.records.count < 1_000 else { throw StoreFailure.tooLarge }
        next.records.append(receipt)
        do { try await documents.write(next, key: "manual-sessions.v1") }
        catch { uncertain = true; throw error }
        return next.records
    }
    private func table() async throws -> Table {
        guard !uncertain else { throw StoreFailure.verificationFailed }
        let value = try await documents.read(Table.self, key: "manual-sessions.v1")?.value ?? .init()
        guard value.version == 1, value.records.count <= 1_000, value.records.allSatisfy(\.valid),
              value.records.enumerated().allSatisfy({ index, item in !value.records.prefix(index).contains(item) }) else { throw StoreFailure.invalidDocument }
        return value
    }
    private func acquire() async throws {
        if !busy { busy = true; return }; guard waiters.count < 16 else { throw StoreFailure.unavailable }
        await withCheckedContinuation { waiters.append($0) }
    }
    private func release() { if waiters.isEmpty { busy = false } else { waiters.removeFirst().resume() } }
}
