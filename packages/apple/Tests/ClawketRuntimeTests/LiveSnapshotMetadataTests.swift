import ClawketTransport
import Foundation
import Testing
@testable import ClawketRuntime

@Suite(.serialized)
struct LiveSnapshotMetadataTests {
    private func connection(_ backend: BackendKind = .openclaw) -> BackendConnection {
        .init(id: "synthetic-snapshot", backendKind: backend, transportKind: .local, label: "Synthetic",
              url: URL(string: "ws://127.0.0.1:1")!)
    }
    private func frame(_ payload: [String: JSONValue], event: String = "chat") -> JSONValue {
        .object(["type": .string("event"), "event": .string(event), "payload": .object(payload)])
    }
    private func chat(_ message: [String: JSONValue], state: String = "delta", extra: [String: JSONValue] = [:]) -> JSONValue {
        frame(["runId": .string("actual-run"), "sessionKey": .string("s"), "state": .string(state),
               "message": .object(message)].merging(extra) { _, new in new })
    }
    private func text(_ updates: [RuntimeSessionUpdate]) throws -> RuntimeTextUpdate {
        guard case let .text(value) = try #require(updates.first) else {
            throw RuntimeFailure(.invalidResponse)
        }
        return value
    }

    @Test func chatSnapshotsUseTheSameActualMessageIdentityAndLineageParserAsFinalAndHistory() throws {
        var events = SessionEvents()
        let message: [String: JSONValue] = ["id": .string("é"), "messageId": .string("secondary"),
            "role": .string("assistant"), "content": .string("Cumulative body"),
            "turnId": .string("inner-turn"), "inputMessageId": .string("inner-input"),
            "inputMessageKey": .string("e\u{301}"), "timestampMs": .number(1_767_225_600_000),
            "__openclaw": .object(["transcriptPosition": .object(["source": .string("transcript"), "rawSeq": .number(4)])])]
        let live = try text(events.map(chat(message), connection: connection()))
        let metadata = try #require(live.snapshotMetadata)
        let completed = try events.map(chat(message, state: "final"), connection: connection())
        let final = try #require(completed.last)
        let history = try WireModels.history(.object(["messages": .array([.object(message)])]), key: "s", backend: .openclaw)
        #expect(metadata == final.finalMessageMetadata(backend: .openclaw))
        #expect(metadata.providedID == history.messages[0].providedID)
        #expect(Data(try #require(metadata.providedID).utf8) == Data("é".utf8))
        #expect(metadata.transcriptPosition == history.messages[0].transcriptPosition)
        #expect(live.mode == .snapshot && live.turnID == "inner-turn" && live.inputMessageID == "inner-input")
        #expect(Data(try #require(live.inputMessageKey).utf8) == Data("e\u{301}".utf8))
    }

    @Test(arguments: BackendKind.allCases)
    func missingMessageIDsNeverUseEnvelopeRunItemToolTurnOrClockIdentity(_ backend: BackendKind) throws {
        var events = SessionEvents()
        let live = try text(events.map(chat(["role": .string("assistant"), "content": .string("Body"),
            "timestampMs": .number(1_767_225_600_000)], extra: ["id": .string("event"), "itemId": .string("item"),
            "toolCallId": .string("tool"), "turnId": .string("turn")]), connection: connection(backend)))
        #expect(live.snapshotMetadata == nil)
        #expect(live.runID == "actual-run" && live.turnID == "turn")
    }

    @Test(arguments: [BackendKind.codex, .claudeCode, .pi, .localModel])
    func canonicalSDKChunksNeverPromoteTheLastItemOrAnEmbeddedMessageIntoAggregateIdentity(_ backend: BackendKind) throws {
        var events = SessionEvents()
        let eventName = try #require(BackendProfile.profile(for: backend).updateEvent)
        for mode in ["delta", "snapshot"] {
            let live = try text(events.map(frame(["type": .string("agent_message_chunk"), "sessionKey": .string("s"),
                "runId": .string("r"), "text": .string("Aggregate"), "textMode": .string(mode),
                "itemId": .string("last-item"), "messageId": .string("envelope-message"),
                "message": .object(["id": .string("last-message"), "role": .string("assistant")])],
                event: eventName), connection: connection(backend)))
            #expect(live.snapshotMetadata == nil)
            #expect(live.mode == (mode == "delta" ? .delta : .snapshot))
        }
    }

    @Test func roleAndConflictingByteLineageRemainExplicitAndMalformedIDsStayUnknown() throws {
        for role in ["assistant", "user", "system", "tool"] {
            var events = SessionEvents()
            let live = try text(events.map(chat(["id": .string("actual"), "role": .string(role),
                "content": .string("Body"), "turnId": .string("e\u{301}")],
                extra: ["turnId": .string("é")]), connection: connection()))
            #expect(live.snapshotMetadata?.role.rawValue == role)
            #expect(live.snapshotMetadata?.hasConflictingLineage == true)
        }
        for id in ["", "bad\nidentity", String(repeating: "x", count: 4_097)] {
            var events = SessionEvents()
            let live = try text(events.map(chat(["id": .string(id), "role": .string("assistant"),
                "content": .string("Body")]), connection: connection()))
            #expect(live.snapshotMetadata == nil)
        }
        var events = SessionEvents()
        let runConflict = try text(events.map(chat(["id": .string("actual"), "role": .string("assistant"),
            "runId": .string("other-run"), "content": .string("Body")]), connection: connection()))
        #expect(runConflict.snapshotMetadata?.hasConflictingLineage == true)
        let malformed = try text(events.map(chat(["id": .string("actual"), "role": .string("assistant"),
            "content": .string("Body")], extra: ["turnId": .string("bad\nlineage"),
                "inputMessageId": .string(String(repeating: "x", count: 4_097)), "inputMessageKey": .bool(true)]), connection: connection()))
        #expect(malformed.snapshotMetadata != nil)
        #expect(malformed.turnID == nil && malformed.inputMessageID == nil && malformed.inputMessageKey == nil)
    }

    @Test func missingMalformedAndLegacyHistoryActivityAreNotTerminalEvidence() throws {
        for raw in [JSONValue.null, .string("false"), .number(0)] {
            let history = try WireModels.history(.object(["messages": .array([]), "hasActiveRun": raw]), key: "s", backend: .hermes)
            #expect(history.activeRunEvidence == nil)
        }
        let absent = try WireModels.history(.object(["messages": .array([])]), key: "s", backend: .openclaw)
        #expect(absent.activeRunEvidence == nil)
        let conflicting: [[String: JSONValue]] = [
            ["hasActiveRun": .bool(false), "activeRun": .object(["runId": .string("actual")])],
            ["hasActiveRun": .bool(false), "inFlightRun": .object(["runId": .string("actual")])],
            ["hasActiveRun": .bool(true), "sessionInfo": .object(["hasActiveRun": .bool(false)])],
            ["hasActiveRun": .bool(false), "sessionInfo": .object(["hasActiveRun": .null])]
        ]
        for fields in conflicting {
            let history = try WireModels.history(.object(fields.merging(["messages": .array([])]) { _, new in new }), key: "s", backend: .hermes)
            #expect(history.activeRunEvidence == nil)
        }
        let old = Data(#"{"key":"s","messages":[],"pagination":"limit","hasActiveRun":false}"#.utf8)
        #expect(try JSONDecoder().decode(RuntimeHistory.self, from: old).activeRunEvidence == nil)
        for value in [true, false] {
            let history = try WireModels.history(.object(["messages": .array([]), "sessionInfo": .object([
                "hasActiveRun": .bool(value)])]), key: "s", backend: .hermes)
            #expect(history.activeRunEvidence == value)
            #expect(try JSONDecoder().decode(RuntimeHistory.self, from: JSONEncoder().encode(history)).activeRunEvidence == value)
        }
    }

    @Test func currentProducerShapesAndLegacyActualRunSnapshotsPreservePositiveActivityWithoutGuessing() throws {
        for backend in BackendKind.allCases {
            var fields: [String: JSONValue] = ["messages": .array([])]
            if backend == .openclaw { fields["sessionInfo"] = .object(["hasActiveRun": .bool(true)]) }
            else { fields["hasActiveRun"] = .bool(true) }
            if backend != .localModel {
                fields[backend == .openclaw || backend == .hermes ? "inFlightRun" : "activeRun"] = .object([
                    "runId": .string("actual-run"), "text": .string("")])
            }
            let history = try WireModels.history(.object(fields), key: "s", backend: backend)
            #expect(history.activeRunEvidence == true)
            #expect(history.activeRunID == (backend == .localModel ? nil : "actual-run"))
        }
        for name in ["activeRun", "inFlightRun"] {
            let history = try WireModels.history(.object(["messages": .array([]), name: .object([
                "runId": .string("e\u{301}"), "sessionKey": .string("s"), "text": .string("")])]), key: "s", backend: .hermes)
            #expect(history.hasActiveRun == false) // Compatibility default is unchanged.
            #expect(history.activeRunEvidence == true)
            #expect(Data(try #require(history.activeRunID).utf8) == Data("e\u{301}".utf8))
        }
        let invalidRuns: [JSONValue] = [.object(["text": .string("Not an identity"), "timestampMs": .number(1)]),
            .object(["runId": .string("")]), .object(["runId": .string("bad\nrun")]),
            .object(["runId": .string(String(repeating: "r", count: 257))]),
            .object(["runId": .string("actual"), "sessionKey": .string("other")]), .string("run-like")]
        for run in invalidRuns {
            let history = try WireModels.history(.object(["messages": .array([]), "inFlightRun": run]), key: "s", backend: .openclaw)
            #expect(history.activeRunEvidence == nil && history.activeRunID == nil)
        }
        let conflicting = try WireModels.history(.object(["messages": .array([]), "hasActiveRun": .bool(true),
            "activeRun": .object(["runId": .string("é")]), "inFlightRun": .object(["runId": .string("e\u{301}")])]), key: "s", backend: .hermes)
        #expect(conflicting.activeRunEvidence == nil)
    }
}
