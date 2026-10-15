import CryptoKit
import Foundation

/// Same-application source only. Native QA cannot construct a source for the installed store bundle.
public actor ExpoLegacySource: LegacyUpgradeSource {
    private let container: URL
    private let bundleIdentifier: String
    private let secure: any LegacySecureReader
    private let defaults: [String: Data]
    private var storage: (directory: URL, manifest: [String: String?])?
    private var storageLoaded = false

    public static func currentApplication(expectedBundleIdentifier: String) throws -> ExpoLegacySource {
        guard !expectedBundleIdentifier.isEmpty, Bundle.main.bundleIdentifier == expectedBundleIdentifier else { throw UpgradeFailure.wrongApplication }
        var values: [String: Data] = [:]
        for (key, value) in UserDefaults.standard.persistentDomain(forName: expectedBundleIdentifier) ?? [:] where key.hasPrefix("com.revenuecat.userdefaults.") {
            do { values[key] = try PropertyListSerialization.data(fromPropertyList: value, format: .binary, options: 0) }
            catch { throw UpgradeFailure.malformedSource }
        }
        return try ExpoLegacySource(container: URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true),
                                    bundleIdentifier: expectedBundleIdentifier, secure: ExpoSecureStoreReader(), defaults: values)
    }

    /// Explicit synthetic container constructor is internal; production uses the bundle-checked factory.
    init(container: URL, bundleIdentifier: String, secure: any LegacySecureReader, defaults: [String: Data] = [:]) throws {
        guard container.isFileURL, !bundleIdentifier.isEmpty,
              bundleIdentifier.range(of: "^[A-Za-z0-9.-]+$", options: .regularExpression) != nil else { throw UpgradeFailure.unsafePath }
        self.container = container.standardizedFileURL.resolvingSymlinksInPath()
        self.bundleIdentifier = bundleIdentifier; self.secure = secure; self.defaults = defaults
    }

    public func listValues() async throws -> [LegacyValueID] {
        let manifest = try loadStorage()?.manifest ?? [:]
        var ids = try await secure.keys().map { LegacyValueID(domain: .secure, key: $0) }
        ids += manifest.keys.filter(isAppLegacyKey).map { LegacyValueID(domain: .asyncStorage, key: $0) }
        ids += defaults.keys.map { LegacyValueID(domain: .userDefaults, key: $0) }
        guard ids.count <= UpgradeLimits.valueCount, Set(ids).count == ids.count else { throw UpgradeFailure.tooLarge }
        return ids.sorted()
    }

    public func readValue(_ id: LegacyValueID) async throws -> Data? {
        try validateLegacyKey(id.key)
        switch id.domain {
        case .secure: return try await secure.read(id.key)
        case .userDefaults:
            guard id.key.hasPrefix("com.revenuecat.userdefaults.") else { throw UpgradeFailure.malformedSource }
            return defaults[id.key]
        case .asyncStorage:
            guard isAppLegacyKey(id.key) else { throw UpgradeFailure.malformedSource }
            guard let storage = try loadStorage(), let entry = storage.manifest[id.key] else { return nil }
            if let inline = entry { return Data(inline.utf8) }
            // CryptoKit MD5 is used only to reproduce AsyncStorage's existing filename convention.
            let name = Insecure.MD5.hash(data: Data(id.key.utf8)).map { String(format: "%02x", $0) }.joined()
            let file = storage.directory.appendingPathComponent(name)
            let data = try readLegacyFile(file, maximumBytes: UpgradeLimits.plainValueBytes)
            guard String(data: data, encoding: .utf8) != nil else { throw UpgradeFailure.malformedSource }
            return data
        }
    }

    public func listResourcePaths() throws -> [String] {
        var paths: [String] = []
        for rootName in ["incoming-share", "voice-drafts-v1"] {
            let root = container.appendingPathComponent("Documents/\(rootName)", isDirectory: true)
            guard FileManager.default.fileExists(atPath: root.path) else { continue }
            try validateLegacyDescendant(root, container: container)
            let folders = try directoryContents(root)
            guard folders.count <= (rootName == "incoming-share" ? 200 : 10) else { throw UpgradeFailure.tooLarge }
            for folder in folders {
                guard folder.lastPathComponent.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil else { throw UpgradeFailure.unsafePath }
                try validateLegacyDirectory(folder)
                let files = try directoryContents(folder)
                guard files.count <= (rootName == "incoming-share" ? 6 : 20) else { throw UpgradeFailure.tooLarge }
                for file in files {
                    let leaf = file.lastPathComponent
                    let pattern = rootName == "incoming-share" ? "^[0-5]\\.[A-Za-z0-9]{1,10}$" : "^(?:metadata\\.json|audio\\.pcm|result-[0-9]{1,3}\\.(?:json|tmp))$"
                    guard leaf.range(of: pattern, options: .regularExpression) != nil else { throw UpgradeFailure.unsafePath }
                    let relative = "Documents/\(rootName)/\(folder.lastPathComponent)/\(leaf)"
                    _ = try checkedResourceURL(relative)
                    paths.append(relative)
                }
            }
        }
        guard paths.count <= UpgradeLimits.resourceCount else { throw UpgradeFailure.tooLarge }
        return paths.sorted()
    }

    public func inspectResource(_ relativePath: String) throws -> LegacyResource {
        let url = try checkedResourceURL(relativePath)
        let before = try legacyFileProperties(url, maximumBytes: Int(UpgradeLimits.resourceBytes))
        do {
            let file = try FileHandle(forReadingFrom: url)
            defer { try? file.close() }
            var hash = SHA256(), bytes: Int64 = 0
            while true {
                try Task.checkCancellation()
                let chunk = try file.read(upToCount: 64 * 1024) ?? Data()
                if chunk.isEmpty { break }
                bytes += Int64(chunk.count)
                guard bytes <= UpgradeLimits.resourceBytes else { throw UpgradeFailure.tooLarge }
                hash.update(data: chunk)
            }
            let after = try legacyFileProperties(url, maximumBytes: Int(UpgradeLimits.resourceBytes))
            guard bytes == before.size, after.size == before.size, after.modified == before.modified else { throw UpgradeFailure.sourceUnavailable }
            return LegacyResource(relativePath: relativePath, byteCount: bytes, sha256: hash.finalize().map { String(format: "%02x", $0) }.joined())
        } catch is CancellationError { throw CancellationError() }
        catch let error as UpgradeFailure { throw error }
        catch { throw UpgradeFailure.sourceUnavailable }
    }

    public func readResourceChunk(_ relativePath: String, offset: Int64, maximumBytes: Int) throws -> Data {
        guard offset >= 0, maximumBytes > 0, maximumBytes <= UpgradeLimits.chunkBytes else { throw UpgradeFailure.tooLarge }
        let url = try checkedResourceURL(relativePath)
        let properties = try legacyFileProperties(url, maximumBytes: Int(UpgradeLimits.resourceBytes))
        guard offset <= properties.size else { throw UpgradeFailure.malformedSource }
        do {
            let file = try FileHandle(forReadingFrom: url)
            defer { try? file.close() }
            try file.seek(toOffset: UInt64(offset))
            let count = min(maximumBytes, Int(properties.size - offset))
            let data = try file.read(upToCount: count) ?? Data()
            guard data.count == count else { throw UpgradeFailure.sourceUnavailable }
            return data
        } catch let error as UpgradeFailure { throw error }
        catch { throw UpgradeFailure.sourceUnavailable }
    }

    private func checkedResourceURL(_ relative: String) throws -> URL {
        try validateResourcePath(relative)
        let parts = relative.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 4, parts[0] == "Documents", ["incoming-share", "voice-drafts-v1"].contains(String(parts[1])),
              parts[2].range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil,
              parts[3] != ".", parts[3] != "..", !parts[3].isEmpty else { throw UpgradeFailure.unsafePath }
        var url = container
        for (index, part) in parts.enumerated() {
            url.appendPathComponent(String(part))
            if index < parts.count - 1 { try validateLegacyDirectory(url) }
        }
        _ = try legacyFileProperties(url, maximumBytes: Int(UpgradeLimits.resourceBytes))
        return url
    }

    private func loadStorage() throws -> (directory: URL, manifest: [String: String?])? {
        if storageLoaded { return storage }
        let current = container.appendingPathComponent("Library/Application Support/\(bundleIdentifier)/RCTAsyncLocalStorage_V1", isDirectory: true)
        let old = ["Documents/RCTAsyncLocalStorage_V1", "Documents/RCTAsyncLocalStorage"].map { container.appendingPathComponent($0, isDirectory: true) }
        var candidates: [(URL, Data, Date)] = []
        for directory in [current] + old {
            guard FileManager.default.fileExists(atPath: directory.path) else { continue }
            try validateLegacyDescendant(directory, container: container)
            let file = directory.appendingPathComponent("manifest.json")
            guard FileManager.default.fileExists(atPath: file.path) else {
                guard try directoryContents(directory).isEmpty else { throw UpgradeFailure.malformedSource }
                continue
            }
            let data = try readLegacyFile(file, maximumBytes: UpgradeLimits.manifestBytes)
            let modified = try legacyFileProperties(file, maximumBytes: UpgradeLimits.manifestBytes).modified
            candidates.append((directory, data, modified))
            if directory == current { break } // The active store wins over retained migration sources.
        }
        guard !candidates.isEmpty else { storageLoaded = true; return nil }
        candidates.sort { $0.2 > $1.2 }
        if candidates.count > 1, candidates[0].2 == candidates[1].2, candidates[0].1 != candidates[1].1 { throw UpgradeFailure.ambiguousSource }
        let chosen = candidates[0]
        guard let json = try? JSONSerialization.jsonObject(with: chosen.1) as? [String: Any], json.count <= UpgradeLimits.valueCount else { throw UpgradeFailure.malformedSource }
        var manifest: [String: String?] = [:]
        for (key, value) in json {
            try validateLegacyKey(key)
            if let value = value as? String { manifest[key] = .some(value) }
            else if value is NSNull { manifest[key] = .some(nil) }
            else { throw UpgradeFailure.malformedSource }
        }
        storage = (chosen.0, manifest); storageLoaded = true
        return storage
    }
}

private func validateLegacyDescendant(_ directory: URL, container: URL) throws {
    let prefix = container.path.hasSuffix("/") ? container.path : container.path + "/"
    guard directory.path.hasPrefix(prefix) else { throw UpgradeFailure.unsafePath }
    var current = container
    for part in directory.path.dropFirst(prefix.count).split(separator: "/") {
        guard part != ".", part != ".." else { throw UpgradeFailure.unsafePath }
        current.appendPathComponent(String(part), isDirectory: true)
        try validateLegacyDirectory(current)
    }
}

private func directoryContents(_ url: URL) throws -> [URL] {
    do { return try FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: nil) }
    catch { throw UpgradeFailure.sourceUnavailable }
}

func validateLegacyDirectory(_ url: URL) throws {
    do {
        let properties = try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard properties.isDirectory == true, properties.isSymbolicLink != true else { throw UpgradeFailure.unsafePath }
    } catch let error as UpgradeFailure { throw error }
    catch { throw UpgradeFailure.sourceUnavailable }
}

func legacyFileProperties(_ url: URL, maximumBytes: Int) throws -> (size: Int64, modified: Date) {
    do {
        let freshURL = URL(fileURLWithPath: url.path)
        let properties = try freshURL.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey, .contentModificationDateKey])
        guard properties.isRegularFile == true, properties.isSymbolicLink != true else { throw UpgradeFailure.unsafePath }
        guard let size = properties.fileSize, size >= 0, size <= maximumBytes else { throw UpgradeFailure.tooLarge }
        return (Int64(size), properties.contentModificationDate ?? .distantPast)
    } catch let error as UpgradeFailure { throw error }
    catch {
        if (error as? CocoaError)?.code == .fileReadNoSuchFile { throw UpgradeFailure.missingResource }
        throw UpgradeFailure.sourceUnavailable
    }
}

func readLegacyFile(_ url: URL, maximumBytes: Int) throws -> Data {
    let before = try legacyFileProperties(url, maximumBytes: maximumBytes)
    do {
        let file = try FileHandle(forReadingFrom: url)
        defer { try? file.close() }
        let data = try file.read(upToCount: maximumBytes + 1) ?? Data()
        guard data.count <= maximumBytes else { throw UpgradeFailure.tooLarge }
        let after = try legacyFileProperties(url, maximumBytes: maximumBytes)
        guard Int64(data.count) == before.size, after.size == before.size, after.modified == before.modified else { throw UpgradeFailure.sourceUnavailable }
        return data
    } catch let error as UpgradeFailure { throw error }
    catch { throw UpgradeFailure.sourceUnavailable }
}
