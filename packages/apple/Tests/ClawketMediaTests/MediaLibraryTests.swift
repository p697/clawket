import Foundation
import Testing
@testable import ClawketMedia

private final class Fixture: @unchecked Sendable {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("clawket-media-" + UUID().uuidString)
    init() throws { try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true) }
    deinit { try? FileManager.default.removeItem(at: root) }
    var libraryURL: URL { root.appendingPathComponent("library") }
    func source(_ bytes: Data, name: String = "notes.txt") throws -> URL {
        let url = root.appendingPathComponent(UUID().uuidString + name); try bytes.write(to: url); return url
    }
    func staged(_ bytes: Data, name: String = "notes.txt", mime: String = "text/plain") throws -> StagedMediaFile {
        try MediaImportStager(directory: root.appendingPathComponent("staging")).stageFile(from: source(bytes), name: name, mimeType: mime)
    }
}

private final class FaultIndex: MediaIndexIO, @unchecked Sendable {
    enum Fault: Sendable { case afterWrite, protection, readback }
    private let lock = NSLock()
    private var fault: Fault?
    private var replaced = false
    func arm(_ fault: Fault) { lock.lock(); self.fault = fault; replaced = false; lock.unlock() }
    func read(_ url: URL) throws -> Data {
        lock.lock(); let reject = replaced && fault == .readback && url.lastPathComponent == "index.json"
        if reject { fault = nil }; lock.unlock()
        return reject ? Data("corrupt-readback".utf8) : try Data(contentsOf: url)
    }
    func write(_ data: Data, to url: URL) throws {
        try data.write(to: url, options: .atomic)
        lock.lock(); if url.lastPathComponent == "index.json" { replaced = true }
        let reject = replaced && fault == .afterWrite
        if reject { fault = nil }; lock.unlock()
        if reject { throw MediaFailure.corrupt }
    }
    func protect(_ url: URL) throws {
        lock.lock(); let reject = replaced && fault == .protection && url.lastPathComponent == "index.json"
        if reject { fault = nil }; lock.unlock()
        if reject { throw MediaFailure.corrupt }
        try MediaFiles.protect(url)
    }
}

private actor ReadCount {
    var count = 0
    func next() { count += 1 }
}

private actor ChunkGate {
    var waiting: CheckedContinuation<Data, any Error>?
    var entered = false
    func read() async throws -> Data {
        entered = true
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                if Task.isCancelled { continuation.resume(throwing: CancellationError()) } else { waiting = continuation }
            }
        } onCancel: { Task { await self.cancel() } }
    }
    func cancel() { waiting?.resume(throwing: CancellationError()); waiting = nil }
}

@Suite(.serialized)
struct MediaLibraryTests {
    @Test func synchronousStageSurvivesProviderDeletionAndKeepsOriginalNameAcrossRestart() async throws {
        let fixture = try Fixture(), bytes = Data("native attachment 中文".utf8), source = try fixture.source(bytes)
        let stager = try MediaImportStager(directory: fixture.root.appendingPathComponent("staging"))
        let staged = try stager.stageFile(from: source, name: "notes.txt", mimeType: " Text/Plain ")
        try FileManager.default.removeItem(at: source) // Provider callback has returned.
        let library = try MediaLibrary(directory: fixture.libraryURL), resource = try await library.adopt(staged)
        let url = try await library.resourceURL(resource.id)
        #expect(url.lastPathComponent == "notes.txt"); #expect(try Data(contentsOf: url) == bytes)
        #expect(!FileManager.default.fileExists(atPath: staged.url.path))
        let reopened = try MediaLibrary(directory: fixture.libraryURL)
        #expect(try await reopened.resource(resource.id) == resource)
        #expect(try await reopened.preparePrompt(resource.id).data == bytes)
    }

    @Test func symlinksUnsafeNamesAndOversizedSourcesRejectWithoutCopy() throws {
        let fixture = try Fixture(), source = try fixture.source(Data([1]))
        let stager = try MediaImportStager(directory: fixture.root.appendingPathComponent("staging"))
        let link = fixture.root.appendingPathComponent("link")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: source)
        #expect(throws: MediaFailure.invalidFile) { try stager.stageFile(from: link, name: "link.txt", mimeType: "text/plain") }
        #expect(throws: MediaFailure.invalidFile) { try stager.stageFile(from: source, name: "../escape", mimeType: "text/plain") }
        let oversized = try fixture.source(Data())
        let handle = try FileHandle(forWritingTo: oversized); try handle.truncate(atOffset: UInt64(MediaLimits.sourceBytes + 1)); try handle.close()
        #expect(throws: MediaFailure.tooLarge) { try stager.stageFile(from: oversized, name: "large.bin", mimeType: "application/octet-stream") }
        #expect(try FileManager.default.contentsOfDirectory(atPath: fixture.root.appendingPathComponent("staging").path).isEmpty)
        let alias = fixture.root.appendingPathComponent("alias")
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: fixture.root.appendingPathComponent("staging"))
        #expect(throws: MediaFailure.invalidFile) { try MediaImportStager(directory: alias.appendingPathComponent("child")) }
    }

    @Test(arguments: [FaultIndex.Fault.afterWrite, .protection, .readback])
    func unknownIndexCommitNeverDeletesPossiblyCommittedBytes(_ fault: FaultIndex.Fault) async throws {
        let fixture = try Fixture(), index = FaultIndex()
        let library = try MediaLibrary(directory: fixture.libraryURL, indexIO: index)
        let original = try await library.adopt(fixture.staged(Data([1, 2, 3])))
        let staged = try fixture.staged(Data([4, 5, 6]), name: "second.txt")
        index.arm(fault)
        await #expect(throws: MediaFailure.commitUncertain) { try await library.adopt(staged) }
        await #expect(throws: MediaFailure.corrupt) { try await library.resource(original.id) }
        let reopened = try MediaLibrary(directory: fixture.libraryURL)
        #expect(try await reopened.preparePrompt(original.id).data == Data([1, 2, 3]))
        #expect(try await reopened.preparePrompt(staged.resource.id).data == Data([4, 5, 6]))
        #expect(FileManager.default.fileExists(atPath: staged.url.path))
    }

    @Test func uncertainRemovalCanRecoverAlreadyPersistedDraftID() async throws {
        let fixture = try Fixture(), index = FaultIndex()
        let library = try MediaLibrary(directory: fixture.libraryURL, indexIO: index)
        let original = try await library.adopt(fixture.staged(Data([1, 2, 3])))
        index.arm(.protection)
        await #expect(throws: MediaFailure.commitUncertain) { try await library.remove(original.id) }
        let reopened = try MediaLibrary(directory: fixture.libraryURL)
        #expect(try await reopened.recoverResource(original.id) == original)
        #expect(try await reopened.preparePrompt(original.id).data == Data([1, 2, 3]))
    }

    @Test func crashOrphansAreReconciledButUnknownMetadataFailsClosed() async throws {
        let fixture = try Fixture()
        let orphan = fixture.libraryURL.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: orphan, withIntermediateDirectories: true)
        try Data([1, 2, 3]).write(to: orphan.appendingPathComponent("interrupted.bin"))
        _ = try MediaLibrary(directory: fixture.libraryURL)
        #expect(!FileManager.default.fileExists(atPath: orphan.path))
        try Data("bad".utf8).write(to: fixture.libraryURL.appendingPathComponent("index.json"))
        #expect(throws: (any Error).self) { try MediaLibrary(directory: fixture.libraryURL) }
    }

    @Test func generatedChunksCacheDedupAndMissingCacheRefetch() async throws {
        let fixture = try Fixture(), library = try MediaLibrary(directory: fixture.libraryURL), calls = ReadCount()
        let bytes = Data(repeating: 7, count: 128 * 1_024 + 3), key = MediaArtifactKey(connectionID: "a", sessionKey: "b", artifactID: "c")
        let read: @Sendable (Int) async throws -> Data = { offset in
            await calls.next(); return bytes.subdata(in: offset..<min(bytes.count, offset + MediaLimits.chunkBytes))
        }
        let first = try await library.cacheArtifact(key: key, name: "result.pdf", mimeType: "application/pdf", size: bytes.count, read: read)
        #expect(try Data(contentsOf: await library.resourceURL(first.id)) == bytes)
        let cached = try await library.cacheArtifact(key: key, name: "result.pdf", mimeType: "application/pdf", size: bytes.count, read: read)
        #expect(cached.id == first.id); #expect(await calls.count == 2)
        try FileManager.default.removeItem(at: await library.resourceURL(first.id))
        let second = try await library.cacheArtifact(key: key, name: "result.pdf", mimeType: "application/pdf", size: bytes.count, read: read)
        #expect(second.id != first.id); #expect(await calls.count == 4)
        try await library.retain(second.id)
        try await library.removeExpiredArtifacts(now: Date().addingTimeInterval(90_000))
        #expect(try await library.resource(second.id) == second)
        await library.release(second.id)
        try await library.removeExpiredArtifacts(now: Date().addingTimeInterval(90_000))
        await #expect(throws: MediaFailure.missing) { try await library.resource(second.id) }
    }

    @Test func malformedChunksAndScopeInvalidationNeverCommitPartialFiles() async throws {
        let fixture = try Fixture(), library = try MediaLibrary(directory: fixture.libraryURL)
        let key = MediaArtifactKey(connectionID: "a", sessionKey: "b", artifactID: "c")
        await #expect(throws: MediaFailure.invalidChunk) {
            try await library.cacheArtifact(key: key, name: "result.txt", mimeType: "text/plain", size: 2) { _ in Data([1]) }
        }
        let gate = ChunkGate()
        let task = Task { try await library.cacheArtifact(key: key, name: "result.txt", mimeType: "text/plain", size: 2) { _ in try await gate.read() } }
        while !(await gate.entered) { await Task.yield() }
        await library.invalidateArtifacts(connectionID: "a")
        await #expect(throws: CancellationError.self) { try await task.value }
        let replacement = try await library.cacheArtifact(key: key, name: "result.txt", mimeType: "text/plain", size: 2) { _ in Data([1, 2]) }
        #expect(try await library.preparePrompt(replacement.id).data == Data([1, 2]))
    }

    @Test func emptyGeneratedFileStillRequiresOneValidatedChunk() async throws {
        let fixture = try Fixture(), library = try MediaLibrary(directory: fixture.libraryURL), calls = ReadCount()
        let value = try await library.cacheArtifact(key: .init(connectionID: "a", sessionKey: "b", artifactID: "empty"), name: "empty.txt", mimeType: "text/plain", size: 0) { offset in
            #expect(offset == 0); await calls.next(); return Data()
        }
        #expect(value.byteCount == 0); #expect(await calls.count == 1)
    }
}
