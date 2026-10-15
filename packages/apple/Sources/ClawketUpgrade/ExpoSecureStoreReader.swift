import Foundation
import Security

protocol LegacySecureReader: Sendable {
    func keys() async throws -> [String]
    func read(_ key: String) async throws -> Data?
}

/// Expo uses Data for both account and generic, with these exact service fallbacks.
/// No writes, deletes, access-group expansion or authentication prompts occur here.
actor ExpoSecureStoreReader: LegacySecureReader {
    static let services = ["app:no-auth", "app:auth", "app"]

    func keys() throws -> [String] {
        var keys = Set<String>()
        for service in Self.services {
            var query = Self.query(service: service)
            query[kSecReturnAttributes] = true
            query[kSecMatchLimit] = kSecMatchLimitAll
            var output: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &output)
            if status == errSecItemNotFound { continue }
            guard status == errSecSuccess, let items = output as? [[CFString: Any]] else { throw UpgradeFailure.sourceUnavailable }
            guard items.count <= UpgradeLimits.valueCount else { throw UpgradeFailure.tooLarge }
            for item in items {
                if let key = try Self.legacyKey(attributes: item) { keys.insert(key) }
            }
        }
        return keys.sorted()
    }

    func read(_ key: String) throws -> Data? {
        try validateLegacyKey(key)
        guard isAppLegacyKey(key) else { throw UpgradeFailure.malformedSource }
        for service in Self.services {
            var query = Self.query(service: service, key: key)
            query[kSecReturnData] = true
            query[kSecMatchLimit] = kSecMatchLimitOne
            var output: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &output)
            if status == errSecItemNotFound { continue }
            guard status == errSecSuccess, let value = output as? Data else { throw UpgradeFailure.sourceUnavailable }
            guard value.count <= UpgradeLimits.secureValueBytes else { throw UpgradeFailure.tooLarge }
            guard String(data: value, encoding: .utf8) != nil else { throw UpgradeFailure.malformedSource }
            return value
        }
        return nil
    }

    static func query(service: String, key: String? = nil) -> [CFString: Any] {
        var query: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: service,
                                    kSecUseAuthenticationUI: kSecUseAuthenticationUIFail]
        if let key { query[kSecAttrAccount] = Data(key.utf8); query[kSecAttrGeneric] = Data(key.utf8) }
        return query
    }

    static func legacyKey(attributes: [CFString: Any]) throws -> String? {
        // Security may return CFString even when Expo queried the account with UTF-8 Data.
        let account = (attributes[kSecAttrAccount] as? Data) ?? (attributes[kSecAttrAccount] as? String).map { Data($0.utf8) }
        guard let account, let key = String(data: account, encoding: .utf8), isAppLegacyKey(key) else { return nil }
        guard attributes[kSecAttrGeneric] as? Data == account else { throw UpgradeFailure.malformedSource }
        try validateLegacyKey(key)
        return key
    }
}

func isAppLegacyKey(_ key: String) -> Bool { key.hasPrefix("clawket.") || key == "agent_avatars" }

func validateLegacyKey(_ key: String) throws {
    guard !key.isEmpty, key.utf8.count <= UpgradeLimits.keyBytes,
          !key.unicodeScalars.contains(where: { $0.value < 32 }) else { throw UpgradeFailure.malformedSource }
}
