import Foundation
import ClawketPairing

public enum SpeechLimits {
    public static let sampleRate = 16_000
    public static let bytesPerSecond = 32_000
    public static let recordingSeconds = 600
    public static let recordingBytes = recordingSeconds * bytesPerSecond
    public static let segmentBytes = 110 * bytesPerSecond
    public static let chunkBytes = 6_400
    public static let outstandingBytes = 64_000
    public static let recordings = 10
    public static let resultCharacters = 16_000
    public static let wireBytes = 128 * 1_024
}

/// Fixed categories only. Native errors, audio, draft text and addresses are never diagnostics.
public enum SpeechCode: String, Codable, Sendable, CaseIterable {
    case unavailable = "speech_unavailable", authentication = "speech_auth", busy = "speech_busy"
    case deviceLimit = "speech_device_limit", ipLimit = "speech_ip_limit", dailyLimit = "speech_daily_limit"
    case admissionFailed = "speech_admission_failed", configuration = "speech_config"
    case providerBusy = "speech_provider_busy", providerAuthentication = "speech_provider_auth"
    case providerQuota = "speech_provider_quota", providerUpgrade = "speech_provider_upgrade"
    case providerUnreachable = "speech_provider_unreachable", providerStartTimeout = "speech_provider_start_timeout"
    case providerFailed = "speech_provider_failed", disconnected = "speech_disconnected"
    case connectTimeout = "speech_connect_timeout", audioTimeout = "speech_audio_timeout"
    case finishTimeout = "speech_finish_timeout", timeout = "speech_timeout", invalidProtocol = "speech_protocol"
    case audioLimit = "speech_audio_limit", tooLong = "speech_too_long", cancelled = "speech_cancelled"
    case permission = "speech_permission", captureFailed = "speech_capture_failed"
    case storage = "speech_storage", storageFull = "speech_storage_full", noSpeech = "speech_no_speech", failed = "speech_failed"
}

public struct SpeechFailure: Error, Equatable, Sendable {
    public let code: SpeechCode
    public let requestID: String?
    public let retryUntil: Date?
    public init(_ code: SpeechCode, requestID: String? = nil, retryAfterMilliseconds: Double = 0, now: Date = Date()) {
        self.code = code
        self.requestID = requestID.flatMap { $0.range(of: "^[a-f0-9-]{36}$", options: .regularExpression) != nil ? $0 : nil }
        self.retryUntil = retryAfterMilliseconds.isFinite && retryAfterMilliseconds > 0
            ? now.addingTimeInterval(min(86_400_000, retryAfterMilliseconds) / 1_000) : nil
    }
    public func remainingRetryMilliseconds(now: Date = Date()) -> Double {
        max(0, (retryUntil?.timeIntervalSince(now) ?? 0) * 1_000)
    }
}

/// A typed on-device association, never a capability or a diagnostic identity.
public struct SpeechScope: Codable, Sendable, Hashable {
    public let connectionID: String
    public let agentID: String
    public let sessionKey: String
    public init(connectionID: String, agentID: String, sessionKey: String) throws {
        self.connectionID = connectionID; self.agentID = agentID; self.sessionKey = sessionKey
        try validate()
    }
    func validate() throws {
        guard !connectionID.isEmpty, connectionID.utf8.count <= 256,
              !agentID.isEmpty, agentID.utf8.count <= 256,
              !sessionKey.isEmpty, sessionKey.utf8.count <= 1_024 else { throw SpeechFailure(.storage) }
    }
}

public struct SpeechRecording: Sendable, Equatable, Identifiable {
    public let id: String
    public let scope: SpeechScope
    public let draft: String
    public let createdAt: Date
    public let bytes: Int
    public let isRecording: Bool
    public let hasCompletedTranscription: Bool
    public var seconds: Double { Double(bytes) / Double(SpeechLimits.bytesPerSecond) }
}

public struct SpeechSigningIdentity: Sendable {
    public let publicKey: Data
    public let tweetNaClSecretKey: Data
    public init(publicKey: Data, tweetNaClSecretKey: Data) {
        self.publicKey = publicKey; self.tweetNaClSecretKey = tweetNaClSecretKey
    }
}

/// The normalized authority is exactly the host/optional port signed by the existing Worker.
public struct SpeechServiceConfiguration: Sendable, Equatable {
    public let url: URL
    public let authority: String
    public init(_ value: String) throws {
        guard var parts = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
              parts.scheme?.lowercased() == "wss", let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.percentEncodedPath == "/v1/speech",
              host.unicodeScalars.allSatisfy({ $0.value > 32 && $0.value < 127 }),
              parts.port == nil || (1...65_535).contains(parts.port!) else { throw SpeechFailure(.unavailable) }
        parts.scheme = "wss"; parts.host = host.lowercased()
        if parts.port == 443 { parts.port = nil }
        guard let url = parts.url, url.absoluteString.hasPrefix("wss://"),
              let end = url.absoluteString.dropFirst(6).firstIndex(of: "/") else { throw SpeechFailure(.unavailable) }
        self.url = url
        self.authority = String(url.absoluteString[url.absoluteString.index(url.absoluteString.startIndex, offsetBy: 6)..<end])
    }

    public func signedRequest(identity: SpeechSigningIdentity, timestampMilliseconds: Int64, nonce: String) throws -> URLRequest {
        guard (1_000_000_000_000...9_999_999_999_999).contains(timestampMilliseconds),
              nonce.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil else { throw SpeechFailure(.authentication) }
        do {
            let signingKey = try PairingCryptography.importSigningKey(tweetNaClSecret: identity.tweetNaClSecretKey, publicKey: identity.publicKey)
            let payload = "clawket-speech-v1|\(authority)|\(timestampMilliseconds)|\(nonce)"
            let signature = try signingKey.signature(for: Data(payload.utf8))
            var request = URLRequest(url: url)
            request.setValue("2", forHTTPHeaderField: "x-speech-protocol")
            request.setValue(PairingCryptography.hex(identity.publicKey), forHTTPHeaderField: "x-speech-key")
            request.setValue(String(timestampMilliseconds), forHTTPHeaderField: "x-speech-time")
            request.setValue(nonce, forHTTPHeaderField: "x-speech-nonce")
            request.setValue(PairingCryptography.hex(signature), forHTTPHeaderField: "x-speech-signature")
            return request
        } catch { throw SpeechFailure(.authentication) }
    }
}
