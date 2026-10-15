import CryptoKit
import Foundation

/// Private device-local caches and drafts. Callers supply a directory inside their own sandbox.
/// Opaque file names do not reveal connection or session identifiers.
public actor FileValueStore: ValueStore {
    private let directory: URL
    private let maximumBytes: Int

    public init(directory: URL, maximumBytes: Int = 8 * 1024 * 1024) throws {
        guard directory.isFileURL, maximumBytes > 0, maximumBytes <= 8 * 1024 * 1024 else {
            throw StoreFailure.invalidKey
        }
        self.directory = directory
        self.maximumBytes = maximumBytes
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
            let properties = try directory.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey])
            guard properties.isDirectory == true, properties.isSymbolicLink != true else { throw StoreFailure.unavailable }
            var url = directory
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try url.setResourceValues(values)
        } catch { throw StoreFailure.unavailable }
    }

    public func read(_ key: String) throws -> Data? {
        let url = try fileURL(key)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        do {
            let properties = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
            guard properties.isRegularFile == true, properties.isSymbolicLink != true else { throw StoreFailure.unavailable }
            guard let size = properties.fileSize, size <= maximumBytes else { throw StoreFailure.tooLarge }
            let file = try FileHandle(forReadingFrom: url)
            defer { try? file.close() }
            let data = try file.read(upToCount: maximumBytes + 1) ?? Data()
            guard data.count <= maximumBytes else { throw StoreFailure.tooLarge }
            return data
        } catch let failure as StoreFailure { throw failure }
        catch { throw StoreFailure.unavailable }
    }

    public func write(_ value: Data, for key: String) throws {
        guard value.count <= maximumBytes else { throw StoreFailure.tooLarge }
        let url = try fileURL(key)
        do {
            #if os(iOS)
            try value.write(to: url, options: [.atomic, .completeFileProtection])
            #else
            try value.write(to: url, options: [.atomic])
            #endif
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        } catch { throw StoreFailure.unavailable }
    }

    public func remove(_ key: String) throws {
        let url = try fileURL(key)
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        do { try FileManager.default.removeItem(at: url) }
        catch { throw StoreFailure.unavailable }
    }

    private func fileURL(_ key: String) throws -> URL {
        try validateStoreKey(key)
        let name = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent(name + ".json", isDirectory: false)
    }
}
