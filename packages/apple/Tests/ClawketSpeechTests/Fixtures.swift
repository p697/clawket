import CryptoKit
import Foundation
import Testing
import ClawketTransport
@testable import ClawketSpeech

final class SpeechFixture: @unchecked Sendable {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("clawket-speech-" + UUID().uuidString)
    init() throws { try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true) }
    deinit { try? FileManager.default.removeItem(at: root) }
    var recordings: URL { root.appendingPathComponent("recordings") }
    static var scope: SpeechScope { get throws { try .init(connectionID: "fixture", agentID: "main", sessionKey: "fixture-session") } }
    static var identity: SpeechSigningIdentity {
        get throws {
            let seed = Data(0..<32), key = try Curve25519.Signing.PrivateKey(rawRepresentation: seed)
            return .init(publicKey: key.publicKey.rawRepresentation, tweetNaClSecretKey: seed + key.publicKey.rawRepresentation)
        }
    }
    static func request() throws -> URLRequest {
        try SpeechServiceConfiguration("wss://speech.invalid/v1/speech").signedRequest(identity: identity,
            timestampMilliseconds: 1_700_000_000_000, nonce: String(repeating: "a", count: 32))
    }
}

final class SpeechTestClock: TransportClock, @unchecked Sendable {
    private let lock = NSLock()
    private var value: Duration = .zero
    private var waits: [UUID: (Duration, CheckedContinuation<Void, any Error>)] = [:]
    func now() -> Duration { lock.lock(); defer { lock.unlock() }; return value }
    func sleep(for duration: Duration) async throws {
        let id = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
                lock.lock()
                if Task.isCancelled { lock.unlock(); continuation.resume(throwing: CancellationError()) }
                else if duration <= .zero { lock.unlock(); continuation.resume() }
                else { waits[id] = (value + duration, continuation); lock.unlock() }
            }
        } onCancel: { self.cancel(id) }
    }
    private func cancel(_ id: UUID) {
        lock.lock(); let pending = waits.removeValue(forKey: id); lock.unlock()
        pending?.1.resume(throwing: CancellationError())
    }
    func advance(_ duration: Duration) {
        lock.lock(); value += duration
        let due = waits.filter { $0.value.0 <= value }
        for id in due.keys { waits.removeValue(forKey: id) }; lock.unlock()
        due.values.forEach { $0.1.resume() }
    }
    func advanceWithoutWaking(_ duration: Duration) { lock.lock(); value += duration; lock.unlock() }
    var pendingCount: Int { lock.lock(); defer { lock.unlock() }; return waits.count }
}

final class SpeechPacingClock: TransportClock, Sendable {
    let base = SpeechTestClock()
    func now() -> Duration { base.now() }
    func sleep(for duration: Duration) async throws {
        if duration < .seconds(1) { base.advance(duration); await Task.yield(); try Task.checkCancellation() }
        else { try await base.sleep(for: duration) }
    }
}

actor SpeechPeer: SpeechSocket {
    var frames: [WebSocketFrame]
    var sent: [WebSocketFrame] = []
    var closed = false
    var waiter: CheckedContinuation<WebSocketFrame, any Error>?
    let onSend: @Sendable (WebSocketFrame, SpeechPeer) async throws -> Void
    init(ready: Bool = true, acknowledgement: Bool = true,
         onSend: @escaping @Sendable (WebSocketFrame, SpeechPeer) async throws -> Void = { _, _ in }) {
        frames = ready ? [.text("{\"type\":\"ready\",\"maxSeconds\":120\(acknowledgement ? ",\"flowControl\":\"ack.v1\"" : "")}")] : []
        self.onSend = onSend
    }
    func open() throws { if closed { throw SpeechFailure(.cancelled) } }
    func send(_ frame: WebSocketFrame) async throws {
        guard !closed else { throw SpeechFailure(.cancelled) }
        sent.append(frame); try await onSend(frame, self)
    }
    func receive() async throws -> WebSocketFrame {
        if !frames.isEmpty { return frames.removeFirst() }
        guard !closed else { throw SpeechFailure(.cancelled) }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { waiter = $0 }
        } onCancel: { Task { await self.close() } }
    }
    func emit(_ text: String) {
        let frame = WebSocketFrame.text(text)
        if let waiter { self.waiter = nil; waiter.resume(returning: frame) }
        else { frames.append(frame) }
    }
    func close() { closed = true; let old = waiter; waiter = nil; old?.resume(throwing: SpeechFailure(.cancelled)) }
}

final class SpeechPeerFactory: SpeechSocketFactory, @unchecked Sendable {
    private let lock = NSLock()
    private var peers: [SpeechPeer]
    private var requests: [URLRequest] = []
    init(_ peers: SpeechPeer...) { self.peers = peers }
    func makeSocket(request: URLRequest) throws -> any SpeechSocket {
        lock.lock(); defer { lock.unlock() }
        requests.append(request)
        guard !peers.isEmpty else { throw SpeechFailure(.unavailable) }
        return peers.removeFirst()
    }
    var count: Int { lock.lock(); defer { lock.unlock() }; return requests.count }
}

actor SpeechFakeDriver: SpeechAudioDriver {
    var id: UUID?
    var starts = 0
    var stops = 0
    var continuation: AsyncThrowingStream<SpeechCaptureChunk, any Error>.Continuation?
    func start(id: UUID) throws -> AsyncThrowingStream<SpeechCaptureChunk, any Error> {
        guard self.id == nil else { throw SpeechFailure(.busy) }
        self.id = id; starts += 1
        let (stream, continuation) = AsyncThrowingStream<SpeechCaptureChunk, any Error>.makeStream(bufferingPolicy: .bufferingOldest(64))
        self.continuation = continuation; return stream
    }
    func stop(id: UUID) {
        guard self.id == id else { return }; self.id = nil; stops += 1
        let old = continuation; continuation = nil; old?.finish()
    }
    func emit(_ bytes: Data) throws { continuation?.yield(try SpeechCaptureChunk(pcm: bytes, level: 0.2)) }
    func fail() { continuation?.finish(throwing: SpeechFailure(.captureFailed)) }
}

func speechEventually(_ predicate: @escaping () async -> Bool, sourceLocation: SourceLocation = #_sourceLocation) async {
    let deadline = ContinuousClock.now.advanced(by: .seconds(3))
    while ContinuousClock.now < deadline {
        if await predicate() { return }; await Task.yield()
    }
    Issue.record("Speech fixture condition was not reached", sourceLocation: sourceLocation)
}
