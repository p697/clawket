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

private actor HistoryPausedExport: NativeHistoryExportPreparing {
    let cache: NativeHistoryExportCache
    private(set) var fileURL: URL?
    private var continuation: CheckedContinuation<Void, Never>?
    private var released = false
    init(cache: NativeHistoryExportCache) { self.cache = cache }
    func prepare(_ transcript: NativePublicTranscript, format: NativeHistoryExportFormat,
                 userLabel: String, assistantLabel: String, loadedOnlyLabel: String?) async throws -> NativeHistoryExportFile {
        let file = try await cache.prepare(transcript, format: format,
            userLabel: userLabel, assistantLabel: assistantLabel, loadedOnlyLabel: loadedOnlyLabel)
        fileURL = file.url
        if !released { await withCheckedContinuation { continuation = $0 } }
        return file
    }
    func preparePhysical(_ conversation: NativeConversation, title: String, format: NativeHistoryExportFormat,
                         userLabel: String, assistantLabel: String, loadedOnlyLabel: String) async throws -> NativeHistoryExportFile {
        try await cache.preparePhysical(conversation, title: title, format: format,
            userLabel: userLabel, assistantLabel: assistantLabel, loadedOnlyLabel: loadedOnlyLabel)
    }
    func prepareBulk(_ values: [NativeSavedConversation]) async throws -> NativeHistoryExportFile {
        try await cache.prepareBulk(values)
    }
    func resume() { released = true; continuation?.resume(); continuation = nil }
}

@MainActor
final class NativeHistorySharingTests: XCTestCase {
    private func request() -> NativeHistoryExportRequest {
        .init(context: .init(route: .init(connectionID: "c", agentID: "a", sessionID: "s"),
            activation: UUID(), wire: UUID(), selection: UUID(), epoch: UUID()), title: "Synthetic")
    }
    private var transcript: NativePublicTranscript {
        .init(title: "Synthetic", messages: [.init(role: .assistant, text: "Public text", timestampMs: nil, attachments: [])])
    }
    private func controller(root: URL, exports: any NativeHistoryExportPreparing,
                            current: @escaping (NativeHistoryExportContext) -> Bool) throws -> NativeHistoryController {
        try NativeHistoryController(saved: NativeSavedConversations(directory: root.appendingPathComponent("Saved")),
            conversations: NativeConversationStore(directory: root.appendingPathComponent("Current")), media: nil,
            runtime: RuntimeCoordinator(credentials: HistoryUnusedCredentials()), exports: exports, current: current)
    }
    private func preparedURL(_ gate: HistoryPausedExport) async throws -> URL {
        let deadline = ContinuousClock.now + .seconds(3)
        while ContinuousClock.now < deadline {
            if let url = await gate.fileURL { return url }
            await Task.yield()
        }
        await gate.resume()
        XCTFail("The actual export cache did not finish its file preparation")
        throw NativeHistoryFailure.changed
    }

    func testCompleteShareRechecksAccessAfterLoadButLocalSavedShareRemainsFree() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("history-complete-access-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let directory = root.appendingPathComponent("Exports"), cache = try NativeHistoryExportCache(directory: directory)
        let request = request(); var paid = true
        let controller = try controller(root: root, exports: cache, current: { paid && $0 == request.context })
        let allowed = try await controller.share(transcript, request: request, format: .markdown)
        XCTAssertTrue(FileManager.default.fileExists(atPath: allowed.url.path))
        await allowed.releaseIfUnpresented()
        paid = false
        do { _ = try await controller.share(transcript, request: request, format: .json); XCTFail("Loaded content cannot retain expired live access") }
        catch { XCTAssertEqual(error as? NativeHistoryExportFailure, .changed) }
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: []).isEmpty)
        let local = try await controller.share(transcript, format: .json)
        XCTAssertTrue(FileManager.default.fileExists(atPath: local.url.path))
        await local.releaseIfUnpresented()
    }

    func testCompleteShareExpiryDuringPreparationReleasesTheActualUnpresentedFile() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("history-complete-expiry-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let directory = root.appendingPathComponent("Exports"), cache = try NativeHistoryExportCache(directory: directory)
        let gate = HistoryPausedExport(cache: cache), request = request(); var paid = true
        let controller = try controller(root: root, exports: gate, current: { paid && $0 == request.context })
        let pending = Task { try await controller.share(transcript, request: request, format: .json) }
        defer { pending.cancel() }
        let url = try await preparedURL(gate)
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
        paid = false; controller.accessChanged(); await gate.resume()
        do { _ = try await pending.value; XCTFail("A delayed preparation cannot publish after expiry") }
        catch { XCTAssertEqual(error as? NativeHistoryExportFailure, .changed) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: []).isEmpty)
    }

    func testCompleteSharePhysicalEpochOrActivationChangeDuringPreparationCannotPublish() async throws {
        for changeEpoch in [true, false] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent("history-complete-scope-" + UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: root) }
            let cache = try NativeHistoryExportCache(directory: root.appendingPathComponent("Exports"))
            let gate = HistoryPausedExport(cache: cache), request = request(); var current = request.context
            let controller = try controller(root: root, exports: gate, current: { $0 == current })
            let pending = Task { try await controller.share(transcript, request: request, format: .markdown) }
            defer { pending.cancel() }
            let url = try await preparedURL(gate)
            current = .init(route: current.route, activation: changeEpoch ? current.activation : UUID(),
                wire: current.wire, selection: current.selection, epoch: changeEpoch ? UUID() : current.epoch)
            await gate.resume()
            do { _ = try await pending.value; XCTFail("A replacement physical/open scope cannot inherit a completed export") }
            catch { XCTAssertEqual(error as? NativeHistoryExportFailure, .changed) }
            XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
        }
    }

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
