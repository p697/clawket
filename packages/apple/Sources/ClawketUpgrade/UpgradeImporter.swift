import CryptoKit
import Foundation
import ClawketPersistence

/// Imports once into an isolated namespace. Application activation occurs only after this returns success.
public actor UpgradeImporter {
    public static let manifestKey = "clawket.upgrade.expo.v1"
    private let source: any LegacyUpgradeSource
    private let secretValues: any ValueStore
    private let plainValues: any ValueStore
    private let manifests: DocumentStore
    private var inFlight = false

    public init(source: any LegacyUpgradeSource, secretValues: any ValueStore, plainValues: any ValueStore, manifests: DocumentStore) {
        self.source = source; self.secretValues = secretValues; self.plainValues = plainValues; self.manifests = manifests
    }

    public func importIfNeeded() async throws -> UpgradeResult {
        guard !inFlight else { throw UpgradeFailure.busy }
        inFlight = true
        defer { inFlight = false }
        try Task.checkCancellation()
        if let manifest = try await storedManifest() {
            try validateManifest(manifest)
            return try await result(manifest, alreadyImported: true)
        }
        let ids = try await source.listValues()
        guard ids.count <= UpgradeLimits.valueCount, Set(ids).count == ids.count else { throw UpgradeFailure.malformedSource }
        for id in ids { try validateID(id) }
        let paths = try await source.listResourcePaths()
        guard paths.count <= UpgradeLimits.resourceCount, Set(paths).count == paths.count else { throw UpgradeFailure.malformedSource }
        let markerID = LegacyValueID(domain: .asyncStorage, key: UpgradeKeys.marker)
        let marker = ids.contains(markerID) ? try await source.readValue(markerID) : nil
        let installState = try Self.installState(marker: marker, ids: ids, resourcePaths: paths)
        var references: [UpgradedValueReference] = []
        var totalBytes = 0
        for id in ids.sorted() {
            try Task.checkCancellation()
            if installState == .fresh && !Self.retainOnFreshInstall(id) { continue }
            guard let data = try await source.readValue(id) else { throw UpgradeFailure.sourceUnavailable }
            let cap = id.domain == .secure ? UpgradeLimits.secureValueBytes : UpgradeLimits.plainValueBytes
            guard data.count <= cap, data.count <= UpgradeLimits.totalValueBytes - totalBytes else { throw UpgradeFailure.tooLarge }
            totalBytes += data.count
            try validatePreservedValue(id, data: data)
            var chunks: [String] = []
            for offset in stride(from: 0, to: data.count, by: UpgradeLimits.chunkBytes) {
                try Task.checkCancellation()
                let chunk = data.subdata(in: offset..<min(data.count, offset + UpgradeLimits.chunkBytes))
                let key = "upgrade.\(id.domain.rawValue).\(upgradeDigest(chunk))"
                let store = id.domain == .secure ? secretValues : plainValues
                // Staging keys are content-addressed and are not published until the manifest commit.
                if try await store.read(key) != chunk { try await store.write(chunk, for: key) }
                guard try await store.read(key) == chunk else { throw UpgradeFailure.verificationFailed }
                chunks.append(key)
            }
            references.append(UpgradedValueReference(id: id, byteCount: data.count, sha256: upgradeDigest(data), chunks: chunks))
        }
        var resources: [LegacyResource] = []
        var resourceBytes: Int64 = 0
        for path in paths.sorted() {
            try Task.checkCancellation()
            try validateResourcePath(path)
            let resource = try await source.inspectResource(path)
            guard resource.relativePath == path, resource.byteCount >= 0, resource.byteCount <= UpgradeLimits.resourceBytes,
                  resource.byteCount <= UpgradeLimits.totalResourceBytes - resourceBytes, isUpgradeDigest(resource.sha256) else { throw UpgradeFailure.malformedSource }
            resourceBytes += resource.byteCount
            var chunks: [String] = [], offset: Int64 = 0, digest = SHA256()
            while offset < resource.byteCount {
                try Task.checkCancellation()
                let count = min(UpgradeLimits.chunkBytes, Int(resource.byteCount - offset))
                let data = try await source.readResourceChunk(path, offset: offset, maximumBytes: count)
                guard data.count == count else { throw UpgradeFailure.sourceUnavailable }
                digest.update(data: data)
                let key = "upgrade.resource.\(upgradeDigest(data))"
                if try await plainValues.read(key) != data { try await plainValues.write(data, for: key) }
                guard try await plainValues.read(key) == data else { throw UpgradeFailure.verificationFailed }
                chunks.append(key); offset += Int64(data.count)
            }
            guard digest.finalize().map({ String(format: "%02x", $0) }).joined() == resource.sha256 else { throw UpgradeFailure.sourceUnavailable }
            resources.append(LegacyResource(relativePath: path, byteCount: resource.byteCount, sha256: resource.sha256, chunks: chunks))
        }
        let manifest = UpgradeManifest(version: 1, installState: installState, values: references, resources: resources)
        try validateManifest(manifest)
        let output = try await result(manifest, alreadyImported: false) // Validate identity/registry before publishing.
        try Task.checkCancellation()
        // Commit point. A cancellation arriving after the verified write starts does not undo valid data.
        try await manifests.write(manifest, key: Self.manifestKey)
        guard try await storedManifest() == manifest else { throw UpgradeFailure.verificationFailed }
        return output
    }

    public func preservedValue(_ id: LegacyValueID) async throws -> Data? {
        try validateID(id)
        guard let manifest = try await storedManifest() else { return nil }
        try validateManifest(manifest)
        guard let data = try await value(id, manifest: manifest) else { return nil }
        try validatePreservedValue(id, data: data)
        return data
    }

    /// Reads immutable copied resources. Original Expo files can later be discarded without breaking launch.
    public func readResource(_ relativePath: String, offset: Int64, maximumBytes: Int = UpgradeLimits.chunkBytes) async throws -> Data {
        try validateResourcePath(relativePath)
        guard offset >= 0, maximumBytes > 0, maximumBytes <= UpgradeLimits.chunkBytes,
              let manifest = try await storedManifest() else { throw UpgradeFailure.missingResource }
        try validateManifest(manifest)
        guard let resource = manifest.resources.first(where: { $0.relativePath == relativePath }), offset <= resource.byteCount else { throw UpgradeFailure.missingResource }
        let wanted = min(maximumBytes, Int(resource.byteCount - offset))
        var data = Data(), position = offset
        while data.count < wanted {
            try Task.checkCancellation()
            let index = Int(position) / UpgradeLimits.chunkBytes, inner = Int(position) % UpgradeLimits.chunkBytes
            guard index < resource.chunks.count else { throw UpgradeFailure.verificationFailed }
            let key = resource.chunks[index]
            let expectedCount = min(UpgradeLimits.chunkBytes, Int(resource.byteCount) - index * UpgradeLimits.chunkBytes)
            guard let chunk = try await plainValues.read(key), key == "upgrade.resource.\(upgradeDigest(chunk))",
                  chunk.count == expectedCount, inner < chunk.count else { throw UpgradeFailure.verificationFailed }
            let count = min(wanted - data.count, chunk.count - inner)
            data.append(chunk.subdata(in: inner..<inner + count)); position += Int64(count)
        }
        return data
    }

    static func installState(marker: Data?, ids: [LegacyValueID], resourcePaths: [String]) throws -> UpgradeInstallState {
        if let marker {
            guard let value = String(data: marker, encoding: .utf8) else { throw UpgradeFailure.malformedSource }
            if !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return .existing }
        }
        // Recognized owned files also prove a prior installation; unsent recordings must survive old markers.
        let hasSandboxData = !resourcePaths.isEmpty || ids.contains {
            $0.domain == .asyncStorage && $0.key != UpgradeKeys.marker && isAppLegacyKey($0.key)
        }
        return hasSandboxData ? .upgraded : .fresh
    }

    static func retainOnFreshInstall(_ id: LegacyValueID) -> Bool {
        if id.domain == .secure { return id.key == UpgradeKeys.identity || id.key.hasPrefix("clawket.proEntitlement.v1") }
        return id.domain == .userDefaults || id.key == UpgradeKeys.marker
    }

    private func storedManifest() async throws -> UpgradeManifest? {
        do { return try await manifests.read(UpgradeManifest.self, key: Self.manifestKey)?.value }
        catch is CancellationError { throw CancellationError() }
        catch { throw UpgradeFailure.verificationFailed }
    }

    func committedResult() async throws -> UpgradeResult? {
        guard let manifest = try await storedManifest() else { return nil }
        try validateManifest(manifest)
        return try await result(manifest, alreadyImported: true)
    }

    private func value(_ id: LegacyValueID, manifest: UpgradeManifest) async throws -> Data? {
        guard let reference = manifest.values.first(where: { $0.id == id }) else { return nil }
        let store = id.domain == .secure ? secretValues : plainValues
        var data = Data()
        data.reserveCapacity(reference.byteCount)
        for key in reference.chunks {
            try Task.checkCancellation()
            guard let chunk = try await store.read(key), chunk.count <= UpgradeLimits.chunkBytes,
                  key == "upgrade.\(id.domain.rawValue).\(upgradeDigest(chunk))",
                  chunk.count <= reference.byteCount - data.count else { throw UpgradeFailure.verificationFailed }
            data.append(chunk)
        }
        guard data.count == reference.byteCount, upgradeDigest(data) == reference.sha256 else { throw UpgradeFailure.verificationFailed }
        return data
    }

    private func result(_ manifest: UpgradeManifest, alreadyImported: Bool) async throws -> UpgradeResult {
        func id(_ key: String, domain: LegacyValueDomain = .secure) -> LegacyValueID { .init(domain: domain, key: key) }
        let identity = try upgradeIdentity(await value(id(UpgradeKeys.identity), manifest: manifest))
        let current = try await value(id(UpgradeKeys.registry), manifest: manifest)
        let rollback = try await value(id(UpgradeKeys.rollback), manifest: manifest)
        let configs = try await value(id(UpgradeKeys.configs), manifest: manifest)
        let profiles = try await value(id(UpgradeKeys.profiles), manifest: manifest)
        let single = try await value(id(UpgradeKeys.single), manifest: manifest)
        let registry = try upgradeRegistry(current: current, rollback: rollback, configs: configs, profiles: profiles, single: single)
        let purchase = try purchaseString(await value(id(UpgradeKeys.purchase, domain: .userDefaults), manifest: manifest))
        let oldPurchase = try purchaseString(await value(id(UpgradeKeys.oldPurchase, domain: .userDefaults), manifest: manifest))
        return UpgradeResult(manifest: manifest, identity: identity, registry: registry,
            purchaseIdentity: .init(currentAppUserID: purchase, legacyAppUserID: oldPurchase), wasAlreadyImported: alreadyImported)
    }
}

private func validateID(_ id: LegacyValueID) throws {
    try validateLegacyKey(id.key)
    guard id.domain == .userDefaults ? id.key.hasPrefix("com.revenuecat.userdefaults.") : isAppLegacyKey(id.key) else { throw UpgradeFailure.malformedSource }
}

private func validateManifest(_ manifest: UpgradeManifest) throws {
    guard manifest.version == 1, manifest.values.count <= UpgradeLimits.valueCount,
          Set(manifest.values.map(\.id)).count == manifest.values.count,
          manifest.resources.count <= UpgradeLimits.resourceCount,
          Set(manifest.resources.map(\.relativePath)).count == manifest.resources.count else { throw UpgradeFailure.malformedSource }
    var bytes = 0
    for reference in manifest.values {
        try validateID(reference.id)
        guard manifest.installState != .fresh || UpgradeImporter.retainOnFreshInstall(reference.id) else { throw UpgradeFailure.malformedSource }
        let cap = reference.id.domain == .secure ? UpgradeLimits.secureValueBytes : UpgradeLimits.plainValueBytes
        guard reference.byteCount >= 0, reference.byteCount <= cap, reference.byteCount <= UpgradeLimits.totalValueBytes - bytes,
              reference.chunks.count == (reference.byteCount + UpgradeLimits.chunkBytes - 1) / UpgradeLimits.chunkBytes,
              isUpgradeDigest(reference.sha256) else { throw UpgradeFailure.malformedSource }
        for key in reference.chunks {
            let prefix = "upgrade.\(reference.id.domain.rawValue)."
            guard key.hasPrefix(prefix), isUpgradeDigest(String(key.dropFirst(prefix.count))) else { throw UpgradeFailure.malformedSource }
        }
        bytes += reference.byteCount
    }
    var resourceBytes: Int64 = 0
    for resource in manifest.resources {
        try validateResourcePath(resource.relativePath)
        guard resource.byteCount >= 0, resource.byteCount <= UpgradeLimits.resourceBytes,
              resource.byteCount <= UpgradeLimits.totalResourceBytes - resourceBytes, isUpgradeDigest(resource.sha256),
              resource.chunks.count == (Int(resource.byteCount) + UpgradeLimits.chunkBytes - 1) / UpgradeLimits.chunkBytes else { throw UpgradeFailure.malformedSource }
        for key in resource.chunks {
            let prefix = "upgrade.resource."
            guard key.hasPrefix(prefix), isUpgradeDigest(String(key.dropFirst(prefix.count))) else { throw UpgradeFailure.malformedSource }
        }
        resourceBytes += resource.byteCount
    }
    let data = try JSONEncoder().encode(manifest)
    guard data.count <= UpgradeLimits.manifestBytes else { throw UpgradeFailure.tooLarge }
}

func validateResourcePath(_ path: String) throws {
    let pattern = "^Documents/(?:incoming-share/[a-f0-9]{32}/[0-5]\\.[A-Za-z0-9]{1,10}|voice-drafts-v1/[a-f0-9]{32}/(?:metadata\\.json|audio\\.pcm|result-[0-9]{1,3}\\.(?:json|tmp)))$"
    guard path.utf8.count <= 512, !path.unicodeScalars.contains(where: { $0.value < 32 }),
          path.range(of: pattern, options: .regularExpression) != nil else { throw UpgradeFailure.unsafePath }
}

func upgradeDigest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
func isUpgradeDigest(_ value: String) -> Bool { value.utf8.count == 64 && value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }
