import Foundation
import Testing
import ClawketTransport
@testable import ClawketRuntime

@Suite(.serialized)
struct ConsentLifecycleTests {
    @Test func newerEmptyListWinsEvenWhenOlderReadHasNeverSeenRequest() async throws {
        let socket = ScriptSocket { request, socket in
            if request["method"]?.stringValue == "connect" { try await socket.reply(request, payload: health(.pi)) }
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(.pi))
        let older = Task { try await runtime.listPending(sessionKey: "s") }
        try await eventually { await socket.requests("questions.list").count == 1 }
        let newer = Task { try await runtime.listPending(sessionKey: "s") }
        try await eventually { await socket.requests("questions.list").count == 2 }
        let requests = await socket.requests("questions.list")
        try await socket.reply(requests[1], payload: .array([]))
        _ = try await newer.value
        try await socket.reply(requests[0], payload: .array([inputQuestion("stale")]))
        #expect(try await older.value.questions.isEmpty)
        #expect(try await runtime.pendingRequests().questions.isEmpty)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func lateListCannotResurrectResolvedQuestionOrReplaceNewerReview() async throws {
        let socket = ScriptSocket { request, socket in
            if request["method"]?.stringValue == "connect" { try await socket.reply(request, payload: health(.pi)) }
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(.pi))
        let list = Task { try await runtime.listPending(sessionKey: "s") }
        try await eventually { await socket.requests("questions.list").count == 1 }
        try await socket.emit(event("pi.update", .object(["type": .string("question_resolved"), "sessionKey": .string("s"), "questionId": .string("gone")])))
        try await socket.emit(event("pi.update", .object(["type": .string("question_requested"), "sessionKey": .string("s"), "question": inputQuestion("new")])))
        try await eventually { (try? await runtime.pendingRequests().questions.count) == 1 }
        let reference = try await runtime.pendingRequests().questions[0].reference
        let request = await socket.requests("questions.list")[0]
        var old = inputQuestion("new").object!; old["title"] = .string("Old title")
        try await socket.reply(request, payload: .array([inputQuestion("gone"), .object(old)]))
        let result = try await list.value
        #expect(result.questions.count == 1); #expect(result.questions[0].reference == reference)
        #expect(result.questions[0].title == "Choose a response")
        await runtime.disconnect(); reader.cancel()
    }

    @Test func doubleSubmitIsLockedAndTimeoutNeverOffersBlindRetry() async throws {
        let clock = TestClock()
        let socket = ScriptSocket { request, socket in
            if ["connect", "health"].contains(request["method"]?.stringValue ?? "") { try await socket.reply(request, payload: health(.codex)) }
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket), clock: clock)
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(.codex))
        try await socket.emit(event("codex.update", .object(["type": .string("approval_requested"), "sessionKey": .string("s"), "approval": execution()])))
        try await eventually { (try? await runtime.pendingRequests().approvals.count) == 1 }
        let reference = try await runtime.pendingRequests().approvals[0].reference
        let write = Task { try await runtime.resolve(reference, decision: .allowOnce) }
        try await eventually { await socket.requests("approvals.resolve").count == 1 }
        do { try await runtime.resolve(reference, decision: .deny); Issue.record("Duplicate dispatch accepted") }
        catch let failure as RuntimeFailure { #expect(failure.code == .requestBusy) }
        try await eventually { clock.pendingDelays.contains { $0 <= .seconds(20) } }
        clock.advance(.seconds(20))
        do { try await write.value; Issue.record("Missing reply accepted") }
        catch let failure as RuntimeFailure { #expect(failure.delivery == .uncertain); #expect(!failure.retryable) }
        #expect(try await runtime.pendingRequests().approvals[0].state == .uncertain)
        try await socket.emit(event("codex.update", .object(["type": .string("approval_requested"), "sessionKey": .string("s"),
            "approval": execution(command: "changed metadata cannot unlock an unknown write")])))
        try await socket.emit(event("codex.update", .object(["type": .string("question_requested"), "sessionKey": .string("s"), "question": formQuestion()])))
        try await eventually { (try? await runtime.pendingRequests().questions.count) == 1 }
        #expect(try await runtime.pendingRequests().approvals[0].reference == reference)
        #expect(try await runtime.pendingRequests().approvals[0].state == .uncertain)
        do { try await runtime.resolve(reference, decision: .allowOnce); Issue.record("Uncertain write replayed") }
        catch let failure as RuntimeFailure { #expect(failure.code == .requestBusy) }
        #expect(await socket.requests("approvals.resolve").count == 1)
        try await socket.emit(event("codex.update", .object(["type": .string("approval_resolved"), "approvalId": .string("approval"), "decision": .string("allow-once")])))
        try await eventually { (try? await runtime.pendingRequests().approvals.isEmpty) == true }
        await runtime.disconnect(); reader.cancel()
    }

    @Test func malformedWriteReplyIsHeldAndCannotBeSubmittedAgain() async throws {
        let socket = ScriptSocket { request, socket in
            try await socket.reply(request, payload: request["method"]?.stringValue == "connect" ? health(.codex) : .object([:]))
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(.codex))
        try await socket.emit(event("codex.update", .object(["type": .string("approval_requested"), "sessionKey": .string("s"), "approval": execution()])))
        try await eventually { (try? await runtime.pendingRequests().approvals.count) == 1 }
        let reference = try await runtime.pendingRequests().approvals[0].reference
        do { try await runtime.resolve(reference, decision: .deny); Issue.record("Malformed ACK accepted") }
        catch let failure as RuntimeFailure { #expect(failure.code == .invalidResponse); #expect(failure.delivery == .responseReceived) }
        #expect(try await runtime.pendingRequests().approvals[0].state == .uncertain)
        do { try await runtime.resolve(reference, decision: .deny); Issue.record("Malformed reply unlocked retry") }
        catch let failure as RuntimeFailure { #expect(failure.code == .requestBusy) }
        #expect(await socket.requests("approvals.resolve").count == 1)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func expiryAndAlwaysConfirmationDeadlinesUseMonotonicClock() async throws {
        let clock = TestClock()
        let socket = ScriptSocket { request, socket in try await socket.reply(request, payload: health(.hermes)) }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket), clock: clock)
        let recorder = Events(), reader = read(runtime, into: recorder)
        try await runtime.activate(connection(.hermes))
        try await socket.emit(event("exec.approval.requested", .object(["id": .string("expiring"), "expiresAtMs": .number(Double(RuntimeCoordinator.wallMilliseconds() + 1_000)),
            "request": .object(["sessionKey": .string("s"), "command": .string("review"), "decisions": .array([.string("allow-always"), .string("deny")])])])))
        try await eventually { (try? await runtime.pendingRequests().approvals.count) == 1 }
        let reference = try await runtime.pendingRequests().approvals[0].reference
        let confirmation = try await runtime.prepareApprovalConfirmation(reference)
        clock.advance(.seconds(2))
        do { try await runtime.resolve(reference, decision: .allowAlways, confirmation: confirmation); Issue.record("Expired request dispatched") }
        catch let failure as RuntimeFailure { #expect([.requestExpired, .requestUnavailable].contains(failure.code)) }
        #expect(await socket.requests("exec.approval.resolve").isEmpty)
        try await eventually { await recorder.values.contains { if case .requestResolved(_, _, .expired) = $0 { true } else { false } } }
        await runtime.disconnect(); reader.cancel()
    }

    @Test func freshAuthenticationOnSameSocketInvalidatesOldReferences() async throws {
        let socket = ScriptSocket(initial: [challengeFrame]) { request, socket in try await socket.reply(request, payload: hello) }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(.openclaw))
        try await socket.emit(event("device.pair.requested", .object(["requestId": .string("p"), "ts": .number(42)])))
        try await eventually { (try? await runtime.pendingRequests().approvals.count) == 1 }
        let old = try await runtime.pendingRequests().approvals[0].reference
        try await socket.emit(event("connect.challenge", .object(["nonce": .string("fresh-auth"), "ts": .number(1_778_198_400_301)])))
        try await eventually {
            let count = await socket.requests("connect").count
            let phase = await runtime.state.phase
            return count == 2 && phase == .ready
        }
        do { try await runtime.resolve(old, decision: .approve); Issue.record("Old authentication approved") }
        catch let failure as RuntimeFailure { #expect(failure.code == .requestUnavailable) }
        #expect(await socket.requests("device.pair.approve").isEmpty)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func explicitQuestionCancelWaitsForNativeResolutionAndDismissalSendsNothing() async throws {
        let socket = ScriptSocket { request, socket in
            try await socket.reply(request, payload: request["method"]?.stringValue == "connect" ? health(.claudeCode) : .object(["ok": .bool(true)]))
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(.claudeCode))
        try await socket.emit(event("claude-code.update", .object(["type": .string("question_requested"), "sessionKey": .string("s"), "question": formQuestion()])))
        try await eventually { (try? await runtime.pendingRequests().questions.count) == 1 }
        let question = try await runtime.pendingRequests().questions[0]
        _ = try await runtime.pendingRequests() // Merely reading/dismissing has no mutation operation.
        #expect(await socket.requests("questions.respond").isEmpty)
        try await runtime.answer(question.reference, answer: .cancel)
        #expect(try await runtime.pendingRequests().questions[0].state == .uncertain)
        #expect(await socket.requests("questions.respond")[0]["params"]?["cancelled"] == .bool(true))
        try await socket.emit(event("claude-code.update", .object(["type": .string("question_resolved"), "sessionKey": .string("s"), "questionId": .string("form")])))
        try await eventually { (try? await runtime.pendingRequests().questions.isEmpty) == true }
        await runtime.disconnect(); reader.cancel()
    }

    @Test func malformedSnapshotDoesNotPartiallyReplacePendingRequests() async throws {
        let socket = ScriptSocket { request, socket in
            if request["method"]?.stringValue == "connect" { try await socket.reply(request, payload: health(.pi)) }
            else { try await socket.reply(request, payload: .array([inputQuestion("new"), .object(["id": .string("bad")])])) }
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(.pi))
        try await socket.emit(event("pi.update", .object(["type": .string("question_requested"), "sessionKey": .string("s"), "question": inputQuestion("original")])))
        try await eventually { (try? await runtime.pendingRequests().questions.count) == 1 }
        let old = try await runtime.pendingRequests().questions[0].reference
        do { _ = try await runtime.listPending(sessionKey: "s"); Issue.record("Corrupt list accepted") } catch is RuntimeFailure {}
        #expect(try await runtime.pendingRequests().questions.map(\.reference) == [old])
        await runtime.disconnect(); reader.cancel()
    }
}
