import Foundation
import Testing
import ClawketPairing
import ClawketTransport
@testable import ClawketRuntime

private func session(_ key: String) -> JSONValue {
    .object(["key": .string(key), "agentId": .string("codex"), "title": .string(key), "kind": .string("other"),
             "updatedAt": .null, "hasActiveRun": .bool(false), "canContinue": .bool(true),
             "allowedActions": .object(["rename": .bool(true), "reset": .bool(true), "delete": .bool(true), "pin": .bool(true)])])
}

@Suite(.serialized)
struct RuntimeOperationsTests {
    @Test func completeFrozenCatalogProjectsAndCreateSessionPreserveSessionsFirst() async throws {
        let catalogEpoch = String(repeating: "a", count: 32), revision = String(repeating: "b", count: 32)
        let socket = ScriptSocket { request, socket in
            let payload: JSONValue
            switch request["method"]?.stringValue {
            case "connect": payload = .object(["backend": .string("codex"), "sessionCatalogSync": .number(1), "projects": .bool(true)])
            case "agents.list": payload = .array([.object(["agentId": .string("codex"), "entryMode": .string("sessions"), "mainSessionKey": .string("")])])
            case "sessions.sync":
                let offset = request["params"]?["page"]?["offset"]?.numberValue ?? 0
                payload = .object(["kind": .string("full"), "epoch": .string(catalogEpoch), "revision": .string(revision),
                                   "total": .number(2), "offset": .number(offset), "sessions": .array([session(offset == 0 ? "one" : "two")]),
                                   "nextOffset": offset == 0 ? .number(1) : .null])
            case "projects.list": payload = .array([.object(["id": .string("project"), "name": .string("Project"), "path": .string("/synthetic/project"), "available": .bool(true)])])
            case "sessions.create": payload = session("new-session")
            default: throw RuntimeFailure(.unsupported)
            }
            try await socket.reply(request, payload: payload)
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(.codex))
        let roster = try await runtime.refreshRoster()
        #expect(roster.agents[0].entryMode == .sessions); #expect(roster.agents[0].mainSessionKey.isEmpty)
        #expect(roster.sessions.map(\.key) == ["one", "two"])
        #expect(await socket.requests("sessions.sync").count == 2)
        #expect(await runtime.state.capabilities.projects)
        #expect(try await runtime.projects().map(\.id) == ["project"])
        let created = try await runtime.createSession(agentID: "codex", title: "New", projectID: "project")
        #expect(created.key == "new-session"); #expect(created.connectionID == "connection-a")
        #expect(await socket.requests("sessions.create")[0]["params"]?["projectId"]?.stringValue == "project")
        await runtime.disconnect(); reader.cancel()
    }

    @Test func malformedFrozenCatalogNeverReturnsPartialRoster() async throws {
        let socket = ScriptSocket { request, socket in
            let payload: JSONValue = switch request["method"]?.stringValue {
            case "connect": .object(["backend": .string("codex"), "sessionCatalogSync": .number(1)])
            case "agents.list": .array([.object(["agentId": .string("codex"), "entryMode": .string("sessions"), "mainSessionKey": .string("")])])
            default: .object(["kind": .string("full"), "epoch": .string(String(repeating: "a", count: 32)), "revision": .string(String(repeating: "b", count: 32)),
                              "offset": .number(0), "total": .number(2), "sessions": .array([session("only-one")]), "nextOffset": .null])
            }
            try await socket.reply(request, payload: payload)
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(.codex))
        await #expect(throws: RuntimeFailure.self) { try await runtime.refreshRoster() }
        await runtime.disconnect(); reader.cancel()
    }

    @Test(arguments: BackendKind.allCases)
    func textSendAndAbortMatchEachBackendWire(_ backend: BackendKind) async throws {
        let socket = ScriptSocket(initial: backend == .openclaw ? [challengeFrame] : []) { request, socket in
            let payload: JSONValue
            switch request["method"]?.stringValue {
            case "connect": payload = backend == .openclaw ? hello : health(backend)
            case "health": payload = health(backend)
            case "chat.send": payload = .object(["runId": .string("run")])
            default: payload = .object(["ok": .bool(true)])
            }
            try await socket.reply(request, payload: payload)
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(backend))
        let receipt = try await runtime.send(sessionKey: "main", input: .init(text: "hello", idempotencyKey: "outbox", thinkingLevel: "off"))
        #expect(receipt.runID == "run"); #expect(receipt.idempotencyKey == "outbox")
        let params = await socket.requests("chat.send")[0]["params"]!
        let gateway = [.openclaw, .hermes].contains(backend)
        #expect(params[gateway ? "message" : "text"]?.stringValue == "hello")
        #expect(params["idempotencyKey"]?.stringValue == "outbox")
        #expect(params["deliver"] == (backend == .openclaw ? .bool(false) : nil))
        if backend == .openclaw { #expect(params["thinking"]?.stringValue == "off") }
        if [.hermes, .codex, .claudeCode].contains(backend) { #expect(params["thinkingLevel"] == nil) }
        try await runtime.abort(sessionKey: "main", runID: "run")
        #expect(await socket.requests("chat.abort")[0]["params"]?["runId"]?.stringValue == "run")
        #expect(await socket.requests("chat.abort")[0]["params"]?["sessionKey"] == (backend == .localModel ? nil : .string("main")))
        await runtime.disconnect(); reader.cancel()
    }

    @Test func headAndOlderHistorySerializeAndPhysicalOffsetStaysScoped() async throws {
        let socket = ScriptSocket(initial: [challengeFrame]) { request, socket in
            if request["method"]?.stringValue == "connect" { try await socket.reply(request, payload: hello) }
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(.openclaw))
        let head = Task { try await runtime.loadSession(key: "agent:main:main") }
        try await eventually { await socket.requests("chat.history").count == 1 }
        let cursor = "clawket:openclaw-offset:{\"key\":\"agent:main:main\",\"sessionId\":\"physical\",\"offset\":50}"
        let older = Task { try await runtime.loadSession(key: "agent:main:main", cursor: cursor) }
        for _ in 0..<20 { await Task.yield() }
        #expect(await socket.requests("chat.history").count == 1)
        try await socket.reply(await socket.requests("chat.history")[0], payload: .object(["messages": .array([])]))
        _ = try await head.value
        try await eventually { await socket.requests("chat.history").count == 2 }
        let request = await socket.requests("chat.history")[1]
        #expect(request["params"]?["offset"]?.numberValue == 50); #expect(request["params"]?["sessionId"]?.stringValue == "physical")
        #expect(request["params"]?["cursor"] == nil)
        try await socket.reply(request, payload: .object(["messages": .array([])]))
        _ = try await older.value
        await #expect(throws: RuntimeFailure.self) { try await runtime.loadSession(key: "different-session", cursor: cursor) }
        await runtime.disconnect(); reader.cancel()
    }

    @Test func replacementChallengeRetiresHistoryBeforeNewAuthentication() async throws {
        let socket = ScriptSocket(initial: [challengeFrame]) { request, socket in
            if request["method"]?.stringValue == "connect" { try await socket.reply(request, payload: hello) }
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(.openclaw))
        let history = Task { try await runtime.loadSession(key: "main") }
        try await eventually { await socket.requests("chat.history").count == 1 }
        try await socket.emit(event("connect.challenge", .object(["nonce": .string("replacement"), "ts": .number(123)])))
        do { _ = try await history.value; Issue.record("Old history survived backend replacement") }
        catch let failure as RuntimeFailure { #expect(failure.code == .superseded) }
        try await eventually {
            let count = await socket.requests("connect").count, phase = await runtime.state.phase
            return count == 2 && phase == .ready
        }
        #expect(await socket.requests("chat.history").count == 1)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func sdkModelReadsAndWritesKeepSessionScope() async throws {
        let socket = ScriptSocket { request, socket in
            let payload: JSONValue = request["method"]?.stringValue == "connect" ? health(.codex)
                : request["method"]?.stringValue == "models.list" ? .object(["currentModel": .string("a"), "currentProvider": .string("provider"),
                    "models": .array([.object(["id": .string("a"), "name": .string("A"), "provider": .string("provider")])])]) : .object(["ok": .bool(true)])
            try await socket.reply(request, payload: payload)
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(.codex))
        #expect(try await runtime.models(sessionKey: "session-a").first?.selected == true)
        #expect(await socket.requests("models.list")[0]["params"]?["sessionKey"]?.stringValue == "session-a")
        try await runtime.selectModel(id: "b", provider: "provider", sessionKey: "session-a")
        #expect(await socket.requests("models.select")[0]["params"]?["scope"]?.stringValue == "session")
        #expect(await socket.requests("models.select")[0]["params"]?["sessionKey"]?.stringValue == "session-a")
        await runtime.disconnect(); reader.cancel()
    }
}
