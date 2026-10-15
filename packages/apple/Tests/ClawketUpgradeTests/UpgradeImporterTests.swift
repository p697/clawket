import Foundation
import XCTest
@testable import ClawketUpgrade

final class UpgradeImporterTests: XCTestCase, @unchecked Sendable {
    private func secure(_ key: String) -> LegacyValueID { .init(domain: .secure, key: key) }
    private func plain(_ key: String) -> LegacyValueID { .init(domain: .asyncStorage, key: key) }

    func testVerifiedCommitPreservesIdentityRegistryRoleTokensOpaqueDraftsAndPurchaseIdentity() async throws {
        let (identity, deviceID) = try upgradeTestIdentity()
        let operatorID = secure("clawket.deviceToken.\(deviceID)_relay_synthetic")
        let nodeID = secure("clawket.deviceToken.\(deviceID)_relay_synthetic_role_node")
        let question = plain("clawket.questionDraft.connection::agent::session::question")
        let purchaseID = LegacyValueID(domain: .userDefaults, key: UpgradeKeys.purchase)
        let values: [LegacyValueID: Data] = [secure(UpgradeKeys.identity): identity,
            secure(UpgradeKeys.registry): try upgradeTestRegistry(), plain(UpgradeKeys.marker): Data("123".utf8),
            operatorID: try upgradeTestJSON(["version": 1, "token": "synthetic-operator", "role": "operator", "scopes": ["operator.read"], "updatedAtMs": 100]),
            nodeID: try upgradeTestJSON(["version": 1, "token": "synthetic-node", "role": "node", "scopes": ["node.invoke"], "updatedAtMs": 200]),
            question: Data("{\"choice\":\"original 中文 answer\"}".utf8),
            plain("clawket.future-feature.v99"): Data("opaque unmodified bytes".utf8),
            purchaseID: try PropertyListSerialization.data(fromPropertyList: "$RCAnonymousID:synthetic", format: .binary, options: 0)]
        let source = UpgradeMemorySource(values: values)
        let (importer, secrets, plainStore, receipt) = try upgradeTestImporter(source)
        let result = try await importer.importIfNeeded()
        XCTAssertFalse(result.wasAlreadyImported); XCTAssertEqual(result.manifest.installState, .existing)
        XCTAssertEqual(result.identity?.deviceID, deviceID); XCTAssertEqual(result.registry?.connections.count, 6)
        XCTAssertEqual(result.purchaseIdentity.currentAppUserID, "$RCAnonymousID:synthetic")
        for id in [operatorID, nodeID, question, plain("clawket.future-feature.v99")] {
            let retained = try await importer.preservedValue(id); XCTAssertEqual(retained, values[id])
        }
        let secretState = await secrets.snapshot(), plainState = await plainStore.snapshot(), receiptState = await receipt.snapshot()
        XCTAssertTrue(secretState.keys.allSatisfy { $0.hasPrefix("upgrade.secure.") })
        XCTAssertTrue(plainState.keys.allSatisfy { !$0.hasPrefix("upgrade.secure.") })
        XCTAssertNotNil(receiptState[UpgradeImporter.manifestKey])
        let original = await source.snapshot(); XCTAssertEqual(original, values)
    }

    func testFailedStageWriteAndReadbackDoNotPublishReceiptAndRetryPreservesSource() async throws {
        let values = [plain("clawket.draft.v1"): Data("unsent original".utf8)]
        let source = UpgradeMemorySource(values: values)
        let (importer, _, plainStore, receipt) = try upgradeTestImporter(source)
        await plainStore.setFailure()
        do { _ = try await importer.importIfNeeded(); XCTFail("write failure published") } catch { }
        let firstReceipt = await receipt.snapshot(); XCTAssertTrue(firstReceipt.isEmpty)
        let original = await source.snapshot(); XCTAssertEqual(original, values)
        let result = try await importer.importIfNeeded(); XCTAssertFalse(result.wasAlreadyImported)
        let secondReceipt = await receipt.snapshot(); XCTAssertNotNil(secondReceipt[UpgradeImporter.manifestKey])

        let other = UpgradeMemorySource(values: values)
        let (corrupt, _, badStore, badReceipt) = try upgradeTestImporter(other)
        await badStore.setCorruptReads(true)
        do { _ = try await corrupt.importIfNeeded(); XCTFail("read-back failure published") }
        catch { XCTAssertEqual(error as? UpgradeFailure, .verificationFailed) }
        let absent = await badReceipt.snapshot(); XCTAssertTrue(absent.isEmpty)
        await badStore.setCorruptReads(false)
        _ = try await corrupt.importIfNeeded()
        let otherOriginal = await other.snapshot(); XCTAssertEqual(otherOriginal, values)
    }

    func testCancellationAndOverlappingAttemptCannotPublishOrReplaceData() async throws {
        let source = UpgradeMemorySource(values: [plain("clawket.draft.v1"): Data("keep me".utf8)])
        let (importer, _, _, receipt) = try upgradeTestImporter(source)
        await source.blockReads()
        let attempt = Task { try await importer.importIfNeeded() }
        var blocked = false
        for _ in 0..<1_000 {
            if await source.isBlocked() { blocked = true; break }
            await Task.yield()
        }
        XCTAssertTrue(blocked)
        do { _ = try await importer.importIfNeeded(); XCTFail("overlapping import accepted") } catch { XCTAssertEqual(error as? UpgradeFailure, .busy) }
        attempt.cancel(); await source.release()
        do { _ = try await attempt.value; XCTFail("canceled import completed") } catch { XCTAssertTrue(error is CancellationError) }
        let state = await receipt.snapshot(); XCTAssertTrue(state.isEmpty)
        let retry = try await importer.importIfNeeded(); XCTAssertEqual(retry.manifest.values.count, 1)
    }

    func testFreshInstallKeepsIdentityAndOneTimeGraceWithoutResurrectingConnectionsOrPreferences() async throws {
        let (identity, deviceID) = try upgradeTestIdentity()
        let graceID = secure("clawket.proEntitlement.v1.synthetic")
        let grace = try upgradeTestJSON(["version": 1, "freeConnectionId": "connection-0", "lastFreeConnectionSwitchAt": 10,
            "graceEvaluatedAt": 20, "graceUntil": 30])
        let source = UpgradeMemorySource(values: [secure(UpgradeKeys.identity): identity, secure(UpgradeKeys.registry): try upgradeTestRegistry(),
            secure("clawket.deviceToken.old"): Data("stale operator token".utf8), secure("clawket.themeMode.v1"): Data("dark".utf8), graceID: grace])
        let (importer, _, _, _) = try upgradeTestImporter(source)
        let result = try await importer.importIfNeeded()
        XCTAssertEqual(result.manifest.installState, .fresh); XCTAssertEqual(result.identity?.deviceID, deviceID); XCTAssertNil(result.registry)
        XCTAssertEqual(Set(result.manifest.values.map(\.id)), [secure(UpgradeKeys.identity), graceID])
        let savedGrace = try await importer.preservedValue(graceID); XCTAssertEqual(savedGrace, grace)
        let oldRegistry = try await importer.preservedValue(secure(UpgradeKeys.registry)); XCTAssertNil(oldRegistry)
    }

    func testCopiedResourcesSurviveNormalSourceConsumptionAndReadAcrossChunkBoundary() async throws {
        let path = "Documents/voice-drafts-v1/\(String(repeating: "a", count: 32))/audio.pcm"
        var audio = Data(repeating: 1, count: UpgradeLimits.chunkBytes)
        audio.append(Data(repeating: 2, count: UpgradeLimits.chunkBytes)); audio.append(Data([3, 4]))
        let source = UpgradeMemorySource(resources: [path: audio])
        let (importer, _, _, receipt) = try upgradeTestImporter(source)
        let first = try await importer.importIfNeeded()
        XCTAssertEqual(first.manifest.installState, .upgraded)
        XCTAssertEqual(first.manifest.resources.first?.byteCount, Int64(audio.count))
        XCTAssertEqual(first.manifest.resources.first?.chunks.count, 3)
        await source.discardResource(path)
        let restarted = try await importer.importIfNeeded()
        XCTAssertTrue(restarted.wasAlreadyImported)
        let portion = try await importer.readResource(path, offset: Int64(UpgradeLimits.chunkBytes - 1), maximumBytes: 3)
        XCTAssertEqual(portion, Data([1, 2, 2]))
        let ending = try await importer.readResource(path, offset: Int64(audio.count - 2), maximumBytes: 100)
        XCTAssertEqual(ending, Data([3, 4]))
        let end = try await importer.readResource(path, offset: Int64(audio.count), maximumBytes: 1)
        XCTAssertTrue(end.isEmpty)
        let savedReceipt = await receipt.snapshot(); XCTAssertNotNil(savedReceipt[UpgradeImporter.manifestKey])
    }

    func testLargeOpaqueValueIsChunkedAboveEightMiBWithoutTruncation() async throws {
        let id = plain("clawket.conversation-archives.v1")
        let bytes = Data(repeating: 65, count: 9 * 1024 * 1024 + 7)
        let source = UpgradeMemorySource(values: [id: bytes])
        let (importer, _, plainStore, _) = try upgradeTestImporter(source)
        let result = try await importer.importIfNeeded()
        XCTAssertEqual(result.manifest.values.first?.byteCount, bytes.count)
        let restored = try await importer.preservedValue(id); XCTAssertEqual(restored, bytes)
        let writes = await plainStore.snapshot()
        XCTAssertTrue(writes.values.allSatisfy { $0.count <= UpgradeLimits.chunkBytes })
    }

    func testCommittedImportIgnoresChangedLegacyValuesAndCorruptCopiesFailOnUse() async throws {
        let (identity, id) = try upgradeTestIdentity()
        let source = UpgradeMemorySource(values: [plain(UpgradeKeys.marker): Data("1".utf8), secure(UpgradeKeys.identity): identity])
        let (importer, secrets, _, _) = try upgradeTestImporter(source)
        _ = try await importer.importIfNeeded()
        let before = await source.readCount
        await source.replace(secure(UpgradeKeys.identity), data: Data("now corrupt at original source".utf8))
        let imported = try await importer.importIfNeeded()
        XCTAssertTrue(imported.wasAlreadyImported); XCTAssertEqual(imported.identity?.deviceID, id)
        let after = await source.readCount; XCTAssertEqual(after, before)
        await secrets.setCorruptReads(true)
        do { _ = try await importer.importIfNeeded(); XCTFail("corrupt active copy accepted") } catch { XCTAssertEqual(error as? UpgradeFailure, .verificationFailed) }
    }

    func testInvalidIdentityOrRegistryLeavesNoReceiptAndOriginalAvailable() async throws {
        for key in [UpgradeKeys.identity, UpgradeKeys.registry] {
            let values = [plain(UpgradeKeys.marker): Data("1".utf8), secure(key): Data("corrupt original".utf8)]
            let source = UpgradeMemorySource(values: values)
            let (importer, _, _, receipt) = try upgradeTestImporter(source)
            do { _ = try await importer.importIfNeeded(); XCTFail("corrupt core became empty") } catch { }
            let state = await receipt.snapshot(); XCTAssertTrue(state.isEmpty)
            let original = await source.snapshot(); XCTAssertEqual(original, values)
        }
    }

    func testCorruptCopiedResourceFailsOnUseWithoutReopeningOriginalAtLaunch() async throws {
        let path = "Documents/incoming-share/\(String(repeating: "a", count: 32))/0.txt"
        let source = UpgradeMemorySource(resources: [path: Data("owned original file".utf8)])
        let (importer, _, plainStore, _) = try upgradeTestImporter(source)
        _ = try await importer.importIfNeeded()
        await source.discardResource(path)
        await plainStore.setCorruptReads(true)
        let launch = try await importer.importIfNeeded(); XCTAssertTrue(launch.wasAlreadyImported)
        do { _ = try await importer.readResource(path, offset: 0); XCTFail("corrupt copy accepted") }
        catch { XCTAssertEqual(error as? UpgradeFailure, .verificationFailed) }
    }

    func testScopedOperatorAndNodeTokensStayBoundToImportedConnectionAndOriginalIdentity() async throws {
        let (identity, deviceID) = try upgradeTestIdentity()
        // Pinned from Mobile storage.ts SHA256(serverUrl + "::" + gatewayId) and SHA256("node").
        let relayHash = "c10d9f934ee8f8b1dfccf7f6cfed0a09e7506be36cfa0381c322e94f79f0e1d9"
        let roleHash = "545ea538461003efdc8c81c244531b003f6f26cfccf6c0073b3239fdedf49446"
        let opID = secure("clawket.deviceToken.\(deviceID)_relay_\(relayHash)")
        let nodeID = secure("clawket.deviceToken.\(deviceID)_relay_\(relayHash)_role_\(roleHash)")
        let values: [LegacyValueID: Data] = [plain(UpgradeKeys.marker): Data("1".utf8), secure(UpgradeKeys.identity): identity,
            secure(UpgradeKeys.registry): try upgradeTestRegistry(),
            opID: try upgradeTestJSON(["version": 1, "token": "synthetic-operator", "role": "operator", "scopes": ["operator.read"], "updatedAtMs": 101]),
            nodeID: try upgradeTestJSON(["version": 1, "token": "synthetic-node", "role": "node", "scopes": ["node.invoke"], "updatedAtMs": 202])]
        let source = UpgradeMemorySource(values: values)
        let (importer, _, _, _) = try upgradeTestImporter(source)
        let before = try await importer.deviceToken(connectionID: "connection-0", deviceID: deviceID)
        XCTAssertNil(before)
        let untouched = await source.readCount; XCTAssertEqual(untouched, 0)
        _ = try await importer.importIfNeeded()
        let op = try await importer.deviceToken(connectionID: "connection-0", deviceID: deviceID)
        let node = try await importer.deviceToken(connectionID: "connection-0", deviceID: deviceID, role: "node")
        XCTAssertEqual(op?.token, "synthetic-operator"); XCTAssertEqual(op?.role, "operator"); XCTAssertEqual(op?.updatedAtMs, 101)
        XCTAssertEqual(node?.token, "synthetic-node"); XCTAssertEqual(node?.role, "node"); XCTAssertEqual(node?.scopes, ["node.invoke"])
        let other = try await importer.deviceToken(connectionID: "connection-1", deviceID: deviceID, role: "node")
        let new = try await importer.deviceToken(connectionID: "not-an-imported-connection", deviceID: deviceID)
        let changed = try await importer.deviceToken(connectionID: "connection-0", deviceID: "different-device")
        XCTAssertNil(other); XCTAssertNil(new); XCTAssertNil(changed)
    }

    func testUnscopedLegacyTokenFallbackNeverGrantsNodeRole() async throws {
        let (identity, deviceID) = try upgradeTestIdentity()
        let source = UpgradeMemorySource(values: [plain(UpgradeKeys.marker): Data("1".utf8), secure(UpgradeKeys.identity): identity,
            secure(UpgradeKeys.registry): try upgradeTestRegistry(), secure("clawket.deviceToken.\(deviceID)"): Data("synthetic-legacy-operator".utf8)])
        let (importer, _, _, _) = try upgradeTestImporter(source)
        _ = try await importer.importIfNeeded()
        let op = try await importer.deviceToken(connectionID: "connection-0", deviceID: deviceID)
        let node = try await importer.deviceToken(connectionID: "connection-0", deviceID: deviceID, role: "node")
        XCTAssertEqual(op?.token, "synthetic-legacy-operator"); XCTAssertEqual(op?.scopes, [])
        XCTAssertNil(node)
        for index in 1..<6 {
            let foreign = try await importer.deviceToken(connectionID: "connection-\(index)", deviceID: deviceID)
            XCTAssertNil(foreign)
        }
    }

    func testScopedOnlyTokensRetainRawHTTPAndRegistryURLSpellingsBeforeNormalization() async throws {
        let (identity, deviceID) = try upgradeTestIdentity()
        let cases: [(String, Bool)] = [("http://Gateway.Example.invalid:80/base/", false),
            ("https://Gateway.Example.invalid:443/base/%2f/", false),
            ("https://REGISTRY.Example.invalid:443/base/", true),
            ("https://clawket-registry.clawket.workers.dev/", true)]
        for (rawURL, isRelay) in cases {
            var row = upgradeTestRecords()[0]
            var scope = rawURL
            while scope.hasSuffix("/") { scope.removeLast() }
            if isRelay {
                row["relay"] = ["serverUrl": rawURL, "gatewayId": "gateway-0", "clientToken": "synthetic-client"]
                scope += "::gateway-0"
            } else {
                row["url"] = rawURL; row["transportKind"] = "local"; row.removeValue(forKey: "relay")
            }
            let key = secure("clawket.deviceToken.\(deviceID)_\(isRelay ? "relay" : "url")_\(upgradeDigest(Data(scope.utf8)))")
            let source = UpgradeMemorySource(values: [plain(UpgradeKeys.marker): Data("1".utf8),
                secure(UpgradeKeys.identity): identity, secure(UpgradeKeys.registry): try upgradeTestRegistry([row]),
                key: Data("synthetic-raw-scope-token".utf8)])
            let (importer, _, _, _) = try upgradeTestImporter(source)
            let imported = try await importer.importIfNeeded()
            let connection = try XCTUnwrap(imported.registry?.connections.first)
            XCTAssertEqual(isRelay ? connection.legacyTokenScope.registryURL : connection.legacyTokenScope.gatewayURL, rawURL)
            if !isRelay { XCTAssertEqual(connection.url.scheme, rawURL.hasPrefix("https:") ? "wss" : "ws") }
            let token = try await importer.deviceToken(connectionID: connection.id, deviceID: deviceID)
            XCTAssertEqual(token?.token, "synthetic-raw-scope-token")
        }
    }
}
