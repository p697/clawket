import ClawketRuntime
import Foundation
import XCTest
@testable import Clawket

private actor HistoryLeaseCounter: NativeShareLease {
    var releases = 0
    func release() { releases += 1 }
}

private actor HistoryUnusedCredentials: DeviceCredentialProvider {
    func identity() throws -> RuntimeDeviceIdentity { throw RuntimeFailure(.unsupported) }
    func readToken(scope: DeviceTokenScope) -> RuntimeDeviceToken? { nil }
    func writeToken(_ token: RuntimeDeviceToken, scope: DeviceTokenScope) throws { throw RuntimeFailure(.unsupported) }
    func deleteToken(scope: DeviceTokenScope) throws { throw RuntimeFailure(.unsupported) }
}

@MainActor
final class NativeHistorySharingTests: XCTestCase {
    func testOldPreparationAndDeferCannotPublishOrUnlockAReplacementAfterReappearance() throws {
        var state = NativeHistoryOperation()
        let first = try XCTUnwrap(state.begin()); XCTAssertNil(state.begin())
        state.retire()
        let replacement = try XCTUnwrap(state.begin())
        XCTAssertFalse(state.owns(first)); XCTAssertTrue(state.owns(replacement))
        state.finish(first); XCTAssertTrue(state.isBusy); XCTAssertNil(state.begin())
        state.finish(replacement); XCTAssertFalse(state.isBusy)
    }
    func testUnpresentedAndCreatedButUnshownControllersReleaseExactlyOnce() async {
        for created in [false, true] {
            let lease = HistoryLeaseCounter(), share = NativeMediaShare(url: URL(fileURLWithPath: "/synthetic/Clawket.md"), shareLease: lease)
            if created { share.controllerCreated() }
            await share.releaseIfUnpresented(controllerDismantled: true)
            await share.completed(); await share.releaseIfUnpresented(controllerDismantled: true)
            let count = await lease.releases; XCTAssertEqual(count, 1)
        }
    }

    func testActuallyPresentedShareKeepsItsFileUntilSystemCompletion() async {
        let lease = HistoryLeaseCounter(), share = NativeMediaShare(url: URL(fileURLWithPath: "/synthetic/Clawket.json"), shareLease: lease)
        share.controllerCreated(); share.appeared()
        await share.releaseIfUnpresented(); await share.releaseIfUnpresented(controllerDismantled: true)
        let retained = await lease.releases; XCTAssertEqual(retained, 0)
        await share.completed(); await share.completed()
        let released = await lease.releases; XCTAssertEqual(released, 1)
    }

    func testExportFileQuotaNeverEvictsAnActiveShareAndCompletionRemovesOnlyItsCopy() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("history-sharing-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let source = root.appendingPathComponent("original.json"), bytes = Data("protected public snapshot".utf8)
        try bytes.write(to: source)
        let cache = try NativeHistoryExportCache(directory: root.appendingPathComponent("Exports"))
        var copies: [NativeHistoryExportFile] = []
        for _ in 0..<16 { copies.append(try await cache.prepare(bytes, format: .json)) }
        do { _ = try await cache.prepare(bytes, format: .json); XCTFail("An active system share cannot be evicted") }
        catch { XCTAssertEqual(error as? NativeHistoryFailure, .full) }
        XCTAssertTrue(copies.allSatisfy { FileManager.default.fileExists(atPath: $0.url.path) })
        await copies[0].lease.release(); await copies[0].lease.release()
        XCTAssertFalse(FileManager.default.fileExists(atPath: copies[0].url.path))
        XCTAssertEqual(try Data(contentsOf: source), bytes)
        let replacement = try await cache.prepare(bytes, format: .markdown)
        XCTAssertEqual(replacement.url.lastPathComponent, "Clawket.md")
        XCTAssertEqual(try Data(contentsOf: replacement.url), bytes)
        for copy in copies.dropFirst() { await copy.lease.release() }
        await replacement.lease.release()
        let remaining = try FileManager.default.contentsOfDirectory(at: root.appendingPathComponent("Exports"), includingPropertiesForKeys: [])
        XCTAssertTrue(remaining.isEmpty)
    }

    func testUnverifiedEntitlementCannotOpenBulkReadsOrCreateAnExportFile() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("history-access-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let runtime = try RuntimeCoordinator(credentials: HistoryUnusedCredentials())
        let exports = root.appendingPathComponent("Exports")
        let controller = try NativeHistoryController(saved: NativeSavedConversations(directory: root.appendingPathComponent("Saved")),
            conversations: NativeConversationStore(directory: root.appendingPathComponent("Current")), media: nil,
            runtime: runtime, exports: NativeHistoryExportCache(directory: exports), current: { _ in false })
        XCTAssertFalse(controller.access().search); XCTAssertFalse(controller.access().bulkExport)
        do { _ = try await controller.shareAll(["not-a-stored-id"]); XCTFail("No guessed Pro status") }
        catch { XCTAssertEqual(error as? NativeHistoryFailure, .unavailable) }
        let files = try FileManager.default.contentsOfDirectory(at: exports, includingPropertiesForKeys: [])
        XCTAssertTrue(files.isEmpty)
    }
}
