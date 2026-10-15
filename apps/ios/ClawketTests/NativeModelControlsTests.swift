import ClawketPersistence
import ClawketTransport
import ClawketUI
import Foundation
import XCTest
@testable import ClawketRuntime
@testable import Clawket

private func controlsValue(backend: BackendKind = .codex, caller: String? = "s", global: Bool = false,
                           current: String? = "m", native: Bool = true,
                           reference: RuntimeModelControlsReference = .init(token: UUID()), generation: ConnectionGeneration = .init(),
                           actions: Set<RuntimeModelControlAction> = [.selectModel, .setThinkingLevel, .setFastMode, .setPermissions],
                           canSend: Bool = true, permissionRequired: Bool = false, uncertain: Bool = false,
                           configuredDefault: String? = "p/m") -> RuntimeModelControls {
    .init(connectionID: "c", backendKind: backend, generation: generation, sessionKey: caller,
        scope: global ? .global : .session(caller ?? "s"), reference: reference,
        models: [.init(id: "m", name: "Current", provider: "p", selected: current == "m", input: ["text", "image"], sortOrder: 0),
                 .init(id: "n", name: "Next", provider: "p", selected: current == "n", input: ["text"], sortOrder: 1)],
        currentModel: current, currentProvider: "p", configuredDefaultModel: configuredDefault,
        thinking: .init(current: "medium", levels: ["low", "medium"], writePath: native ? .native : .command),
        fastMode: native ? .init(enabled: false, available: true) : nil,
        permissions: native ? .init(mode: .known(.workspace), available: true, availableModes: [.readOnly, .workspace, .fullAccess],
            requiresConfirmation: permissionRequired, unencryptedTransport: false) : nil,
        allowedActions: actions, writeState: permissionRequired || uncertain ? .uncertain : .available, canSend: canSend, usesNativeSendBarrier: native)
}

private actor SettingsRuntime: NativeModelRuntime {
    struct Write: Sendable { let reference: RuntimeModelControlsReference; let choice: ModelControlChoice }
    var base: RuntimeModelControls
    var reads = 0
    var writes: [Write] = []
    var preparations: [RuntimeModelPermissionConfirmation] = []
    var plans: [RuntimeSettingCommand] = []
    var defaultReads = 0
    private var defaults: RuntimeModelControls?
    private var holdWrite = false
    private var holdPrepare = false
    private var ackOnly = false
    private var readFails = false
    private var readFailsAfterWrite = false
    private var wrongReceipt = false
    private var writeFailure: RuntimeFailure?
    private var barrierValue: RuntimeModelSendBarrier?
    private var writeContinuation: CheckedContinuation<Void, Never>?
    private var prepareContinuation: CheckedContinuation<Void, Never>?
    private var nextReadHeld = false
    private var readContinuation: CheckedContinuation<Void, Never>?

    init(_ value: RuntimeModelControls) { base = value }
    func configure(hold: Bool = false, holdPrepare: Bool = false, ackOnly: Bool = false, readFails: Bool = false,
                   readFailsAfterWrite: Bool = false, wrongReceipt: Bool = false, failure: RuntimeFailure? = nil) {
        holdWrite = hold; self.holdPrepare = holdPrepare; self.ackOnly = ackOnly; self.readFails = readFails
        self.readFailsAfterWrite = readFailsAfterWrite; self.wrongReceipt = wrongReceipt; writeFailure = failure
    }
    func setValue(_ value: RuntimeModelControls) { base = value; barrierValue = value.canSend ? nil : .permissionsRequired }
    func setDefault(_ value: RuntimeModelControls) { defaults = value }
    func holdNextRead() { nextReadHeld = true }
    func releaseRead() { readContinuation?.resume(); readContinuation = nil }
    func releaseWrite() { writeContinuation?.resume(); writeContinuation = nil; holdWrite = false }
    func releasePrepare() { prepareContinuation?.resume(); prepareContinuation = nil; holdPrepare = false }
    func modelControls(sessionKey: String?) async throws -> RuntimeModelControls {
        reads += 1
        if sessionKey == nil {
            defaultReads += 1
            guard let defaults else { throw RuntimeFailure(.unsupported) }
            return defaults
        }
        if readFails { throw RuntimeFailure(.network) }
        let captured = base
        if nextReadHeld { nextReadHeld = false; await withCheckedContinuation { readContinuation = $0 } }
        if captured.canSend { barrierValue = nil }
        return captured
    }
    func modelSendBarrier(sessionKey: String) -> RuntimeModelSendBarrier? { sessionKey == base.sessionKey ? barrierValue : nil }
    func selectModel(reference: RuntimeModelControlsReference, modelID: String, provider: String?) async throws -> RuntimeModelControlReceipt {
        try await write(reference, choice: .model(modelID), action: .selectModel)
    }
    func setThinkingLevel(reference: RuntimeModelControlsReference, level: String) async throws -> RuntimeModelControlReceipt {
        try await write(reference, choice: .thinking(level), action: .setThinkingLevel)
    }
    func setFastMode(reference: RuntimeModelControlsReference, enabled: Bool) async throws -> RuntimeModelControlReceipt {
        try await write(reference, choice: .fastMode(enabled), action: .setFastMode)
    }
    func preparePermissions(reference: RuntimeModelControlsReference, mode: RuntimeSessionPermissionMode) async -> RuntimeModelPermissionConfirmation {
        let token = RuntimeModelPermissionConfirmation(token: UUID(), reference: reference, mode: mode)
        preparations.append(token)
        if holdPrepare { await withCheckedContinuation { prepareContinuation = $0 } }
        return token
    }
    func setPermissions(confirmation: RuntimeModelPermissionConfirmation) async throws -> RuntimeModelControlReceipt {
        let mode: ModelPermissionMode = confirmation.mode == .fullAccess ? .fullAccess : confirmation.mode == .readOnly ? .readOnly : .workspace
        return try await write(confirmation.reference, choice: .permissions(mode), action: .setPermissions)
    }
    func prepareThinkingCommand(reference: RuntimeModelControlsReference, level: String) -> RuntimeSettingCommand {
        let plan = RuntimeSettingCommand(connectionID: base.connectionID, sessionKey: base.sessionKey!, settingsScope: base.scope,
            text: "/think \(level)", thinkingLevel: nil)
        plans.append(plan); return plan
    }
    private func write(_ reference: RuntimeModelControlsReference, choice: ModelControlChoice,
                       action: RuntimeModelControlAction) async throws -> RuntimeModelControlReceipt {
        writes.append(.init(reference: reference, choice: choice))
        if base.usesNativeSendBarrier { barrierValue = .pending }
        if holdWrite { await withCheckedContinuation { writeContinuation = $0 } }
        if let writeFailure { barrierValue = base.usesNativeSendBarrier ? .unconfirmed : nil; throw writeFailure }
        if readFailsAfterWrite { readFails = true }
        barrierValue = ackOnly && base.usesNativeSendBarrier ? .unconfirmed : nil
        return .init(reference: reference, connectionID: base.connectionID, sessionKey: wrongReceipt ? "foreign" : base.sessionKey,
            scope: base.scope, action: action, state: ackOnly ? nil : base)
    }
}

@MainActor private final class SettingsHost {
    var context = NativeSessionHostContext(activation: UUID(), wire: UUID(), selection: UUID())
    var selected = ConversationID(connectionID: "c", agentID: "a", sessionID: "s")
    var snapshots: [RuntimeModelControls] = []
    var plans: [RuntimeSettingCommand] = []
    var draft = NativeConversation(draft: "Unsent draft")
    var queueFailure = false
    var changes = 0
}

final class NativeModelControlsTests: XCTestCase, @unchecked Sendable {
    private var route: ConversationID { .init(connectionID: "c", agentID: "a", sessionID: "s") }
    @MainActor private func fixture(_ value: RuntimeModelControls = controlsValue()) -> (NativeModelControls, ClientPresentation, SettingsRuntime, SettingsHost) {
        let model = ClientPresentation(), runtime = SettingsRuntime(value), host = SettingsHost()
        let controller = NativeModelControls(presentation: model, runtime: runtime, context: { host.context }, selectedRoute: { host.selected },
            queue: { _, plan in
                host.plans.append(plan)
                if host.queueFailure { throw StoreFailure.unavailable }
                try host.draft.enqueueSettingCommand(plan.text, id: UUID().uuidString, timestampMs: 1)
            }, onSnapshot: { _, value, _ in host.snapshots.append(value) }, onChange: { host.changes += 1 })
        controller.update(.init(connectionID: "c", phase: .ready, backendKind: value.backendKind))
        return (controller, model, runtime, host)
    }
    @MainActor private func wait(_ check: @MainActor () async -> Bool) async throws {
        for _ in 0..<2_000 { if await check() { return }; try await Task.sleep(for: .milliseconds(2)) }
        XCTFail("Settings did not reach expected state"); throw StoreFailure.unavailable
    }
    @MainActor private func open(_ controller: NativeModelControls, _ model: ClientPresentation) async throws -> UUID {
        let id = UUID(); controller.open(route, id: id)
        try await wait { model.modelControls?.id == id && model.modelControls?.phase == .ready }; return id
    }

    @MainActor func testMissingActionsAndForeignChoicesCannotReachNativeWrites() async throws {
        let (controller, model, runtime, _) = fixture(controlsValue(actions: []))
        let id = try await open(controller, model)
        controller.choose(id, choice: .fastMode(true)); controller.choose(id, choice: .thinking("unlisted"))
        controller.choose(id, choice: .model("foreign")); controller.choose(UUID(), choice: .permissions(.fullAccess))
        let writes = await runtime.writes
        XCTAssertTrue(writes.isEmpty)
        XCTAssertFalse(model.modelControls?.modelSelection.isVisible == true)
    }

    @MainActor func testNativeWriteReservesSynchronouslyAndPausesOnlyItsInputScope() async throws {
        let (controller, model, runtime, _) = fixture()
        await runtime.configure(hold: true)
        let id = try await open(controller, model)
        controller.choose(id, choice: .fastMode(true)); controller.choose(id, choice: .fastMode(false))
        XCTAssertEqual(model.modelControls?.submitting, .fastMode(true))
        XCTAssertFalse(controller.permitsInput(route))
        XCTAssertTrue(controller.permitsInput(.init(connectionID: "c", agentID: "a", sessionID: "other")))
        do { try await controller.verifyInput(route); XCTFail("Reserved input passed") } catch {}
        try await wait { await runtime.writes.count == 1 }
        await runtime.releaseWrite()
        try await wait { model.modelControls?.submitting == nil }
        XCTAssertTrue(controller.permitsInput(route))
    }

    @MainActor func testPermissionsPrepareBeforeDialogAndConsumeFrozenConfirmationOnce() async throws {
        let (controller, model, runtime, _) = fixture()
        let id = try await open(controller, model)
        controller.choose(id, choice: .permissions(.fullAccess))
        try await wait { model.modelControls?.confirmation != nil }
        let frozen = try XCTUnwrap(model.modelControls?.confirmation)
        let prepared = await runtime.preparations
        XCTAssertEqual(prepared.count, 1)
        let before = await runtime.writes
        XCTAssertTrue(before.isEmpty)
        controller.confirm(frozen.id); controller.confirm(frozen.id); controller.dismissConfirmation(frozen.id)
        XCTAssertNil(model.modelControls?.confirmation)
        try await wait { await runtime.writes.count == 1 }
        let writes = await runtime.writes
        XCTAssertEqual(writes[0].reference, prepared[0].reference)
        XCTAssertEqual(writes[0].choice, .permissions(.fullAccess))
    }

    @MainActor func testDismissedAndReplacedPermissionDialogsNeverApproveReplacement() async throws {
        let (controller, model, runtime, _) = fixture()
        let id = try await open(controller, model)
        controller.choose(id, choice: .permissions(.fullAccess))
        try await wait { model.modelControls?.confirmation != nil }
        let frozen = try XCTUnwrap(model.modelControls?.confirmation)
        controller.dismiss(id)
        _ = try await open(controller, model)
        controller.confirm(frozen.id)
        let writes = await runtime.writes
        XCTAssertTrue(writes.isEmpty)
    }

    @MainActor func testClosedPermissionPreparationReleasesOnlyItsOwnReservation() async throws {
        let (controller, model, runtime, _) = fixture()
        await runtime.configure(holdPrepare: true)
        let id = try await open(controller, model)
        controller.choose(id, choice: .permissions(.workspace))
        try await wait { await runtime.preparations.count == 1 }
        controller.dismiss(id); await runtime.releasePrepare()
        let next = try await open(controller, model)
        try await wait { model.modelControls?.submitting == nil }
        controller.choose(next, choice: .fastMode(true))
        try await wait { await runtime.writes.count == 1 }
        XCTAssertNil(model.modelControls?.confirmation)
    }

    @MainActor func testAcknowledgedWriteWithFailedReadRemainsConfirmedWithoutFakeApplication() async throws {
        let (controller, model, runtime, _) = fixture()
        await runtime.configure(ackOnly: true, readFailsAfterWrite: true)
        let id = try await open(controller, model)
        controller.choose(id, choice: .fastMode(true))
        try await wait { model.modelControls?.phase == .unavailable }
        XCTAssertEqual(model.modelControls?.error, String(localized: "Setting confirmed. Refresh to see the latest state."))
        XCTAssertEqual(model.modelControls?.fastMode?.enabled, false)
        XCTAssertFalse(model.modelControls?.isUncertain == true)
        XCTAssertFalse(controller.permitsInput(route))
        let writes = await runtime.writes
        XCTAssertEqual(writes.count, 1)
        await runtime.configure()
        controller.refresh(id)
        try await wait { model.modelControls?.phase == .ready }
        XCTAssertTrue(controller.permitsInput(route))
        let after = await runtime.writes
        XCTAssertEqual(after.count, 1)
    }

    @MainActor func testUnknownModelChangeNeverReusesOldImageCapabilityOrBlocksOrdinaryText() async throws {
        let value = controlsValue(backend: .hermes, global: true, native: false, actions: [.selectModel, .prepareThinkingCommand])
        let (controller, model, runtime, _) = fixture(value)
        await runtime.configure(failure: .init(.timeout, delivery: .uncertain))
        let id = try await open(controller, model)
        let target = try XCTUnwrap(model.modelControls?.models.first { $0.title == "Next" }?.id)
        controller.choose(id, choice: .model(target))
        XCTAssertTrue(controller.isImageModelUnconfirmed(route))
        XCTAssertTrue(controller.isImageModelUnconfirmed(.init(connectionID: "c", agentID: "b", sessionID: "other")))
        XCTAssertTrue(controller.permitsInput(route))
        try await wait { model.modelControls?.phase == .unavailable }
        XCTAssertNil(model.modelControls?.submitting)
        XCTAssertTrue(controller.isImageModelUnconfirmed(route))
        await runtime.configure()
        controller.refresh(id)
        try await wait { model.modelControls?.phase == .ready }
        XCTAssertFalse(controller.isImageModelUnconfirmed(route))
        let writes = await runtime.writes
        XCTAssertEqual(writes.count, 1)
    }

    @MainActor func testReadFailureCannotInventAnInputOrStopBarrier() async throws {
        let (controller, model, runtime, _) = fixture()
        await runtime.configure(readFails: true)
        let id = UUID(); controller.open(route, id: id)
        try await wait { model.modelControls?.phase == .unavailable }
        XCTAssertTrue(controller.permitsInput(route))
        try await controller.verifyInput(route)
        XCTAssertTrue(controller.permitsInput(route))
    }

    @MainActor func testForeignReceiptCannotUnlockNativeInputOrAuthorizeImages() async throws {
        let (controller, model, runtime, _) = fixture()
        await runtime.configure(wrongReceipt: true)
        let id = try await open(controller, model)
        let target = try XCTUnwrap(model.modelControls?.models.last?.id)
        controller.choose(id, choice: .model(target))
        try await wait { model.modelControls?.phase == .unavailable }
        XCTAssertTrue(model.modelControls?.isUncertain == true)
        XCTAssertFalse(controller.permitsInput(route))
        XCTAssertTrue(controller.isImageModelUnconfirmed(route))
        XCTAssertNil(model.modelControls?.submitting)
    }

    @MainActor func testExplicitPermissionRepairIsAvailableDespitePriorUnknownPermissions() async throws {
        let (controller, model, runtime, _) = fixture(controlsValue(actions: [.setPermissions], canSend: false, uncertain: true))
        let id = try await open(controller, model)
        XCTAssertFalse(controller.permitsInput(route))
        XCTAssertTrue(model.modelControls?.isUncertain == true)
        XCTAssertTrue(model.modelControls?.permits(.permissions(.workspace)) == true)
        controller.choose(id, choice: .permissions(.workspace))
        try await wait { model.modelControls?.confirmation != nil }
        let writes = await runtime.writes
        XCTAssertTrue(writes.isEmpty)
        controller.dismissConfirmation(try XCTUnwrap(model.modelControls?.confirmation?.id))
        XCTAssertFalse(controller.permitsInput(route))
    }

    @MainActor func testFailedCommandPersistenceDoesNotClaimAnAppliedThinkingLevelOrReplaceDraft() async throws {
        let value = controlsValue(backend: .hermes, global: true, native: false, actions: [.prepareThinkingCommand])
        let (controller, model, runtime, host) = fixture(value)
        host.queueFailure = true
        let id = try await open(controller, model)
        controller.choose(id, choice: .thinking("low"))
        try await wait { model.modelControls?.phase == .unavailable }
        XCTAssertEqual(host.draft.draft, "Unsent draft")
        XCTAssertTrue(host.draft.messages.isEmpty)
        XCTAssertEqual(model.modelControls?.thinking?.current, "medium")
        XCTAssertNil(model.modelControls?.notice)
        let writes = await runtime.writes
        XCTAssertTrue(writes.isEmpty)
    }

    @MainActor func testOptionalConfiguredDefaultReadNeverReplacesConcreteSessionAuthority() async throws {
        for available in [false, true] {
            let value = controlsValue(backend: .openclaw, configuredDefault: nil)
            let (controller, model, runtime, _) = fixture(value)
            if available {
                await runtime.setDefault(controlsValue(backend: .openclaw, caller: nil, global: true,
                    generation: value.generation, configuredDefault: "p/n"))
            }
            let id = try await open(controller, model)
            try await wait { await runtime.defaultReads == 1 }
            if available { try await wait { model.modelControls?.models.first { $0.isConfiguredDefault }?.title == "Next" } }
            XCTAssertEqual(model.modelControls?.phase, .ready)
            XCTAssertEqual(model.modelControls?.models.first { $0.isConfiguredDefault }?.title, available ? "Next" : nil)
            controller.choose(id, choice: .fastMode(true))
            try await wait { await runtime.writes.count == 1 }
            let writes = await runtime.writes
            XCTAssertEqual(writes[0].reference, value.reference)
        }
    }

    @MainActor func testLegacyCatalogUsesCurrentDescriptorAndCannotBypassPendingSettings() async throws {
        let (controller, model, runtime, _) = fixture()
        await runtime.configure(hold: true)
        let id = try await open(controller, model)
        controller.choose(id, choice: .fastMode(true))
        let target = try XCTUnwrap(model.modelControls?.models.last?.id)
        controller.chooseLegacy(route, modelID: target)
        try await wait { await runtime.writes.count == 1 }
        let writes = await runtime.writes
        XCTAssertEqual(writes[0].choice, .fastMode(true))
        await runtime.releaseWrite()
    }

    @MainActor func testLateAcknowledgementAfterSameConnectionReplacementCannotPublish() async throws {
        let (controller, model, runtime, host) = fixture()
        await runtime.configure(hold: true)
        let id = try await open(controller, model)
        controller.choose(id, choice: .fastMode(true))
        try await wait { await runtime.writes.count == 1 }
        controller.invalidate(); host.context = .init(activation: UUID(), wire: UUID(), selection: UUID())
        controller.update(.init(connectionID: "c", phase: .ready, backendKind: .codex))
        let snapshots = host.snapshots.count, changes = host.changes
        await runtime.releaseWrite()
        try await wait { host.changes > changes }
        XCTAssertEqual(host.snapshots.count, snapshots)
        XCTAssertEqual(model.modelControls?.phase, .unavailable)
    }

    @MainActor func testPreWriteReadReturnedLateCannotReplaceAcknowledgedSettings() async throws {
        let (controller, model, runtime, host) = fixture()
        let id = try await open(controller, model)
        await runtime.holdNextRead()
        let read = Task { await controller.refreshSummary(route) }
        try await wait { await runtime.reads == 2 }
        // An active review is loading; a legacy event still has to read a new exact descriptor.
        let target = try NativeModelControls.modelKey(.init(id: "n", name: "Next", provider: "p", selected: false))
        controller.chooseLegacy(route, modelID: target)
        try await wait { await runtime.writes.count == 1 && model.modelControls?.phase == .ready }
        let count = host.snapshots.count
        await runtime.releaseRead(); await read.value
        XCTAssertEqual(host.snapshots.count, count)
        XCTAssertEqual(model.modelControls?.id, id)
    }

    @MainActor func testThinkingCommandUsesPersistedQueueAndPreservesComposerWithoutNativeWrite() async throws {
        let value = controlsValue(backend: .hermes, global: true, native: false, actions: [.selectModel, .prepareThinkingCommand])
        let (controller, model, runtime, host) = fixture(value)
        let resource = UUID(); host.draft.draftResourceIDs = [resource]
        let id = try await open(controller, model)
        controller.choose(id, choice: .thinking("low"))
        try await wait { host.plans.count == 1 && model.modelControls?.submitting == nil }
        XCTAssertEqual(host.plans[0].sessionKey, "s"); XCTAssertEqual(host.plans[0].settingsScope, .global)
        XCTAssertNil(host.plans[0].thinkingLevel)
        XCTAssertEqual(host.draft.draft, "Unsent draft"); XCTAssertEqual(host.draft.draftResourceIDs, [resource])
        XCTAssertEqual(host.draft.messages.first?.text, "/think low")
        XCTAssertEqual(host.draft.messages.first?.delivery, .queued)
        XCTAssertEqual(model.modelControls?.thinking?.current, "medium")
        let writes = await runtime.writes
        XCTAssertTrue(writes.isEmpty)
    }

    func testCommandQueueRejectsDuplicatesCapacityAndUnsafeRevisionWithoutReplacingDraft() throws {
        var value = NativeConversation(draft: "Keep me")
        try value.enqueueSettingCommand("/think low", id: "stable", timestampMs: 1)
        XCTAssertThrowsError(try value.enqueueSettingCommand("/think low", id: "stable", timestampMs: 2))
        XCTAssertEqual(value.messages.count, 1); XCTAssertEqual(value.draft, "Keep me")
        value.revision = Int64.max
        XCTAssertThrowsError(try value.enqueueSettingCommand("/think high", id: "next", timestampMs: 2))
        XCTAssertEqual(value.messages.count, 1)
        value.revision = 0
        for index in 1..<32 { try value.enqueueSettingCommand("/think low", id: "m\(index)", timestampMs: 2) }
        XCTAssertThrowsError(try value.enqueueSettingCommand("/think high", id: "overflow", timestampMs: 2))
        XCTAssertEqual(value.draft, "Keep me"); XCTAssertEqual(value.messages.count, 32)
    }
}
