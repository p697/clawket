import Foundation
import ClawketTransport

public struct SpeechCaptureChunk: Sendable {
    public let pcm: Data
    public let level: Double
    public init(pcm: Data, level: Double) throws {
        guard !pcm.isEmpty, pcm.count <= SpeechLimits.chunkBytes, pcm.count.isMultiple(of: 2),
              level.isFinite, (0...1).contains(level) else { throw SpeechFailure(.captureFailed) }
        self.pcm = pcm; self.level = level
    }
}

public protocol SpeechAudioDriver: Sendable {
    /// Permission may show system UI; it never claims audio hardware.
    func requestPermission() async throws
    /// Called only for an explicit record intent. Constructing a driver is inert.
    func start(id: UUID) async throws -> AsyncThrowingStream<SpeechCaptureChunk, any Error>
    /// Stops hardware before returning and finishes the stream without dropping
    /// chunks already yielded. A stale ID never stops a replacement attempt.
    func stop(id: UUID) async
}
public extension SpeechAudioDriver { func requestPermission() async throws {} }

public enum SpeechCaptureUpdate: Sendable {
    case recording(SpeechRecording, level: Double)
    case stopped(SpeechRecording, SpeechFailure?)
}

/// Owns native capture and the disk writer independently from network ASR.
public actor SpeechRecorder {
    private struct Attempt {
        let token: UUID
        let recordingID: String
        var reader: Task<Void, Never>?
        var starting: Task<AsyncThrowingStream<SpeechCaptureChunk, any Error>, any Error>?
    }
    private let store: SpeechRecordingStore
    private let driver: any SpeechAudioDriver
    private let clock: any TransportClock
    private var active: Attempt?
    private var watchdog: Task<Void, Never>?
    private var forcedFailure: SpeechFailure?
    private let update: @Sendable (SpeechCaptureUpdate) async -> Void
    public init(store: SpeechRecordingStore, driver: any SpeechAudioDriver,
                clock: any TransportClock = MonotonicTransportClock(),
                update: @escaping @Sendable (SpeechCaptureUpdate) async -> Void = { _ in }) {
        self.store = store; self.driver = driver; self.clock = clock; self.update = update
    }

    public func start(scope: SpeechScope, draft: String) async throws -> SpeechRecording {
        guard active == nil else { throw SpeechFailure(.busy) }
        // Reserve before any await, including protected metadata I/O.
        let token = UUID(); active = Attempt(token: token, recordingID: "", reader: nil); forcedFailure = nil
        var created: SpeechRecording?
        do {
            try await driver.requestPermission()
            guard active?.token == token, !Task.isCancelled else { throw SpeechFailure(.cancelled) }
            let recording = try await store.create(scope: scope, draft: draft); created = recording
            guard active?.token == token, !Task.isCancelled else { throw SpeechFailure(.cancelled) }
            active = Attempt(token: token, recordingID: recording.id, reader: nil)
            let expires = clock.now() + .seconds(SpeechLimits.recordingSeconds)
            let starting = Task { [driver] in try await driver.start(id: token) }
            active?.starting = starting
            let stream = try await withTaskCancellationHandler { try await starting.value }
                onCancel: { starting.cancel() }
            if active?.token == token { active?.starting = nil }
            guard active?.token == token, !Task.isCancelled else {
                await driver.stop(id: token); throw SpeechFailure(.cancelled)
            }
            let reader = Task { [weak self, store, driver, update, clock] in
                var failure: SpeechFailure?
                do {
                    for try await chunk in stream {
                        guard clock.now() < expires else { failure = SpeechFailure(.tooLong); break }
                        let current = try await store.recording(recording.id)
                        let remaining = SpeechLimits.recordingBytes - current.bytes
                        if remaining > 0 {
                            _ = try await store.append(Data(chunk.pcm.prefix(remaining)), to: recording.id)
                            let saved = try await store.recording(recording.id)
                            await update(.recording(saved, level: chunk.level))
                        }
                        if chunk.pcm.count >= remaining { failure = SpeechFailure(.tooLong); break }
                    }
                } catch { failure = error as? SpeechFailure ?? SpeechFailure(.captureFailed) }
                // Never cancel this reader to stop recording: drain buffered
                // callbacks first, then close the append-only writer.
                await driver.stop(id: token)
                do { try await store.close(recording.id) } catch { failure = SpeechFailure(.storage) }
                failure = await self?.finished(token, failure: failure) ?? failure
                if let saved = try? await store.recording(recording.id) { await update(.stopped(saved, failure)) }
            }
            active?.reader = reader
            watchdog = Task { [weak self, clock] in
                do {
                    let remaining = expires - clock.now()
                    if remaining > .zero { try await clock.sleep(for: remaining) }
                    try Task.checkCancellation()
                }
                catch { return }
                await self?.expire(token)
            }
            return recording
        } catch {
            await driver.stop(id: token)
            if let created { try? await store.close(created.id) }
            if active?.token == token { active = nil }
            throw error as? SpeechFailure ?? SpeechFailure(Task.isCancelled ? .cancelled : .captureFailed)
        }
    }

    public func stop(recordingID: String? = nil) async {
        guard let captured = active else { return }
        if let recordingID, captured.recordingID != recordingID { return }
        watchdog?.cancel(); watchdog = nil
        // Invalidate an incomplete start synchronously. A ready reader instead
        // owns final draining and retires only after the writer is closed.
        if captured.reader == nil { active = nil }
        captured.starting?.cancel()
        await driver.stop(id: captured.token)
        await captured.reader?.value
        if !captured.recordingID.isEmpty { try? await store.close(captured.recordingID) }
        if active?.token == captured.token { active = nil }
    }
    private func expire(_ token: UUID) async {
        guard active?.token == token else { return }
        forcedFailure = SpeechFailure(.tooLong); await stop()
    }
    private func finished(_ token: UUID, failure: SpeechFailure?) -> SpeechFailure? {
        guard active?.token == token else { return failure }
        let result = forcedFailure ?? failure
        active = nil; forcedFailure = nil; watchdog?.cancel(); watchdog = nil
        return result
    }
    deinit {
        watchdog?.cancel()
        if let active {
            let driver = driver, token = active.token
            Task { await driver.stop(id: token) }
        }
    }
}

/// The existing native converter supplies mono 16kHz floats; quantization matches
/// Mobile's PCM16 little-endian path, including clipping and nonfinite samples.
enum SpeechPCM {
    static func encode(_ samples: UnsafeBufferPointer<Float>) -> (Data, Double) {
        var bytes = Data(capacity: samples.count * 2)
        var energy = 0.0
        for sample in samples {
            let value = sample.isFinite ? max(-1, min(1, Double(sample))) : 0
            let scaled = floor(value * (value < 0 ? 32_768 : 32_767) + 0.5)
            let integer = Int16(scaled)
            let bits = UInt16(bitPattern: integer)
            bytes.append(UInt8(bits & 255)); bytes.append(UInt8(bits >> 8))
            energy += value * value
        }
        let rms = samples.isEmpty ? 0 : sqrt(energy / Double(samples.count))
        return (bytes, min(1, rms * 4))
    }
}
