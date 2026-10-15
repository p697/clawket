import Darwin
import Foundation

/// These URLs are exclusively inside the caller's private app-owned recording directory.
enum SpeechFiles {
    static func canonicalBase(_ url: URL) throws -> URL {
        guard url.isFileURL, url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.host == nil || url.host == "" || url.host?.lowercased() == "localhost" else { throw SpeechFailure(.storage) }
        var parts: [String] = []
        for part in url.path.split(separator: "/") {
            if part == ".." { if !parts.isEmpty { parts.removeLast() } }
            else if part != "." { parts.append(String(part)) }
        }
        var path = "/" + parts.joined(separator: "/")
        if path == "/tmp" || path.hasPrefix("/tmp/") || path == "/var" || path.hasPrefix("/var/") { path = "/private" + path }
        return URL(fileURLWithPath: path, isDirectory: true)
    }

    static func directory(_ url: URL) throws {
        var cursor = URL(fileURLWithPath: "/", isDirectory: true)
        for component in url.pathComponents.dropFirst() {
            cursor.appendPathComponent(component, isDirectory: true)
            if FileManager.default.fileExists(atPath: cursor.path) {
                let metadata = try cursor.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
                guard metadata.isDirectory == true, metadata.isSymbolicLink == false else { throw SpeechFailure(.storage) }
            } else {
                try FileManager.default.createDirectory(at: cursor, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            }
        }
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        var owned = url; try owned.setResourceValues(values)
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
        #endif
    }

    static func existingDirectory(_ url: URL) throws {
        let properties = try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard properties.isDirectory == true, properties.isSymbolicLink == false else { throw SpeechFailure(.storage) }
    }

    static func openAudio(_ url: URL, writing: Bool = false, create: Bool = false) throws -> FileHandle {
        try existingDirectory(url.deletingLastPathComponent())
        let flags = (writing ? O_WRONLY | O_APPEND : O_RDONLY) | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK
            | (create ? O_CREAT | O_EXCL : 0)
        let descriptor = open(url.path, flags, mode_t(0o600))
        guard descriptor >= 0 else { throw SpeechFailure(.storage) }
        var metadata = stat()
        guard fstat(descriptor, &metadata) == 0, metadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              metadata.st_size >= 0, metadata.st_size <= SpeechLimits.recordingBytes else {
            Darwin.close(descriptor); throw SpeechFailure(.storage)
        }
        return FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
    }

    static func protectAudio(_ url: URL) throws {
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
        #endif
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        var owned = url; try owned.setResourceValues(values)
    }

    static func size(_ file: FileHandle) throws -> Int {
        var value = stat()
        guard fstat(file.fileDescriptor, &value) == 0, value.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              value.st_size >= 0, value.st_size <= SpeechLimits.recordingBytes else { throw SpeechFailure(.storage) }
        return Int(value.st_size)
    }

    static func id(_ value: String) -> Bool {
        value.utf8.count == 32 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
}
