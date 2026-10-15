import CryptoKit
import Foundation
import Sodium

public enum PairingCryptography {
    public static func decodeBase64URL(_ value: String, count: Int? = nil) throws -> Data {
        guard !value.isEmpty, value.utf8.count <= PairingLimits.responseBytes,
              value.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else { throw PairingError.invalidSecret }
        let padded = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + String(repeating: "=", count: (4 - value.count % 4) % 4)
        guard let data = Data(base64Encoded: padded), encodeBase64URL(data) == value,
              count == nil || data.count == count else { throw PairingError.invalidSecret }
        return data
    }

    public static func encodeBase64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    public static func codeHash(_ normalizedCode: String) -> String { hex(Data(SHA256.hash(data: Data(normalizedCode.utf8)))) }
    public static func codeKey(_ normalizedCode: String) -> Data { Data(SHA256.hash(data: Data(normalizedCode.utf8))) }

    public static func openInvitation(nonce: String, ciphertext: String, key: Data) throws -> String {
        guard key.count == 32, ciphertext.count <= PairingLimits.ciphertextCharacters else { throw PairingError.invalidResponse }
        let n = try decodeBase64URL(nonce, count: 24), c = try decodeBase64URL(ciphertext)
        guard c.count >= 16, let bytes = Sodium().secretBox.open(authenticatedCipherText: Array(c), secretKey: Array(key), nonce: Array(n)),
              let text = String(bytes: bytes, encoding: .utf8) else { throw PairingError.decryptionFailed }
        guard text.utf8.count <= PairingLimits.qrBytes else { throw PairingError.responseTooLarge }
        return text
    }

    /// The stored TweetNaCl secret is exactly seed[32] + publicKey[32], not a CryptoKit raw key.
    public static func importSigningKey(tweetNaClSecret: Data, publicKey: Data) throws -> Curve25519.Signing.PrivateKey {
        guard tweetNaClSecret.count == 64, publicKey.count == 32 else { throw PairingError.invalidSecret }
        let key = try Curve25519.Signing.PrivateKey(rawRepresentation: tweetNaClSecret.prefix(32))
        guard key.publicKey.rawRepresentation == publicKey, tweetNaClSecret.suffix(32) == publicKey else { throw PairingError.invalidSecret }
        return key
    }

    /// Matches the current Gateway v3 signature preimage byte-for-byte; fields are not URL/JSON encoded.
    public static func deviceAuthPayload(deviceID: String, clientID: String, clientMode: String, role: String,
                                         scopes: [String], signedAtMs: Int64, token: String? = nil, nonce: String,
                                         platform: String, deviceFamily: String) -> String {
        ["v3", deviceID, clientID, clientMode, role, scopes.joined(separator: ","), String(signedAtMs),
         token ?? "", nonce, platform, deviceFamily].joined(separator: "|")
    }

    public static func deviceID(publicKey: Data) throws -> String {
        guard publicKey.count == 32 else { throw PairingError.invalidSecret }
        return hex(Data(SHA256.hash(data: publicKey)))
    }

    static func proof(_ message: String, codeKey: Data) -> String {
        hex(Data(HMAC<SHA256>.authenticationCode(for: Data(message.utf8), using: SymmetricKey(data: codeKey))))
    }

    static func verifyProof(_ proof: String, message: String, codeKey: Data) -> Bool {
        guard proof.utf8.count == 64, let bytes = try? decodeHex(proof), bytes.count == 32 else { return false }
        return HMAC<SHA256>.isValidAuthenticationCode(bytes, authenticating: Data(message.utf8), using: SymmetricKey(data: codeKey))
    }

    public static func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }
    public static func decodeHex(_ value: String) throws -> Data {
        guard value.utf8.count <= PairingLimits.responseBytes, value.count.isMultiple(of: 2),
              value.range(of: "^[a-f0-9]+$", options: .regularExpression) != nil else { throw PairingError.invalidSecret }
        let characters = Array(value.utf8)
        return try Data(stride(from: 0, to: characters.count, by: 2).map { index in
            guard let byte = UInt8(String(bytes: characters[index...index + 1], encoding: .utf8)!, radix: 16) else { throw PairingError.invalidSecret }; return byte
        })
    }
}

/// One restricted Relay exchange. No reusable pairing secrets are stored or logged.
public struct SecurePairingExchange: Sendable {
    public let sessionID: String
    public let requestID: String
    public let clientPublicKey: String
    private let clientSecretKey: Data
    private let codeKey: Data

    public init(sessionID: String, normalizedCode: String) throws {
        try self.init(sessionID: sessionID, normalizedCode: normalizedCode, requestID: nil, clientSecretKey: nil)
    }

    init(sessionID: String, normalizedCode: String, requestID: String?, clientSecretKey: Data?) throws {
        guard sessionID.range(of: "^ps_[a-f0-9]{64}$", options: .regularExpression) != nil,
              normalizedCode.range(of: "^[0-9]{6}$", options: .regularExpression) != nil else { throw PairingError.invalidResponse }
        let key = try clientSecretKey.map { try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: $0) } ?? Curve25519.KeyAgreement.PrivateKey()
        self.sessionID = sessionID
        self.requestID = requestID ?? PairingCryptography.hex(SymmetricKey(size: .bits128).withUnsafeBytes { Data($0) })
        guard self.requestID.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil else { throw PairingError.invalidSecret }
        self.clientSecretKey = key.rawRepresentation
        self.clientPublicKey = PairingCryptography.encodeBase64URL(key.publicKey.rawRepresentation)
        self.codeKey = PairingCryptography.codeKey(normalizedCode)
    }

    public func startFrame() throws -> String {
        let proof = PairingCryptography.proof("clawket-pair-v2:start:\(sessionID):\(requestID):\(clientPublicKey)", codeKey: codeKey)
        let frame: [String: Any] = ["type": "control", "event": "pairing.secure.start", "requestId": requestID,
            "payload": ["protocol": 2, "sessionId": sessionID, "clientPublicKey": clientPublicKey, "clientProof": proof]]
        let data = try JSONSerialization.data(withJSONObject: frame, options: [.sortedKeys, .withoutEscapingSlashes])
        return "__clawket_relay_control__:" + String(decoding: data, as: UTF8.self)
    }

    /// nil means an unrelated/additive control frame, not a failed exchange.
    public func receive(_ text: String) throws -> String? {
        guard text.utf8.count <= 8 * 1024 * 1024 else { throw PairingError.responseTooLarge }
        let prefix = "__clawket_relay_control__:"
        guard text.hasPrefix(prefix) else { return nil }
        guard let frame = try? JSONSerialization.jsonObject(with: Data(text.dropFirst(prefix.count).utf8)) as? [String: Any] else { return nil }
        guard string(frame, "requestId") == requestID else { return nil }
        if string(frame, "event") == "pairing.secure.error" { throw PairingError.rejected }
        guard string(frame, "event") == "pairing.secure.result", let payload = frame["payload"] as? [String: Any],
              integer(payload, "protocol") == 2, string(payload, "sessionId") == sessionID else { return nil }
        let publicKey = try required(payload, "bridgePublicKey"), nonce = try required(payload, "nonce"), ciphertext = try required(payload, "ciphertext")
        guard ciphertext.count <= PairingLimits.ciphertextCharacters else { throw PairingError.responseTooLarge }
        let proof = try required(payload, "bridgeProof")
        let message = "clawket-pair-v2:result:\(sessionID):\(requestID):\(clientPublicKey):\(publicKey):\(nonce):\(ciphertext)"
        guard PairingCryptography.verifyProof(proof, message: message, codeKey: codeKey) else { throw PairingError.decryptionFailed }
        let sender = try PairingCryptography.decodeBase64URL(publicKey, count: 32)
        let n = try PairingCryptography.decodeBase64URL(nonce, count: 24), c = try PairingCryptography.decodeBase64URL(ciphertext)
        guard c.count >= 16, let bytes = Sodium().box.open(authenticatedCipherText: Array(c), senderPublicKey: Array(sender), recipientSecretKey: Array(clientSecretKey), nonce: Array(n)),
              let result = String(bytes: bytes, encoding: .utf8) else { throw PairingError.decryptionFailed }
        return result
    }
}
