import ClawketPersistence
import Foundation

/// Display preferences only. These model keys never grant runtime write authority.
struct NativeModelPreferencesDocument: Codable, Sendable {
    var version = 1
    var recent: [String: [String]] = [:]

    func validate() throws {
        guard version == 1, recent.count <= 128 else { throw StoreFailure.invalidDocument }
        for (connectionID, models) in recent {
            guard !connectionID.isEmpty, connectionID.utf8.count <= 1_024, models.count <= 6,
                  Set(models).count == models.count,
                  models.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 256 }) else { throw StoreFailure.invalidDocument }
        }
    }

    mutating func record(_ modelID: String, connectionID: String) throws -> [String] {
        try validate()
        guard !connectionID.isEmpty, connectionID.utf8.count <= 1_024,
              !modelID.isEmpty, modelID.utf8.count <= 256,
              recent[connectionID] != nil || recent.count < 128 else { throw StoreFailure.invalidDocument }
        let result = Array(([modelID] + (recent[connectionID] ?? []).filter { $0 != modelID }).prefix(6))
        recent[connectionID] = result
        return result
    }
}

actor NativeModelPreferences {
    private let documents: DocumentStore
    private var current: NativeModelPreferencesDocument?
    private var uncertain = false
    private var busy = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    init(directory: URL? = nil, values: (any ValueStore)? = nil) throws {
        let store: any ValueStore
        if let values { store = values }
        else {
            let support = try directory ?? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                appropriateFor: nil, create: true).appendingPathComponent("NativeModelPreferences", isDirectory: true)
            store = try FileValueStore(directory: support, maximumBytes: 256 * 1_024)
        }
        documents = try DocumentStore(values: store, maximumBytes: 256 * 1_024)
    }

    func read(connectionID: String) async throws -> [String] {
        guard !connectionID.isEmpty, connectionID.utf8.count <= 1_024 else { throw StoreFailure.invalidDocument }
        try await acquire(); defer { release() }
        try await load()
        return current?.recent[connectionID] ?? []
    }

    func record(_ modelID: String, connectionID: String) async throws -> [String] {
        try await acquire(); defer { release() }
        try await load(); try Task.checkCancellation()
        var next = current ?? .init()
        let models = try next.record(modelID, connectionID: connectionID)
        do {
            try await documents.write(next, key: "recent-models.v1")
            current = next
            return models
        } catch {
            // Atomic replacement may have committed. Never overwrite an unknown
            // result from an older in-memory snapshot; reopen to read it first.
            uncertain = true
            throw error
        }
    }

    private func load() async throws {
        guard !uncertain else { throw StoreFailure.verificationFailed }
        guard current == nil else { return }
        let value = try await documents.read(NativeModelPreferencesDocument.self, key: "recent-models.v1")?.value ?? .init()
        try value.validate(); current = value
    }
    private func acquire() async throws {
        if !busy { busy = true; return }
        guard waiters.count < 32 else { throw StoreFailure.unavailable }
        await withCheckedContinuation { waiters.append($0) }
    }
    private func release() {
        if waiters.isEmpty { busy = false } else { waiters.removeFirst().resume() }
    }
}
