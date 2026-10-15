import Foundation
import ClawketPairing
import ClawketTransport

struct BackendProfile: Sendable {
    enum Handshake: Sendable { case challenge, hermesHealth, bridgeHealth }
    let handshake: Handshake
    let updateEvent: String?
    let modelsPerSession: Bool
    let cursorHistory: Bool

    static func profile(for backend: BackendKind) -> BackendProfile {
        switch backend {
        case .openclaw: return .init(handshake: .challenge, updateEvent: nil, modelsPerSession: true, cursorHistory: false)
        case .hermes: return .init(handshake: .hermesHealth, updateEvent: nil, modelsPerSession: false, cursorHistory: false)
        case .codex: return .init(handshake: .bridgeHealth, updateEvent: "codex.update", modelsPerSession: true, cursorHistory: true)
        case .claudeCode: return .init(handshake: .bridgeHealth, updateEvent: "claude-code.update", modelsPerSession: true, cursorHistory: true)
        case .pi: return .init(handshake: .bridgeHealth, updateEvent: "pi.update", modelsPerSession: true, cursorHistory: true)
        case .localModel: return .init(handshake: .bridgeHealth, updateEvent: "local-model.update", modelsPerSession: false, cursorHistory: true)
        }
    }

    static func endpoint(_ connection: BackendConnection, deviceID: String) throws -> URL {
        guard !connection.id.isEmpty, connection.id.utf8.count <= 256,
              let scheme = connection.url.scheme?.lowercased(),
              ["ws", "wss", "http", "https"].contains(scheme),
              var parts = URLComponents(url: connection.url, resolvingAgainstBaseURL: false),
              parts.host?.isEmpty == false, parts.user == nil, parts.password == nil, parts.fragment == nil,
              connection.url.absoluteString.utf8.count <= 16_384 else { throw RuntimeFailure(.invalidConnection) }
        parts.scheme = scheme == "http" ? "ws" : scheme == "https" ? "wss" : scheme
        if connection.transportKind == .relay {
            guard let relay = connection.relay, !relay.gatewayID.isEmpty, relay.gatewayID.utf8.count <= 256,
                  let token = relay.clientToken, !token.isEmpty, token.utf8.count <= 16_384 else {
                throw RuntimeFailure(.invalidConnection)
            }
            if parts.path.isEmpty || parts.path == "/" { parts.path = "/ws" }
            let names = Set(["gatewayId", "bridgeId", "role", "clientId", "token", "capabilities"])
            var query = (parts.queryItems ?? []).filter { !names.contains($0.name) }
            query += [URLQueryItem(name: connection.backendKind == .hermes ? "bridgeId" : "gatewayId", value: relay.gatewayID),
                      URLQueryItem(name: "role", value: "client"),
                      URLQueryItem(name: "clientId", value: connection.backendKind == .openclaw ? deviceID : connection.id),
                      URLQueryItem(name: "token", value: token),
                      URLQueryItem(name: "capabilities", value: RelayHeartbeatConfiguration.advertisedCapabilities.joined(separator: ","))]
            parts.queryItems = query
        } else if connection.backendKind == .hermes, let token = connection.auth?.token, !token.isEmpty {
            guard token.utf8.count <= 16_384 else { throw RuntimeFailure(.invalidConnection) }
            // Hermes authenticates the Upgrade, before its health RPC can run. Keep the
            // credential separate in storage; only the ephemeral socket URL carries it.
            var query = (parts.queryItems ?? []).filter { $0.name != "token" }
            query.append(URLQueryItem(name: "token", value: token))
            parts.queryItems = query
            // URLSearchParams treats a literal '+' as a space; URLComponents does not.
            parts.percentEncodedQuery = parts.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        }
        guard let url = parts.url else { throw RuntimeFailure(.invalidConnection) }
        return url
    }
}

extension JSONValue {
    var object: [String: JSONValue]? { if case .object(let value) = self { value } else { nil } }
    var array: [JSONValue]? { if case .array(let value) = self { value } else { nil } }
    var nonemptyString: String? {
        guard let value = stringValue?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        return value
    }
    var safeInteger: Int64? {
        guard let number = numberValue, number.isFinite, number >= 0, number <= 9_007_199_254_740_991,
              number.rounded(.towardZero) == number else { return nil }
        return Int64(number)
    }
    var strings: [String] { Array(Set((array ?? []).compactMap(\.nonemptyString))).sorted() }
}

func protocolText(_ value: JSONValue?) -> String {
    guard let value else { return "" }
    if let text = value.stringValue { return text }
    if let values = value.array {
        return values.compactMap { block in
            guard ["text", "content", "output_text", "input_text"].contains(block["type"]?.stringValue ?? "") else { return nil }
            return block["artifactDisplayText"]?.stringValue ?? block["text"]?.stringValue
        }.joined()
    }
    return ""
}

func timestamp(_ value: JSONValue?) -> Int64? {
    if let number = value?.numberValue, number.isFinite, number >= 0, number <= 9_007_199_254_740_991 { return Int64(number) }
    if let text = value?.stringValue {
        if let number = Double(text), number.isFinite, number >= 0, number <= 9_007_199_254_740_991 { return Int64(number) }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: text) ?? ISO8601DateFormatter().date(from: text) { return Int64(date.timeIntervalSince1970 * 1_000) }
    }
    return nil
}

func runtimeFailure(_ error: any Error, sending: Bool = false) -> RuntimeFailure {
    if let failure = error as? RuntimeFailure { return failure }
    guard let error = error as? RPCFailure else {
        return RuntimeFailure(.network, delivery: sending ? .uncertain : .notDispatched, retryable: true)
    }
    let delivery: RuntimeFailure.Delivery = switch error.delivery {
    case .notDispatched: .notDispatched
    case .uncertain: .uncertain
    case .responseReceived: .responseReceived
    }
    let code = error.remoteError?["code"]?.stringValue?.uppercased() ?? ""
    if code == "BRIDGE_UNAVAILABLE" { return RuntimeFailure(.network, delivery: delivery, retryable: true) }
    if code == "PAIRING_REQUIRED" || code == "NOT_PAIRED" { return RuntimeFailure(.pairingRequired, delivery: delivery) }
    if ["UNAUTHORIZED", "AUTH_REJECTED", "AUTH_REQUIRED", "INVALID_TOKEN", "TOKEN_REVOKED", "PERMISSION_DENIED",
        "AUTH_TOKEN_MISMATCH", "AUTH_SCOPE_MISMATCH", "DEVICE_AUTH_NONCE_MISMATCH", "DEVICE_AUTH_SIGNATURE_INVALID"].contains(code) {
        return RuntimeFailure(.authenticationRequired, delivery: delivery)
    }
    if sending, code == "CODEX_ERROR", let message = error.remoteError?["message"]?.stringValue,
       ["Codex did not restore the conversation permissions. Select and confirm permissions before sending.",
        "The previous conversation permissions cannot be verified safely. Select and confirm permissions before sending."].contains(message) {
        return RuntimeFailure(.permissionsRequired, delivery: .rejectedBeforeDispatch)
    }
    switch error.code {
    case .timeout: return RuntimeFailure(.timeout, delivery: delivery, retryable: true)
    case .retired, .cancelled: return RuntimeFailure(.superseded, delivery: delivery)
    case .invalidConfiguration, .invalidEndpoint, .invalidRequest: return RuntimeFailure(.invalidConnection, delivery: delivery)
    case .frameTooLarge, .pendingLimit, .eventBufferOverflow: return RuntimeFailure(.capacity, delivery: delivery)
    case .invalidFrame, .remoteRejection: return RuntimeFailure(.invalidResponse, delivery: delivery)
    case .notConnected: return RuntimeFailure(.notConnected, delivery: delivery, retryable: true)
    case .socketFailure, .heartbeatTimeout: return RuntimeFailure(.network, delivery: delivery, retryable: true)
    }
}
