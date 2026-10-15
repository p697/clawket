import Foundation
import Testing
import ClawketTransport
@testable import ClawketSpeech

private actor SpeechIdentityGate {
    var pending: CheckedContinuation<SpeechSigningIdentity, any Error>?
    func read() async throws -> SpeechSigningIdentity { try await withCheckedThrowingContinuation { pending = $0 } }
    func release() throws { let old = pending; pending = nil; old?.resume(returning: try SpeechFixture.identity) }
}

@Suite(.serialized)
struct SpeechTranscriberTests {
    private func transcriber(_ store: SpeechRecordingStore, _ factory: SpeechPeerFactory,
                             clock: any TransportClock = SpeechPacingClock()) throws -> SpeechTranscriber {
        try .init(store: store, configuration: SpeechServiceConfiguration("wss://speech.invalid/v1/speech"),
                  factory: factory, clock: clock, identity: { try SpeechFixture.identity })
    }
    private func finalPeer(_ text: String) -> SpeechPeer {
        SpeechPeer { frame, peer in
            if case .text = frame { await peer.emit("{\"type\":\"result\",\"text\":\"\(text)\"}") }
        }
    }
    @Test func onlyPreReadyBusyRetriesAndCompletedAudioReviewsWithoutAnotherSocket() async throws {
        let fixture = try SpeechFixture(), store = try SpeechRecordingStore(directory: fixture.recordings)
        let recording = try await store.create(scope: SpeechFixture.scope, draft: "typed")
        _ = try await store.append(Data([0, 0]), to: recording.id); try await store.close(recording.id)
        let busy = SpeechPeer(ready: false); await busy.emit("{\"type\":\"error\",\"code\":\"speech_busy\"}")
        let factory = SpeechPeerFactory(busy, finalPeer("result")), transcriber = try transcriber(store, factory)
        #expect(try await transcriber.transcribe(recording.id) == "result"); #expect(factory.count == 2)
        #expect(try await transcriber.transcribe(recording.id) == "result"); #expect(factory.count == 2)
        #expect(try await store.completedText(recording.id) == "result")
        #expect(try await store.recording(recording.id).hasCompletedTranscription)
    }
    @Test func lostFinalKeepsSourceAndNeverAutomaticallyReplaysAcceptedAudio() async throws {
        let fixture = try SpeechFixture(), store = try SpeechRecordingStore(directory: fixture.recordings)
        let recording = try await store.create(scope: SpeechFixture.scope, draft: "original")
        _ = try await store.append(Data([0, 0]), to: recording.id); try await store.close(recording.id)
        let lost = SpeechPeer { frame, peer in if case .text = frame { await peer.close() } }
        let factory = SpeechPeerFactory(lost, finalPeer("explicit retry")), transcriber = try transcriber(store, factory)
        await #expect(throws: SpeechFailure.self) { _ = try await transcriber.transcribe(recording.id) }
        #expect(factory.count == 1); #expect(try await store.recording(recording.id).bytes == 2)
        #expect(try await store.completedText(recording.id) == nil)
        #expect(try await transcriber.transcribe(recording.id) == "explicit retry"); #expect(factory.count == 2)
    }
    @Test func silentSuccessfulSegmentIsNotUploadedAgainAfterLaterFailure() async throws {
        let fixture = try SpeechFixture(), store = try SpeechRecordingStore(directory: fixture.recordings)
        let recording = try await store.create(scope: SpeechFixture.scope, draft: "")
        _ = try await store.append(Data(repeating: 0, count: SpeechLimits.segmentBytes + 2), to: recording.id)
        try await store.close(recording.id)
        try await store.checkpoint(recording.id, index: 0, byteCount: SpeechLimits.segmentBytes, text: "")
        let peer = finalPeer("last"), factory = SpeechPeerFactory(peer)
        #expect(try await transcriber(store, factory).transcribe(recording.id) == "last")
        #expect(await peer.sent.filter { if case .binary = $0 { return true }; return false } == [.binary(Data([0, 0]))])
        #expect(factory.count == 1); #expect(try await store.completedText(recording.id) == "last")
    }
    @Test func absentAcknowledgementStopsAt64KiBWindowAndPreservesAllLocalAudio() async throws {
        let fixture = try SpeechFixture(), store = try SpeechRecordingStore(directory: fixture.recordings)
        let recording = try await store.create(scope: SpeechFixture.scope, draft: "")
        _ = try await store.append(Data(repeating: 0, count: SpeechLimits.outstandingBytes + 2), to: recording.id)
        try await store.close(recording.id)
        let peer = SpeechPeer(), factory = SpeechPeerFactory(peer)
        await #expect(throws: SpeechFailure(.audioTimeout)) { _ = try await transcriber(store, factory).transcribe(recording.id) }
        let bytes = await peer.sent.reduce(0) { total, frame in if case .binary(let bytes) = frame { return total + bytes.count }; return total }
        #expect(bytes == SpeechLimits.outstandingBytes); #expect(factory.count == 1); #expect(await peer.closed)
        #expect(try await store.recording(recording.id).bytes == SpeechLimits.outstandingBytes + 2)
    }
    @Test func credentialDeadlineDoesNotWaitForUncooperativeProviderOrDispatchLateIdentity() async throws {
        let fixture = try SpeechFixture(), store = try SpeechRecordingStore(directory: fixture.recordings)
        let recording = try await store.create(scope: SpeechFixture.scope, draft: "")
        _ = try await store.append(Data([0, 0]), to: recording.id); try await store.close(recording.id)
        let gate = SpeechIdentityGate(), clock = SpeechTestClock(), factory = SpeechPeerFactory(finalPeer("unused"))
        let transcriber = try SpeechTranscriber(store: store, configuration: SpeechServiceConfiguration("wss://speech.invalid/v1/speech"),
            factory: factory, clock: clock, identity: { try await gate.read() })
        let task = Task { try await transcriber.transcribe(recording.id) }
        await speechEventually { await gate.pending != nil && clock.pendingCount == 1 }
        clock.advance(.seconds(5))
        await #expect(throws: SpeechFailure(.connectTimeout)) { _ = try await task.value }
        try await gate.release(); #expect(factory.count == 0)
        #expect(try await store.recording(recording.id).bytes == 2)
    }
}
