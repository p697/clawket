import Foundation

/// Mirrors packages/bridge-core/src/official-relay.ts. Contract tests pin every public alias.
public enum OfficialPairingServices {
    public struct Service: Sendable, Equatable {
        public let backend: PairingBackend
        public let environment: PairingEnvironment
        public let registryHost: String
        public let relayHost: String
        public let legacyRegistryHost: String
        public let legacyRelayHost: String
    }

    public static let services: [Service] = PairingBackend.allCases.flatMap { backend in
        let stem = backend == .openclaw ? "" : "\(backend.rawValue)-"
        let worker = backend == .openclaw ? "clawket" : "clawket-\(backend.rawValue)"
        let environments: [PairingEnvironment] = backend == .localModel ? [.preview] : [.production, .preview]
        return environments.map { environment in
            let suffix = environment == .preview ? "-preview" : ""
            return Service(backend: backend, environment: environment,
                registryHost: "\(stem)registry\(backend == .localModel ? "" : suffix).clawket.ai",
                relayHost: "\(stem)relay\(backend == .localModel ? "" : suffix).clawket.ai",
                legacyRegistryHost: "\(worker)-registry\(suffix).clawket.workers.dev",
                legacyRelayHost: "\(worker)-relay\(suffix).clawket.workers.dev")
        }
    }

    public static func registry(backend: PairingBackend, environment: PairingEnvironment = .production) -> URL {
        let item = services.first { $0.backend == backend && (backend == .localModel || $0.environment == environment) }!
        return URL(string: "https://\(item.registryHost)")!
    }

    public static func service(for url: URL) -> Service? {
        guard url.user == nil, url.password == nil, (url.port == nil || url.port == 443), let host = url.host?.lowercased() else { return nil }
        return services.first {
            (url.scheme?.lowercased() == "https" && [ $0.registryHost, $0.legacyRegistryHost ].contains(host))
                || (url.scheme?.lowercased() == "wss" && [ $0.relayHost, $0.legacyRelayHost ].contains(host))
        }
    }

    public static func canonicalize(_ url: URL) -> URL {
        guard let service = service(for: url), var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        parts.scheme = parts.scheme?.lowercased()
        if parts.port == 443 { parts.port = nil }
        if parts.host?.lowercased() == service.legacyRegistryHost { parts.host = service.registryHost }
        if parts.host?.lowercased() == service.legacyRelayHost { parts.host = service.relayHost }
        return parts.url ?? url
    }

    static func validate(_ url: URL, expectation: PairingExpectation) throws {
        guard let service = service(for: url) else { return } // Custom registries are not official environments.
        guard service.backend == expectation.backend else { throw PairingError.backendMismatch }
        if service.backend == .localModel || (service.backend == .pi && service.environment == .production) { return }
        if service.environment == .preview && !expectation.debugMode { throw PairingError.previewRequiresDebugMode }
        let effective: PairingEnvironment = expectation.debugMode ? expectation.environment : .production
        guard service.environment == effective else { throw PairingError.environmentMismatch }
    }
}

func pairingHTTPBase(_ value: String) throws -> URL {
    var raw = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if !raw.contains("://") { raw = "https://" + raw }
    guard var parts = URLComponents(string: raw), parts.host?.isEmpty == false,
          parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil else { throw PairingError.invalidPayload }
    parts.scheme = parts.scheme?.lowercased()
    if parts.scheme == "wss" { parts.scheme = "https" }
    if parts.scheme == "ws" { parts.scheme = "http" }
    guard parts.scheme == "http" || parts.scheme == "https", let url = parts.url else { throw PairingError.invalidPayload }
    return OfficialPairingServices.canonicalize(url)
}

func pairingSocketURL(_ value: String) throws -> URL {
    guard var parts = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
          parts.host?.isEmpty == false, parts.user == nil, parts.password == nil, parts.fragment == nil else { throw PairingError.invalidPayload }
    parts.scheme = parts.scheme?.lowercased()
    if parts.scheme == "https" { parts.scheme = "wss" }
    if parts.scheme == "http" { parts.scheme = "ws" }
    guard parts.scheme == "ws" || parts.scheme == "wss", let url = parts.url else { throw PairingError.invalidPayload }
    return OfficialPairingServices.canonicalize(url)
}
