import Foundation
import CryptoKit

protocol MediaIndexIO: Sendable {
    func read(_ url: URL) throws -> Data
    func write(_ data: Data, to url: URL) throws
    func protect(_ url: URL) throws
}
struct DiskMediaIndexIO: MediaIndexIO {
    func read(_ url: URL) throws -> Data { try Data(contentsOf: url) }
    func write(_ data: Data, to url: URL) throws {
        try data.write(to: url, options: .atomic)
        let handle = try FileHandle(forWritingTo: url); defer { try? handle.close() }
        try handle.synchronize()
    }
    func protect(_ url: URL) throws { try MediaFiles.protect(url) }
}

/// Protected owned files and durable metadata. Drafts are removed only explicitly;
/// bounded generated-file caches may expire after 24 hours unless retained for sharing.
public actor MediaLibrary {
    struct Entry: Codable { let resource: MediaResource; let artifact: MediaArtifactKey? }
    private let directory: URL
    private let indexIO: any MediaIndexIO
    private var entries: [UUID: Entry] = [:]
    private var committedBytes: Data?
    private var rollbackEntries: [UUID: Entry] = [:]
    private var unavailable = false
    private var activeFiles: Set<UUID> = []
    private var retained: [UUID: Int] = [:]
    private var pending: [MediaArtifactKey: (UUID, Task<MediaResource, any Error>)] = [:]
    private var reservations: [UUID: (MediaArtifactKey, Int)] = [:]

    public init(directory: URL) throws { try self.init(directory: directory, indexIO: DiskMediaIndexIO()) }

    init(directory: URL, indexIO: any MediaIndexIO) throws {
        let directory = MediaFiles.canonicalBase(directory)
        try MediaFiles.directory(directory); self.directory = directory; self.indexIO = indexIO
        let index = directory.appendingPathComponent("index.json")
        let rollback = directory.appendingPathComponent("index.rollback")
        var current: Data?, backup: Data?
        if FileManager.default.fileExists(atPath: rollback.path) {
            _ = try MediaFiles.size(rollback, maximum: 1_024 * 1_024); backup = try indexIO.read(rollback)
            if let data = backup, let decoded = try? Self.decodeIndex(data) { rollbackEntries = decoded }
        }
        if FileManager.default.fileExists(atPath: index.path) {
            _ = try MediaFiles.size(index, maximum: 1_024 * 1_024)
            current = try indexIO.read(index)
            if let data = current, let decoded = try? Self.decodeIndex(data) { entries = decoded; committedBytes = data }
            else if let data = backup { entries = try Self.decodeIndex(data); committedBytes = data }
            else { throw MediaFailure.corrupt }
        } else if let data = backup {
            entries = try Self.decodeIndex(data); committedBytes = data
        } else {
            // Only UUID data files can be interrupted, uncommitted work. Unknown
            // metadata is never interpreted as an empty installation.
            guard try FileManager.default.contentsOfDirectory(atPath: directory.path).allSatisfy({ UUID(uuidString: $0) != nil }) else { throw MediaFailure.corrupt }
        }
        try Self.reconcileFiles(directory: directory, keeping: Set(entries.keys).union(rollbackEntries.keys))
    }

    public func adopt(_ staged: StagedMediaFile) throws -> MediaResource {
        try capacity(bytes: staged.resource.byteCount)
        let value = staged.resource
        try MediaFiles.directory(folder(value.id))
        var committed = false
        defer { if !committed && !unavailable { try? FileManager.default.removeItem(at: folder(value.id)) } }
        let destination = file(value.id, name: value.name)
        let (count, hash) = try MediaFiles.copy(staged.url, to: destination, maximum: MediaLimits.sourceBytes)
        guard count == value.byteCount, hash == value.sha256 else { try? FileManager.default.removeItem(at: folder(value.id)); throw MediaFailure.corrupt }
        entries[value.id] = Entry(resource: value, artifact: nil)
        do { try save() }
        catch {
            entries.removeValue(forKey: value.id)
            if !unavailable { try? FileManager.default.removeItem(at: folder(value.id)) }
            throw error
        }
        // Receipt committed; the stager's owned copy is no longer needed.
        committed = true
        try? FileManager.default.removeItem(at: staged.url)
        return value
    }

    public func resource(_ id: UUID) throws -> MediaResource {
        guard !unavailable else { throw MediaFailure.corrupt }
        guard let entry = entries[id] else { throw MediaFailure.missing }
        return entry.resource
    }

    /// Reconcile against the host's verified draft/outbox registry before
    /// explicitly removing an unreferenced draft. This never evicts a draft.
    public func draftResources() throws -> [MediaResource] {
        guard !unavailable else { throw MediaFailure.corrupt }
        return entries.values.filter { $0.artifact == nil }.map(\.resource).sorted { $0.createdAt < $1.createdAt }
    }

    /// On cold-open, reconcile already persisted draft IDs before new mutations.
    /// An I/O failure after atomic replacement can leave a valid newer index;
    /// the verified rollback preserves the older draft's bytes and metadata.
    public func recoverResource(_ id: UUID) throws -> MediaResource {
        guard !unavailable else { throw MediaFailure.corrupt }
        if let current = entries[id] { return current.resource }
        guard let previous = rollbackEntries[id], previous.artifact == nil else { throw MediaFailure.missing }
        entries[id] = previous
        do { try save() } catch { entries.removeValue(forKey: id); throw error }
        return previous.resource
    }

    /// Verified local URL for Quick Look/system sharing. Retain until the activity
    /// completion callback, then release. Never expose an external picker URL.
    public func resourceURL(_ id: UUID) throws -> URL {
        let value = try resource(id), url = file(id)
        guard try MediaFiles.size(url, maximum: MediaLimits.sourceBytes) == value.byteCount,
              try MediaFiles.hash(url, maximum: MediaLimits.sourceBytes) == value.sha256 else { throw MediaFailure.corrupt }
        return url
    }

    public func retain(_ id: UUID) throws { _ = try resource(id); retained[id, default: 0] += 1 }
    public func release(_ id: UUID) { if let count = retained[id] { retained[id] = count > 1 ? count - 1 : nil } }
    public func remove(_ id: UUID) throws {
        guard !unavailable else { throw MediaFailure.corrupt }
        guard retained[id] == nil else { throw MediaFailure.capacity }
        guard let entry = entries.removeValue(forKey: id) else { return }
        do { try save() } catch { entries[id] = entry; throw error }
    }

    public func preparePrompt(_ id: UUID) throws -> PreparedMedia {
        let value = try resource(id), url = try resourceURL(id)
        try Task.checkCancellation()
        if value.mimeType.hasPrefix("image/"), value.mimeType != "image/svg+xml" {
            return try MediaImages.prepare(resource: value, url: url)
        }
        guard value.byteCount <= MediaLimits.promptBytes else { throw MediaFailure.tooLarge }
        return PreparedMedia(resource: value, data: try Data(contentsOf: url), mimeType: value.mimeType, isImage: false, thumbnail: nil, aspectRatio: nil)
    }

    public func previewImage(_ id: UUID, maximumPixels: Int = 1_600) throws -> MediaImagePreview {
        let value = try resource(id)
        guard value.hasRasterPreview, (44...2_048).contains(maximumPixels) else { throw MediaFailure.unsupported }
        return try MediaImages.preview(url: resourceURL(id), pixels: maximumPixels)
    }

    /// One task per stable scope/reference; writes one chunk at a time. `read`
    /// must be backed by a captured RuntimeArtifactHandle, never an arbitrary URL.
    public func cacheArtifact(key: MediaArtifactKey, name: String, mimeType: String, size: Int,
                              read: @escaping @Sendable (Int) async throws -> Data) async throws -> MediaResource {
        guard !key.connectionID.isEmpty, key.connectionID.utf8.count <= 256,
              !key.sessionKey.isEmpty, key.sessionKey.utf8.count <= 1_024,
              !key.artifactID.isEmpty, key.artifactID.utf8.count <= 512,
              size >= 0, size <= MediaLimits.artifactBytes else { throw MediaFailure.invalidFile }
        let name = try mediaName(name), mime = try mediaMIME(mimeType)
        if let cached = entries.values.first(where: { $0.artifact == key && Date().timeIntervalSince($0.resource.createdAt) < 86_400 }) {
            do {
                guard cached.resource.byteCount == size, cached.resource.mimeType == mime else { throw MediaFailure.corrupt }
                _ = try resourceURL(cached.resource.id); return cached.resource
            }
            catch {
                guard retained[cached.resource.id] == nil else { throw MediaFailure.corrupt }
                try remove(cached.resource.id)
            }
        }
        if let (_, task) = pending[key] { let result = try await task.value; try Task.checkCancellation(); return result }
        try capacity(bytes: size)
        let scoped = entries.values.filter { $0.artifact?.connectionID == key.connectionID && $0.artifact?.sessionKey == key.sessionKey }
        let reserved = reservations.values.filter { $0.0.connectionID == key.connectionID && $0.0.sessionKey == key.sessionKey }
        guard scoped.count + reserved.count < 16,
              size <= 30 * 1_024 * 1_024 - scoped.reduce(0, { $0 + $1.resource.byteCount }) - reserved.reduce(0, { $0 + $1.1 }) else { throw MediaFailure.capacity }
        let operation = UUID(); reservations[operation] = (key, size)
        let task = Task { [weak self] in
            guard let self else { throw MediaFailure.cancelled }
            return try await self.receiveArtifact(key: key, name: name, mime: mime, size: size, operation: operation, read: read)
        }
        pending[key] = (operation, task)
        defer { if pending[key]?.0 == operation { pending.removeValue(forKey: key) }; reservations.removeValue(forKey: operation) }
        // A caller cancellation never destroys another caller's shared download.
        let result = try await task.value
        try Task.checkCancellation(); return result
    }

    public func invalidateArtifacts(connectionID: String, sessionKey: String? = nil) {
        for (key, (_, task)) in pending where key.connectionID == connectionID && (sessionKey == nil || key.sessionKey == sessionKey) {
            task.cancel(); pending.removeValue(forKey: key)
        }
    }

    public func removeExpiredArtifacts(now: Date = Date()) throws {
        let expired = entries.values.filter { $0.artifact != nil && now.timeIntervalSince($0.resource.createdAt) >= 86_400 && retained[$0.resource.id] == nil }
        for entry in expired { try remove(entry.resource.id) }
    }

    private func receiveArtifact(key: MediaArtifactKey, name: String, mime: String, size: Int, operation: UUID,
                                 read: @Sendable (Int) async throws -> Data) async throws -> MediaResource {
        let id = UUID()
        try MediaFiles.directory(folder(id))
        let url = file(id, name: name)
        guard FileManager.default.createFile(atPath: url.path, contents: nil, attributes: [.posixPermissions: 0o600]) else { throw MediaFailure.invalidFile }
        let output = try FileHandle(forWritingTo: url)
        activeFiles.insert(id)
        var committed = false
        defer { activeFiles.remove(id); try? output.close(); if !committed && !unavailable { try? FileManager.default.removeItem(at: folder(id)) } }
        var offset = 0, hash = SHA256()
        repeat {
            try Task.checkCancellation()
            guard pending[key]?.0 == operation else { throw MediaFailure.cancelled }
            let bytes = try await read(offset)
            try Task.checkCancellation()
            guard pending[key]?.0 == operation, bytes.count == min(MediaLimits.chunkBytes, size - offset) else { throw MediaFailure.invalidChunk }
            hash.update(data: bytes); try output.write(contentsOf: bytes); offset += bytes.count
        } while offset < size
        try output.synchronize(); try MediaFiles.protect(url)
        let value = MediaResource(id: id, name: name, mimeType: mime, byteCount: size,
                                  sha256: hash.finalize().map { String(format: "%02x", $0) }.joined(), createdAt: Date())
        entries[id] = Entry(resource: value, artifact: key)
        do { try save() } catch { entries.removeValue(forKey: id); throw error }
        committed = true; return value
    }

    private func capacity(bytes: Int) throws {
        guard !unavailable else { throw MediaFailure.corrupt }
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey]).filter { UUID(uuidString: $0.lastPathComponent) != nil }
        let occupied = try files.reduce(0) { try $0 + Self.folderSize($1) }
        guard files.count + reservations.count < MediaLimits.resources,
              bytes >= 0, bytes <= MediaLimits.libraryBytes - occupied - reservations.values.reduce(0, { $0 + $1.1 }) else { throw MediaFailure.capacity }
    }
    private func folder(_ id: UUID) -> URL { directory.appendingPathComponent(id.uuidString.lowercased(), isDirectory: true) }
    private func file(_ id: UUID, name: String? = nil) -> URL {
        folder(id).appendingPathComponent(name ?? entries[id]?.resource.name ?? rollbackEntries[id]?.resource.name ?? "resource.bin")
    }
    private func save() throws {
        guard !unavailable else { throw MediaFailure.corrupt }
        try Task.checkCancellation()
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let bytes = try encoder.encode(entries.values.sorted { $0.resource.id.uuidString < $1.resource.id.uuidString })
        guard bytes.count <= 1_024 * 1_024 else { throw MediaFailure.capacity }
        let url = directory.appendingPathComponent("index.json")
        // Once an atomic replacement begins, any later I/O error has an unknown
        // commit outcome. Keep all bytes and fail closed until a fresh open reads
        // current/rollback, rather than deleting a possibly committed draft.
        do {
            if let previous = committedBytes {
                let backup = directory.appendingPathComponent("index.rollback")
                try indexIO.write(previous, to: backup); try indexIO.protect(backup)
                guard try indexIO.read(backup) == previous else { throw MediaFailure.corrupt }
                rollbackEntries = try Self.decodeIndex(previous)
            }
            try indexIO.write(bytes, to: url); try indexIO.protect(url)
            guard try indexIO.read(url) == bytes else { throw MediaFailure.corrupt }
            committedBytes = bytes
            try Self.reconcileFiles(directory: directory, keeping: Set(entries.keys).union(rollbackEntries.keys).union(activeFiles))
        } catch { unavailable = true; throw MediaFailure.commitUncertain }
    }

    private static func decodeIndex(_ data: Data) throws -> [UUID: Entry] {
        guard !data.isEmpty, data.count <= 1_024 * 1_024 else { throw MediaFailure.corrupt }
        let values = try JSONDecoder().decode([Entry].self, from: data)
        guard values.count <= MediaLimits.resources else { throw MediaFailure.corrupt }
        var result: [UUID: Entry] = [:], total = 0
        for entry in values {
            let value = entry.resource
            guard result[value.id] == nil, value.byteCount >= 0, value.byteCount <= MediaLimits.sourceBytes,
                  value.sha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
                  value.createdAt.timeIntervalSince1970.isFinite else { throw MediaFailure.corrupt }
            _ = try mediaName(value.name); _ = try mediaMIME(value.mimeType)
            if let key = entry.artifact {
                guard value.byteCount <= MediaLimits.artifactBytes, !key.connectionID.isEmpty, key.connectionID.utf8.count <= 256,
                      !key.sessionKey.isEmpty, key.sessionKey.utf8.count <= 1_024,
                      !key.artifactID.isEmpty, key.artifactID.utf8.count <= 512 else { throw MediaFailure.corrupt }
            }
            total += value.byteCount; guard total <= MediaLimits.libraryBytes else { throw MediaFailure.corrupt }
            result[value.id] = entry
        }
        return result
    }

    private static func reconcileFiles(directory: URL, keeping: Set<UUID>) throws {
        var bytes = 0, count = 0
        for file in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey]) {
            guard let id = UUID(uuidString: file.lastPathComponent) else {
                guard ["index.json", "index.rollback"].contains(file.lastPathComponent) else { throw MediaFailure.corrupt }; continue
            }
            let size = try folderSize(file)
            if !keeping.contains(id) { try FileManager.default.removeItem(at: file); continue }
            bytes += size; count += 1
            guard bytes <= MediaLimits.libraryBytes, count <= MediaLimits.resources else { throw MediaFailure.capacity }
        }
    }

    private static func folderSize(_ url: URL) throws -> Int {
        let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard values.isDirectory == true, values.isSymbolicLink == false else { throw MediaFailure.corrupt }
        let files = try FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: [.fileSizeKey])
        guard files.count <= 1 else { throw MediaFailure.corrupt }
        guard let file = files.first else { return 0 }
        _ = try mediaName(file.lastPathComponent)
        return try MediaFiles.size(file, maximum: MediaLimits.sourceBytes)
    }
}
