import Foundation
import Testing
@testable import ClawketSpeech

@Suite(.serialized)
struct SpeechCaptureTests {
    @Test func initializationIsInertAndStopDrainsBufferedChunksForRecovery() async throws {
        let fixture = try SpeechFixture(), store = try SpeechRecordingStore(directory: fixture.recordings), driver = SpeechFakeDriver()
        let recorder = SpeechRecorder(store: store, driver: driver, clock: SpeechTestClock())
        #expect(await driver.starts == 0)
        let recording = try await recorder.start(scope: SpeechFixture.scope, draft: "keep")
        for _ in 0..<20 { try await driver.emit(Data([1, 2])) }
        await recorder.stop()
        #expect(await driver.starts == 1); #expect(await driver.stops == 1)
        #expect(try await store.recording(recording.id).bytes == 40)
        #expect(try await store.recording(recording.id).isRecording == false)
        #expect(try await SpeechRecordingStore(directory: fixture.recordings).recordings().count == 1)
    }
    @Test func captureInterruptionPreservesDraftAndAudioAndSuccessorUsesFreshAttempt() async throws {
        let fixture = try SpeechFixture(), store = try SpeechRecordingStore(directory: fixture.recordings), driver = SpeechFakeDriver()
        let recorder = SpeechRecorder(store: store, driver: driver, clock: SpeechTestClock())
        let first = try await recorder.start(scope: SpeechFixture.scope, draft: "typed prefix")
        try await driver.emit(Data([0, 0])); await driver.fail()
        await speechEventually { (try? await store.recording(first.id).isRecording) == false }
        #expect(try await store.recording(first.id).draft == "typed prefix")
        #expect(try await store.recording(first.id).bytes == 2)
        let second = try await recorder.start(scope: SpeechFixture.scope, draft: "next")
        await recorder.stop(); #expect(first.id != second.id)
        #expect(await driver.starts == 2); #expect(await driver.stops == 2)
    }
    @Test func tenMinuteWallDeadlineStopsHardwareAndPreservesSilentRecording() async throws {
        let fixture = try SpeechFixture(), store = try SpeechRecordingStore(directory: fixture.recordings), driver = SpeechFakeDriver(), clock = SpeechTestClock()
        let recorder = SpeechRecorder(store: store, driver: driver, clock: clock)
        let recording = try await recorder.start(scope: SpeechFixture.scope, draft: "")
        await speechEventually { clock.pendingCount == 1 }; clock.advance(.seconds(600))
        await speechEventually { await driver.stops == 1 }
        await recorder.stop()
        #expect(try await store.recording(recording.id).bytes == 0)
        #expect(try await store.recordings().count == 1)
    }
    @Test func pcmClipsNonfiniteAndRetainsExistingLittleEndianQuantization() {
        let samples: [Float] = [-2, -1, -0.5, 0, 0.5, 1, 2, .nan, .infinity]
        let (bytes, level) = samples.withUnsafeBufferPointer { SpeechPCM.encode($0) }
        #expect(Array(bytes) == [0, 128, 0, 128, 0, 192, 0, 0, 0, 64, 255, 127, 255, 127, 0, 0, 0, 0])
        #expect(level == 1)
    }
    @Test func lateCaptureCannotAppendAfterWallDeadlineWhileTimerIsSuspended() async throws {
        let fixture = try SpeechFixture(), store = try SpeechRecordingStore(directory: fixture.recordings), driver = SpeechFakeDriver(), clock = SpeechTestClock()
        let recorder = SpeechRecorder(store: store, driver: driver, clock: clock)
        let recording = try await recorder.start(scope: SpeechFixture.scope, draft: "")
        try await driver.emit(Data([1, 2]))
        await speechEventually { (try? await store.recording(recording.id).bytes) == 2 && clock.pendingCount == 1 }
        clock.advanceWithoutWaking(.seconds(601)); try await driver.emit(Data([3, 4]))
        await speechEventually { (try? await store.recording(recording.id).isRecording) == false }
        #expect(try await store.recording(recording.id).bytes == 2); #expect(await driver.stops == 1)
    }
    @Test func staleRecordingStopCannotRetireItsSuccessor() async throws {
        let fixture = try SpeechFixture(), store = try SpeechRecordingStore(directory: fixture.recordings), driver = SpeechFakeDriver()
        let recorder = SpeechRecorder(store: store, driver: driver, clock: SpeechTestClock())
        let old = try await recorder.start(scope: SpeechFixture.scope, draft: "old")
        await recorder.stop(recordingID: old.id)
        let current = try await recorder.start(scope: SpeechFixture.scope, draft: "new")
        await recorder.stop(recordingID: old.id)
        try await driver.emit(Data([1, 2]))
        await speechEventually { (try? await store.recording(current.id).bytes) == 2 }
        #expect(try await store.recording(current.id).isRecording); #expect(await driver.stops == 1)
        await recorder.stop(recordingID: current.id); #expect(await driver.stops == 2)
    }
}
