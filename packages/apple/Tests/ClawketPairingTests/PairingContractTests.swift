import CryptoKit
import Foundation
import Sodium
import XCTest
@testable import ClawketPairing

struct PairingVectors: Decodable, Sendable {
    struct SecretBox: Decodable, Sendable { let code, codeHash, nonce, ciphertext, linkKey, linkCiphertext: String }
    struct Secure: Decodable, Sendable { let code, codeHash, sessionID, requestID, clientSecret, clientPublic, bridgeSecret, bridgePublic, nonce, ciphertext, startProof, resultProof, resultFrame: String }
    struct Signing: Decodable, Sendable { let secretKey, publicKey, deviceID, signedPayload, signature: String }
    struct Service: Decodable, Sendable { let backend, environment, registryHost, relayHost, legacyRegistryHost, legacyRelayHost: String }
    let plaintext: String
    let secretBox: SecretBox
    let secure: Secure
    let signing: Signing
    let services: [Service]
    static func load() throws -> Self {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "pairing-vectors", withExtension: "json", subdirectory: "Fixtures"))
        return try JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
    }
}

final class PairingContractTests: XCTestCase, @unchecked Sendable {
    func testTweetNaClLegacySecretBoxAndLinkKeyCompatibility() throws {
        let vector = try PairingVectors.load()
        XCTAssertEqual(PairingCryptography.codeHash(vector.secretBox.code), vector.secretBox.codeHash)
        let key = PairingCryptography.codeKey(vector.secretBox.code)
        XCTAssertEqual(try PairingCryptography.openInvitation(nonce: vector.secretBox.nonce, ciphertext: vector.secretBox.ciphertext, key: key), vector.plaintext)
        XCTAssertEqual(try PairingCryptography.openInvitation(nonce: vector.secretBox.nonce, ciphertext: vector.secretBox.linkCiphertext,
            key: PairingCryptography.decodeBase64URL(vector.secretBox.linkKey, count: 32)), vector.plaintext)
        XCTAssertThrowsError(try PairingCryptography.openInvitation(nonce: vector.secretBox.nonce, ciphertext: vector.secretBox.ciphertext, key: Data(repeating: 0, count: 32)))
        XCTAssertThrowsError(try PairingCryptography.openInvitation(nonce: "AA", ciphertext: vector.secretBox.ciphertext, key: key))
        XCTAssertThrowsError(try PairingCryptography.openInvitation(nonce: vector.secretBox.nonce, ciphertext: "AA", key: key))
    }

    func testTweetNaClBoxKeyAndExactProofCompatibility() throws {
        let vector = try PairingVectors.load()
        let exchange = try SecurePairingExchange(sessionID: vector.secure.sessionID, normalizedCode: vector.secure.code,
            requestID: vector.secure.requestID, clientSecretKey: PairingCryptography.decodeHex(vector.secure.clientSecret))
        XCTAssertEqual(exchange.clientPublicKey, vector.secure.clientPublic)
        XCTAssertEqual(PairingCryptography.codeHash(vector.secure.code), vector.secure.codeHash)
        let start = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(exchange.startFrame().dropFirst("__clawket_relay_control__:".count).utf8)) as? [String: Any])
        let payload = try XCTUnwrap(start["payload"] as? [String: Any])
        XCTAssertEqual(start["requestId"] as? String, vector.secure.requestID)
        XCTAssertEqual(payload["clientProof"] as? String, vector.secure.startProof)
        XCTAssertEqual(try exchange.receive(vector.secure.resultFrame), vector.plaintext)
        XCTAssertNil(try exchange.receive("__clawket_relay_control__:{\"event\":\"relay.ready\"}"))
        XCTAssertNil(try exchange.receive(vector.secure.resultFrame.replacingOccurrences(of: vector.secure.requestID, with: String(repeating: "0", count: 32))))
        XCTAssertThrowsError(try exchange.receive(vector.secure.resultFrame.replacingOccurrences(of: vector.secure.resultProof, with: String(repeating: "0", count: 64)))) { XCTAssertEqual($0 as? PairingError, .decryptionFailed) }
        XCTAssertThrowsError(try exchange.receive("__clawket_relay_control__:{\"event\":\"pairing.secure.error\",\"requestId\":\"\(vector.secure.requestID)\"}"))
    }

    func testTweetNaClEd25519IdentityImportAndSignature() throws {
        let vector = try PairingVectors.load().signing
        let publicKey = try PairingCryptography.decodeHex(vector.publicKey)
        let secret = try PairingCryptography.decodeHex(vector.secretKey)
        let key = try PairingCryptography.importSigningKey(tweetNaClSecret: secret, publicKey: publicKey)
        XCTAssertEqual(try PairingCryptography.deviceID(publicKey: publicKey), vector.deviceID)
        XCTAssertEqual(PairingCryptography.deviceAuthPayload(deviceID: vector.deviceID, clientID: "openclaw-ios", clientMode: "ui", role: "operator",
            scopes: ["operator.read", "operator.write"], signedAtMs: 1_700_000_000_123, token: "synthetic-token", nonce: "synthetic-nonce", platform: "ios", deviceFamily: "iphone"), vector.signedPayload)
        let message = Data(vector.signedPayload.utf8)
        let signature = try key.signature(for: message)
        let sodiumSignature = try XCTUnwrap(Sodium().sign.signature(message: Array(message), secretKey: Array(secret)))
        XCTAssertEqual(PairingCryptography.hex(Data(sodiumSignature)), vector.signature)
        // CryptoKit does not promise deterministic signing output. Verify both implementations across keys.
        XCTAssertTrue(Sodium().sign.verify(message: Array(message), publicKey: Array(publicKey), signature: Array(signature)))
        XCTAssertTrue(key.publicKey.isValidSignature(try PairingCryptography.decodeHex(vector.signature), for: message))
        XCTAssertThrowsError(try PairingCryptography.importSigningKey(tweetNaClSecret: secret.prefix(32), publicKey: publicKey))
        XCTAssertThrowsError(try PairingCryptography.importSigningKey(tweetNaClSecret: secret, publicKey: Data(repeating: 0, count: 32)))
        var corrupted = secret; corrupted[63] ^= 1
        XCTAssertThrowsError(try PairingCryptography.importSigningKey(tweetNaClSecret: corrupted, publicKey: publicKey))
    }

    func testCanonicalBase64RejectsPaddingTrailingBitsAndInvalidLength() throws {
        for value in ["", "=", "AA==", "AB", "A", "あ", "AA/"] { XCTAssertThrowsError(try PairingCryptography.decodeBase64URL(value)) }
        XCTAssertEqual(try PairingCryptography.decodeBase64URL("AA"), Data([0]))
        XCTAssertThrowsError(try PairingCryptography.decodeBase64URL("AA", count: 32))
        XCTAssertThrowsError(try PairingCryptography.decodeHex("zz"))
    }

    func testEveryOfficialAliasMatchesTypeScriptSourceFixture() throws {
        let fixtures = try PairingVectors.load().services
        XCTAssertEqual(OfficialPairingServices.services.count, fixtures.count)
        for fixture in fixtures {
            let item = try XCTUnwrap(OfficialPairingServices.services.first { $0.backend.rawValue == fixture.backend && $0.environment.rawValue == fixture.environment })
            XCTAssertEqual(item.registryHost, fixture.registryHost)
            XCTAssertEqual(item.relayHost, fixture.relayHost)
            XCTAssertEqual(item.legacyRegistryHost, fixture.legacyRegistryHost)
            XCTAssertEqual(item.legacyRelayHost, fixture.legacyRelayHost)
            XCTAssertEqual(OfficialPairingServices.canonicalize(try XCTUnwrap(URL(string: "https://\(fixture.legacyRegistryHost)/pair/test#k=keep"))).host, fixture.registryHost)
        }
        XCTAssertNotNil(OfficialPairingServices.service(for: try XCTUnwrap(URL(string: "https://registry.clawket.ai:443"))))
        for value in ["https://registry.clawket.ai.evil.invalid", "https://registry.clawket.ai:8443", "https://name@registry.clawket.ai", "http://registry.clawket.ai"] {
            XCTAssertNil(OfficialPairingServices.service(for: try XCTUnwrap(URL(string: value))))
        }
    }
}
