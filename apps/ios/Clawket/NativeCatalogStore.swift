import ClawketPersistence
import ClawketRuntime
import Foundation

struct CachedRoster: Codable, Sendable {
    var version = 1
    var roster: RuntimeRoster
    var savedAtMs: Int64
}

actor NativeCatalogStore {
    private let documents: DocumentStore
    private var latestRevision: [String: Int64] = [:]

    init() throws {
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                 appropriateFor: nil, create: true)
        documents = try DocumentStore(values: FileValueStore(directory: support.appendingPathComponent("NativeRoster", isDirectory: true)),
                                      maximumBytes: 8 * 1024 * 1024)
    }

    func read(connectionID: String) async throws -> RuntimeRoster? {
        let key = try DocumentStore.scopedKey(namespace: "roster.v1", parts: [connectionID])
        guard let cached = try await documents.read(CachedRoster.self, key: key)?.value else { return nil }
        guard cached.version == 1, cached.roster.connectionID == connectionID,
              cached.roster.agents.allSatisfy({ $0.connectionID == connectionID }),
              cached.roster.sessions.allSatisfy({ $0.connectionID == connectionID }) else { throw StoreFailure.invalidDocument }
        return cached.roster
    }

    func write(_ roster: RuntimeRoster, revision: Int64) async throws {
        guard revision >= latestRevision[roster.connectionID, default: 0] else { return }
        latestRevision[roster.connectionID] = revision
        let key = try DocumentStore.scopedKey(namespace: "roster.v1", parts: [roster.connectionID])
        try await documents.write(CachedRoster(roster: roster, savedAtMs: Int64(Date().timeIntervalSince1970 * 1000)), key: key)
    }
}
