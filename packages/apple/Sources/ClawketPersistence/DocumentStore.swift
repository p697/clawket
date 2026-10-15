import CryptoKit
import Foundation

public struct StoredDocument<Value: Sendable>: Sendable {
    public let value: Value
    public let recoveredFromRollback: Bool
}

/// Serial read/validate/write/read-back transactions. A caller publishes state only after success.
/// Rollback is retained for recovery; an unreadable document never becomes an empty registry.
public actor DocumentStore {
    private let values: any ValueStore
    private let maximumBytes: Int
    private var locked = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    public init(values: any ValueStore, maximumBytes: Int = 1024 * 1024) throws {
        guard maximumBytes > 0, maximumBytes <= 8 * 1024 * 1024 else { throw StoreFailure.tooLarge }
        self.values = values; self.maximumBytes = maximumBytes
    }

    public func read<Value: Codable & Sendable>(_ type: Value.Type, key: String) async throws -> StoredDocument<Value>? {
        try validateDocumentKey(key)
        await acquire()
        defer { release() }
        if let current = try await values.read(key) {
            if let decoded = try? decode(type, current) {
                return StoredDocument(value: decoded, recoveredFromRollback: false)
            }
            guard let backup = try await values.read(key + ".rollback") else { throw StoreFailure.invalidDocument }
            return StoredDocument(value: try decode(type, backup), recoveredFromRollback: true)
        }
        if let backup = try await values.read(key + ".rollback") {
            return StoredDocument(value: try decode(type, backup), recoveredFromRollback: true)
        }
        return nil
    }

    public func write<Value: Codable & Sendable>(_ value: Value, key: String) async throws {
        try validateDocumentKey(key)
        let data: Data
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
            data = try encoder.encode(value)
        } catch { throw StoreFailure.invalidDocument }
        guard data.count <= maximumBytes else { throw StoreFailure.tooLarge }
        await acquire()
        defer { release() }
        try Task.checkCancellation()
        if let current = try await values.read(key), (try? decode(Value.self, current)) != nil {
            try await values.write(current, for: key + ".rollback")
            guard try await values.read(key + ".rollback") == current else { throw StoreFailure.verificationFailed }
        }
        try await values.write(data, for: key)
        guard try await values.read(key) == data else { throw StoreFailure.verificationFailed }
    }

    public func remove(key: String) async throws {
        try validateDocumentKey(key)
        await acquire()
        defer { release() }
        // An explicit deletion must not resurrect a rollback on the next read.
        try await values.remove(key + ".rollback")
        try await values.remove(key)
    }

    public static func scopedKey(namespace: String, parts: [String]) throws -> String {
        try validateStoreKey(namespace)
        guard namespace.utf8.count <= 64 else { throw StoreFailure.invalidKey }
        let data = try JSONEncoder().encode(parts)
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        return namespace + "." + digest
    }

    private func decode<Value: Decodable>(_ type: Value.Type, _ data: Data) throws -> Value {
        guard !data.isEmpty else { throw StoreFailure.invalidDocument }
        guard data.count <= maximumBytes else { throw StoreFailure.tooLarge }
        do { return try JSONDecoder().decode(type, from: data) }
        catch { throw StoreFailure.invalidDocument }
    }

    private func validateDocumentKey(_ key: String) throws {
        try validateStoreKey(key)
        guard key.utf8.count <= 240, !key.hasSuffix(".rollback") else { throw StoreFailure.invalidKey }
    }

    private func acquire() async {
        if !locked { locked = true; return }
        await withCheckedContinuation { waiters.append($0) }
    }

    private func release() {
        if waiters.isEmpty { locked = false }
        else { waiters.removeFirst().resume() }
    }
}
