import Foundation

actor NativeHistoryExportLease: NativeShareLease {
    let directory: URL
    private let cache: NativeHistoryExportCache
    private var released = false
    init(directory: URL, cache: NativeHistoryExportCache) { self.directory = directory; self.cache = cache }
    func release() async {
        guard !released else { return }; released = true
        await cache.release(directory)
    }
}

struct NativeHistoryExportFile: Sendable {
    let url: URL
    let lease: NativeHistoryExportLease
}

/// Explicit exports alone create share files. A system handoff retains one unique
/// directory until completion; a killed app leaves bounded, age-cleanable copies.
actor NativeHistoryExportCache {
    private let root: URL
    private var active: Set<URL> = []
    init(directory: URL? = nil) throws {
        let base = try directory ?? FileManager.default.url(for: .cachesDirectory, in: .userDomainMask,
            appropriateFor: nil, create: true).appendingPathComponent("NativeHistoryExports", isDirectory: true)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        guard try base.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey]).isSymbolicLink != true,
              try base.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true else { throw NativeHistoryFailure.invalid }
        root = base.resolvingSymlinksInPath()
        try Self.protect(root, directory: true)
    }

    func prepare(_ transcript: NativePublicTranscript, format: NativeHistoryExportFormat,
                 userLabel: String, assistantLabel: String, loadedOnlyLabel: String? = nil) throws -> NativeHistoryExportFile {
        try prepare(NativeHistoryExportFormatter.format(transcript, format: format,
            userLabel: userLabel, assistantLabel: assistantLabel, loadedOnlyLabel: loadedOnlyLabel), format: format)
    }

    func preparePhysical(_ conversation: NativeConversation, title: String, format: NativeHistoryExportFormat,
                         userLabel: String, assistantLabel: String, loadedOnlyLabel: String) throws -> NativeHistoryExportFile {
        let transcript = try NativeHistoryExportFormatter.localSnapshot(conversation, title: title)
        return try prepare(transcript, format: format, userLabel: userLabel,
            assistantLabel: assistantLabel, loadedOnlyLabel: loadedOnlyLabel)
    }

    func prepareBulk(_ values: [NativeSavedConversation]) throws -> NativeHistoryExportFile {
        try prepare(NativeHistoryExportFormatter.bulk(values), format: .json)
    }

    func prepare(_ data: Data, format: NativeHistoryExportFormat) throws -> NativeHistoryExportFile {
        try Task.checkCancellation()
        guard !data.isEmpty, data.count <= 16 * 1_024 * 1_024 else { throw NativeHistoryFailure.full }
        var total = 0, count = 0
        let children = try FileManager.default.contentsOfDirectory(at: root,
            includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey, .creationDateKey])
        guard children.count <= 16 else { throw NativeHistoryFailure.full }
        for child in children {
            let name = child.lastPathComponent
            let info = try child.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey, .creationDateKey])
            guard UUID(uuidString: name)?.uuidString.lowercased() == name,
                  info.isDirectory == true, info.isSymbolicLink != true else { throw NativeHistoryFailure.invalid }
            let files = try FileManager.default.contentsOfDirectory(at: child,
                includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
            guard files.count <= 1 else { throw NativeHistoryFailure.invalid }
            var bytes = 0
            for file in files {
                let attributes = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
                guard ["Clawket.md", "Clawket.json"].contains(file.lastPathComponent), attributes.isRegularFile == true,
                      attributes.isSymbolicLink != true, let size = attributes.fileSize, size <= 16 * 1_024 * 1_024 else {
                    throw NativeHistoryFailure.invalid
                }
                bytes += size
            }
            let expired = info.creationDate.map { Date().timeIntervalSince($0) >= 24 * 3_600 } ?? false
            if expired && !active.contains(child) { try FileManager.default.removeItem(at: child) }
            else { total += bytes; count += 1 }
        }
        guard count < 16, total + data.count <= 64 * 1_024 * 1_024 else { throw NativeHistoryFailure.full }
        let directory = root.appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700])
        do {
            try Self.protect(directory, directory: true)
            let url = directory.appendingPathComponent(format == .markdown ? "Clawket.md" : "Clawket.json")
            try data.write(to: url, options: [.atomic, .completeFileProtection])
            try Self.protect(url, directory: false)
            let readback = try Data(contentsOf: url, options: .mappedIfSafe)
            guard readback == data else { throw NativeHistoryFailure.commitUncertain }
            try Task.checkCancellation()
            active.insert(directory)
            return .init(url: url, lease: .init(directory: directory, cache: self))
        } catch { try? FileManager.default.removeItem(at: directory); throw error }
    }

    func release(_ directory: URL) {
        guard active.remove(directory) != nil else { return }
        try? FileManager.default.removeItem(at: directory)
    }

    private static func protect(_ url: URL, directory: Bool) throws {
        try FileManager.default.setAttributes([.posixPermissions: directory ? 0o700 : 0o600,
                                               .protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
        var mutable = url, values = URLResourceValues(); values.isExcludedFromBackup = true
        try mutable.setResourceValues(values)
    }
}
