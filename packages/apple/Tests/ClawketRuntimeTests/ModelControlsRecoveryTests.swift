import Foundation
import Testing
import ClawketTransport
@testable import ClawketRuntime

@Suite(.serialized)
struct ModelControlsRecoveryTests {
    @Test func explicitPermissionConfirmationIsFrozenSingleUseAndDismissalIsInert() async throws {
        let (runtime, socket, peer, reader) = try controlsFixture(.codex)
        await peer.setValue(controlsPayload(confirmation: .bool(true), mode: .null))
        try await runtime.activate(connection(.codex))
        let value = try await runtime.modelControls(sessionKey: "owned")
        #expect(!value.canSend); #expect(value.permissions?.mode == nil)
        #expect(await runtime.modelSendBarrier(sessionKey: "owned") == .permissionsRequired)
        let dismissed = try await runtime.preparePermissions(reference: value.reference, mode: .readOnly)
        #expect(dismissed.mode == .readOnly); #expect(dismissed.description == "RuntimeModelPermissionConfirmation")
        #expect(await socket.requests("models.permissions").isEmpty)
        await #expect(throws: RuntimeFailure.self) { try await runtime.send(sessionKey: "owned", input: .init(text: "held")) }
        try await runtime.abort(sessionKey: "owned")
        #expect(await socket.requests("chat.abort").count == 1)
        let approved = try await runtime.preparePermissions(reference: value.reference, mode: .workspace)
        let receipt = try await runtime.setPermissions(confirmation: approved)
        #expect(receipt.state?.permissions?.mode == .known(.workspace))
        #expect(receipt.state?.canSend == true)
        await #expect(throws: RuntimeFailure.self) { try await runtime.setPermissions(confirmation: approved) }
        await #expect(throws: RuntimeFailure.self) { try await runtime.setPermissions(confirmation: dismissed) }
        #expect(await socket.requests("models.permissions").count == 1)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func expiredConfirmationAndChangedDescriptorCannotDispatch() async throws {
        let clock = TestClock()
        let (runtime, socket, _, reader) = try controlsFixture(.codex, clock: clock)
        try await runtime.activate(connection(.codex))
        let value = try await runtime.modelControls(sessionKey: "owned")
        let confirmation = try await runtime.preparePermissions(reference: value.reference, mode: .fullAccess)
        clock.advance(.seconds(30))
        do { _ = try await runtime.setPermissions(confirmation: confirmation); Issue.record("Expired confirmation dispatched") }
        catch let failure as RuntimeFailure { #expect(failure.code == .requestExpired) }
        let stale = try await runtime.preparePermissions(reference: value.reference, mode: .workspace)
        _ = try await runtime.modelControls(sessionKey: "owned")
        await #expect(throws: RuntimeFailure.self) { try await runtime.setPermissions(confirmation: stale) }
        #expect(await socket.requests("models.permissions").isEmpty)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func pendingSettingsPauseOnlyThatSessionAndOldAPIOrReadCannotBypassThem() async throws {
        let (runtime, socket, peer, reader) = try controlsFixture(.codex)
        try await runtime.activate(connection(.codex))
        let value = try await runtime.modelControls(sessionKey: "owned")
        await peer.hold("models.fast")
        let write = Task { try await runtime.setFastMode(reference: value.reference, enabled: true) }
        try await eventually { await socket.requests("models.fast").count == 1 }
        #expect(await runtime.modelSendBarrier(sessionKey: "owned") == .pending)
        #expect(await runtime.modelSendBarrier(sessionKey: "other") == nil)
        let pending = try await runtime.modelControls(sessionKey: "owned")
        #expect(!pending.canSend); #expect(pending.writeState == .pending); #expect(pending.allowedActions.isEmpty)
        await #expect(throws: RuntimeFailure.self) { try await runtime.selectModel(id: "alias", sessionKey: "owned") }
        #expect(await socket.requests("models.select").isEmpty)
        try await socket.reply(await socket.requests("models.fast")[0], payload: controlsPayload())
        let receipt = try await write.value
        #expect(receipt.state?.canSend == true)
        // The descriptor obtained while pending cannot remain write authority after the ACK.
        await #expect(throws: RuntimeFailure.self) { try await runtime.setFastMode(reference: pending.reference, enabled: false) }
        await runtime.disconnect(); reader.cancel()
    }

    @Test func timeoutIsUncertainAndRequiresActualReadWithoutAutomaticReplay() async throws {
        let clock = TestClock()
        let (runtime, socket, peer, reader) = try controlsFixture(.codex, clock: clock)
        try await runtime.activate(connection(.codex))
        let value = try await runtime.modelControls(sessionKey: "owned")
        await peer.hold("models.fast")
        let write = Task { try await runtime.setFastMode(reference: value.reference, enabled: true) }
        try await eventually { await socket.requests("models.fast").count == 1 && clock.pendingDelays.contains(.seconds(45)) }
        clock.advance(.seconds(45))
        do { _ = try await write.value; Issue.record("Lost write ACK was accepted") }
        catch let failure as RuntimeFailure { #expect(failure.delivery == .uncertain) }
        #expect(await runtime.modelSendBarrier(sessionKey: "owned") == .unconfirmed)
        #expect(await socket.requests("models.fast").count == 1)
        // Older peers may omit the confirmation flag: a general unknown write can
        // recover from a real known mode, but a real permission requirement cannot.
        await peer.setValue(controlsPayload(confirmation: nil))
        let recovered = try await runtime.modelControls(sessionKey: "owned")
        #expect(recovered.canSend); #expect(await socket.requests("models.fast").count == 1)
        try await socket.reply(await socket.requests("models.fast")[0], payload: controlsPayload(confirmation: .bool(true)))
        for _ in 0..<20 { await Task.yield() }
        #expect(await runtime.modelSendBarrier(sessionKey: "owned") == nil)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func actualPermissionRequirementSurvivesMissingFlagsAndFastWrite() async throws {
        let (runtime, _, peer, reader) = try controlsFixture(.codex)
        await peer.setValue(controlsPayload(confirmation: .bool(true)))
        try await runtime.activate(connection(.codex))
        _ = try await runtime.modelControls(sessionKey: "owned")
        await peer.setValue(controlsPayload(confirmation: nil))
        let olderPeer = try await runtime.modelControls(sessionKey: "owned")
        #expect(!olderPeer.canSend); #expect(olderPeer.permissions?.requiresConfirmation == true)
        let fast = try await runtime.setFastMode(reference: olderPeer.reference, enabled: true)
        #expect(fast.state?.canSend == false)
        #expect(await runtime.modelSendBarrier(sessionKey: "owned") == .permissionsRequired)
        await peer.setValue(controlsPayload(confirmation: .bool(false)))
        #expect(try await runtime.modelControls(sessionKey: "owned").canSend)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func ackWithoutEffectiveMetadataIsNotAnAppliedNativeSetting() async throws {
        let (runtime, socket, peer, reader) = try controlsFixture(.codex)
        try await runtime.activate(connection(.codex))
        let value = try await runtime.modelControls(sessionKey: "owned")
        await peer.setAckOnly()
        let receipt = try await runtime.setFastMode(reference: value.reference, enabled: true)
        #expect(receipt.refreshRequired); #expect(receipt.state == nil)
        #expect(await runtime.modelSendBarrier(sessionKey: "owned") == .unconfirmed)
        #expect(await socket.requests("models.fast").count == 1)
        _ = try await runtime.modelControls(sessionKey: "owned")
        #expect(await runtime.modelSendBarrier(sessionKey: "owned") == nil)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func anUnrelatedSettingsReadFailureDoesNotBlockSendOrStop() async throws {
        let (runtime, socket, peer, reader) = try controlsFixture(.codex)
        try await runtime.activate(connection(.codex)); await peer.reject("models.list")
        await #expect(throws: RuntimeFailure.self) { try await runtime.modelControls(sessionKey: "owned") }
        #expect(await runtime.modelSendBarrier(sessionKey: "owned") == nil)
        _ = try await runtime.send(sessionKey: "owned", input: .init(text: "normal"))
        try await runtime.abort(sessionKey: "owned")
        #expect(await socket.requests("chat.send").count == 1); #expect(await socket.requests("chat.abort").count == 1)
        await runtime.disconnect(); reader.cancel()
    }

    @Test(arguments: [BackendKind.claudeCode, .pi, .localModel])
    func longNativeSelectionRetainsThe190SecondBudget(_ backend: BackendKind) async throws {
        let clock = TestClock()
        let (runtime, socket, peer, reader) = try controlsFixture(backend, clock: clock)
        try await runtime.activate(connection(backend))
        let value = try await runtime.modelControls(sessionKey: backend == .localModel ? "main" : "owned")
        await peer.hold("models.select")
        let write = Task { try await runtime.selectModel(reference: value.reference, modelID: "second") }
        try await eventually { await socket.requests("models.select").count == 1 && clock.pendingDelays.contains(.seconds(190)) }
        clock.advance(.seconds(46))
        try await socket.reply(await socket.requests("models.select")[0], payload: .object(["ok": .bool(true)]))
        #expect(try await write.value.refreshRequired)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func actualHeadHistoryThinkingIsFencedAndOlderPagesDoNotReplaceIt() async throws {
        let (runtime, _, peer, reader) = try controlsFixture(.hermes)
        try await runtime.activate(connection(.hermes))
        let history = try await runtime.loadSession(key: "owned")
        #expect(history.thinkingLevel == "high")
        let values = try await runtime.modelControls(sessionKey: "owned")
        // A model-selection read with its own actual value wins over history fallback.
        #expect(values.thinking?.current == "medium")
        var selection = controlsPayload().object!; selection.removeValue(forKey: "thinkingLevel")
        await peer.setValue(.object(selection))
        #expect(try await runtime.modelControls(sessionKey: "owned").thinking?.current == "high")
        await peer.setHistoryThinking("low")
        let older = try await runtime.loadSession(key: "owned", cursor: "older-page")
        #expect(older.thinkingLevel == "low")
        #expect(try await runtime.modelControls(sessionKey: "owned").thinking?.current == "high")
        let raw: JSONValue = .object(["messages": .array([]), "thinkingLevel": .string("invented")])
        #expect(try WireModels.history(raw, key: "owned", backend: .hermes).thinkingLevel == nil)
        await runtime.disconnect(); reader.cancel()
    }

    @Test(arguments: [false, true])
    func modelMetadataBeforeAckIsAcceptedButPhysicalTargetReplacementIsFenced(_ replaceTarget: Bool) async throws {
        let (runtime, socket, peer, reader) = try controlsFixture(.codex)
        try await runtime.activate(connection(.codex)); _ = try await runtime.refreshRoster()
        let value = try await runtime.modelControls(sessionKey: "owned")
        await peer.hold("models.select")
        let write = Task { try await runtime.selectModel(reference: value.reference, modelID: "second") }
        try await eventually { await socket.requests("models.select").count == 1 }
        var row = lifecycleRow(.codex).object!
        row["model"] = .string("second"); row["modelProvider"] = .string("provider")
        if replaceTarget { row["sessionId"] = .string("replacement-physical") }
        try await socket.emit(event("codex.update", .object(["type": .string("session_info_update"), "session": .object(row)])))
        try await eventually { (try? await runtime.sessionManagement(sessionKey: "owned").session.model) == "second" }
        try await socket.reply(await socket.requests("models.select")[0], payload: controlsPayload(model: "second"))
        if replaceTarget {
            do { _ = try await write.value; Issue.record("Replacement inherited old receipt") }
            catch let failure as RuntimeFailure { #expect(failure.code == .superseded); #expect(failure.delivery == .responseReceived) }
        } else {
            let receipt = try await write.value
            #expect(receipt.state?.currentModel == "second"); #expect(receipt.state?.canSend == true)
            // A ref issued from the ACK captures the latest metadata, not the old alias.
            _ = try await runtime.setFastMode(reference: receipt.state!.reference, enabled: false)
        }
        await runtime.disconnect(); reader.cancel()
    }

    @Test func aPreWriteReadCannotClearOrOverwriteTheLaterWrite() async throws {
        let (runtime, socket, peer, reader) = try controlsFixture(.codex)
        try await runtime.activate(connection(.codex))
        let value = try await runtime.modelControls(sessionKey: "owned")
        await peer.hold("models.list"); await peer.hold("models.fast")
        let stale = Task { try await runtime.modelControls(sessionKey: "owned") }
        try await eventually { await socket.requests("models.list").count == 2 }
        let writing = Task { try await runtime.setFastMode(reference: value.reference, enabled: true) }
        try await eventually { await socket.requests("models.fast").count == 1 }
        try await socket.reply(await socket.requests("models.list")[1], payload: controlsPayload())
        do { _ = try await stale.value; Issue.record("Pre-write read became current") }
        catch let failure as RuntimeFailure { #expect(failure.code == .superseded) }
        #expect(await runtime.modelSendBarrier(sessionKey: "owned") == .pending)
        try await socket.reply(await socket.requests("models.fast")[0], payload: controlsPayload())
        #expect(try await writing.value.state?.canSend == true)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func sameConnectionNewAuthenticationKeepsRealRequirementAndRejectsOldCallbacks() async throws {
        let first = ModelControlsPeer(.codex), second = ModelControlsPeer(.codex)
        await first.setValue(controlsPayload(confirmation: .bool(true))); await first.hold("models.fast")
        await second.setValue(controlsPayload(confirmation: nil))
        let oldSocket = ScriptSocket { try await first.handle($0, socket: $1) }
        let newSocket = ScriptSocket { try await second.handle($0, socket: $1) }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(oldSocket, newSocket))
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(.codex))
        let value = try await runtime.modelControls(sessionKey: "owned")
        let write = Task { try await runtime.setFastMode(reference: value.reference, enabled: true) }
        try await eventually { await oldSocket.requests("models.fast").count == 1 }
        await runtime.disconnect(); try await runtime.activate(connection(.codex))
        let fresh = try await runtime.modelControls(sessionKey: "owned")
        #expect(fresh.generation != value.generation); #expect(!fresh.canSend)
        try await oldSocket.reply(await oldSocket.requests("models.fast")[0], payload: controlsPayload())
        await #expect(throws: RuntimeFailure.self) { try await write.value }
        #expect(await runtime.modelSendBarrier(sessionKey: "owned") == .permissionsRequired)
        await #expect(throws: RuntimeFailure.self) { try await runtime.setFastMode(reference: value.reference, enabled: false) }
        let approval = try await runtime.preparePermissions(reference: fresh.reference, mode: .readOnly)
        #expect(try await runtime.setPermissions(confirmation: approval).state?.canSend == true)
        #expect(await oldSocket.requests("models.fast").count == 1)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func boundedUnresolvedSettingsNeverEvictAnOlderPermissionRequirement() throws {
        var state = ModelControlsState()
        for index in 0..<128 { try state.requirePermissions(.init(connectionID: "saved", scope: .session("scope-\(index)"))) }
        #expect(throws: RuntimeFailure.self) { try state.requirePermissions(.init(connectionID: "saved", scope: .session("overflow"))) }
        let oldest = ModelControlKey(connectionID: "saved", scope: .session("scope-0"))
        _ = try state.begin(key: oldest, nativeBarrier: true)
        state.retire()
        #expect(state.holds.count == 128); #expect(state.contexts.count == 128)
        #expect(state.holds[oldest]?.phase == .uncertain); #expect(state.holds[oldest]?.permissionsRequired == true)
        #expect(state.entries.isEmpty); #expect(state.confirmations.isEmpty)
    }

    @Test func resetRetiresControlsAndPendingModelAckWithoutClearingItsUnknownHold() async throws {
        let (runtime, socket, peer, reader) = try controlsFixture(.codex)
        try await runtime.activate(connection(.codex)); _ = try await runtime.refreshRoster()
        let management = try await runtime.sessionManagement(sessionKey: "owned")
        let value = try await runtime.modelControls(sessionKey: "owned")
        await peer.hold("models.fast"); await peer.hold("sessions.reset")
        let setting = Task { try await runtime.setFastMode(reference: value.reference, enabled: true) }
        try await eventually { await socket.requests("models.fast").count == 1 }
        let reset = Task { try await runtime.resetSession(reference: management.reference) }
        try await eventually { await socket.requests("sessions.reset").count == 1 }
        let pending = try await runtime.modelControls(sessionKey: "owned")
        #expect(pending.allowedActions.isEmpty)
        await #expect(throws: RuntimeFailure.self) { try await runtime.selectModel(id: "alias", sessionKey: "owned") }
        try await socket.reply(await socket.requests("models.fast")[0], payload: controlsPayload())
        do { _ = try await setting.value; Issue.record("Reset target inherited old model ACK") }
        catch let failure as RuntimeFailure { #expect(failure.code == .superseded); #expect(failure.delivery == .responseReceived) }
        try await socket.reply(await socket.requests("sessions.reset")[0], payload: .object(["ok": .bool(true)]))
        _ = try await reset.value
        #expect(await runtime.modelSendBarrier(sessionKey: "owned") == .unconfirmed)
        // Only a subsequent real settings read may reconcile this hold, never reset ACK.
        _ = try await runtime.modelControls(sessionKey: "owned")
        #expect(await runtime.modelSendBarrier(sessionKey: "owned") == nil)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func hermesGlobalHistoryThinkingUsesLatestInitiatedHeadAcrossCallerRoutes() async throws {
        let (runtime, socket, peer, reader) = try controlsFixture(.hermes)
        try await runtime.activate(connection(.hermes))
        await peer.hold("chat.history")
        let old = Task { try await runtime.loadSession(key: "conversation-a") }
        try await eventually { await socket.requests("chat.history").count == 1 }
        let latest = Task { try await runtime.loadSession(key: "conversation-b") }
        try await eventually { await socket.requests("chat.history").count == 2 }
        try await socket.reply(await socket.requests("chat.history")[1], payload: .object(["messages": .array([]), "thinkingLevel": .string("high")]))
        _ = try await latest.value
        try await socket.reply(await socket.requests("chat.history")[0], payload: .object(["messages": .array([]), "thinkingLevel": .string("low")]))
        _ = try await old.value
        var selection = controlsPayload().object!; selection.removeValue(forKey: "thinkingLevel")
        await peer.setValue(.object(selection))
        #expect(try await runtime.modelControls(sessionKey: "conversation-a").thinking?.current == "high")
        await runtime.disconnect(); reader.cancel()
    }
}
