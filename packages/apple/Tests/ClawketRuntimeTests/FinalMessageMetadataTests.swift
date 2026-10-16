import ClawketTransport
import Foundation
import Testing
@testable import ClawketRuntime

@Suite(.serialized)
struct FinalMessageMetadataTests {
    private func connection(_ backend: BackendKind) -> BackendConnection {
        .init(id: "final-fixture", backendKind: backend, transportKind: .local, label: "Synthetic",
              url: URL(string: "ws://127.0.0.1:1")!)
    }
    private func frame(_ payload: [String: JSONValue]) -> JSONValue {
        .object(["type": .string("event"), "event": .string("codex.update"), "payload": .object(payload)])
    }
    private func final(_ message: [String: JSONValue], extra: [String: JSONValue] = [:]) -> RuntimeSessionUpdate {
        var raw = extra; raw["message"] = .object(message)
        return .runFinished(sessionKey: "s", runID: "wire-run", reason: "end_turn", segmentID: "display-segment", raw: .object(raw))
    }

    @Test func actualCodexFailureProducerVectorsPreserveSystemIdentityAndNeverOverwritePartialReply() throws {
        let url = try #require(Bundle.module.url(forResource: "sdk-history", withExtension: "json", subdirectory: "Fixtures"))
        let vectors = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
        let cases = try #require(vectors["terminalCases"]?.array); #expect(cases.count == 3)
        for entry in cases {
            let raw = try #require(entry["frame"])
            let run = try #require(raw["payload"]?["runId"]?.stringValue)
            var events = SessionEvents()
            let partial = frame(["type": .string("agent_message_chunk"), "sessionKey": .string("vector-session"),
                "runId": .string(run), "text": .string("Keep the actual partial reply")])
            #expect(try events.map(partial, connection: connection(.codex)).count == 1)
            let result = try events.map(raw, connection: connection(.codex))
            #expect(result.count == 1) // Compatibility assistant text must not replace the partial.
            let completion = try #require(result.first)
            let notice = try #require(completion.terminalNotice(backend: .codex))
            let history = try #require(entry["historyMessage"])
            #expect(notice.providedID == history["id"]?.stringValue)
            #expect(notice.text == history["text"]?.stringValue)
            #expect(notice.timestampMs == history["timestampMs"]?.safeInteger)
            #expect(!notice.text.contains("PRIVATE-SYNTHETIC"))
            #expect(completion.finalMessageMetadata(backend: .codex)?.providedID == nil)
            #expect(try events.map(raw, connection: connection(.codex)).isEmpty)
        }
    }

    @Test(arguments: BackendKind.allCases)
    func finalsWithoutProducerMessageIDsNeverDeriveSourceFromRunTurnClockOrParagraph(_ backend: BackendKind) throws {
        let update = final(["role": .string("assistant"), "content": .string("Reply"), "timestampMs": .number(1_767_225_600_000)],
            extra: ["turnId": .string("actual-turn"), "inputMessageId": .string("actual-input"), "inputMessageKey": .string("actual-key")])
        let metadata = try #require(update.finalMessageMetadata(backend: backend))
        #expect(metadata.providedID == nil); #expect(metadata.turnID == "actual-turn")
        #expect(metadata.inputMessageID == "actual-input"); #expect(metadata.inputMessageKey == "actual-key")
        #expect(metadata.timestampMs == 1_767_225_600_000)
        #expect(update.terminalNotice(backend: backend) == nil)
    }

    @Test func gatewayFinalRetainsActualMessageIDAndTranscriptPositionWithHistoryCompatiblePrecedence() throws {
        let raw: [String: JSONValue] = ["role": .string("assistant"), "id": .string("producer-message"),
            "messageId": .string("secondary"), "content": .string("Reply"), "turnId": .string("actual-turn"),
            "__openclaw": .object(["id": .string("stored-entry"), "transcriptPosition": .object([
                "source": .string("physical-transcript"), "rawSeq": .number(42)])])]
        let update = final(raw)
        let metadata = try #require(update.finalMessageMetadata(backend: .openclaw))
        #expect(metadata.providedID == "producer-message")
        #expect(metadata.transcriptPosition == .init(source: "physical-transcript", rawSequence: 42))
        #expect(update.finalMessageMetadata(backend: .hermes)?.transcriptPosition == nil)
        let history = try WireModels.history(.object(["messages": .array([.object(raw)])]), key: "s", backend: .openclaw)
        #expect(history.messages[0].providedID == metadata.providedID)
        #expect(history.messages[0].transcriptPosition == metadata.transcriptPosition)
    }

    @Test func malformedIDsPositionsStayUnknownAndConflictingLineageCannotBind() throws {
        for id in ["", "bad\nidentity", String(repeating: "a", count: 4_097)] {
            let update = final(["role": .string("assistant"), "id": .string(id), "content": .string("Keep"),
                "turnId": .string("e\u{301}"), "__openclaw": .object(["transcriptPosition": .object([
                    "source": .string("source"), "rawSeq": .number(1.5)])])], extra: ["turnId": .string("é")])
            let metadata = try #require(update.finalMessageMetadata(backend: .openclaw))
            #expect(metadata.providedID == nil && metadata.transcriptPosition == nil && metadata.turnID == nil)
            #expect(metadata.hasConflictingLineage)
        }
        var events = SessionEvents()
        let partial = frame(["type": .string("agent_message_chunk"), "sessionKey": .string("s"),
            "runId": .string("r"), "text": .string("Keep partial"), "turnId": .string("A")])
        #expect(try events.map(partial, connection: connection(.codex)).count == 1)
        let conflict = frame(["type": .string("run_finished"), "sessionKey": .string("s"), "runId": .string("r"),
            "turnId": .string("A"), "message": .object(["role": .string("assistant"), "id": .string("actual-B"),
                "turnId": .string("B"), "content": .string("Different message")])])
        let updates = try events.map(conflict, connection: connection(.codex))
        #expect(updates.count == 1)
        #expect(updates.first?.finalMessageMetadata(backend: .codex)?.hasConflictingLineage == true)
    }

    @Test func terminalNoticeRequiresExplicitErrorValidSystemIdentityAndNonemptyText() throws {
        let good: [String: JSONValue] = ["role": .string("system"), "id": .string("notice"), "text": .string("Producer notice")]
        let invalid: [[String: JSONValue]] = [[:], ["role": .string("assistant"), "id": .string("n"), "text": .string("Bad")],
            ["role": .string("system"), "id": .string(""), "text": .string("Bad")],
            ["role": .string("system"), "id": .string(String(repeating: "n", count: 257)), "text": .string("Bad")],
            ["role": .string("system"), "id": .string("n"), "text": .string(" ")]]
        for raw in invalid {
            let event = RuntimeSessionUpdate.runFinished(sessionKey: "s", runID: "r", reason: "error", segmentID: "segment",
                raw: .object(["terminalMessage": .object(raw)]))
            #expect(event.terminalNotice(backend: .codex) == nil)
        }
        for reason in ["end_turn", "cancelled", "unknown"] {
            let event = RuntimeSessionUpdate.runFinished(sessionKey: "s", runID: "r", reason: reason, segmentID: "segment",
                raw: .object(["terminalMessage": .object(good)]))
            #expect(event.terminalNotice(backend: .codex) == nil)
        }
        let legacy = RuntimeSessionUpdate.runFinished(sessionKey: "s", runID: "r", reason: "error", segmentID: "segment", raw: .object([:]))
        #expect(legacy.terminalNotice(backend: .codex)?.providedID == nil)
        #expect(legacy.terminalNotice(backend: .codex)?.timestampMs == nil)
        for backend in BackendKind.allCases where backend != .codex { #expect(legacy.terminalNotice(backend: backend) == nil) }
    }

    @Test func byteDistinctRunsToolsAndTerminalStatesDoNotCollapseInTheAdapter() throws {
        var events = SessionEvents()
        let first = "é", second = "e\u{301}"
        func chunk(_ run: String) -> JSONValue { frame(["type": .string("agent_message_chunk"), "sessionKey": .string("s"),
            "runId": .string(run), "text": .string("Reply")]) }
        #expect(try events.map(chunk(first), connection: connection(.codex)).count == 1)
        #expect(try events.map(chunk(second), connection: connection(.codex)).count == 1)
        let finished = frame(["type": .string("run_finished"), "sessionKey": .string("s"), "runId": .string(first)])
        #expect(try events.map(finished, connection: connection(.codex)).count == 1)
        #expect(try events.map(chunk(second), connection: connection(.codex)).count == 1)
        #expect(try events.map(chunk(first), connection: connection(.codex)).isEmpty)
    }
}
