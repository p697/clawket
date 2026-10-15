import ClawketTransport
import CryptoKit
import Foundation
import Sodium
import XCTest
@testable import ClawketPairing

private actor MockHTTP: PairingHTTPClient {
    private var replies: [PairingHTTPResponse]
    private var requests: [URLRequest] = []
    init(_ replies: [PairingHTTPResponse]) { self.replies = replies }
    func execute(_ request: URLRequest, maximumBytes: Int) async throws -> PairingHTTPResponse {
        requests.append(request)
        guard !replies.isEmpty else { throw PairingError.network }
        return replies.removeFirst()
    }
    func captured() -> [URLRequest] { requests }
}

private struct SocketFactory: WebSocketFactory {
    let socket: MockPairingSocket
    func makeSocket(url: URL) throws -> any WebSocketConnection { socket }
}

private actor MockPairingSocket: WebSocketConnection {
    let vector: PairingVectors
    let suspend: Bool
    private var result: String?
    private var sent: String?
    private var closeCount = 0
    private var isClosed = false
    private var pending: CheckedContinuation<WebSocketFrame, any Error>?
    private var startedWaiters: [CheckedContinuation<Void, Never>] = []
    init(vector: PairingVectors, suspend: Bool = false) { self.vector = vector; self.suspend = suspend }
    func open() {}
    func send(_ text: String) throws {
        sent = text
        let frame = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(text.dropFirst("__clawket_relay_control__:".count).utf8)) as? [String: Any])
        let payload = try XCTUnwrap(frame["payload"] as? [String: Any])
        let request = try XCTUnwrap(frame["requestId"] as? String), client = try XCTUnwrap(payload["clientPublicKey"] as? String)
        let nonce = try PairingCryptography.decodeBase64URL(vector.secure.nonce, count: 24)
        let senderSecret = try PairingCryptography.decodeHex(vector.secure.bridgeSecret)
        let cipher = try XCTUnwrap(Sodium().box.seal(message: Array(vector.plaintext.utf8),
            recipientPublicKey: Array(PairingCryptography.decodeBase64URL(client, count: 32)), senderSecretKey: Array(senderSecret), nonce: Array(nonce)))
        let ciphertext = PairingCryptography.encodeBase64URL(Data(cipher))
        let proof = PairingCryptography.proof("clawket-pair-v2:result:\(vector.secure.sessionID):\(request):\(client):\(vector.secure.bridgePublic):\(vector.secure.nonce):\(ciphertext)", codeKey: PairingCryptography.codeKey(vector.secure.code))
        let response: [String: Any] = ["event": "pairing.secure.result", "requestId": request, "payload": ["protocol": 2,
            "sessionId": vector.secure.sessionID, "bridgePublicKey": vector.secure.bridgePublic, "nonce": vector.secure.nonce, "ciphertext": ciphertext, "bridgeProof": proof]]
        result = "__clawket_relay_control__:" + String(decoding: try JSONSerialization.data(withJSONObject: response), as: UTF8.self)
    }
    func receive() async throws -> WebSocketFrame {
        if isClosed { throw CancellationError() }
        if !suspend { return .text(try XCTUnwrap(result)) }
        startedWaiters.forEach { $0.resume() }; startedWaiters = []
        return try await withCheckedThrowingContinuation { pending = $0 }
    }
    func waitForReceive() async {
        if pending != nil { return }
        await withCheckedContinuation { startedWaiters.append($0) }
    }
    func close(code: Int) {
        closeCount += 1
        isClosed = true
        pending?.resume(throwing: CancellationError()); pending = nil
    }
    func captured() -> (String?, Int) { (sent, closeCount) }
}

private func response(_ object: [String: Any], status: Int = 200) throws -> PairingHTTPResponse {
    PairingHTTPResponse(status: status, body: try JSONSerialization.data(withJSONObject: object))
}

final class PairingServiceTests: XCTestCase, @unchecked Sendable {
    private let expectation = PairingExpectation(backend: .codex)
    private func claim() throws -> PairingHTTPResponse {
        try response(["gatewayId": "synthetic-gateway", "relayUrl": "wss://codex-relay.clawket.ai/ws", "clientToken": "synthetic-client", "displayName": "Test"])
    }
    private func resolve(_ vector: PairingVectors) throws -> PairingHTTPResponse {
        try response(["protocol": 2, "sessionId": vector.secure.sessionID, "gatewayId": "synthetic-gateway", "relayUrl": "wss://codex-relay.clawket.ai/ws",
            "relayTicket": "synthetic-ticket", "expiresAt": "2099-01-01T00:00:00.000Z", "displayName": NSNull()])
    }

    func testSixDigitSecureResolveExchangeAndSingleClaim() async throws {
        let vector = try PairingVectors.load(), http = try MockHTTP([resolve(PairingVectors.load()), claim()])
        let socket = MockPairingSocket(vector: vector)
        let service = PairingService(http: http, sockets: SocketFactory(socket: socket))
        let result = try await service.pairCode(vector.secure.code, expectation: expectation)
        XCTAssertEqual(result.backend, .codex); XCTAssertEqual(result.relay?.clientToken, "synthetic-client")
        XCTAssertNil(result.relay?.accessCode)
        let calls = await http.captured()
        XCTAssertEqual(calls.map { $0.url?.path }, ["/v2/pair/session/resolve", "/v1/pair/claim"])
        let resolveBody = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(calls[0].httpBody)) as? [String: String])
        XCTAssertEqual(resolveBody, ["codeHash": vector.secure.codeHash])
        let (_, closes) = await socket.captured(); XCTAssertEqual(closes, 1)
    }

    func testLegacyCodeAndLinkDecryptToSameClaim() async throws {
        let vector = try PairingVectors.load()
        for useLink in [false, true] {
            let encrypted = ["nonce": vector.secretBox.nonce, "ciphertext": useLink ? vector.secretBox.linkCiphertext : vector.secretBox.ciphertext]
            let http = try MockHTTP([response(["sessionId": vector.secure.sessionID, "expiresAt": "2099-01-01T00:00:00Z", "displayName": NSNull(), "encryptedPayload": encrypted]), claim()])
            let service = PairingService(http: http)
            let payload: PairingPayload
            if useLink { payload = try await service.pairLink("https://codex-registry.clawket.ai/pair/\(vector.secure.sessionID)#k=\(vector.secretBox.linkKey)", expectation: expectation) }
            else { payload = try await service.pairCode(vector.secretBox.code, expectation: expectation) }
            XCTAssertEqual(payload.relay?.gatewayID, "synthetic-gateway")
            let calls = await http.captured(); XCTAssertEqual(calls.count, 2)
            if useLink {
                XCTAssertNil(calls[0].httpBody)
                XCTAssertNil(calls[0].url?.fragment)
                XCTAssertFalse(calls[0].url!.absoluteString.contains(vector.secretBox.linkKey))
            }
        }
    }

    func testAllQRClaimsKeepBackendAndHermesUsesOwnEndpoint() async throws {
        for backend in PairingBackend.allCases {
            let hermes = backend == .hermes
            let server = OfficialPairingServices.registry(backend: backend)
            let raw: String
            if hermes { raw = "{\"kind\":\"clawket_hermes_pair\",\"version\":1,\"server\":\"\(server)\",\"bridgeId\":\"b\",\"accessCode\":\"a\"}" }
            else { raw = "{\"k\":\"cp\",\"v\":2,\"b\":\"\(backend.rawValue)\",\"s\":\"\(server)\",\"g\":\"synthetic-gateway\",\"a\":\"synthetic-code\"}" }
            let relayHost = OfficialPairingServices.services.first { $0.backend == backend && (backend == .localModel || $0.environment == .production) }!.relayHost
            let http = try MockHTTP([response([hermes ? "bridgeId" : "gatewayId": hermes ? "b" : "synthetic-gateway", "relayUrl": "wss://\(relayHost)/ws", "clientToken": "synthetic-token"] )])
            let result = try await PairingService(http: http).pairQR(raw, expectation: PairingExpectation(backend: backend))
            XCTAssertEqual(result.backend, backend)
            let calls = await http.captured()
            XCTAssertEqual(calls[0].url?.path, hermes ? "/v1/hermes/pair/claim" : "/v1/pair/claim")
        }
    }

    func testPiCodeEntryKeepsProductionEvenWithPreviewSelected() async throws {
        let http = try MockHTTP([response([:], status: 404)])
        do { _ = try await PairingService(http: http).pairCode("314159", expectation: PairingExpectation(backend: .pi, environment: .preview, debugMode: true)); XCTFail("Fixture rejects") }
        catch { XCTAssertEqual(error as? PairingError, .expired) }
        let requests = await http.captured()
        XCTAssertEqual(requests.first?.url?.host, "pi-registry.clawket.ai")
    }

    func testInvalidExpectedBackendNeverClaims() async throws {
        let http = MockHTTP([]), service = PairingService(http: http)
        do { _ = try await service.pairQR(PairingVectors.load().plaintext, expectation: PairingExpectation(backend: .hermes)); XCTFail("Must reject") }
        catch { XCTAssertEqual(error as? PairingError, .backendMismatch) }
        let calls = await http.captured(); XCTAssertEqual(calls.count, 0)
    }

    func testHTTPFailuresMalformedOversizedAndExpiredNeverRetry() async throws {
        let vector = try PairingVectors.load()
        let replies: [(PairingHTTPResponse, PairingError)] = [
            (try response(["error": ["code": "ACCESS_CODE_REQUIRED"]], status: 409), .alreadyUsed),
            (try response([:], status: 429), .rateLimited), (try response([:], status: 401), .unauthorized),
            (try response([:], status: 404), .expired), (PairingHTTPResponse(status: 200, body: Data("[]".utf8)), .invalidResponse),
            (PairingHTTPResponse(status: 200, body: Data(repeating: 32, count: PairingLimits.responseBytes + 1)), .responseTooLarge),
            (try response(["sessionId": vector.secure.sessionID, "expiresAt": "2000-01-01T00:00:00Z", "encryptedPayload": [:]]), .expired),
        ]
        for (reply, expected) in replies {
            let http = MockHTTP([reply]), service = PairingService(http: http)
            do { _ = try await service.pairCode(vector.secretBox.code, expectation: expectation); XCTFail("Must reject") }
            catch { XCTAssertEqual(error as? PairingError, expected) }
            let calls = await http.captured(); XCTAssertEqual(calls.count, 1)
        }
    }

    func testCancellationClosesRestrictedSocketAndNeverClaims() async throws {
        let vector = try PairingVectors.load(), http = try MockHTTP([resolve(PairingVectors.load())])
        let socket = MockPairingSocket(vector: vector, suspend: true)
        let service = PairingService(http: http, sockets: SocketFactory(socket: socket))
        let task = Task { try await service.pairCode(vector.secure.code, expectation: self.expectation) }
        await socket.waitForReceive()
        do { _ = try await service.pairCode(vector.secure.code, expectation: expectation); XCTFail("Must reject overlapping claim") }
        catch { XCTAssertEqual(error as? PairingError, .busy) }
        task.cancel()
        do { _ = try await task.value; XCTFail("Must cancel") } catch { XCTAssertTrue(error is CancellationError) }
        let calls = await http.captured(); XCTAssertEqual(calls.count, 1)
        let (_, closes) = await socket.captured(); XCTAssertGreaterThanOrEqual(closes, 1)
    }

    func testDeadlineCancelsWaitingSocketWithoutRealSleep() async throws {
        let socket = MockPairingSocket(vector: try PairingVectors.load(), suspend: true)
        do {
            _ = try await pairingDeadline(seconds: 0, onTimeout: { await socket.close(code: 1000) }) {
                try await socket.receive()
            }
            XCTFail("Must time out")
        } catch { XCTAssertEqual(error as? PairingError, .timeout) }
    }
}
