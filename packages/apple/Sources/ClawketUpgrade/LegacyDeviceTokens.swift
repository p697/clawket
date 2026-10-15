import Foundation
import ClawketPairing

public struct UpgradedDeviceToken: Sendable, Equatable {
    public let token: String
    public let role: String
    public let scopes: [String]
    public let updatedAtMs: Int64
}

extension UpgradeImporter {
    /// Only an imported connection and its original identity may use preserved scoped credentials.
    /// The legacy unscoped fallback has operator semantics and is never offered to the node role.
    public func deviceToken(connectionID: String, deviceID: String, role: String = "operator") async throws -> UpgradedDeviceToken? {
        guard let result = try await committedResult(), result.identity?.deviceID == deviceID,
              let connection = result.registry?.connections.first(where: { $0.id == connectionID }),
              connection.backendKind == .openclaw else { return nil }
        let expectedRole = normalizeLegacyScopePart(role).lowercased()
        guard !expectedRole.isEmpty else { return nil }
        for key in legacyTokenCandidates(connection: connection, deviceID: deviceID, role: expectedRole) {
            guard let data = try await preservedValue(.init(domain: .secure, key: key)) else { continue }
            let token = try decodeLegacyToken(data)
            return token.role == expectedRole ? token : nil
        }
        return nil
    }
}

func legacyTokenCandidates(connection: UpgradedConnection, deviceID: String, role: String) -> [String] {
    let base = "clawket.deviceToken.\(deviceID.trimmingCharacters(in: .whitespacesAndNewlines))"
    let normalizedRole = normalizeLegacyScopePart(role).lowercased()
    let suffix = normalizedRole == "operator" || normalizedRole.isEmpty ? "" : "_role_\(upgradeDigest(Data(normalizedRole.utf8)))"
    var keys: [String] = []
    if let relay = connection.relay {
        // The saved raw spelling is authoritative for historical key hashes. Socket URL conversion,
        // URL serialization and official-domain migration must not change that first candidate.
        var servers = [connection.legacyTokenScope.registryURL ?? relay.serverURL.absoluteString]
        servers.append(relay.serverURL.absoluteString)
        if let service = OfficialPairingServices.service(for: relay.serverURL), var alias = URLComponents(url: relay.serverURL, resolvingAgainstBaseURL: false) {
            alias.host = service.legacyRegistryHost
            if let url = alias.url { servers.append(url.absoluteString) }
        }
        for server in servers {
            let identity = normalizeLegacyScopePart(server) + "::" + normalizeLegacyScopePart(relay.gatewayID)
            keys.append(base + "_relay_" + upgradeDigest(Data(identity.utf8)) + suffix)
        }
    } else {
        keys.append(base + "_url_" + upgradeDigest(Data(normalizeLegacyScopePart(connection.legacyTokenScope.gatewayURL).utf8)) + suffix)
    }
    if normalizedRole == "operator" { keys.append(base) }
    var seen = Set<String>()
    return keys.filter { seen.insert($0).inserted }
}

private func normalizeLegacyScopePart(_ value: String) -> String {
    var result = value.trimmingCharacters(in: .whitespacesAndNewlines)
    while result.hasSuffix("/") { result.removeLast() }
    return result
}

func decodeLegacyToken(_ data: Data) throws -> UpgradedDeviceToken {
    guard let raw = String(data: data, encoding: .utf8), !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw UpgradeFailure.malformedSource }
    if let parsed = try? JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed) {
        guard let value = parsed as? [String: Any], upgradeInteger(value, "version") == 1 else { throw UpgradeFailure.malformedSource }
        let token = try upgradeString(value, "token").trimmingCharacters(in: .whitespacesAndNewlines)
        let role = try upgradeString(value, "role").trimmingCharacters(in: .whitespacesAndNewlines)
        let scopes = (value["scopes"] as? [Any] ?? []).compactMap { $0 as? String }
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        return UpgradedDeviceToken(token: token, role: role, scopes: Set(scopes).sorted(), updatedAtMs: upgradeInteger(value, "updatedAtMs") ?? 0)
    }
    return UpgradedDeviceToken(token: raw.trimmingCharacters(in: .whitespacesAndNewlines), role: "operator", scopes: [], updatedAtMs: 0)
}
