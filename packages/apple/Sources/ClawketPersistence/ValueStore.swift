import Foundation
import Security

/// Fixed categories only. Native errors can contain paths or account information.
public enum StoreFailure: Error, Equatable, Sendable {
    case invalidKey, tooLarge, unavailable, invalidDocument, verificationFailed
}

public protocol ValueStore: Sendable {
    func read(_ key: String) async throws -> Data?
    func write(_ value: Data, for key: String) async throws
    func remove(_ key: String) async throws
}

/// An app-specific service keeps the development app separate from installed releases.
/// Legacy Expo services are read only through an explicitly configured importer.
public actor KeychainValueStore: ValueStore {
    private let service: String
    private let maximumBytes: Int

    public init(service: String, maximumBytes: Int = 1024 * 1024) throws {
        guard !service.isEmpty, service.utf8.count <= 256, maximumBytes > 0,
              maximumBytes <= 8 * 1024 * 1024 else { throw StoreFailure.invalidKey }
        self.service = service
        self.maximumBytes = maximumBytes
    }

    public func read(_ key: String) throws -> Data? {
        var query = try attributes(key)
        query[kSecReturnData] = true
        query[kSecMatchLimit] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw StoreFailure.unavailable }
        guard data.count <= maximumBytes else { throw StoreFailure.tooLarge }
        return data
    }

    public func write(_ value: Data, for key: String) throws {
        guard value.count <= maximumBytes else { throw StoreFailure.tooLarge }
        var query = try attributes(key)
        let changes: [CFString: Any] = [kSecValueData: value]
        let status = SecItemUpdate(query as CFDictionary, changes as CFDictionary)
        if status == errSecItemNotFound {
            query[kSecValueData] = value
            query[kSecAttrAccessible] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            guard SecItemAdd(query as CFDictionary, nil) == errSecSuccess else { throw StoreFailure.unavailable }
        } else if status != errSecSuccess { throw StoreFailure.unavailable }
    }

    public func remove(_ key: String) throws {
        let status = SecItemDelete(try attributes(key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw StoreFailure.unavailable }
    }

    private func attributes(_ key: String) throws -> [CFString: Any] {
        try validateStoreKey(key)
        return [kSecClass: kSecClassGenericPassword, kSecAttrService: service,
                kSecAttrAccount: key, kSecAttrSynchronizable: false]
    }
}

func validateStoreKey(_ key: String) throws {
    guard !key.isEmpty, key.utf8.count <= 256, !key.unicodeScalars.contains(where: { $0.value < 32 }) else {
        throw StoreFailure.invalidKey
    }
}
