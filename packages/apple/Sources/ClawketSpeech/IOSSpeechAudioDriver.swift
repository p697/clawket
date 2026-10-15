#if os(iOS)
@preconcurrency import AVFoundation
import Foundation

private final class SpeechAudioEmitter: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: AsyncThrowingStream<SpeechCaptureChunk, any Error>.Continuation?
    private let converter: AVAudioConverter?
    private let target: AVAudioFormat
    private let stop: @Sendable () -> Void
    init(continuation: AsyncThrowingStream<SpeechCaptureChunk, any Error>.Continuation,
         converter: AVAudioConverter?, target: AVAudioFormat, stop: @escaping @Sendable () -> Void) {
        self.continuation = continuation; self.converter = converter; self.target = target; self.stop = stop
    }
    // Serializes converter access and finishing against the real-time callback.
    // No file, network, UI or audio-session operations run under this lock.
    func deliver(_ buffer: AVAudioPCMBuffer) {
        lock.lock(); defer { lock.unlock() }
        guard let continuation, buffer.frameLength > 0 else { return }
        var output = buffer
        if let converter {
            let count = Double(buffer.frameLength) * target.sampleRate / buffer.format.sampleRate
            guard count.isFinite, count > 0, count <= 32_000,
                  let converted = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: AVAudioFrameCount(count) + 1) else {
                failLocked(); return
            }
            var supplied = false
            var error: NSError?
            converter.convert(to: converted, error: &error) { _, status in
                if supplied { status.pointee = .noDataNow; return nil }
                supplied = true; status.pointee = .haveData; return buffer
            }
            guard error == nil else { failLocked(); return }
            output = converted
        }
        guard output.frameLength > 0 else { return }
        guard let samples = output.floatChannelData?[0], output.frameLength <= 32_000 else { failLocked(); return }
        let (bytes, level) = SpeechPCM.encode(UnsafeBufferPointer(start: samples, count: Int(output.frameLength)))
        for offset in stride(from: 0, to: bytes.count, by: SpeechLimits.chunkBytes) {
            let end = min(bytes.count, offset + SpeechLimits.chunkBytes)
            guard let chunk = try? SpeechCaptureChunk(pcm: bytes.subdata(in: offset..<end), level: level) else { failLocked(); return }
            switch continuation.yield(chunk) {
            case .enqueued: break
            case .dropped, .terminated: failLocked(); return
            @unknown default: failLocked(); return
            }
        }
    }
    private func failLocked() {
        let old = continuation; continuation = nil
        old?.finish(throwing: SpeechFailure(.captureFailed)); stop()
    }
    func finish(_ failure: SpeechFailure?) {
        lock.lock(); let old = continuation; continuation = nil; lock.unlock()
        if let failure { old?.finish(throwing: failure) } else { old?.finish() }
    }
}

/// AVAudioConverter's existing native 16k mono path, without Expo or JS. The
/// serial queue owns session/engine transitions; initialization is audio-inert.
public final class IOSSpeechAudioDriver: SpeechAudioDriver, @unchecked Sendable {
    private let queue = DispatchQueue(label: "com.clawket.native-speech.capture", qos: .userInteractive)
    private let queueKey = DispatchSpecificKey<Bool>()
    private var id: UUID?
    private var engine: AVAudioEngine?
    private var tapInstalled = false
    private var emitter: SpeechAudioEmitter?
    private var observers: [NSObjectProtocol] = []
    private var sessionActive = false
    public init() { queue.setSpecific(key: queueKey, value: true) }

    public func start(id: UUID) async throws -> AsyncThrowingStream<SpeechCaptureChunk, any Error> {
        try Task.checkCancellation()
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
            queue.async {
                guard self.id == nil, !Task.isCancelled else { continuation.resume(throwing: SpeechFailure(.busy)); return }
                self.id = id; continuation.resume()
            }
        }
        let allowed: Bool
        if #available(iOS 17.0, *) { allowed = await AVAudioApplication.requestRecordPermission() }
        else {
            allowed = await withCheckedContinuation { continuation in
                AVAudioSession.sharedInstance().requestRecordPermission { continuation.resume(returning: $0) }
            }
        }
        guard allowed, !Task.isCancelled else {
            await stop(id: id); throw SpeechFailure(Task.isCancelled ? .cancelled : .permission)
        }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                queue.async {
                    guard self.id == id else { continuation.resume(throwing: SpeechFailure(.cancelled)); return }
                    do { continuation.resume(returning: try self.begin(id)) }
                    catch { self.end(id, failure: nil); continuation.resume(throwing: SpeechFailure(.captureFailed)) }
                }
            }
        } onCancel: { self.queue.async { self.end(id, failure: .init(.cancelled)) } }
    }

    public func stop(id: UUID) async {
        await withCheckedContinuation { continuation in
            queue.async { self.end(id, failure: nil); continuation.resume() }
        }
    }
    private func begin(_ id: UUID) throws -> AsyncThrowingStream<SpeechCaptureChunk, any Error> {
        let session = AVAudioSession.sharedInstance()
        // Matches the existing capture core: no ducking/HFP or forced hardware
        // sample rate. A real route/music acceptance remains a device check.
        try session.setCategory(.playAndRecord, mode: .measurement,
                                options: [.defaultToSpeaker, .mixWithOthers, .allowBluetoothA2DP])
        try? session.setAllowHapticsAndSystemSoundsDuringRecording(true)
        try session.setActive(true); sessionActive = true
        let engine = AVAudioEngine(); self.engine = engine
        let format = engine.inputNode.outputFormat(forBus: 0)
        guard format.sampleRate.isFinite, (8_000...192_000).contains(format.sampleRate), (1...8).contains(format.channelCount),
              let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 1, interleaved: true) else {
            throw SpeechFailure(.captureFailed)
        }
        let matches = format.sampleRate == 16_000 && format.channelCount == 1 && format.commonFormat == .pcmFormatFloat32
        let converter = matches ? nil : AVAudioConverter(from: format, to: target)
        guard matches || converter != nil else { throw SpeechFailure(.captureFailed) }
        converter?.downmix = true
        let (stream, continuation) = AsyncThrowingStream<SpeechCaptureChunk, any Error>.makeStream(bufferingPolicy: .bufferingOldest(64))
        let emitter = SpeechAudioEmitter(continuation: continuation, converter: converter, target: target) { [weak self] in
            self?.queue.async { [weak self] in self?.end(id, failure: .init(.captureFailed)) }
        }
        self.emitter = emitter
        continuation.onTermination = { [weak self] _ in
            self?.queue.async { [weak self] in self?.end(id, failure: nil) }
        }
        engine.inputNode.installTap(onBus: 0, bufferSize: AVAudioFrameCount(max(1, format.sampleRate * 0.1)), format: format) { buffer, _ in
            emitter.deliver(buffer)
        }
        tapInstalled = true
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: nil) { [weak self] note in
            guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
            self?.queue.async { [weak self] in self?.end(id, failure: .init(.captureFailed)) }
        })
        for (name, object) in [(AVAudioSession.mediaServicesWereResetNotification, session as AnyObject),
                               (Notification.Name.AVAudioEngineConfigurationChange, engine as AnyObject)] {
            observers.append(center.addObserver(forName: name, object: object, queue: nil) { [weak self] _ in
                self?.queue.async { [weak self] in self?.end(id, failure: .init(.captureFailed)) }
            })
        }
        try engine.start()
        return stream
    }
    private func end(_ id: UUID, failure: SpeechFailure?) {
        guard self.id == id else { return }
        self.id = nil
        // Finishing waits for a callback already converting, so all previously
        // yielded chunks can drain to disk after hardware has stopped.
        emitter?.finish(failure); emitter = nil
        observers.forEach(NotificationCenter.default.removeObserver); observers = []
        if let engine { engine.stop(); if tapInstalled { engine.inputNode.removeTap(onBus: 0) } }
        tapInstalled = false
        engine = nil
        if sessionActive {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            sessionActive = false
        }
    }
    deinit {
        if DispatchQueue.getSpecific(key: queueKey) == true { if let id { end(id, failure: nil) } }
        else { queue.sync { if let id = self.id { self.end(id, failure: nil) } } }
    }
}
#endif
