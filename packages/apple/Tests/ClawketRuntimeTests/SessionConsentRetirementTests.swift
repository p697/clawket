import Foundation
import Testing
import ClawketTransport
@testable import ClawketRuntime

// Current SDK update shapes from ClaudeInteractions/Pi extension and Codex service;
// direct execution envelopes from OpenClaw/Hermes run-control. No fabricated physical IDs.
func retirementReview(_ backend: BackendKind, id: String, session: String?) -> JSONValue {
    if [.openclaw, .hermes].contains(backend) {
        var request = execution(id, decisions: ["allow-once", "allow-always", "deny"]).object!
        if let session { request["sessionKey"] = .string(session) }
        return event("exec.approval.requested", .object(["id": .string(id), "expiresAtMs": .null, "request": .object(request)]))
    }
    var question = backend == .claudeCode ? formQuestion().object! : inputQuestion(id).object!
    question["id"] = .string(id)
    return event(backend.rawValue + ".update", .object(["type": .string("question_requested"),
        "sessionKey": session.map(JSONValue.string) ?? .null, "question": .object(question)]))
}

func retirementReferences(_ runtime: RuntimeCoordinator) async throws -> [RuntimeRequestReference] {
    let value = try await runtime.pendingRequests()
    return value.approvals.map(\.reference) + value.questions.map(\.reference)
}

func respondToRetirementReview(_ runtime: RuntimeCoordinator, reference: RuntimeRequestReference, backend: BackendKind) async throws {
    if [.openclaw, .hermes].contains(backend) { try await runtime.resolve(reference, decision: .deny) }
    else if backend == .claudeCode { try await runtime.answer(reference, answer: .form(["q0": ["One"]])) }
    else { try await runtime.answer(reference, answer: .value("One")) }
}

func retirementFixture(_ backend: BackendKind, held: Set<String> = [], clock: any TransportClock = MonotonicTransportClock(), recorder: Events = Events()) throws
    -> (RuntimeCoordinator, ScriptSocket, Task<Void, Never>) {
    let peer = LifecyclePeer(backend, rows: [lifecycleRow(backend), lifecycleRow(backend, key: "other")])
    let socket = ScriptSocket(initial: backend == .openclaw ? [challengeFrame] : []) { request, socket in
        let method = request["method"]?.stringValue ?? ""
        if held.contains(method) { return }
        if ["questions.list", "approvals.list", "exec.approval.list"].contains(method) { try await socket.reply(request, payload: .array([])) }
        else if ["device.pair.list", "node.pair.list"].contains(method) { try await socket.reply(request, payload: .object(["pending": .array([])])) }
        else { try await peer.handle(request, socket: socket) }
    }
    let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket), clock: clock)
    return (runtime, socket, read(runtime, into: recorder))
}

private actor RetirementCompletion {
    var finished = false
    func finish() { finished = true }
}

@Suite(.serialized)
struct SessionConsentRetirementTests {
    @Test(arguments: [BackendKind.openclaw, .hermes, .codex, .claudeCode, .pi], [RuntimeSessionAction.reset, .delete])
    func destructiveWriteRetiresOnlyItsSessionBeforeDispatch(_ backend: BackendKind, _ action: RuntimeSessionAction) async throws {
        let method = action == .reset ? "sessions.reset" : "sessions.delete"
        let recorder = Events()
        let (runtime, socket, reader) = try retirementFixture(backend, held: [method], recorder: recorder)
        try await runtime.activate(connection(backend)); _ = try await runtime.refreshRoster()
        try await socket.emit(retirementReview(backend, id: "target", session: "owned"))
        try await socket.emit(retirementReview(backend, id: "other", session: "other"))
        try await eventually { (try? await retirementReferences(runtime).count) == 2 }
        let old = try await retirementReferences(runtime).first { $0.sessionKey == "owned" }!
        let other = try await retirementReferences(runtime).first { $0.sessionKey == "other" }!
        let confirmation = [.openclaw, .hermes].contains(backend) ? try await runtime.prepareApprovalConfirmation(old) : nil
        if backend == .openclaw {
            try await socket.emit(retirementReview(backend, id: "unscoped", session: nil))
            for kind in ["device", "node"] {
                try await socket.emit(event(kind + ".pair.requested", .object(["requestId": .string(kind), "ts": .number(42)])))
            }
            try await eventually { (try? await retirementReferences(runtime).count) == 5 }
        }
        let descriptor = try await runtime.sessionManagement(sessionKey: "owned")
        let write = Task {
            if action == .reset { return try await runtime.resetSession(reference: descriptor.reference) }
            return try await runtime.deleteSession(reference: descriptor.reference)
        }
        try await eventually { await socket.requests(method).count == 1 }
        #expect(try await retirementReferences(runtime).contains(other))
        #expect(try await retirementReferences(runtime).allSatisfy { $0.sessionKey != "owned" })
        try await eventually {
            await recorder.values.contains { value in
                if case .pendingRequests(let requests) = value {
                    return (requests.approvals.map(\.reference) + requests.questions.map(\.reference)).allSatisfy { $0.id != old.id }
                }
                return false
            }
        }
        #expect(await recorder.values.allSatisfy { value in
            if case .requestResolved(_, let reference, _) = value { return reference.id != old.id }
            return true
        })
        if backend == .openclaw { #expect(try await retirementReferences(runtime).filter { $0.sessionKey == nil }.count == 3) }
        await #expect(throws: RuntimeFailure.self) { try await respondToRetirementReview(runtime, reference: old, backend: backend) }
        if let confirmation {
            await #expect(throws: RuntimeFailure.self) { try await runtime.resolve(old, decision: .allowAlways, confirmation: confirmation) }
        }
        try await socket.emit(retirementReview(backend, id: "during-write", session: "owned"))
        try await respondToRetirementReview(runtime, reference: other, backend: backend)
        #expect(await socket.requests([.openclaw, .hermes].contains(backend) ? "exec.approval.resolve" : "questions.respond").count == 1)
        try await socket.reply(await socket.requests(method)[0], payload: .object(["ok": .bool(true)]))
        _ = try await write.value
        try await socket.emit(retirementReview(backend, id: "target", session: "owned"))
        try await socket.emit(retirementReview(backend, id: "fresh", session: "owned"))
        try await eventually { (try? await retirementReferences(runtime).filter { $0.sessionKey == "owned" }.count) == 1 }
        #expect(try await retirementReferences(runtime).allSatisfy { $0.id != old.id })
        let fresh = try await retirementReferences(runtime).first { $0.sessionKey == "owned" }!
        try await respondToRetirementReview(runtime, reference: fresh, backend: backend)
        #expect(await socket.requests(method).count == 1)
        await runtime.disconnect(); reader.cancel()
    }

    @Test(arguments: ["questions.list", "approvals.list"])
    func oldListCannotRestoreReviewOrStartNextSessionReadAfterReset(_ held: String) async throws {
        let (runtime, socket, reader) = try retirementFixture(.codex, held: [held, "sessions.reset"])
        try await runtime.activate(connection(.codex)); _ = try await runtime.refreshRoster()
        let list = Task { try await runtime.listPending(sessionKey: "owned") }
        try await eventually { await socket.requests(held).count == 1 }
        let descriptor = try await runtime.sessionManagement(sessionKey: "owned")
        let reset = Task { try await runtime.resetSession(reference: descriptor.reference) }
        try await eventually { await socket.requests("sessions.reset").count == 1 }
        try await socket.reply(await socket.requests("sessions.reset")[0], payload: .object(["ok": .bool(true)]))
        _ = try await reset.value
        try await socket.reply(await socket.requests(held)[0], payload: .array([held == "questions.list" ? inputQuestion("never-observed-old") : execution("never-observed-old")]))
        let result = try await list.value
        #expect(result.questions.isEmpty && result.approvals.isEmpty)
        if held == "questions.list" { #expect(await socket.requests("approvals.list").isEmpty) }
        #expect(try await retirementReferences(runtime).isEmpty)
        await runtime.disconnect(); reader.cancel()
    }

    @Test(arguments: [false, true])
    func unknownResetDoesNotUnlockFromListsMetadataOrPhysicalRead(_ malformed: Bool) async throws {
        let clock = TestClock()
        let (runtime, socket, reader) = try retirementFixture(.codex, held: ["sessions.reset", "chat.history"], clock: clock)
        try await runtime.activate(connection(.codex)); await runtime.setForeground(false)
        _ = try await runtime.refreshRoster()
        try await socket.emit(retirementReview(.codex, id: "old", session: "owned"))
        try await eventually { (try? await retirementReferences(runtime).count) == 1 }
        let old = try await retirementReferences(runtime)[0]
        let descriptor = try await runtime.sessionManagement(sessionKey: "owned")
        let reset = Task { try await runtime.resetSession(reference: descriptor.reference) }
        try await eventually { await socket.requests("sessions.reset").count == 1 }
        if malformed { try await socket.reply(await socket.requests("sessions.reset")[0], payload: .object(["ok": .bool(false)])) }
        else {
            try await eventually { clock.pendingDelays.contains(.seconds(20)) }
            clock.advance(.seconds(21))
        }
        await #expect(throws: RuntimeFailure.self) { try await reset.value }
        _ = try await runtime.refreshRoster()
        #expect(try await runtime.sessionManagement(sessionKey: "owned").writeState == .uncertain)
        let history = Task { try await runtime.loadSession(key: "owned") }
        try await eventually { await socket.requests("chat.history").count == 1 }
        try await socket.reply(await socket.requests("chat.history")[0], payload: .object(["sessionId": .string("actual-after-reset"), "messages": .array([])]))
        _ = try await history.value
        _ = try await runtime.listPending(sessionKey: "owned")
        #expect(await socket.requests("questions.list").isEmpty)
        try await socket.emit(retirementReview(.codex, id: "unproven", session: "owned"))
        try await socket.emit(retirementReview(.codex, id: "other", session: "other"))
        try await eventually { (try? await retirementReferences(runtime).count) == 1 }
        #expect(try await retirementReferences(runtime)[0].sessionKey == "other")
        await #expect(throws: RuntimeFailure.self) { try await runtime.answer(old, answer: .value("One")) }
        #expect(await socket.requests("questions.respond").isEmpty)
        #expect(await socket.requests("sessions.reset").count == 1)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func lateConsentAcknowledgementCannotResolveReplacementAfterReset() async throws {
        let (runtime, socket, reader) = try retirementFixture(.codex, held: ["questions.respond", "sessions.reset"])
        try await runtime.activate(connection(.codex)); _ = try await runtime.refreshRoster()
        try await socket.emit(retirementReview(.codex, id: "old", session: "owned"))
        try await eventually { (try? await retirementReferences(runtime).count) == 1 }
        let old = try await retirementReferences(runtime)[0]
        let completion = RetirementCompletion()
        let answer = Task {
            do { try await runtime.answer(old, answer: .value("One")); await completion.finish() }
            catch { await completion.finish(); throw error }
        }
        try await eventually { await socket.requests("questions.respond").count == 1 }
        let descriptor = try await runtime.sessionManagement(sessionKey: "owned")
        let reset = Task { try await runtime.resetSession(reference: descriptor.reference) }
        try await eventually { await socket.requests("sessions.reset").count == 1 }
        try await socket.reply(await socket.requests("sessions.reset")[0], payload: .object(["ok": .bool(true)]))
        _ = try await reset.value
        try await socket.emit(retirementReview(.codex, id: "old", session: "owned"))
        try await socket.emit(retirementReview(.codex, id: "new", session: "owned"))
        try await eventually { (try? await retirementReferences(runtime).count) == 1 }
        let current = try await retirementReferences(runtime)[0]
        try await eventually { await completion.finished }
        try await socket.reply(await socket.requests("questions.respond")[0], payload: .object(["ok": .bool(true)]))
        do { try await answer.value; Issue.record("Retired consent returned an active receipt") }
        catch let failure as RuntimeFailure { #expect(failure.code == .superseded) }
        #expect(try await retirementReferences(runtime) == [current])
        #expect(current != old)
        await runtime.disconnect(); reader.cancel()
    }

    @Test(arguments: [BackendKind.pi, .hermes])
    func knownTransportCapacityFailureRequiresNewReviewNotOldReference(_ backend: BackendKind) async throws {
        let (runtime, socket, reader) = try retirementFixture(backend, held: ["test.hold"])
        try await runtime.activate(connection(backend)); _ = try await runtime.refreshRoster()
        try await socket.emit(retirementReview(backend, id: "q", session: "owned"))
        try await eventually { (try? await retirementReferences(runtime).count) == 1 }
        let old = try await retirementReferences(runtime)[0]
        let confirmation = backend == .hermes ? try await runtime.prepareApprovalConfirmation(old) : nil
        let scope = try await runtime.scope()
        let occupying = (0..<128).map { _ in Task { try await runtime.rpc("test.hold", scope: scope) } }
        try await eventually { await socket.requests("test.hold").count == 128 }
        let descriptor = try await runtime.sessionManagement(sessionKey: "owned")
        do { _ = try await runtime.resetSession(reference: descriptor.reference); Issue.record("Capacity falsely dispatched") }
        catch let failure as RuntimeFailure { #expect(failure.code == .capacity); #expect(failure.delivery == .notDispatched) }
        #expect(await socket.requests("sessions.reset").isEmpty)
        #expect(try await retirementReferences(runtime).isEmpty)
        #expect(try await runtime.sessionManagement(sessionKey: "owned").writeState == .available)
        await #expect(throws: RuntimeFailure.self) { try await respondToRetirementReview(runtime, reference: old, backend: backend) }
        if let confirmation {
            await #expect(throws: RuntimeFailure.self) { try await runtime.resolve(old, decision: .allowAlways, confirmation: confirmation) }
        }
        for request in await socket.requests("test.hold") { try await socket.reply(request, payload: .null) }
        for task in occupying { _ = try await task.value }
        try await socket.emit(retirementReview(backend, id: "q", session: "owned"))
        try await eventually { (try? await retirementReferences(runtime).count) == 1 }
        let renewed = try await retirementReferences(runtime)[0]
        #expect(renewed != old)
        if let confirmation {
            await #expect(throws: RuntimeFailure.self) { try await runtime.resolve(renewed, decision: .allowAlways, confirmation: confirmation) }
            let freshConfirmation = try await runtime.prepareApprovalConfirmation(renewed)
            try await runtime.resolve(renewed, decision: .allowAlways, confirmation: freshConfirmation)
        } else { try await respondToRetirementReview(runtime, reference: renewed, backend: backend) }
        #expect(await socket.requests(backend == .hermes ? "exec.approval.resolve" : "questions.respond").count == 1)
        await runtime.disconnect(); reader.cancel()
        for task in occupying { task.cancel(); _ = try? await task.value }
    }

    @Test func renameKeepsCurrentQuestionAndDoesNotManufactureResolution() async throws {
        let (runtime, socket, reader) = try retirementFixture(.codex)
        try await runtime.activate(connection(.codex)); _ = try await runtime.refreshRoster()
        try await socket.emit(retirementReview(.codex, id: "q", session: "owned"))
        try await eventually { (try? await retirementReferences(runtime).count) == 1 }
        let old = try await retirementReferences(runtime)[0]
        let descriptor = try await runtime.sessionManagement(sessionKey: "owned")
        _ = try await runtime.renameSession(reference: descriptor.reference, title: "Renamed")
        #expect(try await retirementReferences(runtime) == [old])
        try await runtime.answer(old, answer: .value("One"))
        #expect(await socket.requests("questions.respond").count == 1)
        await runtime.disconnect(); reader.cancel()
    }
}
