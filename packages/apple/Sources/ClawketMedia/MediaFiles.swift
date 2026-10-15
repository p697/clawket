import Foundation
import CryptoKit
import Darwin

enum MediaFiles {
    static func canonicalBase(_ url: URL) -> URL {
        guard localFileURL(url) else { return url }
        // Darwin's public temporary/container aliases are system-owned symlinks.
        var parts: [String] = []
        for part in url.path.split(separator: "/") {
            if part == ".." { if !parts.isEmpty { parts.removeLast() } }
            else if part != "." { parts.append(String(part)) }
        }
        let path = "/" + parts.joined(separator: "/")
        if path == "/tmp" || path.hasPrefix("/tmp/") || path == "/var" || path.hasPrefix("/var/") {
            return URL(fileURLWithPath: "/private" + path, isDirectory: true)
        }
        return URL(fileURLWithPath: path, isDirectory: true)
    }
    static func directory(_ url: URL) throws {
        guard localFileURL(url) else { throw MediaFailure.invalidFile }
        let manager = FileManager.default
        // Never traverse an existing symlink, including an ancestor of a new directory.
        var cursor = URL(fileURLWithPath: "/", isDirectory: true)
        for part in url.pathComponents.dropFirst() {
            cursor.appendPathComponent(part, isDirectory: true)
            if manager.fileExists(atPath: cursor.path) {
                let values = try cursor.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey])
                guard values.isSymbolicLink == false, values.isDirectory == true else { throw MediaFailure.invalidFile }
            } else { try manager.createDirectory(at: cursor, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700]) }
        }
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        var owned = url; try owned.setResourceValues(values)
        #if os(iOS)
        try manager.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
        #endif
    }

    static func size(_ url: URL, maximum: Int) throws -> Int {
        guard localFileURL(url) else { throw MediaFailure.invalidFile }
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
        try Task.checkCancellation()
        _ = try size(source, maximum: maximum)
        let (input, before) = try reader(source, maximum: maximum)
        defer { try? input.close() }
        let expected = Int(before.st_size)
        guard !FileManager.default.fileExists(atPath: destination.path),
              FileManager.default.createFile(atPath: destination.path, contents: nil, attributes: [.posixPermissions: 0o600]) else { throw MediaFailure.invalidFile }
        var committed = false
        defer { if !committed { try? FileManager.default.removeItem(at: destination) } }
        let output = try FileHandle(forWritingTo: destination)
        defer { try? output.close() }
        var total = 0, hash = SHA256()
        while let bytes = try input.read(upToCount: 64 * 1_024), !bytes.isEmpty {
            try Task.checkCancellation()
            guard bytes.count <= maximum - total else { throw MediaFailure.tooLarge }
            total += bytes.count; hash.update(data: bytes); try output.write(contentsOf: bytes)
        }
        var after = stat(), current = stat()
        try Task.checkCancellation()
        guard fstat(input.fileDescriptor, &after) == 0, lstat(source.path, &current) == 0,
              total == expected, after.st_size == before.st_size, current.st_ino == before.st_ino, current.st_dev == before.st_dev,
              after.st_mtimespec.tv_sec == before.st_mtimespec.tv_sec, after.st_mtimespec.tv_nsec == before.st_mtimespec.tv_nsec else { throw MediaFailure.invalidFile }
        try output.synchronize(); try protect(destination); committed = true
        return (total, hash.finalize().map { String(format: "%02x", $0) }.joined())
    }

    static func hash(_ url: URL, maximum: Int) throws -> String {
        _ = try size(url, maximum: maximum)
        let (input, _) = try reader(url, maximum: maximum); defer { try? input.close() }
        var total = 0, hash = SHA256()
        while let bytes = try input.read(upToCount: 64 * 1_024), !bytes.isEmpty {
            try Task.checkCancellation()
            guard bytes.count <= maximum - total else { throw MediaFailure.tooLarge }
            total += bytes.count; hash.update(data: bytes)
        }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private static func reader(_ url: URL, maximum: Int) throws -> (FileHandle, stat) {
        let descriptor = open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        guard descriptor >= 0 else { throw MediaFailure.invalidFile }
        var properties = stat()
        guard fstat(descriptor, &properties) == 0, properties.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              properties.st_size >= 0 else { close(descriptor); throw MediaFailure.invalidFile }
        guard properties.st_size <= Int64(maximum) else { close(descriptor); throw MediaFailure.tooLarge }
        return (FileHandle(fileDescriptor: descriptor, closeOnDealloc: true), properties)
    }

    private static func localFileURL(_ url: URL) -> Bool {
        url.isFileURL && (url.host == nil || url.host == "" || url.host?.lowercased() == "localhost")
            && url.user == nil && url.password == nil && url.query == nil && url.fragment == nil
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

    /// Legacy inline transcript content has already been decoded with Runtime's
    /// strict base64 bound. Materialize it once into the same owned-file flow.
    public func stageData(_ data: Data, name: String, mimeType: String) throws -> StagedMediaFile {
        lock.lock(); defer { lock.unlock() }
        try Task.checkCancellation()
        let name = try mediaName(name), mime = try mediaMIME(mimeType)
        guard data.count <= MediaLimits.promptBytes else { throw MediaFailure.tooLarge }
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey])
        guard files.count < MediaLimits.resources else { throw MediaFailure.capacity }
        let occupied = try files.reduce(0) { try $0 + MediaFiles.size($1, maximum: MediaLimits.sourceBytes) }
        guard data.count <= MediaLimits.libraryBytes - occupied else { throw MediaFailure.capacity }
        let id = UUID(), url = directory.appendingPathComponent(id.uuidString.lowercased())
        do { try data.write(to: url, options: .atomic); try MediaFiles.protect(url) }
        catch { try? FileManager.default.removeItem(at: url); throw error }
        let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        return StagedMediaFile(url: url, resource: MediaResource(id: id, name: name, mimeType: mime, byteCount: data.count, sha256: hash, createdAt: Date()))
    }

    /// Explicit cancellation cleanup; never remove a resource already adopted by a library.
    public func discard(_ value: StagedMediaFile) throws {
        lock.lock(); defer { lock.unlock() }
        guard value.url.deletingLastPathComponent().standardizedFileURL == directory.standardizedFileURL else { throw MediaFailure.invalidFile }
        try FileManager.default.removeItem(at: value.url)
    }

    /// Explicit cold-start reconciliation after the host verifies its accepted
    /// queue. Only unadopted receipts in this dedicated directory are removed.
    @discardableResult
    public func removeUnreferenced(keeping: Set<UUID>) throws -> Int {
        lock.lock(); defer { lock.unlock() }
        var removed = 0
        for file in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey]) {
            guard let id = UUID(uuidString: file.lastPathComponent) else { throw MediaFailure.corrupt }
            _ = try MediaFiles.size(file, maximum: MediaLimits.sourceBytes)
            if !keeping.contains(id) { try FileManager.default.removeItem(at: file); removed += 1 }
        }
        return removed
    }
}
