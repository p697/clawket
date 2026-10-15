import ClawketPersistence
import ClawketUI
import Foundation

struct NativeRosterPreference: Codable, Sendable {
    var scope: AgentCatalogID
    var pinned = false
    /// Newest explicit additions first; these are display references, never dispatch authority.
    var homeSessions: [String] = []
}
struct NativeRosterWatermark: Codable, Sendable {
    var route: ConversationID
    var activityAtMs: Int64
}
struct NativeRosterDocument: Codable, Sendable {
    var version = 1
    var revision: Int64 = 0
    var preferences: [NativeRosterPreference] = []
    var baselines: [String] = []
    var watermarks: [NativeRosterWatermark] = []
    func validate() throws {
        let validID: (String) -> Bool = { !$0.isEmpty && $0.utf8.count <= 1_024 }
        guard version == 1, (0...9_007_199_254_740_991).contains(revision), preferences.count <= 512,
              baselines.count <= 128, Set(baselines.map { Data($0.utf8) }).count == baselines.count,
              baselines.allSatisfy(validID), watermarks.count <= 16_384,
              Set(preferences.map(\.scope)).count == preferences.count,
              preferences.allSatisfy({ validID($0.scope.connectionID) && validID($0.scope.agentID) && $0.homeSessions.count <= 128 &&
                  $0.homeSessions.allSatisfy(validID) && Set($0.homeSessions.map { Data($0.utf8) }).count == $0.homeSessions.count }),
              Set(watermarks.map(\.route)).count == watermarks.count,
              watermarks.allSatisfy({ $0.route.isConcrete && [$0.route.connectionID, $0.route.agentID, $0.route.sessionID].allSatisfy(validID) &&
                  (0...9_007_199_254_740_991).contains($0.activityAtMs) }) else { throw StoreFailure.invalidDocument }
    }
    mutating func advance() throws {
        guard revision < 9_007_199_254_740_991 else { throw StoreFailure.invalidDocument }; revision += 1
    }
    func preference(_ scope: AgentCatalogID) -> NativeRosterPreference {
        preferences.first { $0.scope == scope } ?? .init(scope: scope)
    }
    func watermark(_ route: ConversationID) -> Int64 { watermarks.first { $0.route == route }?.activityAtMs ?? 0 }
    func hasBaseline(_ connectionID: String) -> Bool { baselines.contains { $0.utf8.elementsEqual(connectionID.utf8) } }
    mutating func mark(_ route: ConversationID, through timestamp: Int64) {
        guard timestamp >= 0, timestamp <= 9_007_199_254_740_991 else { return }
        if let index = watermarks.firstIndex(where: { $0.route == route }) {
            watermarks[index].activityAtMs = max(watermarks[index].activityAtMs, timestamp)
        } else { watermarks.append(.init(route: route, activityAtMs: timestamp)) }
    }
}

/// One bounded protected display document. Unknown replacement never permits a retry from memory.
actor NativeRosterStore {
    private let documents: DocumentStore
    private var revision: Int64?
    private var uncertain = false
    private var busy = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    init(directory: URL? = nil, values: (any ValueStore)? = nil) throws {
        let storage: any ValueStore
        if let values { storage = values }
        else {
            let directory = try directory ?? FileManager.default.url(for: .applicationSupportDirectory,
                in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("NativeRosterPreferences", isDirectory: true)
            storage = try FileValueStore(directory: directory, maximumBytes: 8 * 1_024 * 1_024)
        }
        documents = try DocumentStore(values: storage, maximumBytes: 8 * 1_024 * 1_024)
    }
    func read() async throws -> NativeRosterDocument {
        try await acquire(); defer { release() }
        guard !uncertain else { throw StoreFailure.verificationFailed }
        let value = try await documents.read(NativeRosterDocument.self, key: "roster-preferences.v1")?.value ?? .init()
        try value.validate(); revision = value.revision; return value
    }
    func write(_ value: NativeRosterDocument) async throws {
        try value.validate(); try await acquire(); defer { release() }
        guard !uncertain, let previous = revision else { throw StoreFailure.verificationFailed }
        guard value.revision > previous else { return }
        do { try await documents.write(value, key: "roster-preferences.v1"); revision = value.revision }
        catch { uncertain = true; throw error }
    }
    private func acquire() async throws {
        if !busy { busy = true; return }
        guard waiters.count < 16 else { throw StoreFailure.unavailable }
        await withCheckedContinuation { waiters.append($0) }
    }
    private func release() {
        if waiters.isEmpty { busy = false } else { waiters.removeFirst().resume() }
    }
}
