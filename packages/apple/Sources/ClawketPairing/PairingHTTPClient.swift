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

private final class NoPairingRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// Ephemeral session, no cookies/cache, no redirects, streaming size enforcement (including chunked bodies).
public final class URLSessionPairingHTTPClient: PairingHTTPClient {
    private let session: URLSession
    public convenience init() { self.init(configuration: .ephemeral) }

    init(configuration: URLSessionConfiguration) {
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = PairingLimits.requestSeconds
        configuration.timeoutIntervalForResource = PairingLimits.requestSeconds
        session = URLSession(configuration: configuration, delegate: NoPairingRedirects(), delegateQueue: nil)
    }

    deinit { session.invalidateAndCancel() }

    public func execute(_ request: URLRequest, maximumBytes: Int) async throws -> PairingHTTPResponse {
        guard maximumBytes > 0, maximumBytes <= PairingLimits.responseBytes else { throw PairingError.responseTooLarge }
        let session = self.session
        do {
            return try await pairingDeadline(seconds: PairingLimits.requestSeconds) {
                let (bytes, response) = try await session.bytes(for: request)
                defer { bytes.task.cancel() }
                guard let http = response as? HTTPURLResponse else { throw PairingError.invalidResponse }
                guard response.expectedContentLength <= Int64(maximumBytes) else { throw PairingError.responseTooLarge }
                return try await withTaskCancellationHandler {
                    var body = Data()
                    for try await byte in bytes {
                        try Task.checkCancellation()
                        guard body.count < maximumBytes else { throw PairingError.responseTooLarge }
                        body.append(byte)
                    }
                    return PairingHTTPResponse(status: http.statusCode, body: body)
                } onCancel: { bytes.task.cancel() }
            }
        } catch is CancellationError { throw CancellationError() }
        catch let error as PairingError { throw error }
        catch let error as URLError where error.code == .cancelled { throw CancellationError() }
        catch let error as URLError where error.code == .timedOut { throw PairingError.timeout }
        catch { throw PairingError.network }
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
