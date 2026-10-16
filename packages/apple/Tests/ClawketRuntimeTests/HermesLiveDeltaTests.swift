import ClawketTransport
import Foundation
import Testing
@testable import ClawketRuntime

@Suite(.serialized)
struct HermesLiveDeltaTests {
    private func connection(_ backend: BackendKind = .hermes, transport: TransportKind = .local) -> BackendConnection {
        .init(id: "synthetic-deltas", backendKind: backend, transportKind: transport, label: "Synthetic",
              url: URL(string: "ws://127.0.0.1:1")!)
    }

    // Synthetic envelopes follow Hermes stream-mapping.ts: message.delta sends
    // only delta, agent/tool/start marks a boundary, and final sends full output.
    // No captured prompts, backend payloads or real run/message IDs are used.
    private func chat(_ content: String, state: String = "delta", seq: Int = 1,
                      message: [String: JSONValue] = [:], extra: [String: JSONValue] = [:]) -> JSONValue {
        let body: [String: JSONValue] = ["role": .string("assistant"), "content": .string(content)]
        let payload: [String: JSONValue] = ["runId": .string("fixture-run"), "sessionKey": .string("main"),
            "seq": .number(Double(seq)), "state": .string(state),
            "message": .object(body.merging(message) { _, new in new })]
        return .object(["type": .string("event"), "event": .string("chat"),
                        "payload": .object(payload.merging(extra) { _, new in new })])
    }

    private func toolStart(_ id: String) -> JSONValue {
        .object(["type": .string("event"), "event": .string("agent"), "payload": .object([
            "runId": .string("fixture-run"), "sessionKey": .string("main"), "stream": .string("tool"),
            "data": .object(["phase": .string("start"), "name": .string("fixture-tool"), "toolCallId": .string(id)])])])
    }

    private func text(_ updates: [RuntimeSessionUpdate]) throws -> RuntimeTextUpdate {
        guard case let .text(value) = try #require(updates.first) else {
            throw RuntimeFailure(.invalidResponse)
        }
        return value
    }

    @Test(arguments: [TransportKind.local, .relay])
    func hermesProducerFragmentsRemainIncrementalWithExactWhitespaceAndUnicode(_ transport: TransportKind) throws {
        var events = SessionEvents()
        let chunks = ["前", " \n", "é", "/", "e", "\u{301}", "\r\n", "\t", "👩", "\u{200D}", "💻"]
        var mapped: [RuntimeTextUpdate] = []
        for (index, chunk) in chunks.enumerated() {
            let update = try text(events.map(chat(chunk, seq: index + 1), connection: connection(transport: transport)))
            #expect(update.mode == .delta)
            #expect(Data(update.text.utf8) == Data(chunk.utf8))
            #expect(update.snapshotMetadata == nil)
            #expect(update.sessionKey == "main" && update.runID == "fixture-run")
            mapped.append(update)
        }
        #expect(Set(mapped.map(\.segmentID)).count == 1)
        // The mapped fragment sequence matches the producer's assistantText.
        // This is a wire-contract check, not a replacement UI accumulator.
        #expect(Data(mapped.map(\.text).joined().utf8) == Data("前 \né/e\u{301}\r\n\t👩‍💻".utf8))
    }

    @Test func hermesDeltaCannotBorrowSnapshotIdentityFromAnEmbeddedMessage() throws {
        var events = SessionEvents()
        let update = try text(events.map(chat("fragment", message: [
            "id": .string("actual-looking-message"), "messageId": .string("secondary"),
            "runId": .string("inner-run"), "turnId": .string("inner-turn")], extra: [
            "id": .string("event"), "itemId": .string("item"), "toolCallId": .string("tool"),
            "turnId": .string("envelope-turn"), "inputMessageKey": .string("e\u{301}")]), connection: connection()))
        #expect(update.mode == .delta && update.text == "fragment")
        #expect(update.snapshotMetadata == nil)
        #expect(update.runID == "fixture-run" && update.turnID == "envelope-turn")
        #expect(Data(try #require(update.inputMessageKey).utf8) == Data("e\u{301}".utf8))
    }

    @Test func hermesToolBoundariesRetainSegmentsAndFinalSnapshotTargetsLatestSegment() throws {
        var events = SessionEvents()
        let before = try text(events.map(chat("Before tool"), connection: connection()))
        _ = try events.map(toolStart("fixture-tool-1"), connection: connection())
        let after = try text(events.map(chat("After ", seq: 2), connection: connection()))
        _ = try events.map(toolStart("fixture-tool-1"), connection: connection())
        let tail = try text(events.map(chat("tool", seq: 3), connection: connection()))
        #expect(before.mode == .delta && after.mode == .delta && tail.mode == .delta)
        #expect(before.segmentID != after.segmentID && after.segmentID == tail.segmentID)
        let completed = try events.map(chat("After tool — final correction", state: "final", seq: 4), connection: connection())
        #expect(completed.count == 2)
        let final = try text(completed)
        #expect(final.mode == .snapshot && final.text == "After tool — final correction")
        #expect(final.segmentID == tail.segmentID && final.segmentID != before.segmentID)
        guard case let .runFinished(key, runID, reason, segmentID, _) = completed[1] else {
            Issue.record("Missing authoritative final after the full snapshot"); return
        }
        #expect(key == "main" && runID == "fixture-run" && reason == "end_turn")
        #expect(segmentID == final.segmentID)
        #expect(try events.map(chat("late", seq: 5), connection: connection()).isEmpty)
        #expect(try events.map(chat("duplicate", state: "final", seq: 6), connection: connection()).isEmpty)
    }

    @Test(arguments: [BackendKind.hermes, .openclaw])
    func fullFinalOnlyMessagesKeepActualMetadataAndSnapshotSemantics(_ backend: BackendKind) throws {
        var events = SessionEvents()
        let completed = try events.map(chat("Full final e\u{301}\r\nbody", state: "final", message: [
            "id": .string("é"), "turnId": .string("final-turn")]), connection: connection(backend))
        #expect(completed.count == 2)
        let final = try text(completed)
        #expect(final.mode == .snapshot)
        #expect(Data(final.text.utf8) == Data("Full final e\u{301}\r\nbody".utf8))
        let metadata = try #require(final.snapshotMetadata)
        #expect(Data(try #require(metadata.providedID).utf8) == Data("é".utf8))
        #expect(final.turnID == "final-turn")
        #expect(metadata == completed[1].finalMessageMetadata(backend: backend))
    }

    @Test func openClawChatDeltasRemainCumulativeSourceBackedSnapshots() throws {
        var events = SessionEvents()
        let value = connection(.openclaw)
        for (index, cumulative) in ["前", "前 e\u{301}", "前 e\u{301}\r\nDone"].enumerated() {
            let update = try text(events.map(chat(cumulative, seq: index + 1,
                message: ["id": .string("producer-message")]), connection: value))
            #expect(update.mode == .snapshot)
            #expect(Data(update.text.utf8) == Data(cumulative.utf8))
            #expect(update.snapshotMetadata?.providedID == "producer-message")
        }
    }
}
