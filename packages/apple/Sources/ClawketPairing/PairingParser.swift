import Foundation
import CoreFoundation


public enum PairingParser {
    public static func normalizeCode(_ value: String) -> String {
        value.uppercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
    }

    public static func parseQR(_ value: String, now: Date = Date()) throws -> PairingPayload {
        let data = Data(value.trimmingCharacters(in: .whitespacesAndNewlines).utf8)
        guard !data.isEmpty, data.count <= PairingLimits.qrBytes else { throw PairingError.invalidPayload }
        if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            return try parseObject(object, now: now)
        }
        guard let parts = URLComponents(string: value), parts.scheme?.lowercased() == "openclaw", parts.host == "connect" else { throw PairingError.invalidPayload }
        var object: [String: Any] = [:]
        for item in parts.queryItems ?? [] {
            guard object[item.name] == nil else { throw PairingError.invalidPayload }
            object[item.name] = item.value
        }
        if object["tls"] as? String == "1" { object["tls"] = true }
        if let port = object["port"] as? String { guard let number = Int(port) else { throw PairingError.invalidPayload }; object["port"] = number }
        if let server = object["serverUrl"], let gateway = object["gatewayId"] {
            var relay: [String: Any] = ["serverUrl": server, "gatewayId": gateway]
            if let version = object["relayProtocolVersion"] as? String { relay["protocolVersion"] = Int(version) }
            if let flag = object["relaySupportsBootstrap"] as? String, ["1", "0", "true", "false"].contains(flag) { relay["supportsBootstrap"] = flag == "1" || flag == "true" }
            object["relay"] = relay
        }
        if let bridge = object["bridgeUrl"] as? String { object["hermes"] = ["bridgeUrl": bridge, "displayName": string(object, "displayName") ?? ""] }
        return try parseObject(object, now: now)
    }

    public static func parseLink(_ value: String) throws -> PairingLink {
        guard value.utf8.count <= PairingLimits.qrBytes, let parts = URLComponents(string: value) else { throw PairingError.invalidLink }
        func query(_ name: String, from items: [URLQueryItem]?) throws -> String {
            let matches = (items ?? []).filter { $0.name == name }
            guard matches.count == 1, let value = matches[0].value else { throw PairingError.invalidLink }
            return value
        }
        let server: URL, session: String, secret: String
        if parts.scheme?.lowercased() == "clawket", parts.host == "pair" {
            let rawServer = try query("server", from: parts.queryItems)
            guard URLComponents(string: rawServer)?.scheme?.lowercased() == "https" else { throw PairingError.invalidLink }
            let base = try pairingHTTPBase(rawServer)
            guard var origin = URLComponents(url: base, resolvingAgainstBaseURL: false) else { throw PairingError.invalidLink }
            origin.path = ""
            guard let url = origin.url else { throw PairingError.invalidLink }
            server = url
            session = try query("session", from: parts.queryItems)
            secret = try query("key", from: parts.queryItems)
        } else {
            guard parts.scheme?.lowercased() == "https", let url = parts.url, OfficialPairingServices.service(for: url) != nil,
                  parts.query == nil else { throw PairingError.invalidLink }
            let path = parts.path.split(separator: "/")
            guard path.count == 2, path[0] == "pair" else { throw PairingError.invalidLink }
            server = try pairingHTTPBase("https://\(parts.host ?? "")")
            session = String(path[1])
            let fragment = URLComponents(string: "https://fragment.invalid/?\(parts.percentEncodedFragment ?? "")")
            secret = try query("k", from: fragment?.queryItems)
        }
        guard OfficialPairingServices.service(for: server) != nil else { throw PairingError.untrustedServer }
        guard server.scheme == "https",
              session.range(of: "^ps_[A-Za-z0-9_-]+$", options: .regularExpression) != nil,
              session.utf8.count <= 256 else { throw PairingError.invalidLink }
        return PairingLink(serverURL: server, sessionID: session, secret: try PairingCryptography.decodeBase64URL(secret, count: 32))
    }

    public static func validate(_ payload: PairingPayload, expectation: PairingExpectation, sourceServer: URL? = nil) throws {
        guard payload.backend == expectation.backend else { throw PairingError.backendMismatch }
        for url in [sourceServer, payload.relay?.serverURL].compactMap({ $0 }) { try OfficialPairingServices.validate(url, expectation: expectation) }
    }

    private static func parseObject(_ object: [String: Any], now: Date) throws -> PairingPayload {
        if let expires = object["expiresAt"] as? NSNumber, expires.doubleValue < now.timeIntervalSince1970 * 1_000 { throw PairingError.expired }
        let compact = string(object, "k") == "cp" && integer(object, "v") == 2
        let legacy = string(object, "kind") == "clawket_pair" && integer(object, "version") == 1
        let hermesLocal = string(object, "kind") == "clawket_hermes_local" && integer(object, "version") == 1
        let hermesRelay = string(object, "kind") == "clawket_hermes_pair" && integer(object, "version") == 1
        if compact || legacy || hermesRelay {
            let server = try pairingHTTPBase(try required(object, compact ? "s" : "server"))
            let id = try required(object, compact ? "g" : hermesRelay ? "bridgeId" : "gatewayId")
            let code = try required(object, compact ? "a" : "accessCode")
            let backend: PairingBackend
            if hermesRelay { backend = .hermes }
            else if let hint = string(object, "b") { guard let parsed = PairingBackend(rawValue: hint), parsed != .hermes else { throw PairingError.invalidPayload }; backend = parsed }
            else { backend = .openclaw }
            let relayURL = try string(object, "relayUrl").map(pairingSocketURL)
            let name = string(object, compact ? "n" : "displayName")
            return PairingPayload(backend: backend, transport: .relay, url: relayURL, displayName: name,
                token: string(object, compact ? "t" : "token"), password: string(object, compact ? "p" : "password"),
                relay: PairingRelay(serverURL: server, gatewayID: id, accessCode: code, relayURL: relayURL, displayName: name,
                    protocolVersion: integer(object, compact ? "pv" : "protocolVersion"), supportsBootstrap: object[compact ? "sb" : "supportsBootstrap"] as? Bool))
        }
        let mode = string(object, "mode")
        guard mode == nil || mode == "hermes" || PairingTransport(rawValue: mode!) != nil else { throw PairingError.invalidPayload }
        let hermes = object["hermes"] as? [String: Any]
        var backend: PairingBackend = (hermes != nil || mode == "hermes" || hermesLocal) ? .hermes : .openclaw
        if let explicit = string(object, "backendKind") {
            guard let parsed = PairingBackend(rawValue: explicit), (backend != .hermes || parsed == .hermes) else { throw PairingError.invalidPayload }
            backend = parsed
        }
        if backend != .openclaw && backend != .hermes && (mode == "hermes" || hermes != nil) { throw PairingError.invalidPayload }
        var transport = PairingTransport(rawValue: mode ?? "custom") ?? (hermesLocal ? .local : .custom)
        let url: URL
        if let raw = string(object, "url") { url = try pairingSocketURL(raw) }
        else if let host = string(object, "host") {
            let port: Int
            if let raw = object["port"] {
                guard let parsed = integer(object, "port") ?? (raw as? String).flatMap(Int.init) else { throw PairingError.invalidPayload }
                port = parsed
            } else { port = 18789 }
            guard (1...65535).contains(port) else { throw PairingError.invalidPayload }
            var parts = URLComponents(); parts.scheme = object["tls"] as? Bool == true ? "wss" : "ws"; parts.host = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host; parts.port = port
            guard let raw = parts.url else { throw PairingError.invalidPayload }; url = try pairingSocketURL(raw.absoluteString)
        } else { throw PairingError.invalidPayload }
        var bootstrap: PairingBootstrap?
        if let value = object["bootstrap"] as? [String: Any] {
            let token = try required(value, "token")
            guard let strategy = PairingBootstrap.Strategy(rawValue: try required(value, "strategy")) else { throw PairingError.invalidPayload }
            let expires = integer(value, "expiresAtMs").map(Int64.init)
            if let expires, Double(expires) <= now.timeIntervalSince1970 * 1_000 { throw PairingError.expired }
            let access = string(value, "access").flatMap(PairingBootstrap.Access.init(rawValue:))
            bootstrap = PairingBootstrap(token: token, strategy: strategy, expiresAtMs: expires, access: access)
        }
        var relay: PairingRelay?
        if let value = object["relay"] as? [String: Any] {
            relay = PairingRelay(serverURL: try pairingHTTPBase(required(value, "serverUrl")), gatewayID: try required(value, "gatewayId"),
                accessCode: string(value, "accessCode"), clientToken: string(value, "clientToken"), relayURL: try string(value, "relayUrl").map(pairingSocketURL),
                displayName: string(value, "displayName"), protocolVersion: integer(value, "protocolVersion"), supportsBootstrap: value["supportsBootstrap"] as? Bool)
        }
        if relay != nil && (mode == nil || mode == "hermes") { transport = .relay }
        if transport == .relay && relay == nil { throw PairingError.invalidPayload }
        var hermesBridgeURL: URL?
        if backend == .hermes {
            guard let hermes, let bridge = string(hermes, "bridgeUrl") else { throw PairingError.invalidPayload }
            hermesBridgeURL = try pairingHTTPBase(bridge)
        } else if string(object, "token") == nil && string(object, "password") == nil && bootstrap == nil && relay?.clientToken == nil { throw PairingError.invalidPayload }
        return PairingPayload(backend: backend, transport: hermesLocal ? .local : transport, url: url,
            displayName: string(object, "displayName") ?? hermes.flatMap { string($0, "displayName") },
            token: string(object, "token"), password: string(object, "password"), bootstrap: bootstrap, hermesBridgeURL: hermesBridgeURL, relay: relay)
    }
}

func string(_ object: [String: Any], _ key: String) -> String? {
    guard let value = object[key] as? String else { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}

func required(_ object: [String: Any], _ key: String) throws -> String {
    guard let value = string(object, key) else { throw PairingError.invalidPayload }
    return value
}

func integer(_ object: [String: Any], _ key: String) -> Int? {
    guard let value = object[key] as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(),
          value.doubleValue.isFinite, value.doubleValue.rounded() == value.doubleValue,
          abs(value.doubleValue) <= 9_007_199_254_740_991 else { return nil }
    return Int(exactly: value.int64Value)
}
