import CryptoKit
import Foundation
import ClawketPairing
import ClawketPersistence
@testable import ClawketUpgrade

func upgradeTestJSON(_ value: Any) throws -> Data { try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) }

func upgradeTestIdentity() throws -> (Data, String) {
    let key = try Curve25519.Signing.PrivateKey(rawRepresentation: Data(repeating: 17, count: 32))
    let publicKey = key.publicKey.rawRepresentation
    let id = try PairingCryptography.deviceID(publicKey: publicKey)
    let object = ["deviceId": id, "publicKeyHex": PairingCryptography.hex(publicKey),
                  "secretKeyHex": PairingCryptography.hex(key.rawRepresentation + publicKey), "createdAt": "2020-01-02T03:04:05.000Z"]
    return (try upgradeTestJSON(object), id)
}

func upgradeTestRecords() -> [[String: Any]] {
    PairingBackend.allCases.enumerated().map { index, backend in
        var row: [String: Any] = ["id": "connection-\(index)", "backendKind": backend.rawValue,
            "transportKind": "relay", "label": backend.rawValue, "url": "wss://relay.example.invalid/ws",
            "createdAt": 1_600_000_000_000 + index, "environment": "production", "debugMode": false,
            "auth": ["token": "synthetic-gateway-token", "password": "synthetic-password"],
            "relay": ["serverUrl": "https://registry.example.invalid", "gatewayId": "gateway-\(index)",
                      "clientToken": "synthetic-client-token", "protocolVersion": 2, "supportsBootstrap": true]]
        if backend == .hermes { row["hermes"] = ["bridgeUrl": "http://127.0.0.1:8787", "displayName": "Test computer"] }
        if backend == .openclaw { row["bootstrap"] = ["token": "synthetic-bootstrap", "strategy": "mobile-setup", "expiresAtMs": 1, "access": "node"] }
        return row
    }
}

func upgradeTestRegistry(_ records: [[String: Any]] = upgradeTestRecords(), revision: Int = 7) throws -> Data {
    try upgradeTestJSON(["version": 1, "revision": revision, "state": ["activeConnectionId": records.first?["id"] ?? NSNull(),
        "freeConnectionId": records.last?["id"] ?? NSNull(), "records": records]])
}

actor UpgradeMemoryStore: ValueStore {
    private var values: [String: Data] = [:]
    var failNextWrite = false
    var corruptReads = false
    private(set) var writeCount = 0
    let maximumBytes: Int
    init(maximumBytes: Int = UpgradeLimits.manifestBytes) { self.maximumBytes = maximumBytes }
    func read(_ key: String) -> Data? {
        guard let data = values[key] else { return nil }
        return corruptReads ? Data("corrupted".utf8) : data
    }
    func write(_ value: Data, for key: String) throws {
        guard value.count <= maximumBytes else { throw StoreFailure.tooLarge }
        if failNextWrite { failNextWrite = false; throw StoreFailure.unavailable }
        values[key] = value; writeCount += 1
    }
    func remove(_ key: String) { values.removeValue(forKey: key) }
    func setFailure() { failNextWrite = true }
    func setCorruptReads(_ value: Bool) { corruptReads = value }
    func snapshot() -> [String: Data] { values }
}

actor UpgradeMemorySource: LegacyUpgradeSource, LegacySecureReader {
    private var values: [LegacyValueID: Data]
    private var resources: [String: Data]
    private(set) var readCount = 0
    var shouldBlock = false
    private var continuation: CheckedContinuation<Void, Never>?
    init(values: [LegacyValueID: Data] = [:], resources: [String: Data] = [:]) { self.values = values; self.resources = resources }
    func listValues() -> [LegacyValueID] { Array(values.keys) }
    func readValue(_ id: LegacyValueID) async -> Data? {
        readCount += 1
        if shouldBlock { await withCheckedContinuation { continuation = $0 } }
        return values[id]
    }
    func listResourcePaths() -> [String] { Array(resources.keys) }
    func inspectResource(_ path: String) throws -> LegacyResource {
        guard let result = resources[path] else { throw UpgradeFailure.missingResource }
        return LegacyResource(relativePath: path, byteCount: Int64(result.count), sha256: upgradeDigest(result))
    }
    func readResourceChunk(_ relativePath: String, offset: Int64, maximumBytes: Int) throws -> Data {
        guard let data = resources[relativePath], offset >= 0, offset <= data.count else { throw UpgradeFailure.missingResource }
        let start = Int(offset)
        return data.subdata(in: start..<min(data.count, start + maximumBytes))
    }
    func keys() -> [String] { values.keys.filter { $0.domain == .secure }.map(\.key) }
    func read(_ key: String) -> Data? { values[.init(domain: .secure, key: key)] }
    func blockReads() { shouldBlock = true }
    func isBlocked() -> Bool { continuation != nil }
    func release() { shouldBlock = false; continuation?.resume(); continuation = nil }
    func replace(_ id: LegacyValueID, data: Data) { values[id] = data }
    func discardResource(_ path: String) { resources.removeValue(forKey: path) }
    func snapshot() -> [LegacyValueID: Data] { values }
}

func upgradeTestImporter(_ source: any LegacyUpgradeSource) throws -> (UpgradeImporter, UpgradeMemoryStore, UpgradeMemoryStore, UpgradeMemoryStore) {
    let secret = UpgradeMemoryStore(maximumBytes: UpgradeLimits.chunkBytes)
    let plain = UpgradeMemoryStore(maximumBytes: UpgradeLimits.chunkBytes)
    let receipt = UpgradeMemoryStore()
    let documents = try DocumentStore(values: receipt, maximumBytes: UpgradeLimits.manifestBytes)
    return (UpgradeImporter(source: source, secretValues: secret, plainValues: plain, manifests: documents), secret, plain, receipt)
}
