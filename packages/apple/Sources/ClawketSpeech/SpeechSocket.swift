import Foundation
import ClawketTransport

public protocol SpeechSocket: Sendable {
    func open() async throws
    func send(_ frame: WebSocketFrame) async throws
    func receive() async throws -> WebSocketFrame
    func close() async
}
public protocol SpeechSocketFactory: Sendable {
    func makeSocket(request: URLRequest) throws -> any SpeechSocket
}

public struct URLSessionSpeechSocketFactory: SpeechSocketFactory {
    public init() {}
    public func makeSocket(request: URLRequest) throws -> any SpeechSocket {
        guard let url = request.url, request.httpBody == nil, request.httpBodyStream == nil,
              request.httpMethod == nil || request.httpMethod == "GET" else { throw SpeechFailure(.configuration) }
        let configuration = try SpeechServiceConfiguration(url.absoluteString)
        let expected: Set<String> = ["x-speech-protocol", "x-speech-key", "x-speech-time", "x-speech-nonce", "x-speech-signature"]
        let supplied = Set((request.allHTTPHeaderFields ?? [:]).keys.map { $0.lowercased() })
        guard supplied == expected, request.value(forHTTPHeaderField: "x-speech-protocol") == "2",
              SpeechASCII.hex(request.value(forHTTPHeaderField: "x-speech-key") ?? "", bytes: 64),
              SpeechASCII.digits(request.value(forHTTPHeaderField: "x-speech-time") ?? "", bytes: 13),
              SpeechASCII.hex(request.value(forHTTPHeaderField: "x-speech-nonce") ?? "", bytes: 32),
              SpeechASCII.hex(request.value(forHTTPHeaderField: "x-speech-signature") ?? "", bytes: 128) else {
            throw SpeechFailure(.authentication)
        }
        var safe = request; safe.url = configuration.url; safe.httpMethod = "GET"; safe.timeoutInterval = 20
        return URLSessionSpeechSocket(request: safe)
    }
}

private final class SpeechOpeningDelegate: NSObject, URLSessionWebSocketDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var result: Result<Void, SpeechFailure>?
    private var waiter: CheckedContinuation<Void, any Error>?
    func wait(_ continuation: CheckedContinuation<Void, any Error>) {
        lock.lock()
        if let result { lock.unlock(); continuation.resume(with: result.mapError { $0 as any Error }) }
        else { waiter = continuation; lock.unlock() }
    }
    func complete(_ value: Result<Void, SpeechFailure>) {
        lock.lock()
        guard result == nil else { lock.unlock(); return }
        result = value; let continuation = waiter; waiter = nil; lock.unlock()
        continuation?.resume(with: value.mapError { $0 as any Error })
    }
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) { complete(.success(())) }
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) { complete(.failure(.init(.disconnected))) }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) { complete(.failure(.init(.disconnected))) }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
}

/// This initializer is internal so isolated native-loopback tests can exercise
/// real binary/header I/O. The public factory alone accepts production endpoints.
actor URLSessionSpeechSocket: SpeechSocket {
    private let session: URLSession
    private let task: URLSessionWebSocketTask
    private let delegate: SpeechOpeningDelegate
    private var started = false
    private var closed = false
    init(request: URLRequest) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil; configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil; configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 20
        let delegate = SpeechOpeningDelegate()
        let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
        let task = session.webSocketTask(with: request); task.maximumMessageSize = SpeechLimits.wireBytes
        self.session = session; self.task = task; self.delegate = delegate
    }
    func open() async throws {
        guard !closed, !started, !Task.isCancelled else { throw SpeechFailure(.cancelled) }
        started = true
        do {
            try await withTaskCancellationHandler {
                try await withCheckedThrowingContinuation { continuation in delegate.wait(continuation); task.resume() }
            } onCancel: {
                self.delegate.complete(.failure(.init(.cancelled)))
                self.task.cancel(with: .goingAway, reason: nil)
            }
        } catch { throw SpeechFailure(Task.isCancelled ? .cancelled : .disconnected) }
        guard !closed, !Task.isCancelled else { throw SpeechFailure(.cancelled) }
    }
    func send(_ frame: WebSocketFrame) async throws {
        guard started, !closed, !Task.isCancelled else { throw SpeechFailure(.cancelled) }
        let message: URLSessionWebSocketTask.Message
        switch frame {
        case let .text(text):
            guard text.utf8.count <= 128 else { throw SpeechFailure(.invalidProtocol) }
            message = .string(text)
        case let .binary(bytes):
            guard !bytes.isEmpty, bytes.count.isMultiple(of: 2), bytes.count <= SpeechLimits.chunkBytes else { throw SpeechFailure(.audioLimit) }
            message = .data(bytes)
        }
        do {
            try await withTaskCancellationHandler { try await task.send(message) }
                onCancel: { self.task.cancel(with: .goingAway, reason: nil) }
        } catch { throw SpeechFailure(Task.isCancelled ? .cancelled : .disconnected) }
        guard !closed, !Task.isCancelled else { throw SpeechFailure(.cancelled) }
    }
    func receive() async throws -> WebSocketFrame {
        guard started, !closed, !Task.isCancelled else { throw SpeechFailure(.cancelled) }
        do {
            let value = try await withTaskCancellationHandler { try await task.receive() }
                onCancel: { self.task.cancel(with: .goingAway, reason: nil) }
            guard !closed, !Task.isCancelled else { throw SpeechFailure(.cancelled) }
            switch value {
            case let .string(text):
                guard text.utf8.count <= SpeechLimits.wireBytes else { throw SpeechFailure(.invalidProtocol) }
                return .text(text)
            case .data: throw SpeechFailure(.invalidProtocol) // Worker control events are text only.
            @unknown default: throw SpeechFailure(.invalidProtocol)
            }
        } catch let failure as SpeechFailure { throw failure }
        catch { throw SpeechFailure(Task.isCancelled ? .cancelled : .disconnected) }
    }
    func close() {
        guard !closed else { return }; closed = true
        delegate.complete(.failure(.init(.cancelled)))
        task.cancel(with: .normalClosure, reason: nil); session.invalidateAndCancel()
    }
    deinit {
        delegate.complete(.failure(.init(.cancelled)))
        task.cancel(with: .goingAway, reason: nil); session.invalidateAndCancel()
    }
}
