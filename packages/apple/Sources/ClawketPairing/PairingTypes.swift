import Foundation

public enum PairingBackend: String, Codable, CaseIterable, Sendable {
    case openclaw, hermes, codex, pi
    case claudeCode = "claude-code"
    case localModel = "local-model"
}

public enum PairingTransport: String, Codable, Sendable {
    case local, relay, tailscale, cloudflare, custom
}

public enum PairingEnvironment: String, Codable, Sendable {
    case production, preview
}

/// Only fixed categories escape this module; transport errors can contain credential-bearing URLs.
public enum PairingError: Error, Equatable, Sendable {
    case invalidPayload, invalidCode, invalidLink, invalidSecret, invalidResponse
    case backendMismatch, environmentMismatch, previewRequiresDebugMode, untrustedServer
    case expired, alreadyUsed, rateLimited, unauthorized, rejected, decryptionFailed
    case responseTooLarge, timeout, network, unsupported, busy
}

public struct PairingExpectation: Sendable, Equatable {
    public let backend: PairingBackend
    public let environment: PairingEnvironment
    public let debugMode: Bool
    public init(backend: PairingBackend, environment: PairingEnvironment = .production, debugMode: Bool = false) {
        self.backend = backend; self.environment = environment; self.debugMode = debugMode
    }
}

public struct PairingBootstrap: Codable, Sendable, Equatable {
    public enum Strategy: String, Codable, Sendable { case mobileSetup = "mobile-setup", legacyBound = "legacy-bound" }
    public enum Access: String, Codable, Sendable { case full, limited, node }
    public let token: String
    public let strategy: Strategy
    public let expiresAtMs: Int64?
    public let access: Access?
    public init(token: String, strategy: Strategy, expiresAtMs: Int64? = nil, access: Access? = nil) {
        self.token = token; self.strategy = strategy; self.expiresAtMs = expiresAtMs; self.access = access
    }
}

public struct PairingRelay: Codable, Sendable, Equatable {
    public let serverURL: URL
    public let gatewayID: String
    public let accessCode: String?
    public let clientToken: String?
    public let relayURL: URL?
    public let displayName: String?
    public let protocolVersion: Int?
    public let supportsBootstrap: Bool?
    public init(serverURL: URL, gatewayID: String, accessCode: String? = nil, clientToken: String? = nil,
                relayURL: URL? = nil, displayName: String? = nil, protocolVersion: Int? = nil, supportsBootstrap: Bool? = nil) {
        self.serverURL = serverURL; self.gatewayID = gatewayID; self.accessCode = accessCode
        self.clientToken = clientToken; self.relayURL = relayURL; self.displayName = displayName
        self.protocolVersion = protocolVersion; self.supportsBootstrap = supportsBootstrap
    }
}

/// Sensitive in-memory pairing data. Never encode into analytics, logs, or a navigation path.
public struct PairingPayload: Sendable, Equatable {
    public let backend: PairingBackend
    public let transport: PairingTransport
    public let url: URL?
    public let displayName: String?
    public let token: String?
    public let password: String?
    public let bootstrap: PairingBootstrap?
    public let hermesBridgeURL: URL?
    public let relay: PairingRelay?
    public init(backend: PairingBackend, transport: PairingTransport, url: URL?, displayName: String? = nil,
                token: String? = nil, password: String? = nil, bootstrap: PairingBootstrap? = nil, hermesBridgeURL: URL? = nil, relay: PairingRelay? = nil) {
        self.backend = backend; self.transport = transport; self.url = url; self.displayName = displayName
        self.token = token; self.password = password; self.bootstrap = bootstrap; self.hermesBridgeURL = hermesBridgeURL; self.relay = relay
    }
}

public struct PairingLink: Sendable, Equatable {
    public let serverURL: URL
    public let sessionID: String
    public let secret: Data
    public init(serverURL: URL, sessionID: String, secret: Data) {
        self.serverURL = serverURL; self.sessionID = sessionID; self.secret = secret
    }
}

public enum PairingLimits {
    public static let qrBytes = 64 * 1024
    public static let responseBytes = 128 * 1024
    public static let ciphertextCharacters = 64 * 1024
    public static let requestSeconds: TimeInterval = 15
    public static let secureExchangeSeconds: TimeInterval = 15
}
