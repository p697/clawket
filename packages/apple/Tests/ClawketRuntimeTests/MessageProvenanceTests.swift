import Foundation
import Testing
import ClawketTransport
@testable import ClawketRuntime

private func provenanceHistory(_ messages: [JSONValue], backend: BackendKind = .openclaw, media: Bool = false) throws -> RuntimeHistory {
    try WireModels.history(.object(["messages": .array(messages)]), key: "main", backend: backend, artifactsEnabled: media)
}
private func provenanceRow(_ id: String? = nil, text: String = "Same text") -> JSONValue {
    var value: [String: JSONValue] = ["role": .string("user"), "text": .string(text), "timestampMs": .number(100_000)]
    if let id { value["id"] = .string(id) }
    return .object(value)
}

@Suite(.serialized)
struct MessageProvenanceTests {
    @Test func suppliedIdentityPrecedenceDoesNotUseChannelOrSendIdentity() throws {
        let raw: JSONValue = .object(["id": .string("first"), "messageId": .string("second"), "role": .string("user"),
            "idempotencyKey": .string("send-key"), "__openclaw": .object(["id": .string("third")]),
            "attribution": .object(["channel": .string("slack"), "messageId": .string("platform-only")])])
        let message = try provenanceHistory([raw]).messages[0]
        #expect(message.id == "first"); #expect(message.providedID == "first"); #expect(message.idSource == .provided)
        #expect(message.attribution?.messageID == "platform-only"); #expect(message.idempotencyKey == "send-key")
        #expect(!message.sentLocally)
    }

    @Test func repeatedProvidedIdentityKeepsEveryRowWithIndependentPresentationIDs() throws {
        let values = [provenanceRow("duplicate"), provenanceRow("duplicate"), provenanceRow("duplicate", text: "Different"), provenanceRow("unique")]
        let history = try provenanceHistory(values)
        #expect(history.messages.count == values.count); #expect(Set(history.messages.map(\.id)).count == values.count)
        #expect(history.messages.prefix(3).allSatisfy { $0.providedID == "duplicate" && $0.idSource == .ambiguousProvided })
        #expect(history.messages[3].providedID == "unique"); #expect(history.messages[3].id == "unique")
        #expect(history.messages.map(\.id) == (try provenanceHistory(values)).messages.map(\.id))
        #expect(history.messages.map(\.raw) == values)
    }

    @Test func canonicallyEquivalentOpaqueIDsRemainBytePreservedAndRendererSafe() throws {
        let first = "\u{e9}", second = "e\u{301}"
        let messages = try provenanceHistory([provenanceRow(first), provenanceRow(second)]).messages
        #expect(messages.count == 2); #expect(Set(messages.map(\.id)).count == 2)
        #expect(messages.allSatisfy { $0.idSource == .ambiguousProvided })
        #expect(try #require(messages[0].providedID).utf8.elementsEqual(first.utf8))
        #expect(try #require(messages[1].providedID).utf8.elementsEqual(second.utf8))
        #expect(!messages[0].providedID!.utf8.elementsEqual(messages[1].providedID!.utf8))
    }

    @Test func missingIdentityAndCrossPageFallbackNeverBecomeProducerEvidence() throws {
        let row = provenanceRow()
        let first = try provenanceHistory([row, row]).messages
        #expect(first.count == 2); #expect(first[0].id != first[1].id)
        let anotherPage = try provenanceHistory([row], backend: .hermes).messages[0]
        // Even if a deterministic renderer fallback repeats on another page,
        // it carries no source identity or local-send authority.
        #expect((first + [anotherPage]).allSatisfy { $0.providedID == nil && $0.idSource == .synthetic && !$0.sentLocally })
        #expect((first + [anotherPage]).allSatisfy { $0.transcriptPosition == nil && $0.idempotencyKey == nil })
    }

    @Test func producerIDCannotCollideWithSyntheticRendererNamespace() throws {
        let row = provenanceRow()
        let fallback = try provenanceHistory([row]).messages[0].id
        for values in [[row, provenanceRow(fallback)], [provenanceRow(fallback), row]] {
            let messages = try provenanceHistory(values).messages
            #expect(Set(messages.map(\.id)).count == 2)
            let supplied = try #require(messages.first { $0.idSource == .provided })
            let synthetic = try #require(messages.first { $0.idSource == .synthetic })
            #expect(supplied.id == fallback); #expect(supplied.providedID == fallback); #expect(synthetic.providedID == nil)
        }
    }

    @Test(arguments: ["", " id ", "bad\nidentity", "bad\u{202e}identity", String(repeating: "x", count: 4_097)])
    func malformedSourceIDDoesNotReduceUsableHistory(_ id: String) throws {
        let row = provenanceRow(id)
        let result = try provenanceHistory([row]).messages[0]
        #expect(result.idSource == .synthetic); #expect(result.providedID == nil); #expect(result.raw == row)
    }

    @Test func existingRecordedResetRetainsExactPositionAndWireOrder() throws {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { root.deleteLastPathComponent() }
        let file = root.appendingPathComponent("apps/mobile/src/connection/adapters/__fixtures__/openclaw-session-reset.json")
        let rows = try #require(FrameCodec.decode(String(contentsOf: file, encoding: .utf8)).array)
        let messages = try provenanceHistory(rows).messages
        #expect(messages.count == 3); #expect(messages.map(\.providedID) == ["first-user-after-reset", "5e4bd6a9", "first-reply-after-reset"])
        #expect(messages.map { $0.transcriptPosition?.rawSequence } == [3793, 3792, 3794])
        #expect(messages.allSatisfy { $0.transcriptPosition?.source == "recorded-transcript" })
        #expect(messages[1].transcriptBoundary == .reset); #expect(messages[1].text == "Reset")
        #expect(messages[0].timestampMs == 1_790_811_103_447); #expect(messages[1].timestampMs == 1_790_811_104_359)
        #expect(messages.map(\.raw) == rows)
    }

    @Test func onlyActualStructuredBoundaryAndSafePositionAreExposed() throws {
        let rows: [JSONValue] = [
            .object(["role": .string("system"), "text": .string("Reset")]),
            .object(["role": .string("assistant"), "__openclaw": .object(["kind": .string("reset")])]),
            .object(["role": .string("system"), "__openclaw": .object(["kind": .string("checkpoint"),
                "transcriptPosition": .object(["source": .string("source"), "rawSeq": .number(1.5)])])]),
            .object(["role": .string("system"), "__openclaw": .object(["kind": .string("compaction"),
                "transcriptPosition": .object(["source": .string("source"), "rawSeq": .number(-1)])])])]
        let messages = try provenanceHistory(rows).messages
        #expect(messages.prefix(3).allSatisfy { $0.transcriptBoundary == nil }); #expect(messages[3].transcriptBoundary == .compaction)
        #expect(messages.allSatisfy { $0.transcriptPosition == nil })
        #expect(try provenanceHistory(rows, backend: .hermes).messages.allSatisfy { $0.transcriptBoundary == nil })
    }

    @Test(arguments: BackendKind.allCases)
    func physicalSessionIdentityAndThinkingAreActualOptionalMetadata(_ backend: BackendKind) throws {
        let value: JSONValue = .object(["messages": .array([]), "sessionId": .string("actual-physical"), "thinkingLevel": .string("high")])
        let history = try WireModels.history(value, key: "logical-route", backend: backend)
        #expect(history.sessionID == "actual-physical"); #expect(history.thinkingLevel == "high")
        #expect(try provenanceHistory([], backend: backend).sessionID == nil)
        let malformed: JSONValue = .object(["messages": .array([]), "sessionId": .number(1), "sessionInfo": .object(["sessionId": .string("not-top-level")])])
        #expect(try WireModels.history(malformed, key: "logical-route", backend: backend).sessionID == nil)
    }

    @Test func legacyCachesNeverGuessProvenanceFromTheRendererID() throws {
        let old = Data("{\"id\":\"native-history:looks-synthetic:0\",\"role\":\"user\",\"text\":\"old\",\"sentLocally\":true,\"raw\":{}}".utf8)
        let message = try JSONDecoder().decode(RuntimeMessage.self, from: old)
        #expect(message.idSource == nil); #expect(message.providedID == nil); #expect(message.attribution == nil)
        #expect(message.transcriptPosition == nil); #expect(message.transcriptBoundary == nil); #expect(message.sentLocally)
        let oldHistory = Data("{\"key\":\"main\",\"messages\":[],\"pagination\":\"limit\",\"hasActiveRun\":false}".utf8)
        let history = try JSONDecoder().decode(RuntimeHistory.self, from: oldHistory)
        #expect(history.sessionID == nil); #expect(history.thinkingLevel == nil)
    }

    @Test func mediaProjectionPreservesProvenanceAndDoesNotDiscardAmbiguousRows() throws {
        let attachment: JSONValue = .object(["type": .string("image"), "mimeType": .string("image/png"), "artifactId": .string("artifact_managed_one")])
        let row: JSONValue = .object(["id": .string("duplicate"), "role": .string("assistant"), "text": .string(""), "attachments": .array([attachment]),
            "__openclaw": .object(["transcriptPosition": .object(["source": .string("source"), "rawSeq": .number(4)])])])
        let ambiguous = try provenanceHistory([row, row], media: true).messages
        #expect(ambiguous.count == 2); #expect(ambiguous[0].id != ambiguous[1].id)
        #expect(ambiguous.allSatisfy { $0.providedID == "duplicate" && $0.idSource == .ambiguousProvided && $0.transcriptPosition?.rawSequence == 4 })
        #expect(ambiguous.allSatisfy { $0.attachments.first?.artifactID == "artifact_managed_one" })
        let single = try provenanceHistory([row], media: true).messages[0]
        #expect(single.providedID == "duplicate"); #expect(single.idSource == .provided); #expect(single.transcriptPosition?.rawSequence == 4)
    }
}
