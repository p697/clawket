import Foundation
import CryptoKit

enum MediaFiles {
    static func canonicalBase(_ url: URL) -> URL {
        // Darwin's public temporary/container aliases are system-owned symlinks.
        let path = url.standardizedFileURL.path
        if path == "/tmp" || path.hasPrefix("/tmp/") || path == "/var" || path.hasPrefix("/var/") {
            return URL(fileURLWithPath: "/private" + path, isDirectory: true)
        }
        return url.standardizedFileURL
    }
    static func directory(_ url: URL) throws {
        guard url.isFileURL else { throw MediaFailure.invalidFile }
        let manager = FileManager.default
        // Never traverse an existing symlink, including an ancestor of a new directory.
        var cursor = URL(fileURLWithPath: "/", isDirectory: true)
        for part in url.standardizedFileURL.pathComponents.dropFirst() {
            cursor.appendPathComponent(part, isDirectory: true)
            if manager.fileExists(atPath: cursor.path) {
                let values = try cursor.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey])
                guard values.isSymbolicLink == false, values.isDirectory == true else { throw MediaFailure.invalidFile }
            } else { try manager.createDirectory(at: cursor, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700]) }
        }
    }

    static func size(_ url: URL, maximum: Int) throws -> Int {
        guard url.isFileURL else { throw MediaFailure.invalidFile }
        let info = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard info.isRegularFile == true, info.isSymbolicLink == false, let size = info.fileSize, size >= 0 else { throw MediaFailure.invalidFile }
        guard size <= maximum else { throw MediaFailure.tooLarge }
        return size
    }

    static func protect(_ url: URL) throws {
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
        #endif
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        var value = url; try value.setResourceValues(values)
    }

    static func copy(_ source: URL, to destination: URL, maximum: Int) throws -> (Int, String) {
        let expected = try size(source, maximum: maximum)
        guard !FileManager.default.fileExists(atPath: destination.path),
              FileManager.default.createFile(atPath: destination.path, contents: nil, attributes: [.posixPermissions: 0o600]) else { throw MediaFailure.invalidFile }
        var committed = false
        defer { if !committed { try? FileManager.default.removeItem(at: destination) } }
        let input = try FileHandle(forReadingFrom: source), output = try FileHandle(forWritingTo: destination)
        defer { try? input.close(); try? output.close() }
        var total = 0, hash = SHA256()
        while let bytes = try input.read(upToCount: 64 * 1_024), !bytes.isEmpty {
            try Task.checkCancellation()
            guard bytes.count <= maximum - total else { throw MediaFailure.tooLarge }
            total += bytes.count; hash.update(data: bytes); try output.write(contentsOf: bytes)
        }
        guard total == expected, try size(source, maximum: maximum) == expected else { throw MediaFailure.invalidFile }
        try output.synchronize(); try protect(destination); committed = true
        return (total, hash.finalize().map { String(format: "%02x", $0) }.joined())
    }

    static func hash(_ url: URL, maximum: Int) throws -> String {
        _ = try size(url, maximum: maximum)
        let input = try FileHandle(forReadingFrom: url); defer { try? input.close() }
        var total = 0, hash = SHA256()
        while let bytes = try input.read(upToCount: 64 * 1_024), !bytes.isEmpty {
            try Task.checkCancellation()
            guard bytes.count <= maximum - total else { throw MediaFailure.tooLarge }
            total += bytes.count; hash.update(data: bytes)
        }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }
}

/// Call synchronously INSIDE loadFileRepresentation's completion handler: Apple's
/// temporary URL is deleted when that callback returns. No Task may defer this copy.
public final class MediaImportStager: @unchecked Sendable {
    private let lock = NSLock()
    private let directory: URL
    public init(directory: URL) throws { let directory = MediaFiles.canonicalBase(directory); try MediaFiles.directory(directory); self.directory = directory }

    public func stageFile(from url: URL, name: String, mimeType: String) throws -> StagedMediaFile {
        lock.lock(); defer { lock.unlock() }
        let name = try mediaName(name), mime = try mediaMIME(mimeType)
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey])
        guard files.count < MediaLimits.resources else { throw MediaFailure.capacity }
        let occupied = try files.reduce(0) { try $0 + MediaFiles.size($1, maximum: MediaLimits.sourceBytes) }
        let size = try MediaFiles.size(url, maximum: MediaLimits.sourceBytes)
        guard size <= MediaLimits.libraryBytes - occupied else { throw MediaFailure.capacity }
        let id = UUID(), destination = directory.appendingPathComponent(id.uuidString.lowercased())
        let (count, hash) = try MediaFiles.copy(url, to: destination, maximum: MediaLimits.sourceBytes)
        return StagedMediaFile(url: destination, resource: MediaResource(id: id, name: name, mimeType: mime, byteCount: count, sha256: hash, createdAt: Date()))
    }

    /// Explicit cancellation cleanup; never remove a resource already adopted by a library.
    public func discard(_ value: StagedMediaFile) throws {
        lock.lock(); defer { lock.unlock() }
        guard value.url.deletingLastPathComponent().standardizedFileURL == directory.standardizedFileURL else { throw MediaFailure.invalidFile }
        try FileManager.default.removeItem(at: value.url)
    }
}
