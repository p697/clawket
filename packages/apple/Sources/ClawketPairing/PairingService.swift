import ClawketTransport
import Foundation

/// Resolves an invitation and claims it once. Persistence and activation belong to the connection registry.
/// No method retries a claim or a secure exchange: cancellation/unknown outcomes require a fresh invitation.
public actor PairingService {
    private let http: any PairingHTTPClient
    private let sockets: any WebSocketFactory
    private let now: @Sendable () -> Date
    private var inFlight = false

    public init(http: any PairingHTTPClient = URLSessionPairingHTTPClient(), sockets: any WebSocketFactory = URLSessionWebSocketFactory(),
                now: @escaping @Sendable () -> Date = { Date() }) {
        self.http = http; self.sockets = sockets; self.now = now
    }

    public func pairQR(_ raw: String, expectation: PairingExpectation) async throws -> PairingPayload {
        guard !inFlight else { throw PairingError.busy }
        inFlight = true
        defer { inFlight = false }
        try Task.checkCancellation()
        let payload = try PairingParser.parseQR(raw, now: now())
        try PairingParser.validate(payload, expectation: expectation)
        return try await claim(payload, expectation: expectation)
    }

    public func pairLink(_ raw: String, expectation: PairingExpectation) async throws -> PairingPayload {
        guard !inFlight else { throw PairingError.busy }
        inFlight = true
        defer { inFlight = false }
        guard expectation.backend != .hermes else { throw PairingError.unsupported }
        let link = try PairingParser.parseLink(raw)
        try OfficialPairingServices.validate(link.serverURL, expectation: expectation)
        let body = try await request(server: link.serverURL, path: "v1/pair/session/\(link.sessionID)")
        let plain = try decryptInvitation(body, key: link.secret, expectedSessionID: link.sessionID)
        let payload = try PairingParser.parseQR(plain, now: now())
        try PairingParser.validate(payload, expectation: expectation, sourceServer: link.serverURL)
        return try await claim(payload, expectation: expectation)
    }

    /// Six digits use the negotiated v2 channel; twelve characters keep legacy SecretBox encryption.
    public func pairCode(_ raw: String, expectation: PairingExpectation) async throws -> PairingPayload {
        guard !inFlight else { throw PairingError.busy }
        inFlight = true
        defer { inFlight = false }
        try Task.checkCancellation()
        let code = PairingParser.normalizeCode(raw)
        guard code.range(of: "^(?:[0-9]{6}|[A-Z0-9]{12})$", options: .regularExpression) != nil else { throw PairingError.invalidCode }
        // Pi's default code entry remains Production; explicit Preview QR/links retain environment checks.
        let server = OfficialPairingServices.registry(backend: expectation.backend, environment: expectation.backend == .pi ? .production : expectation.environment)
        try OfficialPairingServices.validate(server, expectation: expectation)
        if expectation.backend == .hermes {
            let body = try await request(server: server, path: "v1/hermes/pair/claim-code", body: ["accessCode": code, "clientLabel": NSNull()])
            return try claimedPayload(body, original: PairingPayload(backend: .hermes, transport: .relay, url: nil), server: server, expectation: expectation)
        }
        let hash = PairingCryptography.codeHash(code)
        let plain: String
        if code.count == 6 {
            let body = try await request(server: server, path: "v2/pair/session/resolve", body: ["codeHash": hash])
            plain = try await exchange(body, code: code, expectation: expectation)
        } else {
            let body = try await request(server: server, path: "v1/pair/session/resolve", body: ["codeHash": hash])
            plain = try decryptInvitation(body, key: PairingCryptography.codeKey(code))
        }
        let payload = try PairingParser.parseQR(plain, now: now())
        try PairingParser.validate(payload, expectation: expectation, sourceServer: server)
        return try await claim(payload, expectation: expectation)
    }

    private func claim(_ payload: PairingPayload, expectation: PairingExpectation) async throws -> PairingPayload {
        try Task.checkCancellation()
        guard let relay = payload.relay else { return payload }
        guard let code = relay.accessCode else {
            guard relay.clientToken != nil else { throw PairingError.invalidPayload }
            return payload
        }
        let hermes = payload.backend == .hermes
        let body = try await request(server: relay.serverURL, path: hermes ? "v1/hermes/pair/claim" : "v1/pair/claim",
            body: [hermes ? "bridgeId" : "gatewayId": relay.gatewayID, "accessCode": code, "clientLabel": NSNull()])
        let result = try claimedPayload(body, original: payload, server: relay.serverURL, expectation: expectation)
        guard result.relay?.gatewayID == relay.gatewayID else { throw PairingError.invalidResponse }
        return result
    }

    private func claimedPayload(_ body: [String: Any], original: PairingPayload, server: URL, expectation: PairingExpectation) throws -> PairingPayload {
        let id = try required(body, original.backend == .hermes ? "bridgeId" : "gatewayId")
        let url = try pairingSocketURL(required(body, "relayUrl"))
        let token = try required(body, "clientToken")
        try OfficialPairingServices.validate(url, expectation: expectation)
        let name = string(body, "displayName") ?? original.displayName
        let relay = PairingRelay(serverURL: server, gatewayID: id, clientToken: token, relayURL: url, displayName: name,
            protocolVersion: original.relay?.protocolVersion, supportsBootstrap: original.relay?.supportsBootstrap)
        let result = PairingPayload(backend: original.backend, transport: .relay, url: url, displayName: name,
            token: original.token, password: original.password, bootstrap: original.bootstrap, relay: relay)
        try PairingParser.validate(result, expectation: expectation, sourceServer: server)
        return result
    }

    private func decryptInvitation(_ body: [String: Any], key: Data, expectedSessionID: String? = nil) throws -> String {
        guard let session = string(body, "sessionId"), expectedSessionID == nil || session == expectedSessionID,
              let encrypted = body["encryptedPayload"] as? [String: Any] else { throw PairingError.invalidResponse }
        try validateExpiry(body)
        return try PairingCryptography.openInvitation(nonce: required(encrypted, "nonce"), ciphertext: required(encrypted, "ciphertext"), key: key)
    }

    private func exchange(_ body: [String: Any], code: String, expectation: PairingExpectation) async throws -> String {
        guard integer(body, "protocol") == 2 else { throw PairingError.invalidResponse }
        try validateExpiry(body)
        let session = try required(body, "sessionId"), gatewayID = try required(body, "gatewayId"), ticket = try required(body, "relayTicket")
        let relay = try pairingSocketURL(required(body, "relayUrl"))
        try OfficialPairingServices.validate(relay, expectation: expectation)
        guard relay.scheme == "wss", var parts = URLComponents(url: relay, resolvingAgainstBaseURL: false) else { throw PairingError.invalidResponse }
        let exchange = try SecurePairingExchange(sessionID: session, normalizedCode: code)
        var query = (parts.queryItems ?? []).filter { !["gatewayId", "role", "clientId", "token", "capabilities"].contains($0.name) }
        query += [URLQueryItem(name: "gatewayId", value: gatewayID), URLQueryItem(name: "role", value: "client"),
            URLQueryItem(name: "clientId", value: "pair-\(exchange.requestID)"), URLQueryItem(name: "token", value: ticket)]
        parts.queryItems = query
        guard let url = parts.url else { throw PairingError.invalidResponse }
        let socket: any WebSocketConnection
        do { socket = try sockets.makeSocket(url: url) } catch { throw PairingError.network }
        do {
            let plain = try await withTaskCancellationHandler {
                try await pairingDeadline(seconds: PairingLimits.secureExchangeSeconds, onTimeout: { await socket.close(code: 1000) }) {
                    try await socket.open()
                    try Task.checkCancellation()
                    try await socket.send(exchange.startFrame())
                    while true {
                        try Task.checkCancellation()
                        switch try await socket.receive() {
                        case .text(let text): if let value = try exchange.receive(text) { return value }
                        case .binary: throw PairingError.invalidResponse
                        }
                    }
                }
            } onCancel: { Task { await socket.close(code: 1000) } }
            await socket.close(code: 1000)
            try Task.checkCancellation()
            return plain
        } catch {
            await socket.close(code: 1000)
            if error is CancellationError { throw CancellationError() }
            if let failure = error as? PairingError { throw failure }
            if error as? WebSocketFailure == .frameTooLarge { throw PairingError.responseTooLarge }
            throw PairingError.network
        }
    }

    private func validateExpiry(_ body: [String: Any]) throws {
        guard let raw = string(body, "expiresAt") else { throw PairingError.invalidResponse }
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
        guard let date else { throw PairingError.invalidResponse }
        guard date > now() else { throw PairingError.expired }
    }

    private func request(server: URL, path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        try Task.checkCancellation()
        guard !path.contains(".."), server.query == nil, server.fragment == nil else { throw PairingError.invalidPayload }
        var request = URLRequest(url: server.appendingPathComponent(path))
        request.timeoutInterval = PairingLimits.requestSeconds
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys, .withoutEscapingSlashes])
        }
        let response: PairingHTTPResponse
        do { response = try await http.execute(request, maximumBytes: PairingLimits.responseBytes) }
        catch is CancellationError { throw CancellationError() }
        catch let error as PairingError { throw error }
        catch { throw PairingError.network }
        try Task.checkCancellation()
        guard response.body.count <= PairingLimits.responseBytes else { throw PairingError.responseTooLarge }
        let object = (try? JSONSerialization.jsonObject(with: response.body)) as? [String: Any]
        guard (200...299).contains(response.status) else {
            let code = (object?["error"] as? [String: Any]).flatMap { string($0, "code") }
            if code == "ACCESS_CODE_REQUIRED" { throw PairingError.alreadyUsed }
            if code == "ACCESS_CODE_EXPIRED" || response.status == 404 || response.status == 410 { throw PairingError.expired }
            if response.status == 429 { throw PairingError.rateLimited }
            if response.status == 401 || response.status == 403 { throw PairingError.unauthorized }
            throw PairingError.rejected
        }
        guard let object else { throw PairingError.invalidResponse }
        return object
    }
}
