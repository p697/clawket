import Foundation

public protocol RuntimeArtifactHTTPClient: Sendable {
    /// Must honor cancellation and cap the complete body at 10 MiB, including
    /// unknown-length responses. URL was authority-validated by the coordinator.
    func download(_ url: URL, timeout: Duration) async throws -> Data
}

struct ArtifactHTTPResponse: Sendable {
    let status: Int
    let body: Data
}

/// URLSession callbacks and caller cancellation share one locked, exactly-once completion.
final class BoundedArtifactResponse: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private let maximumBytes: Int
    private var status: Int?
    private var body = Data()
    private var result: Result<ArtifactHTTPResponse, any Error>?
    private var continuation: CheckedContinuation<ArtifactHTTPResponse, any Error>?

    init(maximumBytes: Int) { self.maximumBytes = maximumBytes }

    func register(_ continuation: CheckedContinuation<ArtifactHTTPResponse, any Error>) -> Bool {
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

    func finish(_ result: Result<ArtifactHTTPResponse, any Error>) {
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
            finish(.failure(RuntimeFailure(.invalidResponse))); completionHandler(.cancel); return
        }
        guard (200...299).contains(http.statusCode) else {
            finish(.failure(RuntimeFailure(.invalidResponse))); completionHandler(.cancel); return
        }
        guard response.expectedContentLength <= Int64(maximumBytes) else {
            finish(.failure(RuntimeFailure(.capacity))); completionHandler(.cancel); return
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
            finish(.failure(RuntimeFailure(.capacity))); dataTask.cancel(); return
        }
        body.append(data)
        lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) {
        if let error {
            let failure: any Error
            if (error as? URLError)?.code == .cancelled { failure = CancellationError() }
            else if (error as? URLError)?.code == .timedOut { failure = RuntimeFailure(.timeout) }
            else { failure = RuntimeFailure(.network) }
            finish(.failure(failure)); return
        }
        lock.lock()
        let response = status.map { ArtifactHTTPResponse(status: $0, body: body) }
        lock.unlock()
        if let response { finish(.success(response)) }
        else { finish(.failure(RuntimeFailure(.invalidResponse))) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping @Sendable (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        completionHandler(challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust ? .performDefaultHandling : .cancelAuthenticationChallenge, nil)
    }
}

/// Ephemeral unauthenticated ticket GET: no cookies, owner credentials, cache or redirects; bound every data callback.
public final class URLSessionArtifactHTTPClient: RuntimeArtifactHTTPClient {
    private let configuration: URLSessionConfiguration
    public convenience init() { self.init(configuration: .ephemeral) }

    init(configuration: URLSessionConfiguration) {
        let copy = configuration.copy() as! URLSessionConfiguration
        copy.httpCookieStorage = nil
        copy.urlCredentialStorage = nil
        copy.httpShouldSetCookies = false
        copy.urlCache = nil
        copy.requestCachePolicy = .reloadIgnoringLocalCacheData
        copy.timeoutIntervalForRequest = 45
        copy.timeoutIntervalForResource = 45
        self.configuration = copy
    }

    public func download(_ url: URL, timeout: Duration) async throws -> Data {
        guard timeout > .zero, timeout <= .seconds(45), ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
              url.host != nil, url.user == nil, url.password == nil, url.fragment == nil else { throw RuntimeFailure(.invalidConnection) }
        var request = URLRequest(url: url)
        request.timeoutInterval = Double(timeout.components.seconds) + Double(timeout.components.attoseconds) / 1e18
        let response = try await execute(request, maximumBytes: 10 * 1_024 * 1_024)
        guard (200...299).contains(response.status) else { throw RuntimeFailure(.invalidResponse) }
        return response.body
    }

    func execute(_ request: URLRequest, maximumBytes: Int) async throws -> ArtifactHTTPResponse {
        guard maximumBytes > 0, maximumBytes <= 10 * 1_024 * 1_024 else { throw RuntimeFailure(.capacity) }
        let response = BoundedArtifactResponse(maximumBytes: maximumBytes)
        let session = URLSession(configuration: configuration, delegate: response, delegateQueue: nil)
        let task = session.dataTask(with: request)
        defer { session.invalidateAndCancel() }
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await artifactDeadline(timeout: .seconds(request.timeoutInterval), onTimeout: {
                response.finish(.failure(RuntimeFailure(.timeout))); task.cancel()
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

func artifactDeadline<T: Sendable>(timeout: Duration, onTimeout: @escaping @Sendable () async -> Void,
                                 operation: @escaping @Sendable () async throws -> T) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask { try await operation() }
        group.addTask { try await Task.sleep(for: timeout); throw RuntimeFailure(.timeout) }
        defer { group.cancelAll() }
        do { guard let result = try await group.next() else { throw CancellationError() }; return result }
        catch { group.cancelAll(); await onTimeout(); throw error }
    }
}
