import ClawketPersistence
import ClawketTransport
import ClawketUI
import Foundation
import XCTest
@testable import ClawketRuntime
@testable import Clawket

private actor ManagementRuntime: NativeSessionRuntime {
    struct Write: Sendable { let action: RuntimeSessionAction; let reference: RuntimeSessionReference; let title: String? }
    var value: RuntimeSessionManagement
    var writes: [Write] = []
    var refreshes = 0
    var failure: RuntimeFailure?
    var refreshFails = false
    var hold = false
    var wrongReceipt = false
    var continuation: CheckedContinuation<Void, Never>?
    init(_ value: RuntimeSessionManagement) { self.value = value }
    func sessionManagement(sessionKey: String) -> RuntimeSessionManagement { value }
    func listArchivedSessions() -> [RuntimeSession] { [value.session] }
    func refreshRoster() throws -> RuntimeRoster {
        refreshes += 1
        if refreshFails { throw RuntimeFailure(.network) }
        return .init(connectionID: "c", agents: [], sessions: [value.session])
    }
    func set(_ value: RuntimeSessionManagement) { self.value = value }
    func configure(failure: RuntimeFailure? = nil, refreshFails: Bool = false, hold: Bool = false, wrongReceipt: Bool = false) {
        self.failure = failure; self.refreshFails = refreshFails; self.hold = hold; self.wrongReceipt = wrongReceipt
    }
    func release() { continuation?.resume(); continuation = nil; hold = false }
    func renameSession(reference: RuntimeSessionReference, title: String) async throws -> RuntimeSessionMutationReceipt {
        try await write(.rename, reference: reference, title: title)
    }
    func resetSession(reference: RuntimeSessionReference) async throws -> RuntimeSessionMutationReceipt { try await write(.reset, reference: reference) }
    func deleteSession(reference: RuntimeSessionReference) async throws -> RuntimeSessionMutationReceipt { try await write(.delete, reference: reference) }
    func archiveSession(reference: RuntimeSessionReference, archived: Bool) async throws -> RuntimeSessionMutationReceipt {
        try await write(archived ? .archive : .unarchive, reference: reference)
    }
    func branchSession(reference: RuntimeSessionReference, title: String?) async throws -> RuntimeSession {
        _ = try await write(.branch, reference: reference)
        return managementValue(key: "copy").session
    }
    private func write(_ action: RuntimeSessionAction, reference: RuntimeSessionReference, title: String? = nil) async throws -> RuntimeSessionMutationReceipt {
        let session = value.session
        writes.append(.init(action: action, reference: reference, title: title))
        if hold { await withCheckedContinuation { continuation = $0 } }
        if let failure { throw failure }
        return .init(reference: reference, connectionID: "c", sessionKey: wrongReceipt ? "foreign" : session.key,
                     sessionID: session.sessionID, action: action)
    }
}

private func managementValue(key: String = "s", actions: Set<RuntimeSessionAction> = [.rename, .reset, .delete, .archive, .unarchive, .branch]) -> RuntimeSessionManagement {
    let session = RuntimeSession(key: key, connectionID: "c", agentID: "a", title: "Original", kind: "direct", preview: nil,
        updatedAtMs: nil, lastActivityAtMs: nil, model: nil, modelProvider: nil, hasActiveRun: false, project: nil,
        canContinue: true, continuationBlockedReason: nil, source: "bridge", sessionID: "physical-" + key,
        archived: false, allowedActions: nil, raw: .object([:]))
    return .init(reference: .init(token: UUID()), session: session, allowedActions: actions, writeState: .available)
}

@MainActor private final class ManagementHost {
    var context = NativeSessionHostContext(activation: UUID(), wire: UUID(), selection: UUID())
    var outcomes: [NativeSessionMutationOutcome] = []
    var prepared: [NativeSessionMutationTarget] = []
    var preparationFails = false
}

final class NativeSessionManagementTests: XCTestCase, @unchecked Sendable {
    private var route: ConversationID { .init(connectionID: "c", agentID: "a", sessionID: "s") }
    @MainActor private func fixture(actions: Set<RuntimeSessionAction> = [.rename, .reset, .delete, .archive, .unarchive, .branch])
        -> (NativeSessionManagement, ClientPresentation, ManagementRuntime, ManagementHost) {
        let model = ClientPresentation(), runtime = ManagementRuntime(managementValue(actions: actions)), host = ManagementHost()
        let manager = NativeSessionManagement(presentation: model, runtime: runtime, context: { host.context }, prepare: { target in
            host.prepared.append(target)
            if host.preparationFails { throw StoreFailure.unavailable }
        }, outcome: { host.outcomes.append($0) }, onChange: {})
        manager.update(.init(connectionID: "c", phase: .ready, backendKind: .codex))
        return (manager, model, runtime, host)
    }
    @MainActor private func wait(_ check: @MainActor () async -> Bool) async throws {
        for _ in 0..<2_000 {
            if await check() { return }; try await Task.sleep(for: .milliseconds(2))
        }
        XCTFail("Management did not reach expected state"); throw StoreFailure.unavailable
    }
    @MainActor private func open(_ manager: NativeSessionManagement, _ model: ClientPresentation) async throws -> UUID {
        let id = UUID(); manager.open(route, id: id)
        try await wait { model.sessionManagement?.id == id && model.sessionManagement?.phase == .ready }; return id
    }

    @MainActor func testOnlyCurrentRuntimeActionsReachWireAndMissingActionsStayInert() async throws {
        let (manager, model, runtime, _) = fixture(actions: [.unarchive])
        let id = try await open(manager, model)
        XCTAssertEqual(model.sessionManagement?.actions, [.restore])
        manager.request(id, action: .delete); manager.rename(id, title: "Changed")
        manager.request(UUID(), action: .restore)
        let observed1 = await runtime.writes.isEmpty
        XCTAssertTrue(observed1)
    }

    @MainActor func testDestructiveConfirmationConsumesFrozenReferenceBeforeDismissalAndDuplicateTap() async throws {
        let (manager, model, runtime, host) = fixture()
        await runtime.configure(hold: true)
        let id = try await open(manager, model)
        manager.request(id, action: .reset)
        let confirmation = try XCTUnwrap(model.sessionManagement?.confirmation)
        let observed2 = await runtime.writes.isEmpty
        XCTAssertTrue(observed2)
        manager.confirm(confirmation.id); manager.confirm(confirmation.id); manager.dismissConfirmation(confirmation.id)
        XCTAssertNil(model.sessionManagement?.confirmation)
        XCTAssertEqual(model.sessionManagement?.submittingAction, .reset)
        XCTAssertFalse(manager.permitsInput(route))
        try await wait { await runtime.writes.count == 1 }
        XCTAssertEqual(host.prepared.first?.action, .reset)
        await runtime.release()
        try await wait { !host.outcomes.isEmpty }
        XCTAssertTrue(manager.permitsInput(route))
        let observed3 = await runtime.writes.count
        XCTAssertEqual(observed3, 1)
    }

    @MainActor func testDismissedOrReplacedConfirmationNeverTargetsReplacementReview() async throws {
        let (manager, model, runtime, _) = fixture()
        let old = try await open(manager, model)
        manager.request(old, action: .delete)
        let confirmation = try XCTUnwrap(model.sessionManagement?.confirmation)
        manager.dismissConfirmation(confirmation.id); manager.confirm(confirmation.id)
        manager.request(old, action: .delete)
        let second = try XCTUnwrap(model.sessionManagement?.confirmation)
        await runtime.set(managementValue())
        _ = try await open(manager, model)
        manager.confirm(second.id)
        let observed4 = await runtime.writes.isEmpty
        XCTAssertTrue(observed4)
    }

    @MainActor func testRenameChecksTrimmedBytesAndUTF16BeforeAnyPreparation() async throws {
        let (manager, model, runtime, host) = fixture()
        let id = try await open(manager, model)
        manager.rename(id, title: " \n "); manager.rename(id, title: "Original")
        manager.rename(id, title: String(repeating: "😀", count: 101))
        XCTAssertTrue(host.prepared.isEmpty)
        manager.rename(id, title: "  Actual name  ")
        try await wait { await runtime.writes.count == 1 }
        let observed5 = await runtime.writes.first?.title
        XCTAssertEqual(observed5, "Actual name")
    }

    @MainActor func testUnknownWriteLocksAcrossFreshReviewAndDoesNotReplayOnRefresh() async throws {
        let (manager, model, runtime, host) = fixture()
        await runtime.configure(failure: .init(.timeout, delivery: .uncertain))
        let id = try await open(manager, model)
        manager.request(id, action: .archive)
        try await wait { !host.outcomes.isEmpty }
        XCTAssertFalse(manager.permitsInput(route))
        let next = try await open(manager, model)
        manager.request(next, action: .archive); manager.refreshAcknowledged()
        XCTAssertTrue(model.sessionManagement?.isUncertain == true)
        XCTAssertNil(model.sessionManagement?.submittingAction)
        let observed6 = await runtime.writes.count
        XCTAssertEqual(observed6, 1)
        let observed7 = await runtime.refreshes
        XCTAssertEqual(observed7, 0)
    }

    @MainActor func testAcknowledgedWriteWaitsForExplicitPostACKReadWithoutRepeatingMutation() async throws {
        let (manager, model, runtime, host) = fixture()
        await runtime.configure(refreshFails: true)
        let id = try await open(manager, model)
        manager.request(id, action: .archive)
        try await wait { host.outcomes.count == 1 }
        XCTAssertFalse(manager.permitsInput(route))
        if case let .acknowledged(target, roster, _) = host.outcomes[0] {
            XCTAssertNil(roster); XCTAssertEqual(target.route, route)
        } else { XCTFail("ACK was converted into uncertain dispatch") }
        await runtime.configure()
        manager.refreshAcknowledged()
        try await wait { host.outcomes.count == 2 }
        XCTAssertTrue(manager.permitsInput(route))
        let observed8 = await runtime.writes.count
        XCTAssertEqual(observed8, 1)
        let observed9 = await runtime.refreshes
        XCTAssertEqual(observed9, 2)
    }

    @MainActor func testLateAcknowledgementAfterLeavingAndReturningCannotMutateReplacement() async throws {
        let (manager, model, runtime, host) = fixture()
        await runtime.configure(hold: true)
        let old = try await open(manager, model)
        manager.request(old, action: .archive)
        try await wait { await runtime.writes.count == 1 }
        manager.invalidate(); host.context = .init(activation: UUID(), wire: UUID(), selection: UUID())
        manager.update(.init(connectionID: "c", phase: .ready, backendKind: .codex))
        let replacement = try await open(manager, model)
        await runtime.release()
        for _ in 0..<20 { await Task.yield() }
        XCTAssertTrue(host.outcomes.isEmpty)
        XCTAssertEqual(model.sessionManagement?.id, replacement)
        XCTAssertTrue(manager.permitsInput(route))
    }

    @MainActor func testMismatchedAcknowledgementIsUncertainAndNeverRefreshesOrReplays() async throws {
        let (manager, model, runtime, host) = fixture()
        await runtime.configure(wrongReceipt: true)
        let id = try await open(manager, model)
        manager.request(id, action: .archive)
        try await wait { !host.outcomes.isEmpty }
        if case .uncertain = host.outcomes[0] {} else { XCTFail("Foreign receipt was accepted") }
        XCTAssertFalse(manager.permitsInput(route))
        let observed10 = await runtime.refreshes
        XCTAssertEqual(observed10, 0)
    }

    @MainActor func testStoragePreparationFailureDoesNotEnterWire() async throws {
        let (manager, model, runtime, host) = fixture()
        host.preparationFails = true
        let id = try await open(manager, model)
        manager.request(id, action: .archive)
        try await wait { !host.outcomes.isEmpty }
        if case .notDispatched = host.outcomes[0] {} else { XCTFail("Local storage failure implied a dispatch") }
        let observed11 = await runtime.writes.isEmpty
        XCTAssertTrue(observed11)
        XCTAssertTrue(manager.permitsInput(route))
    }

    @MainActor func testBranchOutcomeKeepsOriginalTargetAndReturnsDifferentOwnedConversation() async throws {
        let (manager, model, runtime, host) = fixture(actions: [.branch])
        let id = try await open(manager, model)
        manager.request(id, action: .branch)
        try await wait { !host.outcomes.isEmpty }
        if case let .acknowledged(target, roster, created) = host.outcomes[0] {
            XCTAssertEqual(target.route, route); XCTAssertEqual(target.previousSessionID, "physical-s")
            XCTAssertEqual(created?.key, "copy"); XCTAssertNotNil(roster)
        } else { XCTFail("Copy did not return its typed outcome") }
        let observed12 = await runtime.writes.first?.action
        XCTAssertEqual(observed12, .branch)
    }
    @MainActor func testCatalogReplacementRetiresMenuWithoutRetargetingAuthority() async throws {
        let (manager, model, runtime, _) = fixture()
        let id = try await open(manager, model)
        manager.request(id, action: .delete)
        let confirmation = try XCTUnwrap(model.sessionManagement?.confirmation)
        manager.catalogChanged(sessionKey: "unrelated")
        XCTAssertNotNil(model.sessionManagement?.confirmation)
        manager.catalogChanged(sessionKey: "s")
        manager.confirm(confirmation.id)
        XCTAssertEqual(model.sessionManagement?.phase, .unavailable)
        let writes = await runtime.writes
        XCTAssertTrue(writes.isEmpty)
    }

    func testResetPreparationPreservesDraftIdentityAndNonQueuedMessages() throws {
        var document = NativeConversation()
        document.draft = "Unsent IME draft"
        document.messages = [
            .init(id: "queued", role: .user, local: true, text: "Keep this", idempotencyKey: "same-key", delivery: .queued),
            .init(id: "unknown", role: .user, local: true, text: "Do not replay", delivery: .uncertain),
            .init(id: "remote", role: .assistant, text: "Retain history")
        ]
        XCTAssertTrue(try document.holdForSessionMutation())
        XCTAssertEqual(document.draft, "Unsent IME draft")
        XCTAssertEqual(document.messages.map(\.id), ["queued", "unknown", "remote"])
        XCTAssertEqual(document.messages[0].idempotencyKey, "same-key")
        XCTAssertEqual(document.messages.map(\.delivery), [.held, .uncertain, nil])
        let revision = document.revision
        XCTAssertFalse(try document.holdForSessionMutation())
        XCTAssertEqual(document.revision, revision)
        document.messages[0].delivery = .sending
        XCTAssertThrowsError(try document.holdForSessionMutation())
        XCTAssertEqual(document.messages[0].delivery, .sending)
    }

}
