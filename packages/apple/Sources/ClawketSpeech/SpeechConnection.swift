import Foundation
import ClawketTransport

/// One accepted provider task. It never reconnects or replays audio itself.
public actor SpeechConnection {
    private let socket: any SpeechSocket
    private let clock: any TransportClock
    private var reader: Task<Void, Never>?
    private var watchdog: Task<Void, Never>?
    private var deadlineID = UUID()
    private var initialized = false
    private var finishing = false
    private var writing = false
    private var acknowledged = false
    private var sentBytes = 0
    private var acknowledgedBytes = 0
    private var requestID: String?
    private var terminal: Result<String, SpeechFailure>?
    private var readyWaiter: CheckedContinuation<Void, any Error>?
    private var resultWaiter: CheckedContinuation<String, any Error>?

    init(socket: any SpeechSocket, clock: any TransportClock) { self.socket = socket; self.clock = clock }

    public static func connect(request: URLRequest, factory: any SpeechSocketFactory = URLSessionSpeechSocketFactory(),
                               clock: any TransportClock = MonotonicTransportClock()) async throws -> SpeechConnection {
        let connection = SpeechConnection(socket: try factory.makeSocket(request: request), clock: clock)
        do {
            try await withTaskCancellationHandler { try await connection.start() }
                onCancel: { Task { await connection.cancel() } }
            try Task.checkCancellation()
            return connection
        } catch {
            await connection.cancel()
            if let failure = error as? SpeechFailure { throw failure }
            throw SpeechFailure(Task.isCancelled ? .cancelled : .disconnected)
        }
    }

    private func start() async throws {
        arm(seconds: 20, failure: .connectTimeout)
        do { try await socket.open() }
        catch { await fail(.init(Task.isCancelled ? .cancelled : .disconnected)); throw terminalFailure() }
        guard terminal == nil, !Task.isCancelled else { throw terminalFailure() }
        reader = Task { [weak self, socket] in
            while !Task.isCancelled {
                do {
                    let frame = try await socket.receive()
                    guard let self else { await socket.close(); return }
                    if !(await self.accept(frame)) { return }
                } catch {
                    guard let self else { await socket.close(); return }
                    await self.fail(error as? SpeechFailure ?? .init(.disconnected)); return
                }
            }
        }
        if initialized { return }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
            if let terminal { continuation.resume(throwing: terminalFailure(terminal)) }
            else { readyWaiter = continuation }
        }
        try Task.checkCancellation()
    }

    public func writable(for byteCount: Int) throws -> Bool {
        if let terminal { throw terminalFailure(terminal) }
        guard initialized, !finishing, byteCount > 0, byteCount <= SpeechLimits.chunkBytes,
              byteCount.isMultiple(of: 2) else { throw SpeechFailure(.invalidProtocol) }
        return !writing && (!acknowledged || sentBytes - acknowledgedBytes + byteCount <= SpeechLimits.outstandingBytes)
    }
    public var replayRate: Double { acknowledged ? 5 : 1 }

    public func audio(_ bytes: Data) async throws {
        try Task.checkCancellation()
        guard try writable(for: bytes.count), bytes.count <= 120 * SpeechLimits.bytesPerSecond - sentBytes else {
            throw SpeechFailure(.audioLimit)
        }
        writing = true; sentBytes += bytes.count
        defer { writing = false }
        do { try await socket.send(.binary(bytes)) }
        catch {
            let failure = SpeechFailure(Task.isCancelled ? .cancelled : .disconnected, requestID: requestID)
            await fail(failure); throw failure
        }
        if let terminal { throw terminalFailure(terminal) }
        try Task.checkCancellation()
    }

    public func finish() async throws -> String {
        try Task.checkCancellation()
        guard terminal == nil, initialized, !finishing, !writing else { throw terminalFailure() }
        finishing = true; arm(seconds: 16, failure: .finishTimeout)
        do { try await socket.send(.text("{\"type\":\"finish\"}")) }
        catch {
            // A valid final event can close the socket before the native send
            // completion returns. Its committed result remains authoritative.
            if case let .success(text)? = terminal { try Task.checkCancellation(); return text }
            await fail(.init(Task.isCancelled ? .cancelled : .disconnected, requestID: requestID)); throw terminalFailure()
        }
        let result: String = try await withTaskCancellationHandler {
            if let terminal { return try terminal.get() }
            return try await withCheckedThrowingContinuation { resultWaiter = $0 }
        } onCancel: { Task { await self.cancel() } }
        try Task.checkCancellation(); return result
    }

    public func cancel() async { await fail(.init(.cancelled, requestID: requestID)) }

    private func accept(_ frame: WebSocketFrame) async -> Bool {
        guard terminal == nil else { return false }
        do {
            guard case .text(let text) = frame, text.utf8.count <= SpeechLimits.wireBytes,
                  text.utf16.count <= 32_768 else { throw SpeechFailure(.invalidProtocol) }
            let event = try FrameCodec.decode(text)
            if let id = event["requestId"]?.stringValue,
               id.range(of: "^[a-f0-9-]{36}$", options: .regularExpression) != nil { requestID = id }
            switch event["type"]?.stringValue {
            case "ready":
                guard !initialized, event["maxSeconds"]?.numberValue == 120 else { throw SpeechFailure(.invalidProtocol) }
                initialized = true; acknowledged = event["flowControl"]?.stringValue == "ack.v1"
                arm(seconds: 145, failure: .timeout)
                let continuation = readyWaiter; readyWaiter = nil; continuation?.resume()
            case "ack":
                guard initialized, acknowledged, let count = event["bytes"]?.numberValue, count.isFinite,
                      count.rounded(.down) == count, count >= Double(acknowledgedBytes), count <= Double(sentBytes) else {
                    throw SpeechFailure(.invalidProtocol)
                }
                acknowledgedBytes = Int(count)
            case "transcript":
                guard initialized, let provisional = event["text"]?.stringValue,
                      provisional.utf16.count <= SpeechLimits.resultCharacters else { throw SpeechFailure(.invalidProtocol) }
            case "result":
                guard finishing, let result = event["text"]?.stringValue, result.utf16.count <= SpeechLimits.resultCharacters else {
                    throw SpeechFailure(.invalidProtocol)
                }
                await complete(result.trimmingCharacters(in: .whitespacesAndNewlines)); return false
            case "error":
                let code = SpeechCode(rawValue: event["code"]?.stringValue ?? "") ?? .failed
                throw SpeechFailure(code, requestID: requestID, retryAfterMilliseconds: event["retryAfterMs"]?.numberValue ?? 0)
            default: throw SpeechFailure(.invalidProtocol)
            }
            return true
        } catch { await fail(error as? SpeechFailure ?? .init(.invalidProtocol)); return false }
    }

    private func arm(seconds: Int, failure: SpeechCode) {
        let token = UUID(); deadlineID = token; watchdog?.cancel()
        watchdog = Task { [weak self, clock] in
            do { try await clock.sleep(for: .seconds(seconds)) } catch { return }
            guard !Task.isCancelled, let self else { return }
            await self.expire(token, failure: failure)
        }
    }
    private func expire(_ token: UUID, failure: SpeechCode) async {
        guard token == deadlineID else { return }
        await fail(.init(failure, requestID: requestID))
    }
    private func complete(_ text: String) async {
        guard terminal == nil else { return }
        terminal = .success(text); deadlineID = UUID(); watchdog?.cancel()
        let ready = readyWaiter; readyWaiter = nil
        let result = resultWaiter; resultWaiter = nil
        ready?.resume(throwing: SpeechFailure(.invalidProtocol)); result?.resume(returning: text)
        await socket.close()
    }
    private func fail(_ failure: SpeechFailure) async {
        guard terminal == nil else { return }
        terminal = .failure(failure); deadlineID = UUID(); watchdog?.cancel()
        let ready = readyWaiter; readyWaiter = nil
        let result = resultWaiter; resultWaiter = nil
        ready?.resume(throwing: failure); result?.resume(throwing: failure)
        reader?.cancel()
        await socket.close()
    }
    private func terminalFailure(_ value: Result<String, SpeechFailure>? = nil) -> SpeechFailure {
        if case .failure(let failure)? = value ?? terminal { return failure }
        return .init(.invalidProtocol, requestID: requestID)
    }
    deinit { reader?.cancel(); watchdog?.cancel() }
}
