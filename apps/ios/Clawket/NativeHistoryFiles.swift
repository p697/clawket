import Darwin
import Foundation

/// Synchronous bounded I/O, called only from the conversation store's serial actor transaction.
struct NativeHistoryFiles: Sendable {
    let directory: URL

    init(directory: URL) throws {
        guard directory.isFileURL else { throw NativeHistoryFailure.invalid }
        do {
            if FileManager.default.fileExists(atPath: directory.path) {
                let properties = try directory.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey])
                guard properties.isSymbolicLink != true, properties.isDirectory == true else { throw NativeHistoryFailure.invalid }
            }
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
            self.directory = directory.resolvingSymlinksInPath().standardizedFileURL
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: self.directory.path)
            #if os(iOS)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: self.directory.path)
            #endif
            var target = self.directory, properties = URLResourceValues()
            properties.isExcludedFromBackup = true; try target.setResourceValues(properties)
        } catch let failure as NativeHistoryFailure { throw failure }
        catch { throw NativeHistoryFailure.unavailable }
    }

    static func name(_ id: UUID, _ kind: String) -> String { id.uuidString.lowercased() + "." + kind + ".json" }

    func inventory() throws -> [String: Int] {
        do {
            let urls = try FileManager.default.contentsOfDirectory(at: directory,
                includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
            guard urls.count <= 512 else { throw NativeHistoryFailure.full }
            var result: [String: Int] = [:]
            for url in urls {
                let name = url.lastPathComponent
                guard validName(name) else { throw NativeHistoryFailure.invalid }
                let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
                guard values.isRegularFile == true, values.isSymbolicLink != true,
                      let size = values.fileSize, size >= 0, size <= NativeHistoryLimits.recordBytes else { throw NativeHistoryFailure.invalid }
                result[name] = size
            }
            return result
        } catch let failure as NativeHistoryFailure { throw failure }
        catch { throw NativeHistoryFailure.unavailable }
    }

    func read(_ name: String, maximumBytes: Int = NativeHistoryLimits.recordBytes) throws -> Data? {
        guard validName(name), maximumBytes > 0, maximumBytes <= NativeHistoryLimits.recordBytes else { throw NativeHistoryFailure.invalid }
        let url = directory.appendingPathComponent(name)
        let descriptor = open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        if descriptor < 0 {
            if errno == ENOENT { return nil }; throw NativeHistoryFailure.unavailable
        }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        do {
            defer { try? handle.close() }
            var status = stat()
            guard fstat(descriptor, &status) == 0, status.st_mode & S_IFMT == S_IFREG,
                  status.st_size > 0, status.st_size <= maximumBytes else { throw NativeHistoryFailure.invalid }
            let bytes = try handle.read(upToCount: maximumBytes + 1) ?? Data()
            guard bytes.count == status.st_size else { throw NativeHistoryFailure.invalid }
            return bytes
        } catch let failure as NativeHistoryFailure { throw failure }
        catch { throw NativeHistoryFailure.unavailable }
    }

    /// An immutable destination is never replaced. A retry must prove byte-for-byte equality.
    func put(_ bytes: Data, name: String) throws {
        guard validName(name), !bytes.isEmpty, bytes.count <= NativeHistoryLimits.recordBytes else { throw NativeHistoryFailure.invalid }
        if let existing = try read(name) {
            guard existing == bytes else { throw NativeHistoryFailure.changed }; return
        }
        let temporary = directory.appendingPathComponent("work-" + UUID().uuidString.lowercased())
        let destination = directory.appendingPathComponent(name)
        let descriptor = open(temporary.path, O_CREAT | O_EXCL | O_RDWR | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw NativeHistoryFailure.unavailable }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        var published = false
        defer {
            try? handle.close()
            if !published { try? FileManager.default.removeItem(at: temporary) }
        }
        do {
            #if os(iOS)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: temporary.path)
            #endif
            try handle.write(contentsOf: bytes); try handle.synchronize()
            try handle.seek(toOffset: 0)
            guard try handle.read(upToCount: bytes.count + 1) == bytes else { throw NativeHistoryFailure.unavailable }
            // link is no-replace and keeps the verified inode/protection. Both files are in our own sandbox directory.
            guard link(temporary.path, destination.path) == 0 else {
                if errno == EEXIST, try read(name) == bytes { return }
                throw NativeHistoryFailure.unavailable
            }
            published = true
            guard unlink(temporary.path) == 0 else { throw NativeHistoryFailure.unavailable }
            try synchronizeDirectory()
            guard try read(name) == bytes else { throw NativeHistoryFailure.unavailable }
        } catch let failure as NativeHistoryFailure { throw failure }
        catch { throw NativeHistoryFailure.unavailable }
    }

    func remove(_ name: String) throws {
        guard validName(name) else { throw NativeHistoryFailure.invalid }
        let path = directory.appendingPathComponent(name).path
        guard unlink(path) == 0 else {
            if errno == ENOENT { return }; throw NativeHistoryFailure.unavailable
        }
        try synchronizeDirectory()
    }

    private func synchronizeDirectory() throws {
        let descriptor = open(directory.path, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW)
        guard descriptor >= 0 else { throw NativeHistoryFailure.unavailable }
        defer { _ = Darwin.close(descriptor) }
        guard fsync(descriptor) == 0 else { throw NativeHistoryFailure.unavailable }
    }

    private func validName(_ name: String) -> Bool {
        if name == "intent.json" { return true }
        let parts = name.split(separator: ".", omittingEmptySubsequences: false)
        if parts.count == 3, ["body", "meta", "next"].contains(parts[1]), parts[2] == "json" { return canonicalUUID(String(parts[0])) }
        if name.hasPrefix("work-") { return canonicalUUID(String(name.dropFirst(5))) }
        return false
    }

    private func canonicalUUID(_ value: String) -> Bool {
        value.utf8.count == 36 && UUID(uuidString: value)?.uuidString.lowercased() == value
    }
}
