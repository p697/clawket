import Foundation
import Testing
import ClawketTransport
@testable import ClawketRuntime

@Suite(.serialized)
struct ConsentCoordinatorTests {
    @Test(arguments: [BackendKind.openclaw, .hermes, .codex, .claudeCode, .pi, .localModel])
    func absentNegotiationDoesNotInventActions(_ backend: BackendKind) async throws {
        let socket = ScriptSocket(initial: backend == .openclaw ? [challengeFrame] : []) { request, socket in
            try await socket.reply(request, payload: backend == .openclaw ? hello : health(backend))
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(backend))
        let caps = await runtime.state.capabilities
        #expect(!caps.questions && !caps.executionApprovals && !caps.pairingApprovals)
        await runtime.disconnect(); reader.cancel()
    }

    @Test(arguments: [BackendKind.codex, .claudeCode])
    func successfulListsRecoverScopedSDKRequests(_ backend: BackendKind) async throws {
        let socket = ScriptSocket { request, socket in
            switch request["method"]?.stringValue {
            case "connect": try await socket.reply(request, payload: health(backend))
            case "questions.list": try await socket.reply(request, payload: .array([formQuestion()]))
            case "approvals.list":
                try await socket.reply(request, payload: .array([backend == .codex
                    ? .object(["sessionKey": .string("session"), "approval": execution()]) : execution()]))
            default: try await socket.reply(request, payload: .object(["ok": .bool(true)]))
            }
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(backend))
        let pending = try await runtime.listPending(sessionKey: "session")
        #expect(pending.questions.count == 1 && pending.approvals.count == 1)
        #expect(pending.approvals[0].reference.sessionKey == "session")
        let capabilities = await runtime.state.capabilities
        #expect(capabilities.questions && capabilities.executionApprovals)
        try await runtime.answer(pending.questions[0].reference, answer: .form(["q0": ["One"]]))
        try await runtime.resolve(pending.approvals[0].reference, decision: .allowOnce)
        let answer = await socket.requests("questions.respond")[0]["params"]!
        #expect(answer["sessionKey"]?.stringValue == "session"); #expect(answer["questionId"]?.stringValue == "form")
        #expect(answer["answers"]?["q0"]?.array == [.string("One")])
        #expect(try await runtime.pendingRequests().approvals.isEmpty)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func unsupportedReadIsBoundedAndNotSupportEvidence() async throws {
        let socket = ScriptSocket { request, socket in
            if request["method"]?.stringValue == "connect" { try await socket.reply(request, payload: health(.pi)) }
            else { try await socket.reject(request, code: "METHOD_NOT_FOUND") }
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(.pi))
        #expect(try await runtime.listPending(sessionKey: "s").questions.isEmpty)
        _ = try await runtime.listPending(sessionKey: "s")
        #expect(await socket.requests("questions.list").count == 1)
        #expect(await runtime.state.phase == .ready); #expect(await runtime.state.capabilities.questions == false)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func hermesRequiresActualCapabilityAndAlwaysNeedsFreshConfirmation() async throws {
        let socket = ScriptSocket { request, socket in try await socket.reply(request, payload: request["method"]?.stringValue == "connect" ? health(.hermes) : .object(["ok": .bool(true)])) }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(.hermes))
        _ = try await runtime.listPending(sessionKey: "s")
        #expect(await socket.requests("exec.approval.list").isEmpty)
        try await socket.emit(event("exec.approval.requested", .object(["id": .string("a"), "expiresAtMs": .null,
            "request": .object(["sessionKey": .string("s"), "command": .string("git status"),
                                "decisions": .array([.string("allow-once"), .string("allow-always"), .string("deny")])])])))
        try await eventually { (try? await runtime.pendingRequests().approvals.count) == 1 }
        let approval = try await runtime.pendingRequests().approvals[0]
        do { try await runtime.resolve(approval.reference, decision: .allowAlways); Issue.record("Missing confirmation accepted") }
        catch let failure as RuntimeFailure { #expect(failure.code == .confirmationRequired) }
        let confirmation = try await runtime.prepareApprovalConfirmation(approval.reference)
        try await runtime.resolve(approval.reference, decision: .allowAlways, confirmation: confirmation)
        #expect(await socket.requests("exec.approval.resolve")[0]["params"]?["decision"]?.stringValue == "allow-always")
        await runtime.disconnect(); reader.cancel()
    }

    @Test func confirmationCannotAuthorizeChangedReviewOrReconnect() async throws {
        let socket = ScriptSocket { request, socket in try await socket.reply(request, payload: health(.hermes)) }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(.hermes))
        func frame(_ command: String) -> JSONValue { event("exec.approval.requested", .object(["id": .string("a"), "expiresAtMs": .null,
            "request": .object(["sessionKey": .string("s"), "command": .string(command), "decisions": .array([.string("allow-always"), .string("deny")])])])) }
        try await socket.emit(frame("first"))
        try await eventually { (try? await runtime.pendingRequests().approvals.count) == 1 }
        let old = try await runtime.pendingRequests().approvals[0].reference
        let token = try await runtime.prepareApprovalConfirmation(old)
        try await socket.emit(frame("changed"))
        try await eventually { (try? await runtime.pendingRequests().approvals.first?.command) == "changed" }
        let fresh = try await runtime.pendingRequests().approvals[0].reference
        #expect(fresh != old)
        do { try await runtime.resolve(fresh, decision: .allowAlways, confirmation: token); Issue.record("Stale confirmation accepted") }
        catch let failure as RuntimeFailure { #expect(failure.code == .confirmationRequired) }
        do { try await runtime.resolve(old, decision: .deny); Issue.record("Stale reference accepted") }
        catch let failure as RuntimeFailure { #expect(failure.code == .requestUnavailable) }
        #expect(await socket.requests("exec.approval.resolve").isEmpty)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func pairTargetsAreConnectionWideAndNeverCollide() async throws {
        let socket = ScriptSocket(initial: [challengeFrame]) { request, socket in
            if request["method"]?.stringValue == "connect" { try await socket.reply(request, payload: hello) }
            else { try await socket.reply(request, payload: .object(["ok": .bool(true)])) }
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(.openclaw))
        for target in ["device", "node"] { try await socket.emit(event("\(target).pair.requested", .object(["requestId": .string("same"), "displayName": .string("Review name"), "ts": .number(42)]))) }
        try await eventually { (try? await runtime.pendingRequests().approvals.count) == 2 }
        let values = try await runtime.pendingRequests().approvals
        #expect(values.allSatisfy { $0.reference.sessionKey == nil })
        for approval in values { try await runtime.resolve(approval.reference, decision: approval.pairingTarget == .device ? .approve : .reject) }
        #expect(await socket.requests("device.pair.approve")[0]["params"]?["requestId"]?.stringValue == "same")
        #expect(await socket.requests("node.pair.reject")[0]["params"]?["requestId"]?.stringValue == "same")
        #expect(await socket.requests("exec.approval.resolve").isEmpty)
        await runtime.disconnect(); reader.cancel()
    }
}
