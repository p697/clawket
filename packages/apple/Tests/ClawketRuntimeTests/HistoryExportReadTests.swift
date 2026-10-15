import Foundation
import Testing
import ClawketTransport
@testable import ClawketRuntime

@Suite(.serialized)
struct HistoryExportReadTests {
    @Test(arguments: BackendKind.allCases)
    func exportReadPreservesBackendParametersWithoutPublishingUIModelState(_ backend: BackendKind) async throws {
        let socket = ScriptSocket(initial: backend == .openclaw ? [challengeFrame] : []) { request, socket in
            let payload: JSONValue = switch request["method"]?.stringValue {
            case "connect": backend == .openclaw ? hello : health(backend)
            case "health": health(backend)
            default: .object(["messages": .array([]), "hasMore": .bool(false), "thinkingLevel": .string("high")])
            }
            try await socket.reply(request, payload: payload)
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(backend))
        _ = try await runtime.exportHistorySnapshot(key: "main", limit: 100)
        let requests = await socket.requests("chat.history")
        #expect(requests.count == 1)
        #expect(requests[0]["params"]?["sessionKey"]?.stringValue == (backend == .localModel ? nil : "main"))
        #expect(requests[0]["params"]?["limit"]?.safeInteger == ([.openclaw, .hermes].contains(backend) ? 100 : nil))
        #expect(await runtime.modelControlsState.historyThinking.isEmpty)
        #expect(await runtime.historyTasks.isEmpty)
        #expect(await runtime.historyExportPending == 0)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func closeCancellationReleasesTheOwnedRPCAndDoesNotWaitForAUIHistoryChain() async throws {
        let socket = ScriptSocket { request, socket in
            if request["method"]?.stringValue == "connect" { try await socket.reply(request, payload: health(.hermes)) }
            if request["method"]?.stringValue == "health" { try await socket.reply(request, payload: health(.hermes)) }
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(.hermes))
        let pending = Task { try await runtime.exportHistorySnapshot(key: "main") }
        try await eventually { await socket.requests("chat.history").count == 1 }
        pending.cancel()
        do { _ = try await pending.value; Issue.record("Cancelled export read returned a snapshot") }
        catch { }
        #expect(await runtime.historyExportPending == 0)
        #expect(await runtime.historyTasks.isEmpty)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func InvalidBoundsNeverDispatchAndDoNotConsumeAdmission() async throws {
        let socket = ScriptSocket { request, socket in try await socket.reply(request, payload: health(.hermes)) }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(.hermes))
        for (key, limit, cursor) in [("", 100, nil as String?), ("main", 0, nil), ("main", 1_001, nil), ("main", 100, String(repeating: "x", count: 4_097))] {
            await #expect(throws: RuntimeFailure.self) { try await runtime.exportHistorySnapshot(key: key, limit: limit, cursor: cursor) }
        }
        #expect(await socket.requests("chat.history").isEmpty)
        #expect(await runtime.historyExportPending == 0)
        await runtime.disconnect(); reader.cancel()
    }
}
