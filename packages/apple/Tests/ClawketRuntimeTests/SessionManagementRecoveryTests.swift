import Foundation
import Testing
import ClawketPairing
import ClawketTransport
@testable import ClawketRuntime

@Suite(.serialized)
struct SessionManagementRecoveryTests {
    @Test(arguments: [BackendKind.codex, .claudeCode, .pi, .hermes])
    func knownNativeInputNeedsFreshPositiveContinuation(_ backend: BackendKind) async throws {
        var row = lifecycleRow(backend, key: "original", source: "native", native: true).object!
        let peer = LifecyclePeer(backend, rows: [.object(row)])
        let (runtime, socket, _, reader) = try lifecycleFixture(backend, peer: peer)
        try await runtime.activate(connection(backend)); _ = try await runtime.refreshRoster()
        await #expect(throws: RuntimeFailure.self) { try await runtime.send(sessionKey: "original", input: .init(text: "Do not take over")) }
        #expect(await socket.requests("chat.send").isEmpty)
        row["canContinue"] = .bool(true); await peer.setRows([.object(row)])
        _ = try await runtime.refreshRoster()
        // The fixture deliberately holds the send so the test inspects dispatch without claiming completion.
        await peer.hold("chat.send")
        let sending = Task { try await runtime.send(sessionKey: "original", input: .init(text: "Explicit continuation")) }
        if backend == .hermes {
            await #expect(throws: RuntimeFailure.self) { try await sending.value }
            #expect(await socket.requests("chat.send").isEmpty)
        } else {
            try await eventually { await socket.requests("chat.send").count == 1 }
            try await socket.reply(await socket.requests("chat.send")[0], payload: .object(["runId": .string("continuation")]))
            _ = try await sending.value
        }
        await runtime.disconnect(); reader.cancel()
    }

    @Test func rowReplacementAndRefreshRetireCapturedReferences() async throws {
        let (runtime, socket, peer, reader) = try lifecycleFixture(.codex)
        try await runtime.activate(connection(.codex)); _ = try await runtime.refreshRoster()
        let old = try await runtime.sessionManagement(sessionKey: "owned")
        var replacement = lifecycleRow(.codex).object!
        replacement["sessionId"] = .string("new-physical-session")
        try await socket.emit(event("codex.update", .object(["type": .string("session_info_update"), "session": .object(replacement)])))
        try await eventually {
            (try? await runtime.sessionManagement(sessionKey: "owned").session.sessionID) == "new-physical-session"
        }
        await #expect(throws: RuntimeFailure.self) { try await runtime.deleteSession(reference: old.reference) }
        #expect(await socket.requests("sessions.delete").isEmpty)
        let current = try await runtime.sessionManagement(sessionKey: "owned")
        await peer.setRows([.object(replacement)])
        _ = try await runtime.refreshRoster()
        await #expect(throws: RuntimeFailure.self) { try await runtime.resetSession(reference: current.reference) }
        #expect(await socket.requests("sessions.reset").isEmpty)
        await runtime.disconnect(); reader.cancel()
    }

    @Test(arguments: [false, true])
    func unknownWriteStaysHeldAcrossFreshCatalogAndNeverReplays(_ malformed: Bool) async throws {
        let clock = TestClock()
        let peer = LifecyclePeer(.codex)
        if malformed { await peer.corrupt("sessions.rename") } else { await peer.hold("sessions.rename") }
        let (runtime, socket, _, reader) = try lifecycleFixture(.codex, peer: peer, clock: clock)
        try await runtime.activate(connection(.codex)); await runtime.setForeground(false)
        _ = try await runtime.refreshRoster()
        let context = try await runtime.sessionManagement(sessionKey: "owned")
        let write = Task { try await runtime.renameSession(reference: context.reference, title: "New title") }
        try await eventually { await socket.requests("sessions.rename").count == 1 }
        if !malformed {
            try await eventually { clock.pendingDelays.contains(.seconds(20)) }
            let pending = try await runtime.sessionManagement(sessionKey: "owned")
            #expect(pending.writeState == .pending); #expect(pending.allowedActions.isEmpty)
            clock.advance(.seconds(21))
        }
        do { _ = try await write.value; Issue.record("Unproven write reported success") }
        catch let error as RuntimeFailure { #expect(error.delivery == (malformed ? .responseReceived : .uncertain)) }
        _ = try await runtime.refreshRoster()
        let held = try await runtime.sessionManagement(sessionKey: "owned")
        #expect(held.writeState == .uncertain); #expect(held.allowedActions.isEmpty)
        await #expect(throws: RuntimeFailure.self) { try await runtime.renameSession(reference: held.reference, title: "Try again") }
        #expect(await socket.requests("sessions.rename").count == 1)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func sameConnectionReactivationRejectsOldReceiptAndCannotDeleteReplacement() async throws {
        let first = LifecyclePeer(.codex), second = LifecyclePeer(.codex)
        await first.hold("sessions.rename")
        let oldSocket = ScriptSocket { try await first.handle($0, socket: $1) }
        let newSocket = ScriptSocket { try await second.handle($0, socket: $1) }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(oldSocket, newSocket))
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(.codex)); _ = try await runtime.refreshRoster()
        let old = try await runtime.sessionManagement(sessionKey: "owned")
        let write = Task { try await runtime.renameSession(reference: old.reference, title: "Old write") }
        try await eventually { await oldSocket.requests("sessions.rename").count == 1 }
        await runtime.disconnect(); try await runtime.activate(connection(.codex)); _ = try await runtime.refreshRoster()
        try await oldSocket.reply(await oldSocket.requests("sessions.rename")[0], payload: .object(["ok": .bool(true)]))
        do { _ = try await write.value; Issue.record("Retired write returned a current receipt") }
        catch let error as RuntimeFailure { #expect(error.code == .superseded) }
        await #expect(throws: RuntimeFailure.self) { try await runtime.deleteSession(reference: old.reference) }
        #expect(await newSocket.requests("sessions.delete").isEmpty)
        let current = try await runtime.sessionManagement(sessionKey: "owned")
        #expect(current.writeState == .available)
        _ = try await runtime.deleteSession(reference: current.reference)
        #expect(await newSocket.requests("sessions.delete").count == 1)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func newChallengeOnSameSocketRetiresOldSessionAuthority() async throws {
        let (runtime, socket, _, reader) = try lifecycleFixture(.openclaw)
        try await runtime.activate(connection(.openclaw)); _ = try await runtime.refreshRoster()
        let old = try await runtime.sessionManagement(sessionKey: "owned")
        try await socket.emit(event("connect.challenge", .object(["nonce": .string("new-challenge"), "ts": .number(123)])))
        try await eventually {
            let count = await socket.requests("connect").count, phase = await runtime.state.phase
            return count == 2 && phase == .ready
        }
        await #expect(throws: RuntimeFailure.self) { try await runtime.deleteSession(reference: old.reference) }
        #expect(await socket.requests("sessions.delete").isEmpty)
        await #expect(throws: RuntimeFailure.self) { try await runtime.sessionManagement(sessionKey: "owned") }
        _ = try await runtime.refreshRoster()
        #expect(try await runtime.sessionManagement(sessionKey: "owned").allowedActions.contains(.delete))
        await runtime.disconnect(); reader.cancel()
    }

    @Test func resetRetiresHistoryCompletionBeforeDispatch() async throws {
        let peer = LifecyclePeer(.codex)
        await peer.hold("chat.history"); await peer.hold("sessions.reset")
        let (runtime, socket, _, reader) = try lifecycleFixture(.codex, peer: peer)
        try await runtime.activate(connection(.codex)); _ = try await runtime.refreshRoster()
        let context = try await runtime.sessionManagement(sessionKey: "owned")
        let history = Task { try await runtime.loadSession(key: "owned") }
        try await eventually { await socket.requests("chat.history").count == 1 }
        let reset = Task { try await runtime.resetSession(reference: context.reference) }
        try await eventually { await socket.requests("sessions.reset").count == 1 }
        try await socket.reply(await socket.requests("chat.history")[0], payload: .object(["messages": .array([])]))
        try await socket.reply(await socket.requests("sessions.reset")[0], payload: .object(["ok": .bool(true)]))
        _ = try await reset.value
        await #expect(throws: RuntimeFailure.self) { try await history.value }
        await runtime.disconnect(); reader.cancel()
    }
}
