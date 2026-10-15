import Foundation
import XCTest
@testable import ClawketPairing

/// URLProtocol fixtures exercise real URLSession streaming/cancellation without contacting a server.
private final class HTTPFixtureStore: @unchecked Sendable {
    struct Plan: Sendable { let body: Data; let headers: [String: String]; let hold: Bool }
    private let lock = NSLock()
    private var plans: [String: Plan] = [:]
    private var started = Set<String>()
    private var waiters: [String: CheckedContinuation<Void, Never>] = [:]
    func install(_ plan: Plan) -> URL {
        let key = UUID().uuidString
        lock.lock(); plans[key] = plan; lock.unlock()
        return URL(string: "https://pairing-tests.invalid/\(key)")!
    }
    func take(_ key: String) -> Plan? {
        lock.lock()
        let plan = plans.removeValue(forKey: key)
        lock.unlock()
        return plan
    }
    func markStarted(_ key: String) {
        lock.lock()
        started.insert(key)
        let waiter = waiters.removeValue(forKey: key)
        lock.unlock()
        waiter?.resume()
    }
    func wait(_ key: String, continuation: CheckedContinuation<Void, Never>) {
        lock.lock()
        if started.contains(key) { lock.unlock(); continuation.resume() }
        else { waiters[key] = continuation; lock.unlock() }
    }
    func waitForRequest(_ url: URL) async {
        await withCheckedContinuation { wait(url.lastPathComponent, continuation: $0) }
    }
}

private final class PairingURLProtocol: URLProtocol, @unchecked Sendable {
    static let fixtures = HTTPFixtureStore()
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "pairing-tests.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url, let plan = Self.fixtures.take(url.lastPathComponent),
              let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: plan.headers) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse)); return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        Self.fixtures.markStarted(url.lastPathComponent)
        guard !plan.hold else { return }
        client?.urlProtocol(self, didLoad: plan.body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class PairingHTTPClientTests: XCTestCase, @unchecked Sendable {
    private func client() -> URLSessionPairingHTTPClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PairingURLProtocol.self]
        return URLSessionPairingHTTPClient(configuration: configuration)
    }

    func testStreamingBodyAcceptsExactLimitAndRejectsChunkedOverflow() async throws {
        for length in [32, 33] {
            let url = PairingURLProtocol.fixtures.install(.init(body: Data(repeating: 65, count: length), headers: [:], hold: false))
            let client = client()
            do {
                let result = try await client.execute(URLRequest(url: url), maximumBytes: 32)
                XCTAssertEqual(length, 32); XCTAssertEqual(result.body.count, 32)
            } catch { XCTAssertEqual(length, 33); XCTAssertEqual(error as? PairingError, .responseTooLarge) }
        }
    }

    func testDeclaredOversizedBodyIsRejectedBeforeWaitingForBody() async throws {
        let url = PairingURLProtocol.fixtures.install(.init(body: Data(), headers: ["Content-Length": "1000"], hold: true))
        let client = client()
        do { _ = try await client.execute(URLRequest(url: url), maximumBytes: 32); XCTFail("Must reject") }
        catch { XCTAssertEqual(error as? PairingError, .responseTooLarge) }
    }

    func testCancellationTerminatesAnUnfinishedResponseBody() async throws {
        let url = PairingURLProtocol.fixtures.install(.init(body: Data(), headers: [:], hold: true))
        let client = client()
        let task = Task { try await client.execute(URLRequest(url: url), maximumBytes: 32) }
        await PairingURLProtocol.fixtures.waitForRequest(url)
        task.cancel()
        do { _ = try await task.value; XCTFail("Must cancel") }
        catch { XCTAssertTrue(error is CancellationError) }
    }
}
