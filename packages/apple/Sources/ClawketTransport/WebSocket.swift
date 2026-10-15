import Foundation

public enum WebSocketFrame: Sendable, Equatable {
    case text(String)
    case binary(Data)
}

public protocol WebSocketConnection: Sendable {
    func open() async throws
    func send(_ text: String) async throws
    func receive() async throws -> WebSocketFrame
    func close(code: Int) async
}

public protocol WebSocketFactory: Sendable {
    func makeSocket(url: URL) throws -> any WebSocketConnection
}

public enum WebSocketFailure: Error, Sendable, Equatable {
    case invalidEndpoint
    case failed
    case closed
    case frameTooLarge
}

public struct URLSessionWebSocketFactory: WebSocketFactory {
    public init() {}

    public func makeSocket(url: URL) throws -> any WebSocketConnection {
        guard ["ws", "wss"].contains(url.scheme?.lowercased() ?? ""),
              url.host?.isEmpty == false, url.user == nil, url.password == nil, url.fragment == nil else {
            throw WebSocketFailure.invalidEndpoint
        }
        return URLSessionSocket(url: url)
    }
}

/// Delegate completion contains fixed categories only; native errors can contain credential-bearing URLs.
private final class OpeningDelegate: NSObject, URLSessionWebSocketDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var result: Result<Void, WebSocketFailure>?
    private var continuation: CheckedContinuation<Void, any Error>?

    func wait(_ continuation: CheckedContinuation<Void, any Error>) {
        lock.lock()
        if let result {
            lock.unlock()
            continuation.resume(with: result.mapError { $0 as any Error })
        } else {
            self.continuation = continuation
            lock.unlock()
        }
    }

    func finish(_ result: Result<Void, WebSocketFailure>) {
        lock.lock()
        guard self.result == nil else { lock.unlock(); return }
        self.result = result
        let continuation = continuation
        self.continuation = nil
        lock.unlock()
        continuation?.resume(with: result.mapError { $0 as any Error })
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        finish(.success(()))
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        finish(.failure(.closed))
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) {
        finish(.failure(.failed))
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        // The endpoint query may carry authentication. Never forward it to a redirected origin.
        completionHandler(nil)
    }
}

private actor URLSessionSocket: WebSocketConnection {
    private let delegate: OpeningDelegate
    private let session: URLSession
    private let task: URLSessionWebSocketTask
    private var started = false
    private var closed = false

    init(url: URL) {
        let delegate = OpeningDelegate()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 20
        let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
        let task = session.webSocketTask(with: url)
        task.maximumMessageSize = FrameCodec.maximumFrameBytes
        self.delegate = delegate
        self.session = session
        self.task = task
    }

    func open() async throws {
        guard !closed else { throw WebSocketFailure.closed }
        guard !started else { throw WebSocketFailure.failed }
        started = true
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                delegate.wait(continuation)
                task.resume()
            }
        } onCancel: {
            self.task.cancel(with: .goingAway, reason: nil)
            self.delegate.finish(.failure(.closed))
        }
        guard !closed, !Task.isCancelled else { throw WebSocketFailure.closed }
    }

    func send(_ text: String) async throws {
        guard !Task.isCancelled else { throw WebSocketFailure.closed }
        guard started, !closed else { throw WebSocketFailure.closed }
        do { try FrameCodec.validateSize(text) }
        catch { throw WebSocketFailure.frameTooLarge }
        do {
            try await withTaskCancellationHandler {
                try await task.send(.string(text))
            } onCancel: {
                self.task.cancel(with: .goingAway, reason: nil)
            }
        } catch {
            if Task.isCancelled { throw WebSocketFailure.closed }
            throw WebSocketFailure.failed
        }
        guard !closed, !Task.isCancelled else { throw WebSocketFailure.closed }
    }

    func receive() async throws -> WebSocketFrame {
        guard started, !closed else { throw WebSocketFailure.closed }
        let frame: WebSocketFrame
        do {
            let message = try await withTaskCancellationHandler {
                try await task.receive()
            } onCancel: {
                self.task.cancel(with: .goingAway, reason: nil)
            }
            switch message {
            case .string(let text): frame = .text(text)
            case .data(let data): frame = .binary(data)
            @unknown default: throw WebSocketFailure.failed
            }
        } catch {
            if Task.isCancelled { throw WebSocketFailure.closed }
            if task.closeCode == .messageTooBig || (error as? URLError)?.code == .dataLengthExceedsMaximum {
                throw WebSocketFailure.frameTooLarge
            }
            throw WebSocketFailure.failed
        }
        do { _ = try FrameCodec.text(from: frame) }
        catch FrameValidationError.tooLarge { throw WebSocketFailure.frameTooLarge }
        catch { throw WebSocketFailure.failed }
        guard !closed, !Task.isCancelled else { throw WebSocketFailure.closed }
        return frame
    }

    func close(code: Int) {
        guard !closed else { return }
        closed = true
        delegate.finish(.failure(.closed))
        task.cancel(with: URLSessionWebSocketTask.CloseCode(rawValue: code) ?? .normalClosure, reason: nil)
        session.invalidateAndCancel()
    }

    deinit {
        delegate.finish(.failure(.closed))
        task.cancel(with: .goingAway, reason: nil)
        session.invalidateAndCancel()
    }
}
