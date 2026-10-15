import Foundation
import ClawketPairing

public enum UpgradeFailure: String, Error, Sendable, Equatable {
    case wrongApplication, sourceUnavailable, malformedSource, ambiguousSource, invalidIdentity
    case invalidRegistry, missingResource, unsafePath, tooLarge, verificationFailed, busy
}

public enum LegacyValueDomain: String, Codable, Sendable, CaseIterable, Hashable { case secure, asyncStorage, userDefaults }

public struct LegacyValueID: Codable, Sendable, Hashable, Comparable {
    public let domain: LegacyValueDomain
    public let key: String
    public init(domain: LegacyValueDomain, key: String) { self.domain = domain; self.key = key }
    public static func < (lhs: Self, rhs: Self) -> Bool {
        lhs.domain.rawValue == rhs.domain.rawValue ? lhs.key < rhs.key : lhs.domain.rawValue < rhs.domain.rawValue
    }
}

public struct LegacyResource: Codable, Sendable, Equatable {
    /// Relative to this application's container, never an absolute URL from old storage.
    public let relativePath: String
    public let byteCount: Int64
    public let sha256: String
    public let chunks: [String]
    public init(relativePath: String, byteCount: Int64, sha256: String, chunks: [String] = []) {
        self.relativePath = relativePath; self.byteCount = byteCount; self.sha256 = sha256; self.chunks = chunks
    }
}

/// An explicit read-only boundary. Implementations bound enumeration, value reads and file hashing.
public protocol LegacyUpgradeSource: Sendable {
    func listValues() async throws -> [LegacyValueID]
    func readValue(_ id: LegacyValueID) async throws -> Data?
    func listResourcePaths() async throws -> [String]
    func inspectResource(_ relativePath: String) async throws -> LegacyResource
    func readResourceChunk(_ relativePath: String, offset: Int64, maximumBytes: Int) async throws -> Data
}

public struct UpgradedIdentity: Sendable, Equatable {
    public let deviceID: String
    public let publicKey: Data
    /// Existing TweetNaCl seed[32] + publicKey[32].
    public let secretKey: Data
    public let createdAt: String?
}

/// Validated current fields; original serialized bytes remain available without losing unknown fields.
public struct UpgradedConnection: Sendable, Equatable {
    public let id: String
    public let backendKind: PairingBackend
    public let transportKind: PairingTransport
    public let label: String
    public let url: URL
    public let createdAt: Int64
    public let environment: PairingEnvironment?
    public let debugMode: Bool?
    public let token: String?
    public let password: String?
    public let bootstrap: PairingBootstrap?
    public let relay: PairingRelay?
    public let hermesBridgeURL: URL?
}

public struct UpgradedRegistry: Sendable, Equatable {
    public let revision: Int64
    public let activeConnectionID: String?
    public let freeConnectionID: String?
    public let connections: [UpgradedConnection]
    public let recoveredFromRollback: Bool
}

public struct UpgradedPurchaseIdentity: Sendable, Equatable {
    public let currentAppUserID: String?
    public let legacyAppUserID: String?
}

public enum UpgradeInstallState: String, Codable, Sendable { case existing, upgraded, fresh }

public struct UpgradedValueReference: Codable, Sendable, Equatable {
    public let id: LegacyValueID
    public let byteCount: Int
    public let sha256: String
    public let chunks: [String]
}

/// Metadata only. Secret bytes are stored exclusively in the supplied secret ValueStore.
public struct UpgradeManifest: Codable, Sendable, Equatable {
    public let version: Int
    public let installState: UpgradeInstallState
    public let values: [UpgradedValueReference]
    public let resources: [LegacyResource]
}

public struct UpgradeResult: Sendable, Equatable {
    public let manifest: UpgradeManifest
    public let identity: UpgradedIdentity?
    public let registry: UpgradedRegistry?
    public let purchaseIdentity: UpgradedPurchaseIdentity
    public let wasAlreadyImported: Bool
}

public enum UpgradeLimits {
    public static let valueCount = 16_384
    public static let keyBytes = 4_096
    public static let secureValueBytes = 1024 * 1024
    public static let plainValueBytes = 64 * 1024 * 1024
    public static let totalValueBytes = 256 * 1024 * 1024
    public static let chunkBytes = 128 * 1024
    public static let manifestBytes = 8 * 1024 * 1024
    public static let resourceCount = 2_048
    public static let resourceBytes: Int64 = 32 * 1024 * 1024
    public static let totalResourceBytes: Int64 = 512 * 1024 * 1024
}
