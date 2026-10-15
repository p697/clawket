import Foundation
import Network
import Testing
@testable import ClawketRuntime

private final class StartHTTP: @unchecked Sendable {
    let lock = NSLock()
    var continuation: CheckedContinuation<URL, any Error>?
    init(_ value: CheckedContinuation<URL, any Error>) { continuation = value }
    func finish(_ result: Result<URL, any Error>) {
        lock.lock(); let value = continuation; continuation = nil; lock.unlock(); value?.resume(with: result)
    }
}

private final class LocalHTTP: @unchecked Sendable {
    private let queue = DispatchQueue(label: "clawket.artifact-http-test")
    private let listener: NWListener
    private let reply: Data
    private var connections: [NWConnection] = [] // Queue-owned.
    private let lock = NSLock()
    private var received = 0
    private var credentials = false
    var count: Int { lock.lock(); defer { lock.unlock() }; return received }
    var receivedCredentials: Bool { lock.lock(); defer { lock.unlock() }; return credentials }
    init(_ response: String) throws {
        reply = Data(response.utf8)
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
        listener = try NWListener(using: parameters)
    }
    func start() async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let completion = StartHTTP(continuation)
            listener.stateUpdateHandler = { [weak self] state in
                switch state {
                case .ready:
                    guard let port = self?.listener.port, let url = URL(string: "http://127.0.0.1:\(port.rawValue)/ticket") else { completion.finish(.failure(RuntimeFailure(.network))); return }
                    completion.finish(.success(url))
                case .failed, .cancelled: completion.finish(.failure(RuntimeFailure(.network)))
                default: break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in
                guard let self else { connection.cancel(); return }
                connections.append(connection); connection.start(queue: queue); receive(connection, buffer: Data())
            }
            listener.start(queue: queue)
        }
    }
    func stop() { listener.cancel(); queue.async { [self] in for connection in connections { connection.cancel() }; connections.removeAll() } }
    private func receive(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 4_096) { [weak self] data, _, done, error in
            guard let self, let data, error == nil, buffer.count + data.count <= 16_384 else { connection.cancel(); return }
            let bytes = buffer + data
            guard let text = String(data: bytes, encoding: .utf8), text.contains("\r\n\r\n") else {
                if done { connection.cancel() } else { receive(connection, buffer: bytes) }; return
            }
            record(text)
            connection.send(content: reply, isComplete: true, completion: .contentProcessed { _ in connection.cancel() })
        }
    }
    private func record(_ header: String) {
        lock.lock(); received += 1
        credentials = credentials || header.lowercased().contains("\r\nauthorization:") || header.lowercased().contains("\r\ncookie:")
        lock.unlock()
    }
}

@Suite(.serialized)
struct RealArtifactHTTPTests {
    @Test func actualURLSessionUsesNoCredentialsAndRejectsUnknownLengthOverflow() async throws {
        let good = try LocalHTTP("HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\nabc")
        let url = try await good.start(); defer { good.stop() }
        #expect(try await URLSessionArtifactHTTPClient().download(url, timeout: .seconds(3)) == Data("abc".utf8))
        #expect(good.count == 1); #expect(!good.receivedCredentials)
        let overflow = try LocalHTTP("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n21\r\n" + String(repeating: "x", count: 33) + "\r\n0\r\n\r\n")
        let largeURL = try await overflow.start(); defer { overflow.stop() }
        let request: URLRequest = { var value = URLRequest(url: largeURL); value.timeoutInterval = 3; return value }()
        await #expect(throws: RuntimeFailure(.capacity)) { try await URLSessionArtifactHTTPClient().execute(request, maximumBytes: 32) }
    }

    @Test func actualURLSessionNeverFollowsTicketRedirects() async throws {
        let destination = try LocalHTTP("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        let target = try await destination.start(); defer { destination.stop() }
        let source = try LocalHTTP("HTTP/1.1 302 Found\r\nLocation: \(target.absoluteString)\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        let url = try await source.start(); defer { source.stop() }
        await #expect(throws: RuntimeFailure(.invalidResponse)) { try await URLSessionArtifactHTTPClient().download(url, timeout: .seconds(3)) }
        #expect(source.count == 1); #expect(destination.count == 0)
    }
}
