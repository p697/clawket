import Foundation
import ClawketPairing
import ClawketTransport

public typealias BackendKind = PairingBackend
public typealias TransportKind = PairingTransport
public typealias ServiceEnvironment = PairingEnvironment

/// Credential-bearing persistence boundary. Never log or use as a navigation value.
public struct BackendConnection: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let backendKind: BackendKind
    public let transportKind: TransportKind
    public var label: String
    public let url: URL
    public let createdAt: Int64
    public let environment: ServiceEnvironment?
    public let auth: BackendAuthentication?
    public let bootstrap: PairingBootstrap?
    public let relay: PairingRelay?
    public let hermesBridgeURL: URL?

    public init(id: String = UUID().uuidString.lowercased(), backendKind: BackendKind,
                transportKind: TransportKind, label: String, url: URL,
                createdAt: Int64 = Int64(Date().timeIntervalSince1970 * 1_000),
                environment: ServiceEnvironment? = nil, auth: BackendAuthentication? = nil,
                bootstrap: PairingBootstrap? = nil, relay: PairingRelay? = nil, hermesBridgeURL: URL? = nil) {
        self.id = id; self.backendKind = backendKind; self.transportKind = transportKind
        self.label = label; self.url = url; self.createdAt = createdAt; self.environment = environment
        self.auth = auth; self.bootstrap = bootstrap; self.relay = relay; self.hermesBridgeURL = hermesBridgeURL
    }

    public init(pairing: PairingPayload, id: String = UUID().uuidString.lowercased(), label: String? = nil,
                createdAt: Int64 = Int64(Date().timeIntervalSince1970 * 1_000), environment: ServiceEnvironment? = nil) throws {
        guard let url = pairing.url ?? pairing.relay?.relayURL else { throw RuntimeFailure(.invalidConnection) }
        self.init(id: id, backendKind: pairing.backend, transportKind: pairing.transport,
                  label: label ?? pairing.displayName ?? pairing.backend.rawValue, url: url, createdAt: createdAt,
                  environment: environment, auth: BackendAuthentication(token: pairing.token, password: pairing.password),
                  bootstrap: pairing.bootstrap, relay: pairing.relay, hermesBridgeURL: pairing.hermesBridgeURL)
    }
}

public struct BackendAuthentication: Codable, Sendable, Equatable {
    public let token: String?
    public let password: String?
    public init(token: String? = nil, password: String? = nil) { self.token = token; self.password = password }
}

/// Secret key bytes are the existing TweetNaCl seed[32] + publicKey[32] format.
public struct RuntimeDeviceIdentity: Codable, Sendable, Equatable {
    public let deviceID: String
    public let publicKey: Data
    public let secretKey: Data
    public init(deviceID: String, publicKey: Data, secretKey: Data) {
        self.deviceID = deviceID; self.publicKey = publicKey; self.secretKey = secretKey
    }
}

public struct DeviceTokenScope: Codable, Sendable, Hashable {
    public let connectionID: String
    public let deviceID: String
    public let role: String
    public let registryURL: URL?
    public let relayID: String?
    public let gatewayURL: URL
    public init(connectionID: String, deviceID: String, role: String = "operator", registryURL: URL? = nil,
                relayID: String? = nil, gatewayURL: URL) {
        self.connectionID = connectionID; self.deviceID = deviceID; self.role = role
        self.registryURL = registryURL; self.relayID = relayID; self.gatewayURL = gatewayURL
    }
}

public struct RuntimeDeviceToken: Codable, Sendable, Equatable {
    public let token: String
    public let role: String
    public let scopes: [String]
    public init(token: String, role: String, scopes: [String]) { self.token = token; self.role = role; self.scopes = scopes }
}

public protocol DeviceCredentialProvider: Sendable {
    func identity() async throws -> RuntimeDeviceIdentity
    func readToken(scope: DeviceTokenScope) async throws -> RuntimeDeviceToken?
    func writeToken(_ token: RuntimeDeviceToken, scope: DeviceTokenScope) async throws
    func deleteToken(scope: DeviceTokenScope) async throws
}

public struct RuntimeClient: Sendable, Equatable {
    public let version: String
    public let deviceFamily: String
    public init(version: String = "3.1.2", deviceFamily: String = "iphone") {
        self.version = version; self.deviceFamily = deviceFamily
    }
}

/// This initial runtime advertises only operations implemented by its native adapter.
public struct RuntimeCapabilities: Codable, Sendable, Equatable {
    public var chat = false
    public var abort = false
    public var history = false
    public var sessions = false
    public var models = false
    public var modelPerSession = false
    public init() {}
}

public struct RuntimeConnectionState: Codable, Sendable, Equatable {
    public enum Phase: String, Codable, Sendable { case idle, connecting, handshaking, ready, reconnecting, offline, error }
    public let connectionID: String?
    public let phase: Phase
    public let capabilities: RuntimeCapabilities
    public let backendKind: BackendKind?
    public let bridgeVersion: String?
    public let nextRetryAt: Int64?
    public init(connectionID: String? = nil, phase: Phase = .idle, capabilities: RuntimeCapabilities = .init(),
                backendKind: BackendKind? = nil, bridgeVersion: String? = nil, nextRetryAt: Int64? = nil) {
        self.connectionID = connectionID; self.phase = phase; self.capabilities = capabilities
        self.backendKind = backendKind; self.bridgeVersion = bridgeVersion; self.nextRetryAt = nextRetryAt
    }
}

public struct RuntimeFailure: Error, Sendable, Equatable, CustomStringConvertible {
    public enum Code: String, Codable, Sendable {
        case invalidConnection, invalidResponse, wrongBackend, authenticationRequired, pairingRequired
        case credentialStorage, permissionsRequired, superseded, unsupported, notConnected, timeout, network, capacity
    }
    public enum Delivery: String, Codable, Sendable { case notDispatched, uncertain, rejectedBeforeDispatch, responseReceived }
    public let code: Code
    public let delivery: Delivery
    public let retryable: Bool
    public var description: String { "RuntimeFailure(\(code.rawValue))" }
    public init(_ code: Code, delivery: Delivery = .notDispatched, retryable: Bool = false) {
        self.code = code; self.delivery = delivery; self.retryable = retryable
    }
}

public struct RuntimeAgent: Codable, Sendable, Equatable, Identifiable {
    public enum EntryMode: String, Codable, Sendable { case main, sessions }
    public var id: String { agentID }
    public let agentID: String
    public let connectionID: String
    public let name: String
    public let emoji: String?
    public let avatarURL: URL?
    public let mainSessionKey: String
    public let entryMode: EntryMode
    public init(agentID: String, connectionID: String, name: String, emoji: String? = nil, avatarURL: URL? = nil,
                mainSessionKey: String, entryMode: EntryMode = .main) {
        self.agentID = agentID; self.connectionID = connectionID; self.name = name
        self.emoji = emoji; self.avatarURL = avatarURL; self.mainSessionKey = mainSessionKey; self.entryMode = entryMode
    }
}

public struct RuntimeProject: Codable, Sendable, Equatable {
    public let id: String
    public let name: String
    public let path: String
    public let available: Bool
}

public struct RuntimeSession: Codable, Sendable, Equatable, Identifiable {
    public var id: String { key }
    public let key: String
    public let connectionID: String
    public let agentID: String
    public let title: String
    public let kind: String
    public let preview: String?
    public let updatedAtMs: Int64?
    public let lastActivityAtMs: Int64?
    public let model: String?
    public let modelProvider: String?
    public let hasActiveRun: Bool
    public let project: RuntimeProject?
    public let canContinue: Bool?
    public let continuationBlockedReason: String?
    public let raw: JSONValue
}

public struct RuntimeMessage: Codable, Sendable, Equatable, Identifiable {
    public enum Role: String, Codable, Sendable { case user, assistant, system, tool }
    public let id: String
    public let role: Role
    public let text: String
    public let timestampMs: Int64?
    public let runID: String?
    public let turnID: String?
    public let idempotencyKey: String?
    /// Local provenance is never trusted from a backend frame.
    public let sentLocally: Bool
    public let raw: JSONValue
}

public struct RuntimeHistory: Codable, Sendable, Equatable {
    public enum Pagination: String, Codable, Sendable { case cursor, limit }
    public let key: String
    public let messages: [RuntimeMessage]
    public let nextCursor: String?
    public let hasMore: Bool?
    public let pagination: Pagination
    public let hasActiveRun: Bool
    public let activeRun: JSONValue?
}

public struct RuntimeRoster: Codable, Sendable, Equatable {
    public let connectionID: String
    public let agents: [RuntimeAgent]
    public let sessions: [RuntimeSession]
}

public struct RuntimePrompt: Codable, Sendable, Equatable {
    public let text: String
    public let idempotencyKey: String
    public let thinkingLevel: String?
    public let skillID: String?
    public init(text: String, idempotencyKey: String = UUID().uuidString.lowercased(), thinkingLevel: String? = nil, skillID: String? = nil) {
        self.text = text; self.idempotencyKey = idempotencyKey; self.thinkingLevel = thinkingLevel; self.skillID = skillID
    }
}

public struct RuntimeRunReceipt: Codable, Sendable, Equatable {
    public let runID: String
    public let idempotencyKey: String
}

public struct RuntimeModel: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let provider: String?
    public let selected: Bool
}

public struct RuntimeTextUpdate: Sendable, Equatable {
    public enum Mode: String, Sendable { case delta, snapshot }
    public let sessionKey: String
    public let runID: String
    /// Stable for one assistant segment. A tool boundary starts a new segment, even in the same run.
    public let segmentID: String
    public let text: String
    public let mode: Mode
    public let turnID: String?
    public let inputMessageID: String?
    public let inputMessageKey: String?
}

public enum RuntimeSessionUpdate: Sendable, Equatable {
    case runStarted(sessionKey: String, runID: String)
    case text(RuntimeTextUpdate)
    case thought(sessionKey: String, runID: String, text: String)
    case tool(sessionKey: String?, runID: String?, payload: JSONValue)
    case runFinished(sessionKey: String, runID: String, reason: String, segmentID: String, raw: JSONValue)
    case sessionMetadata(RuntimeSession)
    /// Preserves unimplemented task/consent metadata without advertising an action.
    case other(JSONValue)
}

public enum RuntimeEvent: Sendable, Equatable {
    case state(RuntimeConnectionState)
    case roster(RuntimeRoster)
    case update(connectionID: String, RuntimeSessionUpdate)
    case failure(connectionID: String?, RuntimeFailure)
}
