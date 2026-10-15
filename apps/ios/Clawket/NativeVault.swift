import ClawketPairing
import ClawketPersistence
import ClawketRuntime
import CryptoKit
import Foundation

struct ConnectionRegistry: Codable, Sendable {
    var version = 1
    var revision: Int64 = 0
    var activeConnectionID: String?
    var freeConnectionID: String?
    var paused = false
    var records: [BackendConnection] = []
}

/// The QA app creates identities only in its own isolated Keychain service.
/// Same-bundle upgrade support must be integrated before any production bundle is allowed here.
actor NativeVault: DeviceCredentialProvider {
    private let documents: DocumentStore
    private var identityTask: Task<RuntimeDeviceIdentity, Error>?
    private var identityRevision: UUID?
    private var registryRevision: Int64 = -1

    init() throws {
        guard Bundle.main.bundleIdentifier == "com.p697.clawket.nativeqa" else { throw StoreFailure.unavailable }
        documents = try DocumentStore(values: KeychainValueStore(service: "com.p697.clawket.nativeqa.secure.v1"))
    }

    func readRegistry() async throws -> StoredDocument<ConnectionRegistry>? {
        let value = try await documents.read(ConnectionRegistry.self, key: "registry.v1")
        if let value {
            guard value.value.version == 1, value.value.revision >= 0,
                  Set(value.value.records.map(\.id)).count == value.value.records.count,
                  value.value.records.allSatisfy({ !$0.id.isEmpty && !$0.label.isEmpty }) else {
                throw StoreFailure.invalidDocument
            }
            if let active = value.value.activeConnectionID,
               !value.value.records.contains(where: { $0.id == active }) { throw StoreFailure.invalidDocument }
            registryRevision = max(registryRevision, value.value.revision)
        }
        return value
    }

    func writeRegistry(_ registry: ConnectionRegistry) async throws {
        guard registry.revision >= registryRevision else { throw StoreFailure.verificationFailed }
        registryRevision = registry.revision
        try await documents.write(registry, key: "registry.v1")
    }

    func identity() async throws -> RuntimeDeviceIdentity {
        if let task = identityTask { return try await task.value }
        let revision = UUID()
        let documents = self.documents
        let task = Task<RuntimeDeviceIdentity, Error> {
            if let identity = try await documents.read(RuntimeDeviceIdentity.self, key: "identity.v1")?.value {
                _ = try PairingCryptography.importSigningKey(tweetNaClSecret: identity.secretKey, publicKey: identity.publicKey)
                guard try PairingCryptography.deviceID(publicKey: identity.publicKey) == identity.deviceID else {
                    throw StoreFailure.invalidDocument
                }
                return identity
            }
            let key = Curve25519.Signing.PrivateKey()
            let publicKey = key.publicKey.rawRepresentation
            let identity = RuntimeDeviceIdentity(deviceID: try PairingCryptography.deviceID(publicKey: publicKey),
                publicKey: publicKey, secretKey: key.rawRepresentation + publicKey)
            try await documents.write(identity, key: "identity.v1")
            return identity
        }
        identityTask = task; identityRevision = revision
        do { return try await task.value }
        catch {
            if identityRevision == revision { identityTask = nil; identityRevision = nil }
            throw error
        }
    }

    func readToken(scope: DeviceTokenScope) async throws -> RuntimeDeviceToken? {
        try await documents.read(RuntimeDeviceToken.self, key: tokenKey(scope))?.value
    }

    func writeToken(_ token: RuntimeDeviceToken, scope: DeviceTokenScope) async throws {
        try await documents.write(token, key: tokenKey(scope))
    }

    func deleteToken(scope: DeviceTokenScope) async throws {
        try await documents.remove(key: tokenKey(scope))
    }

    private func tokenKey(_ scope: DeviceTokenScope) throws -> String {
        // Roles and logical endpoints remain independent, even for one local device identity.
        try DocumentStore.scopedKey(namespace: "device-token.v1", parts: [scope.connectionID, scope.deviceID,
            scope.role, scope.registryURL?.absoluteString ?? "", scope.relayID ?? "", scope.gatewayURL.absoluteString])
    }
}

