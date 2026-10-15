import Foundation
import XCTest
import ClawketPairing
@testable import ClawketUpgrade

final class UpgradeValidationTests: XCTestCase, @unchecked Sendable {
    func testIdentityPreservesSeedPublicPairDeviceIDAndCreationTime() throws {
        let (data, id) = try upgradeTestIdentity()
        let result = try XCTUnwrap(upgradeIdentity(data))
        XCTAssertEqual(result.deviceID, id)
        XCTAssertEqual(result.secretKey.count, 64); XCTAssertEqual(result.publicKey.count, 32)
        XCTAssertEqual(result.createdAt, "2020-01-02T03:04:05.000Z")
        let original = try upgradeObject(data)
        for field in ["deviceId", "publicKeyHex", "secretKeyHex"] {
            var corrupted = original
            corrupted[field] = field == "deviceId" ? String(repeating: "0", count: 64) : "00"
            XCTAssertThrowsError(try upgradeIdentity(upgradeTestJSON(corrupted))) { XCTAssertEqual($0 as? UpgradeFailure, .invalidIdentity) }
        }
        var secretMismatch = original
        var secret = try PairingCryptography.decodeHex(try upgradeString(original, "secretKeyHex")); secret[0] ^= 1
        secretMismatch["secretKeyHex"] = PairingCryptography.hex(secret)
        XCTAssertThrowsError(try upgradeIdentity(upgradeTestJSON(secretMismatch)))
    }

    func testSixBackendRegistryPreservesScopesCredentialsTimestampsAndExpiredBootstrap() throws {
        let result = try XCTUnwrap(upgradeRegistry(current: upgradeTestRegistry(), rollback: nil, configs: nil, profiles: nil, single: nil))
        XCTAssertEqual(result.revision, 7)
        XCTAssertEqual(result.connections.map(\.backendKind), PairingBackend.allCases)
        XCTAssertEqual(result.activeConnectionID, "connection-0")
        XCTAssertEqual(result.freeConnectionID, "connection-5")
        for (index, row) in result.connections.enumerated() {
            XCTAssertEqual(row.createdAt, 1_600_000_000_000 + Int64(index))
            XCTAssertEqual(row.relay?.gatewayID, "gateway-\(index)")
            XCTAssertEqual(row.relay?.clientToken, "synthetic-client-token")
            XCTAssertEqual(row.token, "synthetic-gateway-token")
            XCTAssertEqual(row.password, "synthetic-password")
            XCTAssertEqual(row.environment, .production); XCTAssertEqual(row.debugMode, false)
        }
        XCTAssertEqual(result.connections.first?.bootstrap?.expiresAtMs, 1)
        XCTAssertEqual(result.connections.first?.bootstrap?.access, .node)
        XCTAssertEqual(result.connections.first(where: { $0.backendKind == .hermes })?.hermesBridgeURL?.absoluteString, "http://127.0.0.1:8787")
    }

    func testRollbackRecoveryAndMalformedRegistryCannotBecomeEmpty() throws {
        let good = try upgradeTestRegistry()
        let result = try XCTUnwrap(upgradeRegistry(current: Data("broken".utf8), rollback: good, configs: nil, profiles: nil, single: nil))
        XCTAssertTrue(result.recoveredFromRollback); XCTAssertEqual(result.connections.count, 6)
        XCTAssertThrowsError(try upgradeRegistry(current: Data("broken".utf8), rollback: Data("broken".utf8), configs: nil, profiles: nil, single: nil))
        var duplicate = upgradeTestRecords(); duplicate[1]["id"] = duplicate[0]["id"]
        var unknown = upgradeTestRecords(); unknown[0]["backendKind"] = "unknown"
        var fractional = upgradeTestRecords(); fractional[0]["createdAt"] = 1.5
        for records in [duplicate, unknown, fractional] {
            XCTAssertThrowsError(try upgradeRegistry(current: upgradeTestRegistry(records), rollback: nil, configs: nil, profiles: nil, single: nil))
        }
        var snapshot = try upgradeObject(good); snapshot["revision"] = true
        XCTAssertThrowsError(try upgradeRegistry(current: upgradeTestJSON(snapshot), rollback: nil, configs: nil, profiles: nil, single: nil))
    }

    func testLegacyConfigsProfilesAndSingleGatewayRemainRecoverable() throws {
        let rows: [[String: Any]] = [
            ["id": "first", "name": "First", "mode": "local", "url": "ws://127.0.0.1:18789", "createdAt": 123],
            ["id": "second", "name": "Second", "mode": "hermes", "url": "wss://bridge.example.invalid/ws", "createdAt": 456,
             "hermes": ["bridgeUrl": "https://bridge.example.invalid"],
             "relay": ["serverUrl": "https://registry.example.invalid", "gatewayId": "bridge-test", "clientToken": "synthetic-client"]],
        ]
        let result = try XCTUnwrap(upgradeRegistry(current: nil, rollback: nil,
            configs: upgradeTestJSON(["activeId": "second", "configs": rows]), profiles: nil, single: nil))
        XCTAssertEqual(result.activeConnectionID, "second"); XCTAssertEqual(result.freeConnectionID, "second")
        XCTAssertEqual(result.connections.map(\.createdAt), [123, 456])
        XCTAssertEqual(result.connections.last?.backendKind, .hermes); XCTAssertEqual(result.connections.last?.transportKind, .relay)
        var previewRows = rows
        previewRows[0]["relay"] = ["serverUrl": "https://clawket-registry-preview.clawket.workers.dev", "gatewayId": "preview-test"]
        previewRows[0]["debugMode"] = true
        let preview = try XCTUnwrap(upgradeRegistry(current: nil, rollback: nil,
            configs: upgradeTestJSON(["activeId": "first", "configs": previewRows]), profiles: nil, single: nil))
        XCTAssertEqual(preview.connections.first?.environment, .preview)
        XCTAssertEqual(preview.connections.first?.debugMode, true)
        let profiles = try upgradeTestJSON(["activeMode": "tailscale", "local": ["url": "ws://127.0.0.1:1"], "tailscale": ["url": "wss://computer.example.invalid"]])
        let older = try XCTUnwrap(upgradeRegistry(current: nil, rollback: nil, configs: nil, profiles: profiles, single: nil))
        XCTAssertEqual(older.connections.map(\.id), ["legacy_local", "legacy_tailscale"])
        XCTAssertEqual(older.activeConnectionID, "legacy_tailscale"); XCTAssertEqual(older.connections.map(\.createdAt), [0, 0])
        let single = try XCTUnwrap(upgradeRegistry(current: nil, rollback: nil, configs: nil, profiles: nil,
            single: upgradeTestJSON(["url": "http://127.0.0.1:18789", "token": "synthetic-local"])))
        XCTAssertEqual(single.connections.first?.id, "legacy_single"); XCTAssertEqual(single.connections.first?.url.scheme, "ws")
    }

    func testRoleTokensGraceAndPurchaseIdentityAreValidatedWithoutRefreshingThem() throws {
        let tokenID = LegacyValueID(domain: .secure, key: "clawket.deviceToken.synthetic_role_node")
        let token = try upgradeTestJSON(["version": 1, "token": "synthetic-node-token", "role": "node", "scopes": ["node.invoke"], "updatedAtMs": 100])
        XCTAssertNoThrow(try validatePreservedValue(tokenID, data: token))
        XCTAssertNoThrow(try validatePreservedValue(tokenID, data: Data("legacy-operator-token".utf8)))
        XCTAssertThrowsError(try validatePreservedValue(tokenID, data: Data("[]".utf8)))
        let graceID = LegacyValueID(domain: .secure, key: "clawket.proEntitlement.v1.synthetic")
        let grace = try upgradeTestJSON(["version": 1, "freeConnectionId": "first", "lastFreeConnectionSwitchAt": 50,
            "graceEvaluatedAt": 100, "graceUntil": 200])
        XCTAssertNoThrow(try validatePreservedValue(graceID, data: grace))
        var missingFree = try upgradeObject(grace); missingFree.removeValue(forKey: "freeConnectionId")
        XCTAssertThrowsError(try validatePreservedValue(graceID, data: upgradeTestJSON(missingFree)))
        let purchase = try PropertyListSerialization.data(fromPropertyList: "$RCAnonymousID:synthetic", format: .binary, options: 0)
        XCTAssertEqual(try purchaseString(purchase), "$RCAnonymousID:synthetic")
        XCTAssertThrowsError(try purchaseString(try PropertyListSerialization.data(fromPropertyList: "", format: .binary, options: 0)))
    }

    func testTokenNormalizationMatchesMobileForOlderScopeRecordsAndJSONFragments() throws {
        let id = LegacyValueID(domain: .secure, key: "clawket.deviceToken.synthetic")
        let missing = try upgradeTestJSON(["version": 1, "token": " synthetic-token ", "role": " operator "])
        XCTAssertNoThrow(try validatePreservedValue(id, data: missing))
        let decoded = try decodeLegacyToken(missing)
        XCTAssertEqual(decoded.token, "synthetic-token"); XCTAssertEqual(decoded.role, "operator"); XCTAssertEqual(decoded.scopes, [])
        let mixed = try upgradeTestJSON(["version": 1, "token": "synthetic-token", "role": "operator",
            "scopes": [" operator.write ", NSNull(), 17, "", "operator.read", "operator.write"]])
        XCTAssertNoThrow(try validatePreservedValue(id, data: mixed))
        XCTAssertEqual(try decodeLegacyToken(mixed).scopes, ["operator.read", "operator.write"])
        for text in ["123", "true", "null", "\"not-an-object-token\"", "[]", "{}",
                     "{\"version\":1,\"token\":\" \",\"role\":\"operator\"}"] {
            XCTAssertThrowsError(try validatePreservedValue(id, data: Data(text.utf8)))
        }
        XCTAssertEqual(try decodeLegacyToken(Data(" legacy-not-json ".utf8)).token, "legacy-not-json")
    }

    func testResourcePathsRejectTraversalAbsoluteURLsUnknownLeavesAndControlCharacters() throws {
        let id = String(repeating: "a", count: 32)
        XCTAssertNoThrow(try validateResourcePath("Documents/incoming-share/\(id)/0.jpg"))
        XCTAssertNoThrow(try validateResourcePath("Documents/voice-drafts-v1/\(id)/audio.pcm"))
        for path in ["/Documents/incoming-share/\(id)/0.jpg", "Documents/incoming-share/\(id)/../0.jpg",
                     "file:///Documents/incoming-share/\(id)/0.jpg", "Documents/incoming-share/\(id)/0.jpg\n",
                     "Documents/voice-drafts-v1/\(id)/other.secret", "Documents/incoming-share/\(id)/%2e%2e"] {
            XCTAssertThrowsError(try validateResourcePath(path))
        }
    }
}
