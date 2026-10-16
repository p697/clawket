@testable import ClawketRuntime
import ClawketTransport
import ClawketUI
import Foundation
import XCTest
@testable import Clawket

final class NativeLiveMessagesTests: XCTestCase {
    private let epoch = UUID()
    private func text(_ run: String = "run", segment: String = "paragraph", value: String,
                      mode: RuntimeTextUpdate.Mode = .snapshot) -> RuntimeTextUpdate {
        .init(sessionKey: "session", runID: run, segmentID: segment, text: value, mode: mode,
              turnID: "actual-turn", inputMessageID: "actual-input", inputMessageKey: "actual-key")
    }
    private func finish(_ document: inout NativeConversation, segment: String = "paragraph",
                        metadata: RuntimeFinalMessageMetadata? = nil, notice: RuntimeTerminalNotice? = nil,
                        attachments: Bool = false) -> String? {
        NativeLiveMessages.finish(runID: "run", segmentID: segment, metadata: metadata, notice: notice,
            hasAttachments: attachments, in: &document, epoch: epoch)
    }

    func testActualHermesMapperAccumulatesUnicodeFragmentsAndKeepsFullFinalRenderID() throws {
        let connection = BackendConnection(id: "synthetic-hermes", backendKind: .hermes, transportKind: .local,
            label: "Synthetic", url: URL(string: "ws://127.0.0.1:1")!)
        let originalDraft = "Independent e\u{301} draft"
        var mapper = SessionEvents(), document = NativeConversation(draft: originalDraft, historyEpoch: epoch)
        // Same chat envelope as the Bridge's message.delta/full final producer.
        var sequence = 0
        func chat(_ text: String, state: String = "delta") -> JSONValue {
            sequence += 1
            return .object(["type": .string("event"), "event": .string("chat"), "payload": .object([
                "runId": .string("fixture-run"), "sessionKey": .string("session"), "seq": .number(Double(sequence)),
                "state": .string(state), "message": .object(["role": .string("assistant"), "content": .string(text)])])])
        }
        func mappedText(_ frame: JSONValue) throws -> RuntimeTextUpdate {
            let updates = try mapper.map(frame, connection: connection)
            guard case let .text(value)? = updates.first else {
                throw RuntimeFailure(.invalidResponse)
            }
            XCTAssertNil(value.snapshotMetadata)
            XCTAssertTrue(NativeLiveMessages.text(value, in: &document, epoch: epoch))
            return value
        }
        let chunks = ["NO", "RMAL", " ", "NO", "_", "REPLY", "\n", "先", " ", "e", "\u{301}",
                      "👩", "\u{200D}", "💻", "\r\n", "\t", "段"]
        XCTAssertEqual(try mappedText(chat(chunks[0])).mode, .delta)
        let firstID = document.messages[0].id
        for index in 1..<chunks.count {
            let update = try mappedText(chat(chunks[index]))
            XCTAssertEqual(update.mode, .delta)
            XCTAssertEqual(document.messages.count, 1)
            XCTAssertEqual(document.messages[0].id, firstID)
            XCTAssertEqual(Data(document.messages[0].text.utf8), Data(chunks.prefix(index + 1).joined().utf8))
        }
        let finalText = chunks.joined() + " — corrected complete final"
        let final = try mapper.map(chat(finalText, state: "final"), connection: connection)
        XCTAssertEqual(final.count, 2)
        guard case let .text(snapshot) = final[0], case let .runFinished(_, runID, _, segmentID, _) = final[1] else {
            return XCTFail("Missing full final snapshot and authoritative completion")
        }
        XCTAssertEqual(snapshot.mode, .snapshot)
        XCTAssertTrue(NativeLiveMessages.text(snapshot, in: &document, epoch: epoch))
        XCTAssertEqual(NativeLiveMessages.finish(runID: runID, segmentID: segmentID,
            metadata: final[1].finalMessageMetadata(backend: .hermes), notice: nil, hasAttachments: false,
            in: &document, epoch: epoch), firstID)
        XCTAssertEqual(document.messages.map(\.id), [firstID])
        XCTAssertEqual(Data(document.messages[0].text.utf8), Data(finalText.utf8))
        XCTAssertEqual(document.messages[0].liveSnapshotState, .terminal)
        XCTAssertTrue(document.messages.allSatisfy { !$0.streaming && $0.providedID == nil && !$0.local })
        XCTAssertEqual(Data(document.draft.utf8), Data(originalDraft.utf8))
        XCTAssertTrue(try mapper.map(chat("late"), connection: connection).isEmpty)
    }

    func testDeltaSnapshotAndParagraphBoundariesKeepIndependentRenderIDsAndActualLineage() throws {
        var document = NativeConversation(historyEpoch: epoch)
        XCTAssertTrue(NativeLiveMessages.text(text(value: "One", mode: .delta), in: &document, epoch: epoch))
        let first = document.messages[0].id
        XCTAssertNotNil(UUID(uuidString: first)); XCTAssertNil(document.messages[0].providedID)
        XCTAssertTrue(NativeLiveMessages.text(text(value: " two", mode: .delta), in: &document, epoch: epoch))
        XCTAssertEqual(document.messages[0].text, "One two")
        XCTAssertTrue(NativeLiveMessages.text(text(value: "Corrected"), in: &document, epoch: epoch))
        XCTAssertTrue(NativeLiveMessages.text(text(segment: "next", value: "After tool"), in: &document, epoch: epoch))
        let second = document.messages[1].id
        let metadata = RuntimeFinalMessageMetadata(role: .assistant, providedID: "actual-final", timestampMs: 123,
            turnID: "actual-turn", inputMessageID: "actual-input", inputMessageKey: "actual-key")
        XCTAssertEqual(finish(&document, segment: "next", metadata: metadata), second)
        XCTAssertEqual(document.messages.map(\.id), [first, second]); XCTAssertEqual(document.messages.map(\.text), ["Corrected", "After tool"])
        XCTAssertNil(document.messages[0].providedID); XCTAssertEqual(document.messages[1].providedID, "actual-final")
        XCTAssertEqual(document.messages[1].timestampMs, 123); XCTAssertEqual(document.messages[1].turnID, "actual-turn")
        XCTAssertEqual(document.messages[1].inputMessageKey, "actual-key")
        XCTAssertTrue(document.messages.allSatisfy { !$0.local && $0.delivery == nil && !$0.streaming && $0.historyEpoch == epoch })
    }

    func testDelimiterAliasesNeverSelectOrOverwriteAnotherRunsSegment() throws {
        var document = NativeConversation()
        XCTAssertTrue(NativeLiveMessages.text(text("a-b", segment: "c", value: "first"), in: &document, epoch: epoch))
        XCTAssertTrue(NativeLiveMessages.text(text("a", segment: "b-c", value: "second"), in: &document, epoch: epoch))
        XCTAssertEqual(document.messages.count, 2)
        XCTAssertNotEqual(document.messages[0].id, document.messages[1].id)
        XCTAssertTrue(NativeLiveMessages.text(text("a-b", segment: "c", value: "+", mode: .delta), in: &document, epoch: epoch))
        XCTAssertEqual(document.messages.map(\.text), ["first+", "second"])
    }

    func testByteDistinctRunsSegmentsAndEpochsDoNotBorrowAStoredRowsIdentity() throws {
        var document = NativeConversation(messages: [.init(id: "old", role: .assistant, text: "older", runID: "é",
            segmentID: "same", streaming: true, historyEpoch: UUID())])
        for run in ["é", "e\u{301}"] {
            XCTAssertTrue(NativeLiveMessages.text(text(run, segment: "same", value: run), in: &document, epoch: epoch))
        }
        XCTAssertEqual(document.messages.count, 3); XCTAssertEqual(document.messages[0].text, "older")
        XCTAssertEqual(Data(document.messages[1].runID!.utf8), Data("é".utf8))
        XCTAssertEqual(Data(document.messages[2].runID!.utf8), Data("e\u{301}".utf8))
        XCTAssertTrue(NativeLiveMessages.text(text("run", segment: "é", value: "a"), in: &document, epoch: epoch))
        XCTAssertTrue(NativeLiveMessages.text(text("run", segment: "e\u{301}", value: "b"), in: &document, epoch: epoch))
        XCTAssertEqual(document.messages.count, 5)
    }

    func testAmbiguousSegmentsRejectTextSourceAndMediaRatherThanChoosingLastRow() throws {
        var document = NativeConversation(messages: ["one", "two"].map {
            .init(id: $0, role: .assistant, text: $0, runID: "run", segmentID: "paragraph", streaming: true, historyEpoch: epoch)
        })
        XCTAssertFalse(NativeLiveMessages.text(text(value: "wrong"), in: &document, epoch: epoch))
        XCTAssertNil(finish(&document, metadata: .init(role: .assistant, providedID: "actual"), attachments: true))
        XCTAssertEqual(document.messages.map(\.text), ["one", "two"])
        XCTAssertTrue(document.messages.allSatisfy { $0.providedID == nil && $0.media.isEmpty })
    }

    func testKnownParticipantConflictsCannotAcquireTheFinalSourceOrAttachments() throws {
        let author = RuntimeMessageAttribution(channel: "channel", accountID: "é", sender: .init(id: "person"))
        let conflicts = [RuntimeMessageAttribution(channel: "channel", accountID: "e\u{301}", sender: .init(id: "person")),
            RuntimeMessageAttribution(channel: "channel", accountID: "é", sender: .init(id: "other"))]
        for conflict in conflicts {
            var document = NativeConversation(messages: [.init(id: "retained", role: .assistant, text: "original", runID: "run",
                segmentID: "paragraph", streaming: true, attribution: author, historyEpoch: epoch)])
            XCTAssertNil(finish(&document, metadata: .init(role: .assistant, providedID: "actual", attribution: conflict), attachments: true))
            XCTAssertEqual(document.messages[0].attribution, author); XCTAssertNil(document.messages[0].providedID)
            XCTAssertEqual(document.messages[0].text, "original")
        }
        var document = NativeConversation(messages: [.init(id: "kept", role: .assistant, text: "partial", runID: "run",
            segmentID: "paragraph", streaming: true, historyEpoch: epoch, turnID: "A")])
        XCTAssertNil(finish(&document, metadata: .init(role: .assistant, providedID: "actual-B", hasConflictingLineage: true), attachments: true))
        XCTAssertNil(document.messages[0].providedID); XCTAssertEqual(document.messages[0].text, "partial")
        var empty = NativeConversation()
        XCTAssertNil(finish(&empty, metadata: .init(role: .assistant, hasConflictingLineage: true), attachments: true))
        XCTAssertTrue(empty.messages.isEmpty)
    }

    func testDuplicateActualSourceIDsRemainVisibleAndCannotBecomeUniqueHistoryAuthority() throws {
        var document = NativeConversation(messages: [.init(id: "prior", role: .assistant, text: "other", providedID: "same",
            idSource: .provided, historyEpoch: epoch)])
        XCTAssertTrue(NativeLiveMessages.text(text(value: "current"), in: &document, epoch: epoch))
        _ = finish(&document, metadata: .init(role: .assistant, providedID: "same"))
        XCTAssertEqual(document.messages.count, 2)
        XCTAssertTrue(document.messages.allSatisfy { $0.providedID == "same" && $0.idSource == .ambiguousProvided })
        XCTAssertTrue(document.messages.allSatisfy { NativeHistoryIdentity.stored($0).sourceID == nil })
        // Removing another row does not turn a formerly ambiguous source into authority.
        document.messages.removeFirst(); document.messages[0].streaming = true
        _ = finish(&document, metadata: .init(role: .assistant, providedID: "same"))
        XCTAssertEqual(document.messages[0].idSource, .ambiguousProvided)
        XCTAssertNil(NativeHistoryIdentity.stored(document.messages[0]).sourceID)
    }

    func testTerminalSystemNoticeKeepsPartialReplyAndReusesItsActualSourceAcrossHistory() throws {
        var document = NativeConversation(historyEpoch: epoch)
        XCTAssertTrue(NativeLiveMessages.text(text(value: "Keep partial"), in: &document, epoch: epoch))
        let notice = RuntimeTerminalNotice(providedID: "actual-system", text: "Producer failure", timestampMs: 42)
        _ = finish(&document, notice: notice)
        XCTAssertEqual(document.messages.map(\.role), [.assistant, .system])
        XCTAssertEqual(document.messages.map(\.text), ["Keep partial", "Producer failure"])
        let system = document.messages[1]
        XCTAssertNotEqual(system.id, "actual-system"); XCTAssertNotNil(UUID(uuidString: system.id))
        XCTAssertEqual(system.timestampMs, 42); XCTAssertFalse(system.local)
        let raw = RuntimeMessage(id: "actual-system", role: .system, text: "Producer failure", timestampMs: 42,
            runID: nil, turnID: nil, idempotencyKey: nil, sentLocally: false, raw: .object([:]),
            providedID: "actual-system", idSource: .provided)
        let history = RuntimeHistory(key: "session", messages: [raw], nextCursor: nil, hasMore: false,
            pagination: .limit, hasActiveRun: false, activeRun: nil)
        let result = try NativeHistoryApplication.prepare(history, stored: document.messages,
            readSnapshot: Dictionary(uniqueKeysWithValues: document.messages.map { ($0.id, $0) }), epoch: epoch,
            route: .init(connectionID: "c", agentID: "a", sessionID: "session"), earlier: false)
        XCTAssertEqual(result.messages.first { $0.role == .system }?.id, system.id)
    }

    func testLegacyFailureNoticeHasNoSyntheticProducerIDOrClockAndProseDoesNotChangeOtherRoles() throws {
        let raw = RuntimeSessionUpdate.runFinished(sessionKey: "s", runID: "actual-run", reason: "error", segmentID: "display", raw: .object([:]))
        let notice = try XCTUnwrap(raw.terminalNotice(backend: .codex))
        var document = NativeConversation()
        _ = finish(&document, notice: notice)
        XCTAssertNil(document.messages[0].providedID); XCTAssertNil(document.messages[0].timestampMs)
        XCTAssertNil(NativeHistoryIdentity.stored(document.messages[0]).sourceID)
        for role in [RuntimeMessage.Role.user, .assistant] {
            let original = NativeMessage(id: "ordinary", role: role, text: notice.text)
            XCTAssertEqual(Data(NativeSystemNotice.text(original).utf8), Data(notice.text.utf8))
        }
        XCTAssertEqual(NativeSystemNotice.text(.init(id: "system", role: .system, text: "Arbitrary backend prose")), "Arbitrary backend prose")
    }

    func testOptionalLineageSurvivesCodableWhileOldDocumentsStayUnknown() throws {
        let old = Data(#"{"id":"old","role":"assistant","text":"cache"}"#.utf8)
        let decoded = try JSONDecoder().decode(NativeMessage.self, from: old)
        XCTAssertNil(decoded.turnID); XCTAssertNil(decoded.inputMessageID); XCTAssertNil(decoded.inputMessageKey)
        let value = NativeMessage(id: "new", role: .assistant, text: "cache", turnID: "é", inputMessageID: "actual", inputMessageKey: "e\u{301}")
        let copy = try JSONDecoder().decode(NativeMessage.self, from: JSONEncoder().encode(value))
        XCTAssertEqual(copy, value); XCTAssertEqual(Data(copy.inputMessageKey!.utf8), Data("e\u{301}".utf8))
        var different = copy; different.turnID = "e\u{301}"
        XCTAssertNotEqual(different, value)
    }

    @MainActor
    func testActualFinalMediaConsumerUsesOnlyTheExactReducerTargetAndMediaOnlyUsesUUID() throws {
        let model = NativeAppModel(), route = ConversationID(connectionID: "c", agentID: "a", sessionID: "session")
        var document = NativeConversation(messages: [.init(id: "previous-paragraph", role: .assistant, text: "keep", runID: "run", segmentID: "earlier")], historyEpoch: epoch)
        let target = try XCTUnwrap(finish(&document, segment: "image-only", metadata: .init(role: .assistant, providedID: "real-image"), attachments: true))
        XCTAssertNotNil(UUID(uuidString: target)); XCTAssertNotEqual(target, "media-run")
        model.documents[route] = document
        let update = RuntimeSessionUpdate.runFinished(sessionKey: "session", runID: "run", reason: "end_turn", segmentID: "image-only", raw: .object([
            "message": .object(["role": .string("assistant"), "attachments": .array([.object([
                "type": .string("image"), "artifactId": .string("artifact"), "mimeType": .string("image/png")])])])]))
        model.bindFinalMedia(update, route: route, messageID: target)
        XCTAssertTrue(model.documents[route]!.messages[0].media.isEmpty)
        XCTAssertEqual(model.documents[route]!.messages[1].media.count, 1)
        XCTAssertEqual(model.documents[route]!.messages[1].providedID, "real-image")
        model.bindFinalMedia(update, route: route, messageID: nil)
        XCTAssertEqual(model.documents[route]!.messages.count, 2)
    }
}
