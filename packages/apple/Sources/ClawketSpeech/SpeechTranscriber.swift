import Foundation
import ClawketTransport

public struct SpeechTranscriptionProgress: Sendable, Equatable {
    public let completedSegments: Int
    public let text: String
}

/// Sequential 110-second provider tasks over protected local PCM. A failed task
/// is never replayed automatically; an explicit retry reuses durable checkpoints.
public actor SpeechTranscriber {
    private let store: SpeechRecordingStore
    private let configuration: SpeechServiceConfiguration
    private let factory: any SpeechSocketFactory
    private let clock: any TransportClock
    private let identity: @Sendable () async throws -> SpeechSigningIdentity
    private let now: @Sendable () -> Date
    private let nonce: @Sendable () -> String
    private var attempt: UUID?
    private var connection: SpeechConnection?
    private var opening: (id: UUID, task: Task<SpeechConnection, any Error>)?

    public init(store: SpeechRecordingStore, configuration: SpeechServiceConfiguration,
                factory: any SpeechSocketFactory = URLSessionSpeechSocketFactory(),
                clock: any TransportClock = MonotonicTransportClock(),
                identity: @escaping @Sendable () async throws -> SpeechSigningIdentity,
                now: @escaping @Sendable () -> Date = { Date() },
                nonce: @escaping @Sendable () -> String = { UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased() }) {
        self.store = store; self.configuration = configuration; self.factory = factory
        self.clock = clock; self.identity = identity; self.now = now; self.nonce = nonce
    }

    public func transcribe(_ recordingID: String,
                           progress: @escaping @Sendable (SpeechTranscriptionProgress) async -> Void = { _ in }) async throws -> String {
        guard attempt == nil else { throw SpeechFailure(.busy) }
        let token = UUID(); attempt = token
        do {
            let text = try await withTaskCancellationHandler {
                try await perform(recordingID, token: token, progress: progress)
            } onCancel: { Task { await self.cancel(token) } }
            try check(token)
            attempt = nil
            return text
        } catch {
            await cancel(token)
            throw error as? SpeechFailure ?? SpeechFailure(Task.isCancelled ? .cancelled : .failed)
        }
    }

    public func cancel() async { if let attempt { await cancel(attempt) } }
    private func cancel(_ token: UUID) async {
        guard attempt == token else { return }
        attempt = nil
        let pending = opening; opening = nil; pending?.task.cancel()
        let captured = connection; connection = nil
        await captured?.cancel()
    }
    private func check(_ token: UUID) throws {
        guard attempt == token, !Task.isCancelled else { throw SpeechFailure(.cancelled) }
    }

    private func perform(_ id: String, token: UUID,
                         progress: @escaping @Sendable (SpeechTranscriptionProgress) async -> Void) async throws -> String {
        var texts: [String] = []
        for index in 0..<6 {
            let offset = index * SpeechLimits.segmentBytes
            try check(token)
            var recording = try await store.recording(id)
            while recording.bytes <= offset, recording.isRecording {
                try check(token); try await clock.sleep(for: .milliseconds(50))
                recording = try await store.recording(id)
            }
            try check(token)
            guard recording.bytes > offset else { break }
            if let previous = try await store.result(id, index: index) {
                texts.append(previous)
                await progress(.init(completedSegments: texts.count, text: joined(texts)))
                continue
            }
            let accepted = try await admitted(token)
            try check(token); connection = accepted
            do {
                let end = min(offset + SpeechLimits.segmentBytes, SpeechLimits.recordingBytes)
                var cursor = offset
                while cursor < end {
                    try check(token)
                    recording = try await store.recording(id)
                    if recording.bytes <= cursor {
                        if !recording.isRecording { break }
                        _ = try await accepted.writable(for: 2) // Surface a failed reader while capture continues.
                        try await clock.sleep(for: .milliseconds(50)); continue
                    }
                    let length = min(SpeechLimits.chunkBytes, end - cursor, recording.bytes - cursor)
                    let blockedAt = clock.now()
                    while !(try await accepted.writable(for: length)) {
                        try check(token)
                        guard clock.now() - blockedAt < .seconds(10) else { throw SpeechFailure(.audioTimeout) }
                        try await clock.sleep(for: .milliseconds(50))
                    }
                    try check(token)
                    let bytes = try await store.read(id, offset: cursor, length: length)
                    try check(token)
                    try await accepted.audio(bytes)
                    cursor += length
                    let rate = await accepted.replayRate
                    try await clock.sleep(for: .seconds(Double(length) / Double(SpeechLimits.bytesPerSecond) / rate))
                }
                try check(token)
                let text = try await accepted.finish()
                try check(token)
                // Empty successful segments are durable too, so retries do not
                // repeatedly upload silence after a later segment fails.
                try await store.checkpoint(id, index: index, byteCount: cursor - offset, text: text)
                try check(token)
                texts.append(text)
                await progress(.init(completedSegments: texts.count, text: joined(texts)))
                if connection === accepted { connection = nil }
                await accepted.cancel()
            } catch {
                if connection === accepted { connection = nil }
                await accepted.cancel(); throw error
            }
        }
        let text = joined(texts)
        guard !text.isEmpty else { throw SpeechFailure(.noSpeech) }
        return text
    }

    private func admitted(_ token: UUID) async throws -> SpeechConnection {
        let started = clock.now()
        for admission in 0..<8 {
            try check(token)
            let key: SpeechSigningIdentity
            do { key = try await speechDeadline(seconds: 5, clock: clock, operation: identity) }
            catch { throw error as? SpeechFailure ?? SpeechFailure(.authentication) }
            try check(token)
            let timestamp = now().timeIntervalSince1970 * 1_000
            guard timestamp.isFinite, timestamp >= 1_000_000_000_000, timestamp <= 9_999_999_999_999 else { throw SpeechFailure(.authentication) }
            let request = try configuration.signedRequest(identity: key, timestampMilliseconds: Int64(timestamp), nonce: nonce())
            do {
                let openingID = UUID()
                let pending = Task { [factory, clock] in
                    try await SpeechConnection.connect(request: request, factory: factory, clock: clock)
                }
                opening = (openingID, pending)
                let accepted: SpeechConnection
                do { accepted = try await pending.value }
                catch { if opening?.id == openingID { opening = nil }; throw error }
                if opening?.id == openingID { opening = nil }
                do { try check(token); return accepted }
                catch { await accepted.cancel(); throw error }
            } catch let failure as SpeechFailure {
                // Only admission busy, before ready/audio, permits automatic retry.
                guard failure.code == .busy, admission < 7, clock.now() - started < .seconds(30) else { throw failure }
                let delay = min(5_000.0, max(500.0 * pow(2, Double(admission)), failure.remainingRetryMilliseconds(now: now())))
                guard clock.now() - started + .milliseconds(Int64(delay)) <= .seconds(30) else { throw failure }
                try await clock.sleep(for: .milliseconds(Int64(delay)))
            }
        }
        throw SpeechFailure(.busy)
    }
    private func joined(_ texts: [String]) -> String { texts.filter { !$0.isEmpty }.joined(separator: " ") }
}
