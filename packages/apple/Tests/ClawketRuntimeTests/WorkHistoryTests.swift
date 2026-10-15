import ClawketTransport
import Foundation
import Testing
@testable import ClawketRuntime

@Suite(.serialized)
struct WorkHistoryTests {
    @Test func actualBridgeProducerVectorsRetainAllCanonicalSDKTools() throws {
        let url = try #require(Bundle.module.url(forResource: "sdk-history", withExtension: "json", subdirectory: "Fixtures"))
        let data = try Data(contentsOf: url)
        let vectors = try FrameCodec.decode(String(decoding: data, as: UTF8.self))
        let cases = try #require(vectors["cases"]?.array)
        #expect(cases.count == 3)
        var toolCount = 0
        for entry in cases {
            let backendName = try #require(entry["backend"]?.stringValue)
            let backend = try #require(BackendKind(rawValue: backendName))
            let messages = try #require(entry["messages"])
            let history = try WireModels.history(.object(["messages": messages]), key: "s", backend: backend)
            for message in history.messages where message.role == .tool {
                let tool = try #require(message.raw["tool"])
                let updates = message.workUpdates(sessionKey: "s")
                #expect(updates.count == 1)
                let work = try #require(updates.first)
                #expect(work.itemID == tool["callId"]?.stringValue)
                #expect(work.toolName == tool["name"]?.stringValue)
                #expect(work.rawInput == tool["input"])
                #expect(work.rawOutput == tool["output"])
                #expect(work.status?.rawValue == tool["status"]?.stringValue)
                #expect(work.turnID == message.turnID)
                #expect(work.runID == nil) // A completed native turn does not invent a wire run.
                #expect(work.historyMessageID != nil)
                #expect(work.inputIsComplete == nil && work.outputIsComplete == nil)
                #expect(work.startedAtMs == tool["startedAtMs"]?.safeInteger)
                #expect(work.durationMs == tool["durationMs"]?.safeInteger)
                toolCount += 1
            }
        }
        #expect(toolCount == 8)
    }

    @Test func malformedNestedToolKeepsTheTranscriptWithoutInventingAResult() throws {
        let rows: [JSONValue] = [
            .object(["id": .string("reply"), "role": .string("assistant"), "text": .string("Keep ordinary text")]),
            .object(["id": .string("bad"), "role": .string("tool"), "text": .string(""),
                "tool": .object(["name": .string("read"), "callId": .number(5), "status": .string("success")])]),
            .object(["id": .string("unknown"), "role": .string("tool"), "text": .string(""),
                "tool": .object(["name": .string("read"), "callId": .string("call"), "finishedAtMs": .number(50),
                    "output": .string("Output alone does not prove success"), "summary": .string("Producer summary")])]),
        ]
        let history = try WireModels.history(.object(["messages": .array(rows)]), key: "s", backend: .codex)
        #expect(history.messages.count == 3)
        #expect(history.messages[0].text == "Keep ordinary text")
        #expect(history.messages[1].workUpdates(sessionKey: "s").isEmpty)
        let work = try #require(history.messages[2].workUpdates(sessionKey: "s").first)
        #expect(work.status == nil); #expect(work.finishedAtMs == 50)
        #expect(work.text == "Producer summary")
    }

    @Test func gatewayTopLevelToolNameAndCallIdentityRemainCompatible() throws {
        let history = try WireModels.history(.object(["messages": .array([.object([
            "id": .string("gateway-result"), "role": .string("toolResult"), "tool": .string("read"),
            "toolCallId": .string("gateway-call"), "content": .string("Gateway output"),
        ])])]), key: "s", backend: .hermes)
        let work = try #require(history.messages[0].workUpdates(sessionKey: "s").first)
        #expect(work.itemID == "gateway-call"); #expect(work.toolName == "read")
        #expect(work.rawOutput == .string("Gateway output")); #expect(work.status == nil)
    }

    private func connection(_ kind: BackendKind = .hermes) -> BackendConnection {
        .init(id: "c", backendKind: kind, transportKind: .local, label: "QA", url: URL(string: "ws://127.0.0.1:1")!)
    }
    private func event(_ name: String, _ payload: JSONValue) -> JSONValue {
        .object(["type": .string("event"), "event": .string(name), "payload": payload])
    }

    @Test func canonicalStartRetainsActualInputLineageAlongsideExistingStart() throws {
        var events = SessionEvents()
        let updates = try events.map(event("codex.update", .object(["type": .string("run_started"),
            "sessionKey": .string("s"), "runId": .string("r"), "turnId": .string("t"),
            "inputMessageId": .string("m"), "inputMessageKey": .string("k")])), connection: connection(.codex))
        guard case .runStarted = updates[0], case let .work(work) = updates[1] else { Issue.record("Missing typed start"); return }
        #expect(work.kind == .runStart); #expect(work.turnID == "t")
        #expect(work.inputMessageID == "m"); #expect(work.inputMessageKey == "k")
        #expect(work.historyMessageID == nil)
    }

    @Test func gatewayToolsPreserveRawAndOnlyExplicitStatusCompletes() throws {
        var events = SessionEvents()
        let base: [String: JSONValue] = ["sessionKey": .string("s"), "runId": .string("r"), "stream": .string("tool")]
        func map(_ data: JSONValue) throws -> RuntimeWorkUpdate {
            let values = try events.map(event("agent", .object(base.merging(["data": data]) { _, new in new })), connection: connection())
            guard case let .tool(_, _, raw) = values[0], case let .work(work) = values[1] else { throw RuntimeFailure(.invalidResponse) }
            #expect(raw["data"] == data); return work
        }
        let input: JSONValue = .object(["command": .string("printf 'safe fixture'")])
        let start = try map(.object(["phase": .string("start"), "toolCallId": .string("one"), "name": .string("exec"), "args": input]))
        #expect(start.kind == .toolCall); #expect(start.status == .running); #expect(start.rawInput == input)
        #expect(start.toolName == "exec")
        let missing = try map(.object(["phase": .string("end"), "toolCallId": .string("one"), "output": .string("has output")]))
        #expect(missing.status == nil); #expect(missing.rawOutput == .string("has output"))
        #expect(missing.outputIsComplete == nil)
        let explicit = try map(.object(["phase": .string("end"), "toolCallId": .string("one"), "status": .string("error")]))
        #expect(explicit.status == .error)
        let result = try map(.object(["phase": .string("result"), "toolCallId": .string("one"), "result": .string("done")]))
        #expect(result.status == .success)
        let failed = try map(.object(["phase": .string("result"), "toolCallId": .string("one"), "isError": .bool(true)]))
        #expect(failed.status == .error)
    }

    @Test func historyPreservesMultipleEmbeddedCallsResultsAndUnknownLineage() throws {
        let raw: JSONValue = .object(["messages": .array([.object(["id": .string("message"), "role": .string("assistant"),
            "content": .array([
                .object(["type": .string("text"), "text": .string("Checking")]),
                .object(["type": .string("toolcall"), "id": .string("a"), "name": .string("read"), "arguments": .object(["path": .string("fixture")])]),
                .object(["type": .string("tool_result"), "tool_use_id": .string("a"), "content": .string("read result")]),
                .object(["type": .string("tool_use"), "id": .string("b"), "name": .string("exec")]),
                .object(["type": .string("tool_result"), "tool_use_id": .string("b"), "content": .string("denied"), "is_error": .bool(true)])
            ])])])])
        let history = try WireModels.history(raw, key: "s", backend: .openclaw)
        let work = history.messages[0].workUpdates(sessionKey: "s")
        #expect(work.count == 4); #expect(work.map(\.itemID) == ["a", "a", "b", "b"])
        #expect(work.allSatisfy { $0.runID == nil && $0.turnID == nil && $0.historyMessageID != nil })
        #expect(work[0].status == nil); #expect(work[1].status == nil); #expect(work[3].status == .error)
        #expect(Set(work.compactMap(\.historyMessageID)).count == 4)
    }

    @Test func historyUsesExactExplicitLineageAndClocksWithoutGuessingCompletion() throws {
        let history = try WireModels.history(.object(["messages": .array([.object(["id": .string("result"), "role": .string("toolResult"),
            "toolCallId": .string("tool"), "toolName": .string("read"), "runId": .string("r"), "turnId": .string("t"),
            "inputMessageKey": .string("input"), "toolStartedAt": .number(10), "toolFinishedAt": .number(5),
            "toolDurationMs": .number(9), "content": .string("output")])])]), key: "s", backend: .hermes)
        let work = try #require(history.messages[0].workUpdates(sessionKey: "s").first)
        #expect(work.runID == "r"); #expect(work.turnID == "t"); #expect(work.inputMessageKey == "input")
        #expect(work.startedAtMs == 10); #expect(work.finishedAtMs == 5); #expect(work.durationMs == 9)
        #expect(work.status == nil)
    }

    @Test func malformedOptionalHistoryItemDoesNotSuppressValidItemsOrForgeLiveProvenance() throws {
        let history = try WireModels.history(.object(["messages": .array([.object(["id": .string("row"), "role": .string("assistant"),
            "content": .array([
                .object(["type": .string("toolcall"), "id": .string(String(repeating: "x", count: 513))]),
                .object(["type": .string("toolcall"), "id": .string("good")])
            ])])])]), key: "s", backend: .pi)
        #expect(history.messages[0].workUpdates(sessionKey: "s").map(\.itemID) == ["good"])
        let live = try WorkEvents.canonical(.object(["type": .string("tool_call"), "sessionKey": .string("s"),
            "runId": .string("r"), "toolCallId": .string("good"), "historyMessageID": .string("spoofed")]))
        #expect(live?.historyMessageID == nil)
    }

    @Test func finalMetadataKeepsExactLineageAndProducerClocks() throws {
        let update = RuntimeSessionUpdate.runFinished(sessionKey: "s", runID: "r", reason: "error", segmentID: "segment",
            raw: .object(["turnId": .string("second"), "inputMessageKey": .string("input"),
                "startedAtMs": .number(100), "finishedAtMs": .number(90), "durationMs": .number(2.9)]))
        let value = try #require(update.workCompletion)
        #expect(value.turnID == "second"); #expect(value.inputMessageKey == "input")
        #expect(value.startedAtMs == 100); #expect(value.finishedAtMs == 90); #expect(value.durationMs == 2)
        let invalid = RuntimeSessionUpdate.runFinished(sessionKey: "s", runID: "r", reason: "end_turn", segmentID: "segment",
            raw: .object(["turnId": .number(2)]))
        #expect(invalid.workCompletion == nil)
    }
}
