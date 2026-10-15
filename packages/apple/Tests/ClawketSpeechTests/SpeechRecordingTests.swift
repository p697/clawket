import Foundation
import Testing
import ClawketPersistence
@testable import ClawketSpeech

private final class SpeechWriteFault: @unchecked Sendable {
    private let lock = NSLock()
    private var armed = false
    func arm() { lock.lock(); armed = true; lock.unlock() }
    func consume() -> Bool { lock.lock(); defer { lock.unlock() }; let value = armed; armed = false; return value }
}
private actor SpeechFaultValues: ValueStore {
    let values: FileValueStore
    let fault: SpeechWriteFault
    init(directory: URL, fault: SpeechWriteFault) throws { values = try FileValueStore(directory: directory, maximumBytes: 2 * 1_024 * 1_024); self.fault = fault }
    func read(_ key: String) async throws -> Data? { try await values.read(key) }
    func write(_ bytes: Data, for key: String) async throws {
        try await values.write(bytes, for: key)
        if key == "recording.v1", fault.consume() { throw StoreFailure.verificationFailed }
    }
    func remove(_ key: String) async throws { try await values.remove(key) }
}

@Suite(.serialized)
struct SpeechRecordingTests {
    @Test func protectedPcmAndOriginalDraftReopenWithoutCaptureOrNetwork() async throws {
        let fixture = try SpeechFixture(), store = try SpeechRecordingStore(directory: fixture.recordings)
        let recording = try await store.create(scope: SpeechFixture.scope, draft: "Existing draft 中文", now: Date(timeIntervalSince1970: 1_700_000_000))
        _ = try await store.append(Data([0, 1, 2, 3]), to: recording.id)
        try await store.close(recording.id)
        let reopened = try SpeechRecordingStore(directory: fixture.recordings)
        let values = try await reopened.recordings(scope: SpeechFixture.scope)
        #expect(values.count == 1); #expect(values[0].draft == recording.draft)
        #expect(values[0].bytes == 4); #expect(values[0].isRecording == false)
        #expect(try await reopened.read(recording.id, offset: 0, length: 4) == Data([0, 1, 2, 3]))
        #expect(try await reopened.recordings(scope: .init(connectionID: "other", agentID: "main", sessionKey: "fixture-session")).isEmpty)
    }
    @Test func emptySuccessfulCheckpointIsDurableAndCannotBeReplaced() async throws {
        let fixture = try SpeechFixture(), store = try SpeechRecordingStore(directory: fixture.recordings)
        let recording = try await store.create(scope: SpeechFixture.scope, draft: "")
        _ = try await store.append(Data([0, 0]), to: recording.id)
        await #expect(throws: SpeechFailure.self) { try await store.checkpoint(recording.id, index: 0, byteCount: 2, text: "") }
        try await store.close(recording.id)
        try await store.checkpoint(recording.id, index: 0, byteCount: 2, text: "")
        let reopened = try SpeechRecordingStore(directory: fixture.recordings)
        #expect(try await reopened.result(recording.id, index: 0) == "")
        await #expect(throws: SpeechFailure.self) { try await reopened.checkpoint(recording.id, index: 0, byteCount: 2, text: "replacement") }
    }
    @Test func unknownCheckpointWriteKeepsAudioBlocksSameProcessAndColdReadsCommittedResult() async throws {
        let fixture = try SpeechFixture(), fault = SpeechWriteFault()
        let store = try SpeechRecordingStore(directory: fixture.recordings) { directory in
            try DocumentStore(values: SpeechFaultValues(directory: directory, fault: fault), maximumBytes: 2 * 1_024 * 1_024)
        }
        let recording = try await store.create(scope: SpeechFixture.scope, draft: "preserved")
        _ = try await store.append(Data([0, 0]), to: recording.id); try await store.close(recording.id)
        fault.arm()
        await #expect(throws: SpeechFailure.self) { try await store.checkpoint(recording.id, index: 0, byteCount: 2, text: "committed") }
        await #expect(throws: SpeechFailure.self) { _ = try await store.recording(recording.id) }
        let reopened = try SpeechRecordingStore(directory: fixture.recordings)
        #expect(try await reopened.result(recording.id, index: 0) == "committed")
        #expect(try await reopened.read(recording.id, offset: 0, length: 2) == Data([0, 0]))
    }
    @Test func tenUnsentRecordingsAreNeverSilentlyEvicted() async throws {
        let fixture = try SpeechFixture(), store = try SpeechRecordingStore(directory: fixture.recordings)
        for index in 0..<10 {
            let value = try await store.create(scope: SpeechFixture.scope, draft: String(index))
            _ = try await store.append(Data([0, 0]), to: value.id); try await store.close(value.id)
        }
        await #expect(throws: SpeechFailure(.storageFull)) { _ = try await store.create(scope: SpeechFixture.scope, draft: "eleven") }
        #expect(try await store.recordings().count == 10)
    }
    @Test func oddTailIsIgnoredWithoutMutatingOriginalAndActiveDeleteRejects() async throws {
        let fixture = try SpeechFixture(), store = try SpeechRecordingStore(directory: fixture.recordings)
        let recording = try await store.create(scope: SpeechFixture.scope, draft: "")
        _ = try await store.append(Data([0, 0]), to: recording.id)
        await #expect(throws: SpeechFailure.self) { try await store.discard(recording.id) }
        try await store.close(recording.id)
        let file = fixture.recordings.appendingPathComponent(recording.id).appendingPathComponent("audio.pcm")
        let handle = try FileHandle(forWritingTo: file); try handle.seekToEnd(); try handle.write(contentsOf: Data([7])); try handle.close()
        #expect(try await store.recording(recording.id).bytes == 2)
        #expect(try Data(contentsOf: file).count == 3)
        try await store.discard(recording.id); #expect(try await store.recordings().isEmpty)
    }
    @Test func unsafeStateAndSymlinkAudioFailClosedWithoutDeletingFiles() async throws {
        let fixture = try SpeechFixture(), store = try SpeechRecordingStore(directory: fixture.recordings)
        let recording = try await store.create(scope: SpeechFixture.scope, draft: "")
        try await store.close(recording.id)
        let folder = fixture.recordings.appendingPathComponent(recording.id)
        let junk = folder.appendingPathComponent("State").appendingPathComponent("unexpected")
        try Data([1]).write(to: junk)
        await #expect(throws: SpeechFailure.self) { _ = try await store.recording(recording.id) }
        #expect(FileManager.default.fileExists(atPath: junk.path)); try FileManager.default.removeItem(at: junk)
        let audio = folder.appendingPathComponent("audio.pcm"), target = fixture.root.appendingPathComponent("target")
        try Data([1, 2]).write(to: target); try FileManager.default.removeItem(at: audio)
        try FileManager.default.createSymbolicLink(at: audio, withDestinationURL: target)
        await #expect(throws: SpeechFailure.self) { _ = try await store.recording(recording.id) }
        #expect(try Data(contentsOf: target) == Data([1, 2]))
    }
    @Test func maliciousCheckpointIndexRejectsBeforeOverflow() {
        let document = SpeechRecordingDocument(id: String(repeating: "a", count: 32), scope: try! SpeechFixture.scope, draft: "", createdAt: Date(),
            checkpoints: [.init(index: Int.max, byteCount: 2, text: "")])
        #expect(throws: SpeechFailure.self) { try document.validate() }
    }
}
