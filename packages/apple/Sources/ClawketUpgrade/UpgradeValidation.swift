import CoreFoundation
import Foundation
import ClawketPairing

enum UpgradeKeys {
    static let identity = "clawket.identity.v1"
    static let registry = "clawket.connectionRegistry.v1"
    static let rollback = "clawket.connectionRegistry.rollback.v1"
    static let configs = "clawket.gatewayConfigsState.v1"
    static let profiles = "clawket.gatewayProfilesConfig.v1"
    static let single = "clawket.gatewayConfig.v1"
    static let marker = "clawket.installMarker.v1"
    static let purchase = "com.revenuecat.userdefaults.appUserID.new"
    static let oldPurchase = "com.revenuecat.userdefaults.appUserID"
}

func upgradeIdentity(_ data: Data?) throws -> UpgradedIdentity? {
    guard let data else { return nil }
    do {
        let object = try upgradeObject(data)
        let deviceID = try upgradeString(object, "deviceId")
        let publicKey = try PairingCryptography.decodeHex(upgradeString(object, "publicKeyHex"))
        let secretKey = try PairingCryptography.decodeHex(upgradeString(object, "secretKeyHex"))
        _ = try PairingCryptography.importSigningKey(tweetNaClSecret: secretKey, publicKey: publicKey)
        guard try PairingCryptography.deviceID(publicKey: publicKey) == deviceID else { throw UpgradeFailure.invalidIdentity }
        return UpgradedIdentity(deviceID: deviceID, publicKey: publicKey, secretKey: secretKey, createdAt: optionalUpgradeString(object, "createdAt"))
    } catch { throw UpgradeFailure.invalidIdentity }
}

func upgradeRegistry(current: Data?, rollback: Data?, configs: Data?, profiles: Data?, single: Data?) throws -> UpgradedRegistry? {
    if let current, let result = try? currentRegistry(current, rollback: false) { return result }
    if let rollback, let result = try? currentRegistry(rollback, rollback: true) { return result }
    if current != nil || rollback != nil { throw UpgradeFailure.invalidRegistry }
    do {
        if let configs {
            let object = try upgradeObject(configs)
            guard let rows = object["configs"] as? [[String: Any]] else { throw UpgradeFailure.invalidRegistry }
            let records = try rows.map(legacyConnection)
            let ids = Set(records.map(\.id))
            guard ids.count == records.count else { throw UpgradeFailure.invalidRegistry }
            let active = try nullableString(object, "activeId") ?? records.first?.id
            guard active == nil || ids.contains(active!) else { throw UpgradeFailure.invalidRegistry }
            return UpgradedRegistry(revision: 1, activeConnectionID: active, freeConnectionID: active,
                                    connections: records, recoveredFromRollback: false)
        }
        if let profiles {
            let object = try upgradeObject(profiles)
            var rows: [UpgradedConnection] = []
            for mode in ["local", "tailscale", "cloudflare"] {
                guard let profile = object[mode] as? [String: Any] else { continue }
                guard let url = optionalUpgradeString(profile, "url") else { continue }
                var row = profile
                row["id"] = "legacy_\(mode)"; row["name"] = "\(mode.capitalized) Gateway"
                row["mode"] = mode; row["url"] = url
                rows.append(try legacyConnection(row))
            }
            let mode = optionalUpgradeString(object, "activeMode")
            let active = rows.first(where: { $0.transportKind.rawValue == mode })?.id ?? rows.first?.id
            return UpgradedRegistry(revision: 1, activeConnectionID: active, freeConnectionID: active,
                                    connections: rows, recoveredFromRollback: false)
        }
        if let single {
            var object = try upgradeObject(single)
            object["id"] = "legacy_single"; object["name"] = "Gateway"; object["mode"] = "local"
            let row = try legacyConnection(object)
            return UpgradedRegistry(revision: 1, activeConnectionID: row.id, freeConnectionID: row.id,
                                    connections: [row], recoveredFromRollback: false)
        }
        return nil
    } catch { throw UpgradeFailure.invalidRegistry }
}

private func currentRegistry(_ data: Data, rollback: Bool) throws -> UpgradedRegistry {
    let object = try upgradeObject(data)
    guard upgradeInteger(object, "version") == 1, let revision = upgradeInteger(object, "revision"), revision >= 0,
          let state = object["state"] as? [String: Any], let records = state["records"] as? [[String: Any]],
          records.count <= UpgradeLimits.valueCount else { throw UpgradeFailure.invalidRegistry }
    let rows = try records.map { try connection($0, legacy: false) }
    let ids = Set(rows.map(\.id))
    guard ids.count == rows.count, state.keys.contains("activeConnectionId"), state.keys.contains("freeConnectionId") else { throw UpgradeFailure.invalidRegistry }
    let active = try nullableString(state, "activeConnectionId"), free = try nullableString(state, "freeConnectionId")
    if rows.isEmpty {
        guard active == nil, free == nil else { throw UpgradeFailure.invalidRegistry }
    } else {
        guard let active, let free, ids.contains(active), ids.contains(free) else { throw UpgradeFailure.invalidRegistry }
    }
    return UpgradedRegistry(revision: revision, activeConnectionID: active, freeConnectionID: free, connections: rows, recoveredFromRollback: rollback)
}

private func legacyConnection(_ object: [String: Any]) throws -> UpgradedConnection { try connection(object, legacy: true) }

private func connection(_ object: [String: Any], legacy: Bool) throws -> UpgradedConnection {
    let mode = optionalUpgradeString(object, "mode")
    let backendText = optionalUpgradeString(object, "backendKind") ?? (legacy ? (mode == "hermes" || object["hermes"] != nil ? "hermes" : "openclaw") : "")
    let legacyTransport = mode.flatMap(PairingTransport.init(rawValue:))?.rawValue ?? (object["relay"] != nil ? "relay" : "custom")
    let transportText = optionalUpgradeString(object, "transportKind") ?? (legacy ? legacyTransport : "")
    guard let backend = PairingBackend(rawValue: backendText), let transport = PairingTransport(rawValue: transportText) else { throw UpgradeFailure.invalidRegistry }
    let createdAt = upgradeInteger(object, "createdAt") ?? (legacy && object["createdAt"] == nil ? 0 : -1)
    guard createdAt >= 0 else { throw UpgradeFailure.invalidRegistry }
    var environment: PairingEnvironment?
    if let value = object["environment"] {
        guard let raw = value as? String, let parsed = PairingEnvironment(rawValue: raw) else { throw UpgradeFailure.invalidRegistry }
        environment = parsed
    } else { environment = nil }
    let url = try upgradeURL(upgradeString(object, "url"), socket: true)
    var token = optionalUpgradeString(object, legacy ? "token" : "__absent"), password = optionalUpgradeString(object, legacy ? "password" : "__absent")
    if let value = object["auth"] {
        guard let auth = value as? [String: Any] else { throw UpgradeFailure.invalidRegistry }
        token = try strictOptionalString(auth, "token"); password = try strictOptionalString(auth, "password")
    }
    var bootstrap: PairingBootstrap?
    if let value = object["bootstrap"] {
        guard let value = value as? [String: Any], let strategy = PairingBootstrap.Strategy(rawValue: try upgradeString(value, "strategy")) else { throw UpgradeFailure.invalidRegistry }
        let access: PairingBootstrap.Access?
        if let raw = value["access"] {
            guard let raw = raw as? String, let parsed = PairingBootstrap.Access(rawValue: raw) else { throw UpgradeFailure.invalidRegistry }; access = parsed
        } else { access = nil }
        let expires = upgradeInteger(value, "expiresAtMs")
        if value["expiresAtMs"] != nil && expires == nil { throw UpgradeFailure.invalidRegistry }
        // Preserve expired bootstrap data; migration must not mint a new credential or expiry.
        bootstrap = PairingBootstrap(token: try upgradeString(value, "token"), strategy: strategy, expiresAtMs: expires, access: access)
    }
    var relay: PairingRelay?
    if let raw = object["relay"] {
        guard let value = raw as? [String: Any] else { throw UpgradeFailure.invalidRegistry }
        let version = upgradeInteger(value, "protocolVersion")
        if value["protocolVersion"] != nil && version == nil { throw UpgradeFailure.invalidRegistry }
        let supportsBootstrap = try optionalUpgradeBool(value, "supportsBootstrap")
        relay = PairingRelay(serverURL: try upgradeURL(upgradeString(value, "serverUrl"), socket: false), gatewayID: try upgradeString(value, "gatewayId"),
            clientToken: try strictOptionalString(value, "clientToken"), relayURL: transport == .relay ? url : nil,
            displayName: try strictOptionalString(value, "displayName"), protocolVersion: version.map(Int.init), supportsBootstrap: supportsBootstrap)
    }
    if legacy, environment == nil, let server = relay?.serverURL {
        environment = OfficialPairingServices.service(for: server)?.environment
        if environment == nil, server.host?.range(of: "^clawket-hermes-registry-preview\\.[^.]+\\.workers\\.dev$", options: .regularExpression) != nil { environment = .preview }
    }
    var bridge: URL?
    if let value = object["hermes"] {
        guard let value = value as? [String: Any] else { throw UpgradeFailure.invalidRegistry }
        bridge = try upgradeURL(upgradeString(value, "bridgeUrl"), socket: false)
    }
    return UpgradedConnection(id: try upgradeString(object, "id"), backendKind: backend, transportKind: transport,
        label: try upgradeString(object, legacy ? "name" : "label"), url: url, createdAt: createdAt,
        environment: environment, debugMode: try optionalUpgradeBool(object, "debugMode"), token: token, password: password,
        bootstrap: bootstrap, relay: relay, hermesBridgeURL: bridge)
}

func validatePreservedValue(_ id: LegacyValueID, data: Data) throws {
    guard String(data: data, encoding: .utf8) != nil || id.domain == .userDefaults else { throw UpgradeFailure.malformedSource }
    if id.domain == .secure && id.key.hasPrefix("clawket.deviceToken.") {
        guard let text = String(data: data, encoding: .utf8), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw UpgradeFailure.malformedSource }
        if let parsed = try? JSONSerialization.jsonObject(with: data) {
            guard let value = parsed as? [String: Any], upgradeInteger(value, "version") == 1,
                  optionalUpgradeString(value, "token") != nil, optionalUpgradeString(value, "role") != nil,
                  let scopes = value["scopes"] as? [String], scopes.allSatisfy({ !$0.isEmpty }) else { throw UpgradeFailure.malformedSource }
        } // A non-JSON token is the shipped legacy operator-only representation.
    }
    if id.domain == .secure && id.key.hasPrefix("clawket.proEntitlement.v1") {
        let value = try upgradeObject(data)
        guard upgradeInteger(value, "version") == 1, value.keys.contains("freeConnectionId"),
              let evaluated = upgradeInteger(value, "graceEvaluatedAt"), evaluated >= 0 else { throw UpgradeFailure.malformedSource }
        _ = try nullableString(value, "freeConnectionId")
        for name in ["lastFreeConnectionSwitchAt", "graceUntil"] {
            guard value[name] is NSNull || (upgradeInteger(value, name).map { $0 >= 0 } == true) else { throw UpgradeFailure.malformedSource }
        }
    }
}

func purchaseString(_ data: Data?) throws -> String? {
    guard let data else { return nil }
    guard let value = try? PropertyListSerialization.propertyList(from: data, format: nil) as? String,
          !value.isEmpty, value.utf8.count <= 4_096 else { throw UpgradeFailure.malformedSource }
    return value
}

func upgradeObject(_ data: Data) throws -> [String: Any] {
    guard let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw UpgradeFailure.malformedSource }
    return value
}

func optionalUpgradeString(_ object: [String: Any], _ key: String) -> String? {
    guard let value = object[key] as? String, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
    return value
}

func upgradeString(_ object: [String: Any], _ key: String) throws -> String {
    guard let value = optionalUpgradeString(object, key) else { throw UpgradeFailure.malformedSource }
    return value
}

private func strictOptionalString(_ object: [String: Any], _ key: String) throws -> String? {
    guard object[key] != nil else { return nil }
    return try upgradeString(object, key)
}

private func nullableString(_ object: [String: Any], _ key: String) throws -> String? {
    if object[key] is NSNull || object[key] == nil { return nil }
    return try upgradeString(object, key)
}

private func optionalUpgradeBool(_ object: [String: Any], _ key: String) throws -> Bool? {
    guard let value = object[key] else { return nil }
    guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { throw UpgradeFailure.malformedSource }
    return number.boolValue
}

func upgradeInteger(_ object: [String: Any], _ key: String) -> Int64? {
    guard let value = object[key] as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(), value.doubleValue.isFinite,
          value.doubleValue.rounded() == value.doubleValue, abs(value.doubleValue) <= 9_007_199_254_740_991 else { return nil }
    return Int64(exactly: value.doubleValue)
}

private func upgradeURL(_ raw: String, socket: Bool) throws -> URL {
    guard var parts = URLComponents(string: raw), let scheme = parts.scheme?.lowercased(), parts.host?.isEmpty == false,
          parts.user == nil, parts.password == nil, parts.fragment == nil,
          parts.port == nil || (1...65535).contains(parts.port!) else { throw UpgradeFailure.invalidRegistry }
    parts.scheme = socket ? ["http": "ws", "https": "wss"][scheme] ?? scheme : ["ws": "http", "wss": "https"][scheme] ?? scheme
    guard (socket ? ["ws", "wss"] : ["http", "https"]).contains(parts.scheme ?? ""), let url = parts.url else { throw UpgradeFailure.invalidRegistry }
    return OfficialPairingServices.canonicalize(url)
}
