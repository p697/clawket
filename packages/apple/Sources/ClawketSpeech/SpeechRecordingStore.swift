import Foundation
import CryptoKit
import ClawketPersistence

struct SpeechSegmentCheckpoint: Codable, Sendable, Equatable {
    let index: Int
    let byteCount: Int
    let text: String
    var end: Int { index * SpeechLimits.segmentBytes + byteCount }
}
struct SpeechRecordingDocument: Codable, Sendable {
    var version = 1
    let id: String
    let scope: SpeechScope
    let draft: String
    let createdAt: Date
    var checkpoints: [SpeechSegmentCheckpoint] = []
    func validate() throws {
        try scope.validate()
        guard version == 1, SpeechFiles.id(id), draft.utf16.count <= 100_000,
              createdAt.timeIntervalSince1970.isFinite, createdAt.timeIntervalSince1970 >= 0,
              checkpoints.count <= 6, Set(checkpoints.map(\.index)).count == checkpoints.count else { throw SpeechFailure(.storage) }
        for item in checkpoints {
            guard (0..<6).contains(item.index), item.byteCount > 0, item.byteCount.isMultiple(of: 2),
                  item.byteCount <= SpeechLimits.segmentBytes, item.end <= SpeechLimits.recordingBytes,
                  item.text.utf16.count <= SpeechLimits.resultCharacters else { throw SpeechFailure(.storage) }
        }
    }
}

/// Protected metadata/checkpoints are separate from append-only PCM. Actual file
/// length is authoritative after interruption; no whole recording enters memory.
public actor SpeechRecordingStore {
    private let directory: URL
    private let makeDocuments: @Sendable (URL) throws -> DocumentStore
    private var writers: [String: FileHandle] = [:]
    private var blocked: Set<String> = []
    private var locked = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    public init(directory: URL) throws {
        try self.init(directory: directory, makeDocuments: { directory in
            try DocumentStore(values: FileValueStore(directory: directory, maximumBytes: 2 * 1_024 * 1_024), maximumBytes: 2 * 1_024 * 1_024)
        })
    }
    init(directory: URL, makeDocuments: @escaping @Sendable (URL) throws -> DocumentStore) throws {
        let root = try SpeechFiles.canonicalBase(directory)
        try SpeechFiles.directory(root)
        self.directory = root; self.makeDocuments = makeDocuments
    }

    public func create(scope: SpeechScope, draft: String, now: Date = Date()) async throws -> SpeechRecording {
        await acquire(); defer { release() }
        try Task.checkCancellation(); try scope.validate()
        guard draft.utf16.count <= 100_000, now.timeIntervalSince1970.isFinite,
              now.timeIntervalSince1970 >= 0 else { throw SpeechFailure(.storage) }
        try await reconcileStaging()
        guard try folders().count < SpeechLimits.recordings else { throw SpeechFailure(.storageFull) }
        let id = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        let staging = directory.appendingPathComponent(".creating-" + id, isDirectory: true)
        try SpeechFiles.directory(staging)
        let file = try SpeechFiles.openAudio(staging.appendingPathComponent("audio.pcm"), writing: true, create: true)
        defer { try? file.close() }
        try SpeechFiles.protectAudio(staging.appendingPathComponent("audio.pcm")); try file.synchronize()
        let metadata = SpeechRecordingDocument(id: id, scope: scope, draft: draft, createdAt: now)
        do {
            try await documents(staging).write(metadata, key: "recording.v1")
            try Task.checkCancellation()
            try FileManager.default.moveItem(at: staging, to: folder(id))
            writers[id] = try SpeechFiles.openAudio(audio(id), writing: true)
            return .init(id: id, scope: scope, draft: draft, createdAt: now, bytes: 0, isRecording: true)
        } catch { throw SpeechFailure(.storage) } // Keep an unknown metadata commit for cold-open reconciliation.
    }

    /// Caller stores every delivered capture chunk before making it available to ASR.
    /// Cancellation does not discard already-delivered capture buffers.
    public func append(_ bytes: Data, to id: String) throws -> Int {
        guard SpeechFiles.id(id), let file = writers[id], bytes.count.isMultiple(of: 2) else { throw SpeechFailure(.storage) }
        let previous = try SpeechFiles.size(file)
        guard previous.isMultiple(of: 2), bytes.count <= SpeechLimits.recordingBytes - previous else { throw SpeechFailure(.tooLong) }
        do {
            try file.write(contentsOf: bytes)
            try file.synchronize()
            return try SpeechFiles.size(file)
        } catch {
            writers.removeValue(forKey: id); try? file.close()
            throw SpeechFailure(.storage)
        }
    }

    public func close(_ id: String) throws {
        guard SpeechFiles.id(id) else { throw SpeechFailure(.storage) }
        guard let writer = writers.removeValue(forKey: id) else { return }
        defer { try? writer.close() }
        do { try writer.synchronize() } catch { throw SpeechFailure(.storage) }
    }

    public func recordings(scope: SpeechScope? = nil) async throws -> [SpeechRecording] {
        await acquire(); defer { release() }
        try Task.checkCancellation(); try await reconcileStaging()
        var result: [SpeechRecording] = []
        for path in try folders() {
            let document = try await readDocument(path.lastPathComponent)
            if scope == nil || document.scope == scope { result.append(try snapshot(document)) }
        }
        return result.sorted { $0.createdAt == $1.createdAt ? $0.id < $1.id : $0.createdAt < $1.createdAt }
    }

    public func recording(_ id: String) async throws -> SpeechRecording {
        await acquire(); defer { release() }
        return try snapshot(try await readDocument(id))
    }

    public func read(_ id: String, offset: Int, length: Int) throws -> Data {
        try Task.checkCancellation()
        guard SpeechFiles.id(id), !blocked.contains(id), offset >= 0, offset.isMultiple(of: 2),
              length > 0, length.isMultiple(of: 2), length <= SpeechLimits.chunkBytes else { throw SpeechFailure(.storage) }
        let file = try SpeechFiles.openAudio(audio(id)); defer { try? file.close() }
        let size = try SpeechFiles.size(file) / 2 * 2
        guard offset <= size, length <= size - offset else { throw SpeechFailure(.storage) }
        do {
            try file.seek(toOffset: UInt64(offset))
            let bytes = try file.read(upToCount: length) ?? Data()
            guard bytes.count == length else { throw SpeechFailure(.storage) }
            return bytes
        } catch { throw SpeechFailure(.storage) }
    }

    public func checkpoint(_ id: String, index: Int, byteCount: Int, text: String) async throws {
        await acquire(); defer { release() }
        try Task.checkCancellation()
        var document = try await readDocument(id)
        let checkpoint = SpeechSegmentCheckpoint(index: index, byteCount: byteCount, text: text)
        guard (0..<6).contains(index), byteCount > 0, byteCount.isMultiple(of: 2), byteCount <= SpeechLimits.segmentBytes,
              checkpoint.end <= SpeechLimits.recordingBytes, text.utf16.count <= SpeechLimits.resultCharacters,
              byteCount == SpeechLimits.segmentBytes || writers[id] == nil,
              checkpoint.end <= (try snapshot(document).bytes) else { throw SpeechFailure(.storage) }
        if let previous = document.checkpoints.first(where: { $0.index == index }) {
            guard previous == checkpoint else { throw SpeechFailure(.storage) }; return
        }
        document.checkpoints.append(checkpoint); document.checkpoints.sort { $0.index < $1.index }
        try document.validate()
        do { try await documents(folder(id)).write(document, key: "recording.v1") }
        catch { blocked.insert(id); throw SpeechFailure(.storage) }
    }

    public func result(_ id: String, index: Int) async throws -> String? {
        await acquire(); defer { release() }
        let document = try await readDocument(id)
        _ = try snapshot(document)
        return document.checkpoints.first { $0.index == index }?.text
    }

    /// Explicit user deletion only; a live writer or unknown commit stays intact.
    public func discard(_ id: String) async throws {
        await acquire(); defer { release() }
        guard SpeechFiles.id(id), writers[id] == nil else { throw SpeechFailure(.storage) }
        // Even a blocked recording may be explicitly deleted by its stable ID.
        guard try folders().contains(where: { $0.lastPathComponent == id }) else { return }
        do { try FileManager.default.removeItem(at: folder(id)); blocked.remove(id) }
        catch { throw SpeechFailure(.storage) }
    }

    private func readDocument(_ id: String) async throws -> SpeechRecordingDocument {
        guard SpeechFiles.id(id), !blocked.contains(id) else { throw SpeechFailure(.storage) }
        do {
            try SpeechFiles.existingDirectory(folder(id))
            guard let value = try await documents(folder(id)).read(SpeechRecordingDocument.self, key: "recording.v1")?.value,
                  value.id == id else { throw SpeechFailure(.storage) }
            try value.validate(); return value
        } catch { throw SpeechFailure(.storage) }
    }
    private func snapshot(_ document: SpeechRecordingDocument) throws -> SpeechRecording {
        let file = try SpeechFiles.openAudio(audio(document.id)); defer { try? file.close() }
        // A torn trailing half-sample is never sent or overwritten on recovery.
        let bytes = try SpeechFiles.size(file) / 2 * 2
        guard document.checkpoints.allSatisfy({ $0.end <= bytes }) else { throw SpeechFailure(.storage) }
        return .init(id: document.id, scope: document.scope, draft: document.draft, createdAt: document.createdAt,
                     bytes: bytes, isRecording: writers[document.id] != nil)
    }
    private func folder(_ id: String) -> URL { directory.appendingPathComponent(id, isDirectory: true) }
    private func audio(_ id: String) -> URL { folder(id).appendingPathComponent("audio.pcm") }
    private func documents(_ folder: URL) throws -> DocumentStore {
        try SpeechFiles.existingDirectory(folder)
        // Reject ancestors before FileValueStore creates its own State directory.
        try SpeechFiles.directory(folder)
        let children = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
        guard children.count <= 2, children.allSatisfy({ ["audio.pcm", "State"].contains($0.lastPathComponent) }) else { throw SpeechFailure(.storage) }
        let state = folder.appendingPathComponent("State", isDirectory: true)
        if FileManager.default.fileExists(atPath: state.path) {
            try SpeechFiles.directory(state)
            let allowed = Set(["recording.v1", "recording.v1.rollback"].map { key in
                SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined() + ".json"
            })
            let values = try FileManager.default.contentsOfDirectory(at: state, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
            guard values.count <= 2 else { throw SpeechFailure(.storage) }
            for value in values {
                let info = try value.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
                guard allowed.contains(value.lastPathComponent), info.isRegularFile == true, info.isSymbolicLink == false,
                      let size = info.fileSize, size <= 2 * 1_024 * 1_024 else { throw SpeechFailure(.storage) }
            }
        }
        return try makeDocuments(state)
    }

    private func folders() throws -> [URL] {
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard files.count <= SpeechLimits.recordings else { throw SpeechFailure(.storageFull) }
        for file in files {
            let metadata = try file.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            guard SpeechFiles.id(file.lastPathComponent), metadata.isDirectory == true, metadata.isSymbolicLink == false else { throw SpeechFailure(.storage) }
        }
        return files
    }

    private func reconcileStaging() async throws {
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard files.count <= SpeechLimits.recordings else { throw SpeechFailure(.storageFull) }
        for path in files where path.lastPathComponent.hasPrefix(".creating-") {
            let id = String(path.lastPathComponent.dropFirst(10))
            let info = try path.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            guard SpeechFiles.id(id), info.isDirectory == true, info.isSymbolicLink == false,
                  !FileManager.default.fileExists(atPath: folder(id).path) else { throw SpeechFailure(.storage) }
            let children = try FileManager.default.contentsOfDirectory(at: path, includingPropertiesForKeys: nil)
            guard children.count <= 2, children.allSatisfy({ ["audio.pcm", "State"].contains($0.lastPathComponent) }) else { throw SpeechFailure(.storage) }
            if children.isEmpty { try FileManager.default.removeItem(at: path); continue }
            let input = try SpeechFiles.openAudio(path.appendingPathComponent("audio.pcm")); defer { try? input.close() }
            guard try SpeechFiles.size(input) == 0 else { throw SpeechFailure(.storage) }
            if children.count == 1, children[0].lastPathComponent == "audio.pcm" {
                try FileManager.default.removeItem(at: path); continue
            }
            guard let document = try await documents(path).read(SpeechRecordingDocument.self, key: "recording.v1")?.value,
                  document.id == id else { throw SpeechFailure(.storage) }
            try document.validate()
            try FileManager.default.moveItem(at: path, to: folder(id))
        }
    }

    private func acquire() async {
        if !locked { locked = true; return }
        await withCheckedContinuation { waiters.append($0) }
    }
    private func release() {
        if waiters.isEmpty { locked = false } else { waiters.removeFirst().resume() }
    }
    deinit { for writer in writers.values { try? writer.close() } }
}
