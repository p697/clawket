import Foundation

public struct PairingHTTPResponse: Sendable {
    public let status: Int
    public let body: Data
    public init(status: Int, body: Data) { self.status = status; self.body = body }
}

public protocol PairingHTTPClient: Sendable {
    /// Implementations must honor cancellation and bound the complete response body.
    func execute(_ request: URLRequest, maximumBytes: Int) async throws -> PairingHTTPResponse
}

/// URLSession callbacks and caller cancellation share one locked, exactly-once completion.
final class BoundedPairingResponse: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private let maximumBytes: Int
    private var status: Int?
    private var body = Data()
    private var result: Result<PairingHTTPResponse, any Error>?
    private var continuation: CheckedContinuation<PairingHTTPResponse, any Error>?

    init(maximumBytes: Int) { self.maximumBytes = maximumBytes }

    func register(_ continuation: CheckedContinuation<PairingHTTPResponse, any Error>) -> Bool {
        lock.lock()
        if let result {
            lock.unlock()
            continuation.resume(with: result)
            return false
        }
        self.continuation = continuation
        lock.unlock()
        return true
    }

    func finish(_ result: Result<PairingHTTPResponse, any Error>) {
        lock.lock()
        guard self.result == nil else { lock.unlock(); return }
        self.result = result
        body = Data()
        let continuation = continuation
        self.continuation = nil
        lock.unlock()
        continuation?.resume(with: result)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping @Sendable (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse else {
            finish(.failure(PairingError.invalidResponse)); completionHandler(.cancel); return
        }
        guard response.expectedContentLength <= Int64(maximumBytes) else {
            finish(.failure(PairingError.responseTooLarge)); completionHandler(.cancel); return
        }
        lock.lock()
        let active = result == nil
        if active { status = http.statusCode }
        lock.unlock()
        completionHandler(active ? .allow : .cancel)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        guard result == nil else { lock.unlock(); return }
        guard data.count <= maximumBytes - body.count else {
            lock.unlock()
            finish(.failure(PairingError.responseTooLarge)); dataTask.cancel(); return
        }
        body.append(data)
        lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) {
        if let error {
            let failure: any Error
            if (error as? URLError)?.code == .cancelled { failure = CancellationError() }
            else if (error as? URLError)?.code == .timedOut { failure = PairingError.timeout }
            else { failure = PairingError.network }
            finish(.failure(failure)); return
        }
        lock.lock()
        let response = status.map { PairingHTTPResponse(status: $0, body: body) }
        lock.unlock()
        if let response { finish(.success(response)) }
        else { finish(.failure(PairingError.invalidResponse)) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// Per-request ephemeral session: no cookies/credentials/cache/redirects; bound headers and every data callback.
public final class URLSessionPairingHTTPClient: PairingHTTPClient {
    private let configuration: URLSessionConfiguration
    public convenience init() { self.init(configuration: .ephemeral) }

    init(configuration: URLSessionConfiguration) {
        let copy = configuration.copy() as! URLSessionConfiguration
        copy.httpCookieStorage = nil
        copy.urlCredentialStorage = nil
        copy.httpShouldSetCookies = false
        copy.urlCache = nil
        copy.requestCachePolicy = .reloadIgnoringLocalCacheData
        copy.timeoutIntervalForRequest = PairingLimits.requestSeconds
        copy.timeoutIntervalForResource = PairingLimits.requestSeconds
        self.configuration = copy
    }

    public func execute(_ request: URLRequest, maximumBytes: Int) async throws -> PairingHTTPResponse {
        guard maximumBytes > 0, maximumBytes <= PairingLimits.responseBytes else { throw PairingError.responseTooLarge }
        let response = BoundedPairingResponse(maximumBytes: maximumBytes)
        let session = URLSession(configuration: configuration, delegate: response, delegateQueue: nil)
        let task = session.dataTask(with: request)
        defer { session.invalidateAndCancel() }
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await pairingDeadline(seconds: PairingLimits.requestSeconds, onTimeout: {
                response.finish(.failure(PairingError.timeout)); task.cancel()
            }) {
                try Task.checkCancellation()
                return try await withCheckedThrowingContinuation { continuation in
                    if response.register(continuation) { task.resume() }
                }
            }
        } onCancel: {
            response.finish(.failure(CancellationError())); task.cancel()
        }
    }
}

func pairingDeadline<T: Sendable>(seconds: TimeInterval, onTimeout: @escaping @Sendable () async -> Void = {}, operation: @escaping @Sendable () async throws -> T) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask { try await operation() }
        group.addTask {
            try await Task.sleep(for: .seconds(seconds))
            throw PairingError.timeout
        }
        defer { group.cancelAll() }
        do {
            guard let result = try await group.next() else { throw CancellationError() }
            return result
        } catch {
            group.cancelAll()
            await onTimeout()
            throw error
        }
    }
}
