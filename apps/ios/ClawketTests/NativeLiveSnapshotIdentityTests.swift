@testable import ClawketRuntime
import ClawketTransport
import ClawketUI
import Foundation
import XCTest
@testable import Clawket

final class NativeLiveSnapshotIdentityTests: XCTestCase {
    private let epoch = UUID()
    private let route = ConversationID(connectionID: "synthetic", agentID: "agent", sessionID: "session")
    private func update(_ value: String, source: String = "source", run: String = "run", segment: String = "segment",
                        metadata: RuntimeFinalMessageMetadata? = nil, turn: String? = "turn",
                        input: String? = "input", key: String? = "key") -> RuntimeTextUpdate {
        .init(sessionKey: "session", runID: run, segmentID: segment, text: value, mode: .snapshot,
              turnID: turn, inputMessageID: input, inputMessageKey: key,
              snapshotMetadata: metadata ?? .init(role: .assistant, providedID: source,
                turnID: turn, inputMessageID: input, inputMessageKey: key))
    }
    private func raw(_ source: String = "source", text: String = "History body", role: RuntimeMessage.Role = .assistant,
                     run: String? = "run", turn: String? = "turn", provenance: RuntimeMessageIDSource = .provided,
                     input: String = "input", key: String = "key", attribution: RuntimeMessageAttribution? = nil,
                     position: RuntimeTranscriptPosition? = nil) -> RuntimeMessage {
        var raw: [String: JSONValue] = ["id": .string(source), "role": .string(role.rawValue), "text": .string(text),
            "inputMessageId": .string(input), "inputMessageKey": .string(key)]
        if let run { raw["runId"] = .string(run) }
        if let turn { raw["turnId"] = .string(turn) }
        return .init(id: source, role: role, text: text, timestampMs: 123, runID: run, turnID: turn,
              idempotencyKey: nil, sentLocally: true, raw: .object(raw),
              providedID: source, idSource: provenance, attribution: attribution, transcriptPosition: position)
    }
    private func apply(_ values: [RuntimeMessage], to document: inout NativeConversation,
                       active: Bool = true, evidence: Bool? = true, activeRun: String? = "run") throws -> [Int: String] {
        let history = RuntimeHistory(key: "session", messages: values, nextCursor: nil, hasMore: false,
            pagination: .limit, hasActiveRun: active, activeRun: active ? activeRun.map { .object(["runId": .string($0)]) } : nil,
            activeRunEvidence: evidence)
        let result = try NativeHistoryApplication.prepare(history, stored: document.messages,
            readSnapshot: Dictionary(uniqueKeysWithValues: document.messages.map { ($0.id, $0) }),
            epoch: epoch, route: route, earlier: false, sourceAmbiguity: document.sourceAmbiguity,
            retiredTerminalSources: document.retiredTerminalSources)
        document.messages = result.messages
        document.sourceAmbiguity = result.sourceAmbiguity
        document.retiredTerminalSources = result.retiredTerminalSources
        return result.acceptedHistoryIDs
    }
    private func finish(_ document: inout NativeConversation, source: String? = "source", segment: String = "segment",
                        attachments: Bool = false) -> String? {
        NativeLiveMessages.finish(runID: "run", segmentID: segment,
            metadata: .init(role: .assistant, providedID: source, turnID: "turn", inputMessageID: "input", inputMessageKey: "key"),
            notice: nil, hasAttachments: attachments, in: &document, epoch: epoch)
    }

    func testLiveFirstActiveHeadAndFinalKeepOneUUIDAndNeverRegressToHistoryPrefix() throws {
        var document = NativeConversation(historyEpoch: epoch)
        XCTAssertTrue(NativeLiveMessages.text(update("Accepted cumulative body"), in: &document, epoch: epoch))
        let id = document.messages[0].id
        XCTAssertEqual(try apply([raw(text: "Accepted")], to: &document), [0: id])
        XCTAssertEqual(document.messages.count, 1); XCTAssertEqual(document.messages[0].id, id)
        XCTAssertEqual(document.messages[0].text, "Accepted cumulative body"); XCTAssertTrue(document.messages[0].streaming)
        XCTAssertTrue(NativeLiveMessages.text(update("Accepted cumulative body, complete"), in: &document, epoch: epoch))
        XCTAssertEqual(finish(&document), id)
        let terminal = document.messages[0]
        let evidenceValues: [Bool?] = [true, nil]
        for evidence in evidenceValues {
            XCTAssertTrue(try apply([raw(text: "Stale prefix")], to: &document, active: evidence == true, evidence: evidence).isEmpty)
            XCTAssertEqual(document.messages, [terminal])
        }
        XCTAssertEqual(try apply([raw(text: "Final history body")], to: &document, active: false, evidence: false), [0: id])
        XCTAssertEqual(document.messages.map(\.text), ["Final history body"])
        XCTAssertFalse(document.messages[0].streaming); XCTAssertEqual(document.messages[0].liveSnapshotState, .terminal)
        XCTAssertFalse(NativeLiveMessages.text(update("Late partial"), in: &document, epoch: epoch))
        XCTAssertEqual(document.messages.map(\.id), [id]); XCTAssertEqual(document.messages[0].text, "Final history body")
    }

    func testHistoryFirstUsesExistingUUIDAndOnlyActualAcceptedSnapshotPromotesActivity() throws {
        var document = NativeConversation(historyEpoch: epoch)
        _ = try apply([raw(text: "Prefix")], to: &document)
        let id = document.messages[0].id
        XCTAssertFalse(document.messages[0].streaming)
        XCTAssertTrue(NativeLiveMessages.text(update("Prefix and complete cumulative body"), in: &document, epoch: epoch))
        XCTAssertEqual(document.messages.map(\.id), [id]); XCTAssertTrue(document.messages[0].streaming)
        _ = try apply([raw(text: "Older prefix")], to: &document)
        XCTAssertEqual(document.messages.map(\.text), ["Prefix and complete cumulative body"])
        XCTAssertEqual(document.messages.map(\.id), [id])
        XCTAssertTrue(NativeLiveMessages.text(update("Corrected complete body"), in: &document, epoch: epoch))
        XCTAssertEqual(document.messages.map(\.text), ["Corrected complete body"])
        XCTAssertEqual(finish(&document, source: nil, attachments: true), id)
        XCTAssertEqual(document.messages[0].liveSnapshotState, .terminal)
        _ = try apply([raw(text: "Final")], to: &document, active: false, evidence: false)
        XCTAssertEqual(document.messages.map(\.id), [id]); XCTAssertEqual(document.messages.map(\.text), ["Final"])
        var terminalFirst = NativeConversation(historyEpoch: epoch)
        _ = try apply([raw(text: "Already terminal")], to: &terminalFirst, active: false, evidence: false)
        let terminalID = terminalFirst.messages[0].id
        XCTAssertFalse(NativeLiveMessages.text(update("Late partial"), in: &terminalFirst, epoch: epoch))
        XCTAssertEqual(finish(&terminalFirst, attachments: true), terminalID)
        XCTAssertEqual(terminalFirst.messages.map(\.text), ["Already terminal"])
    }

    func testDifferentSourceAndSegmentCandidatesFailClosedWithoutConsumingEitherRow() throws {
        var document = NativeConversation(historyEpoch: epoch)
        _ = try apply([raw(text: "History")], to: &document)
        XCTAssertTrue(NativeLiveMessages.text(.init(sessionKey: "session", runID: "run", segmentID: "segment",
            text: "Separate live", mode: .snapshot, turnID: "turn", inputMessageID: "input", inputMessageKey: "key"),
            in: &document, epoch: epoch))
        let before = document.messages
        XCTAssertFalse(NativeLiveMessages.text(update("Do not choose one"), in: &document, epoch: epoch))
        XCTAssertEqual(document.messages, before)
        XCTAssertEqual(document.messages.count, 2)
        XCTAssertFalse(document.sourceAmbiguity?.rejects("source") == true)
    }

    func testSourceBindingRejectsRoleLineageParticipantPositionAndEpochConflicts() throws {
        let base = NativeMessage(id: "display", role: .assistant, text: "Kept", runID: "run", segmentID: "segment",
            streaming: true, providedID: "source", idSource: .provided, historyEpoch: epoch,
            turnID: "turn", inputMessageID: "input", inputMessageKey: "key", liveSnapshotState: .active)
        var invalid = [NativeMessage]()
        var value = base; value.role = .user; invalid.append(value)
        value = base; value.turnID = "other-turn"; invalid.append(value)
        value = base; value.inputMessageID = "other-input"; invalid.append(value)
        value = base; value.inputMessageKey = "other-key"; invalid.append(value)
        value = base; value.runID = "other-run"; invalid.append(value)
        value = base; value.segmentID = "other-segment"; invalid.append(value)
        for (index, row) in invalid.enumerated() {
            var document = NativeConversation(messages: [row], historyEpoch: epoch)
            let result = NativeLiveMessages.reduceText(update("Wrong"), in: &document, epoch: epoch)
            var expected = row
            if index == 5 {
                XCTAssertEqual(result, .rejected); XCTAssertNil(document.sourceAmbiguity)
            } else {
                XCTAssertEqual(result, .sourceAmbiguityChanged); expected.idSource = .ambiguousProvided
                XCTAssertTrue(document.sourceAmbiguity?.rejects("source") == true)
            }
            XCTAssertEqual(document.messages, [expected])
        }
        let conflicts = [RuntimeFinalMessageMetadata(role: .user, providedID: "source"),
            .init(role: .assistant, providedID: "source", hasConflictingLineage: true),
            .init(role: .assistant, providedID: "source", turnID: "other")]
        for (index, metadata) in conflicts.enumerated() {
            var document = NativeConversation(messages: [base], historyEpoch: epoch)
            XCTAssertFalse(NativeLiveMessages.text(update("Wrong", metadata: metadata), in: &document, epoch: epoch))
            var expected = base
            if index == 0 { expected.idSource = .ambiguousProvided }
            else { XCTAssertNil(document.sourceAmbiguity) }
            XCTAssertEqual(document.messages, [expected])
        }
        var attributed = base
        attributed.attribution = .init(channel: "channel", accountID: "é", sender: .init(id: "person"))
        attributed.transcriptPosition = .init(source: "transcript", rawSequence: 1)
        for metadata in [RuntimeFinalMessageMetadata(role: .assistant, providedID: "source", attribution:
                .init(channel: "channel", accountID: "e\u{301}", sender: .init(id: "person"))),
                .init(role: .assistant, providedID: "source", transcriptPosition: .init(source: "transcript", rawSequence: 2))] {
            var document = NativeConversation(messages: [attributed], historyEpoch: epoch)
            XCTAssertFalse(NativeLiveMessages.text(update("Wrong", metadata: metadata), in: &document, epoch: epoch))
            var expected = attributed; expected.idSource = .ambiguousProvided
            XCTAssertEqual(document.messages, [expected])
        }
        var old = base; old.historyEpoch = UUID()
        var document = NativeConversation(messages: [old], historyEpoch: epoch)
        XCTAssertTrue(NativeLiveMessages.text(update("New physical epoch"), in: &document, epoch: epoch))
        XCTAssertEqual(document.messages[0], old); XCTAssertEqual(document.messages.count, 2)
        XCTAssertNotEqual(document.messages[1].id, old.id)
        var otherConnectionDocument = NativeConversation(historyEpoch: epoch)
        XCTAssertTrue(NativeLiveMessages.text(update("Independent scoped document"), in: &otherConnectionDocument, epoch: epoch))
        XCTAssertNotEqual(otherConnectionDocument.messages[0].id, document.messages[1].id)
        XCTAssertEqual(document.messages[1].text, "New physical epoch")
    }

    func testDuplicateSourcesStayVisibleAndPermanentlyAmbiguousAfterOverlapOrRemoval() throws {
        var document = NativeConversation(historyEpoch: epoch)
        XCTAssertTrue(NativeLiveMessages.text(update("Live"), in: &document, epoch: epoch))
        _ = try apply([raw(text: "One", provenance: .ambiguousProvided), raw(text: "Two", provenance: .ambiguousProvided)], to: &document)
        XCTAssertEqual(document.messages.count, 3)
        XCTAssertTrue(document.messages.allSatisfy { $0.idSource == .ambiguousProvided })
        let before = document.messages
        XCTAssertFalse(NativeLiveMessages.text(update("Wrong"), in: &document, epoch: epoch))
        XCTAssertEqual(document.messages, before)
        document.messages = [try XCTUnwrap(document.messages.first { $0.streaming })]
        XCTAssertFalse(NativeLiveMessages.text(update("Still ambiguous"), in: &document, epoch: epoch))
        XCTAssertEqual(document.messages[0].idSource, .ambiguousProvided)
        XCTAssertNil(NativeHistoryIdentity.stored(document.messages[0]).sourceID)
        XCTAssertNil(finish(&document, attachments: true))
    }

    func testSourceIdentityNeverMergesAcrossToolSegmentsOrSelectsAnotherAttachmentTarget() throws {
        var document = NativeConversation(historyEpoch: epoch)
        XCTAssertTrue(NativeLiveMessages.text(update("Before tool"), in: &document, epoch: epoch))
        let first = document.messages[0].id
        XCTAssertFalse(NativeLiveMessages.text(update("After tool", segment: "after-tool"), in: &document, epoch: epoch))
        XCTAssertFalse(document.sourceAmbiguity?.rejects("source") == true)
        XCTAssertTrue(NativeLiveMessages.text(update("After tool", source: "other-source", segment: "after-tool"), in: &document, epoch: epoch))
        let second = document.messages[1].id
        XCTAssertNotEqual(first, second)
        XCTAssertEqual(finish(&document, source: "other-source", segment: "after-tool", attachments: true), second)
        XCTAssertEqual(document.messages.map(\.text), ["Before tool", "After tool"])
        XCTAssertEqual(document.messages.map(\.providedID), ["source", "other-source"])
    }

    func testCanonicalUnicodeAliasesRemainDistinctSourceRunAndSegmentIdentities() throws {
        var document = NativeConversation(historyEpoch: epoch)
        for id in ["é", "e\u{301}"] {
            XCTAssertTrue(NativeLiveMessages.text(update(id, source: id, run: id, segment: id), in: &document, epoch: epoch))
        }
        let ids = document.messages.map(\.id)
        XCTAssertEqual(document.messages.count, 2)
        XCTAssertNotEqual(Data(document.messages[0].providedID!.utf8), Data(document.messages[1].providedID!.utf8))
        _ = try apply([raw("é", text: "Older", run: "é"), raw("e\u{301}", text: "Older", run: "e\u{301}")], to: &document)
        XCTAssertEqual(document.messages.map(\.id), ids)
        XCTAssertEqual(document.messages.map { Data($0.text.utf8) }, [Data("é".utf8), Data("e\u{301}".utf8)])
    }

    func testTrueDeltaCannotBorrowHydratedHistoryBodyAndLiveFirstDeltaKeepsOnlyItsOwnPrefix() throws {
        var document = NativeConversation(historyEpoch: epoch)
        _ = try apply([raw(text: "Already hydrated whole history")], to: &document)
        let historyID = document.messages[0].id
        let delta = RuntimeTextUpdate(sessionKey: "session", runID: "run", segmentID: "segment", text: " fragment", mode: .delta,
            turnID: "turn", inputMessageID: "input", inputMessageKey: "key")
        XCTAssertTrue(NativeLiveMessages.text(delta, in: &document, epoch: epoch))
        XCTAssertEqual(document.messages.map(\.text), ["Already hydrated whole history", " fragment"])
        XCTAssertNotEqual(document.messages[1].id, historyID)
        var bound = NativeConversation(historyEpoch: epoch)
        _ = try apply([raw(text: "History")], to: &bound)
        XCTAssertTrue(NativeLiveMessages.text(update("Live snapshot"), in: &bound, epoch: epoch))
        XCTAssertTrue(NativeLiveMessages.text(delta, in: &bound, epoch: epoch))
        XCTAssertEqual(bound.messages.map(\.text), ["Live snapshot fragment"])
        var live = NativeConversation(historyEpoch: epoch)
        XCTAssertTrue(NativeLiveMessages.text(update("Live prefix"), in: &live, epoch: epoch))
        _ = try apply([raw(text: "Whole history must not replace live prefix")], to: &live)
        XCTAssertTrue(NativeLiveMessages.text(delta, in: &live, epoch: epoch))
        XCTAssertEqual(live.messages.map(\.text), ["Live prefix fragment"])
        let forbidden = RuntimeTextUpdate(sessionKey: "session", runID: "run", segmentID: "segment", text: "bad", mode: .delta,
            snapshotMetadata: .init(role: .assistant, providedID: "source"))
        XCTAssertFalse(NativeLiveMessages.text(forbidden, in: &live, epoch: epoch))
    }

    func testAmbiguitySurvivesUniqueEmptyAndReappearingHeadsAndColdCacheWithinTheSameEpoch() throws {
        var document = NativeConversation(historyEpoch: epoch)
        _ = try apply([raw(text: "One", provenance: .ambiguousProvided), raw(text: "Two", provenance: .ambiguousProvided)], to: &document)
        XCTAssertEqual(document.messages.count, 2)
        _ = try apply([raw(text: "Unique head")], to: &document)
        XCTAssertEqual(document.messages.count, 1)
        XCTAssertEqual(document.messages[0].idSource, .ambiguousProvided)
        XCTAssertFalse(NativeLiveMessages.text(update("Cannot regain authority"), in: &document, epoch: epoch))
        _ = try apply([], to: &document)
        XCTAssertTrue(document.messages.isEmpty)
        document = try JSONDecoder().decode(NativeConversation.self, from: JSONEncoder().encode(document))
        XCTAssertTrue(document.sourceAmbiguity?.rejects("source") == true)
        _ = try apply([raw(text: "Reappeared")], to: &document)
        XCTAssertEqual(document.messages[0].idSource, .ambiguousProvided)
        XCTAssertFalse(NativeLiveMessages.text(update("Still cannot bind"), in: &document, epoch: epoch))
        let newEpoch = UUID()
        XCTAssertTrue(NativeLiveMessages.text(update("New physical source"), in: &document, epoch: newEpoch))
        XCTAssertEqual(document.messages.filter { $0.historyEpoch == newEpoch }.count, 1)
        var retired = NativeConversation(historyEpoch: epoch)
        XCTAssertTrue(NativeLiveMessages.text(update("Original run"), in: &retired, epoch: epoch))
        _ = finish(&retired)
        _ = try apply([raw(text: "Different run reusing source", run: "different-run")], to: &retired, activeRun: "different-run")
        XCTAssertEqual(retired.messages.count, 1)
        XCTAssertEqual(retired.messages[0].idSource, .ambiguousProvided)
        XCTAssertTrue(retired.sourceAmbiguity?.rejects("source") == true)
        XCTAssertFalse(NativeLiveMessages.text(update("Must not revive", run: "different-run"), in: &retired, epoch: epoch))
    }

    func testAmbiguityMemoryIsByteExactBoundedAndOverflowNeverEvictsKnownFailuresToGrantAuthority() throws {
        var memory = NativeSourceAmbiguity(epoch: epoch)
        memory.remember("é")
        XCTAssertTrue(memory.rejects("é")); XCTAssertFalse(memory.rejects("e\u{301}"))
        for index in 0..<NativeSourceAmbiguity.limit { memory.remember("source-\(index)") }
        XCTAssertEqual(memory.sources.count, NativeSourceAmbiguity.limit)
        XCTAssertTrue(memory.overflow); XCTAssertTrue(memory.rejects("never-seen"))
        let copy = try JSONDecoder().decode(NativeSourceAmbiguity.self, from: JSONEncoder().encode(memory))
        XCTAssertEqual(copy, memory)
        var document = NativeConversation(historyEpoch: epoch, sourceAmbiguity: copy)
        XCTAssertFalse(NativeLiveMessages.text(update("No new authority", source: "never-seen"), in: &document, epoch: epoch))
        XCTAssertTrue(document.messages.isEmpty)
        XCTAssertFalse(copy.scoped(to: UUID()).rejects("é"))
        var corrupt = NativeSourceAmbiguity(epoch: epoch, sources: [Data([0xff])])
        XCTAssertTrue(corrupt.rejects("source"))
        corrupt.remember("source"); XCTAssertTrue(corrupt.overflow)
        let invalidCache = NativeConversation(historyEpoch: epoch, sourceAmbiguity: corrupt)
        XCTAssertThrowsError(try JSONDecoder().decode(NativeConversation.self, from: JSONEncoder().encode(invalidCache)))
    }

    func testRejectedLiveProvenanceContradictionsSurviveEmptyHeadColdRestoreAndSourceReappearance() throws {
        let author = RuntimeMessageAttribution(channel: "channel", accountID: "account", sender: .init(id: "person"))
        let metadata = RuntimeFinalMessageMetadata(role: .assistant, providedID: "source", attribution: author,
            transcriptPosition: .init(source: "transcript", rawSequence: 1), turnID: "turn", inputMessageID: "input", inputMessageKey: "key")
        let cases = [update("Wrong run", run: "next-run"),
            update("Wrong role", metadata: .init(role: .user, providedID: "source")),
            update("Wrong turn", turn: "other-turn"), update("Wrong input", input: "other-input"), update("Wrong key", key: "other-key"),
            update("Wrong position", metadata: .init(role: .assistant, providedID: "source", transcriptPosition: .init(source: "transcript", rawSequence: 2))),
            update("Wrong participant", metadata: .init(role: .assistant, providedID: "source", attribution:
                .init(channel: "channel", accountID: "account", sender: .init(id: "different-person"))))]
        for incoming in cases {
            var document = NativeConversation(historyEpoch: epoch)
            XCTAssertTrue(NativeLiveMessages.text(update("Original body", metadata: metadata), in: &document, epoch: epoch))
            let id = try XCTUnwrap(finish(&document))
            XCTAssertEqual(NativeLiveMessages.reduceText(incoming, in: &document, epoch: epoch), .sourceAmbiguityChanged)
            XCTAssertEqual(document.messages.map(\.id), [id]); XCTAssertEqual(document.messages.map(\.text), ["Original body"])
            XCTAssertEqual(document.messages[0].idSource, .ambiguousProvided)
            XCTAssertTrue(document.sourceAmbiguity?.rejects("source") == true)
            _ = try apply([], to: &document, active: false, evidence: false)
            XCTAssertTrue(document.messages.isEmpty)
            document = try JSONDecoder().decode(NativeConversation.self, from: JSONEncoder().encode(document))
            _ = try apply([raw(text: "Reappeared", run: incoming.runID)], to: &document, activeRun: incoming.runID)
            XCTAssertEqual(document.messages[0].idSource, .ambiguousProvided)
            XCTAssertEqual(NativeLiveMessages.reduceText(update("Cannot regain source", run: incoming.runID), in: &document, epoch: epoch), .rejected)
            XCTAssertEqual(document.messages.map(\.text), ["Reappeared"])
        }
    }

    func testFinalTargetsBecomeTerminalAndOnlyActualSourceContradictionsAreRemembered() throws {
        for origin in 0..<3 {
            var document = NativeConversation(historyEpoch: epoch)
            if origin == 0 {
                _ = try apply([raw(text: "Unknown history")], to: &document, active: false, evidence: nil, activeRun: nil)
                XCTAssertNil(document.messages[0].liveSnapshotState)
                XCTAssertEqual(NativeLiveMessages.reduceText(update("No activity qualification"), in: &document, epoch: epoch), .rejected)
                XCTAssertFalse(document.sourceAmbiguity?.rejects("source") == true)
            } else if origin == 2 {
                XCTAssertTrue(NativeLiveMessages.text(.init(sessionKey: "session", runID: "run", segmentID: "segment",
                    text: "Legacy live", mode: .snapshot, turnID: "turn", inputMessageID: "input", inputMessageKey: "key"),
                    in: &document, epoch: epoch))
                XCTAssertNil(document.messages[0].liveSnapshotState)
            }
            let target = try XCTUnwrap(finish(&document, attachments: true))
            let terminalBody = document.messages.first { $0.id == target }!.text
            XCTAssertEqual(document.messages.first { $0.id == target }?.liveSnapshotState, .terminal)
            XCTAssertEqual(NativeLiveMessages.reduceText(update("Same-run late snapshot"), in: &document, epoch: epoch), .rejected)
            XCTAssertFalse(document.sourceAmbiguity?.rejects("source") == true)
            _ = try apply([raw(text: "Stale active head")], to: &document)
            XCTAssertEqual(document.messages.map(\.id), [target])
            XCTAssertEqual(document.messages[0].liveSnapshotState, .terminal)
            XCTAssertEqual(document.messages[0].text, terminalBody)
            XCTAssertEqual(NativeLiveMessages.reduceText(update("Must not revive"), in: &document, epoch: epoch), .rejected)
            XCTAssertFalse(document.messages[0].streaming)
        }
        var document = NativeConversation(historyEpoch: epoch)
        XCTAssertTrue(NativeLiveMessages.text(update("Kept"), in: &document, epoch: epoch))
        _ = finish(&document)
        let damaged = update("Untrusted conflicting envelope", run: "other-run", metadata:
            .init(role: .assistant, providedID: "source", hasConflictingLineage: true))
        XCTAssertEqual(NativeLiveMessages.reduceText(damaged, in: &document, epoch: epoch), .rejected)
        XCTAssertFalse(document.sourceAmbiguity?.rejects("source") == true)
        XCTAssertNil(NativeLiveMessages.finish(runID: "other-run", segmentID: "other-segment",
            metadata: .init(role: .assistant, providedID: "source"), notice: nil, hasAttachments: true,
            in: &document, epoch: epoch))
        XCTAssertEqual(document.messages.map(\.text), ["Kept"])
        XCTAssertTrue(document.sourceAmbiguity?.rejects("source") == true)
        _ = try apply([], to: &document, active: false, evidence: false)
        _ = try apply([raw(text: "New run", run: "other-run")], to: &document, activeRun: "other-run")
        XCTAssertEqual(document.messages[0].idSource, .ambiguousProvided)
        XCTAssertEqual(NativeLiveMessages.reduceText(update("Still blocked", run: "other-run"), in: &document, epoch: epoch), .rejected)
    }

    func testUnknownHeadsDoNotClaimTerminalOrHydrateAnActiveBodyAndConflictingHistoryLineageDoesNotJoin() throws {
        var document = NativeConversation(historyEpoch: epoch)
        XCTAssertTrue(NativeLiveMessages.text(update("Actual live body"), in: &document, epoch: epoch))
        let id = document.messages[0].id
        _ = try apply([raw(text: "Unknown old head")], to: &document, active: false, evidence: nil, activeRun: nil)
        XCTAssertEqual(document.messages.map(\.id), [id]); XCTAssertEqual(document.messages[0].text, "Actual live body")
        XCTAssertTrue(document.messages[0].streaming); XCTAssertEqual(document.messages[0].liveSnapshotState, .active)
        let result = try apply([raw(text: "Conflicting turn", turn: "other-turn")], to: &document)
        XCTAssertNotEqual(result[0], id); XCTAssertEqual(document.messages.count, 2)
        XCTAssertEqual(document.messages.first { $0.id == id }?.text, "Actual live body")
        var uncertain = NativeConversation(historyEpoch: epoch)
        _ = try apply([raw()], to: &uncertain, active: true, evidence: true, activeRun: "different-active-run")
        XCTAssertNil(uncertain.messages[0].liveSnapshotState)
        XCTAssertFalse(NativeLiveMessages.text(update("Cannot infer active row"), in: &uncertain, epoch: epoch))
        for incoming in [raw(run: "other-run"), raw(turn: "other-turn"), raw(input: "other-input"), raw(key: "other-key")] {
            var document = NativeConversation(historyEpoch: epoch)
            XCTAssertTrue(NativeLiveMessages.text(update("Preserved original"), in: &document, epoch: epoch))
            let original = document.messages[0].id
            let accepted = try apply([incoming], to: &document)
            XCTAssertNotEqual(accepted[0], original)
            XCTAssertEqual(document.messages.first { $0.id == original }?.text, "Preserved original")
        }
    }

    @MainActor
    func testRemovedTerminalSourcesSurviveEmptyHeadRealColdStoreAndStaleActiveHeadWithoutBecomingAmbiguous() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("terminal-source-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        for origin in 0..<3 {
            var document = NativeConversation(historyEpoch: epoch)
            if origin == 0 {
                _ = try apply([raw(text: "Source-only history", run: nil)], to: &document, active: false, evidence: nil)
                XCTAssertNotNil(finish(&document, attachments: true))
            } else if origin == 1 {
                XCTAssertTrue(NativeLiveMessages.text(update("Accepted full body"), in: &document, epoch: epoch))
                XCTAssertNotNil(finish(&document))
            } else {
                _ = try apply([raw(text: "Confirmed terminal history")], to: &document, active: false, evidence: false)
            }
            XCTAssertEqual(document.messages[0].liveSnapshotState, .terminal)
            XCTAssertTrue(document.retiredTerminalSources?.sources.isEmpty != false)
            _ = try apply([], to: &document, active: false, evidence: false)
            XCTAssertTrue(document.messages.isEmpty) // Accepted empty head never displays the old body.
            XCTAssertTrue(document.retiredTerminalSources?.rejects("source") == true)
            XCTAssertFalse(document.sourceAmbiguity?.rejects("source") == true)
            let folder = directory.appendingPathComponent(String(origin))
            let store = try NativeConversationStore(directory: folder)
            try await store.write(document, connectionID: route.connectionID, agentID: route.agentID, sessionID: route.sessionID)
            let reopened = try NativeConversationStore(directory: folder)
            document = try await reopened.read(connectionID: route.connectionID, agentID: route.agentID, sessionID: route.sessionID)
            XCTAssertEqual(NativeLiveMessages.reduceText(update("Direct late packet"), in: &document, epoch: epoch), .rejected)
            XCTAssertTrue(document.messages.isEmpty)
            _ = try apply([raw(text: "Stale active prefix")], to: &document)
            XCTAssertEqual(document.messages[0].liveSnapshotState, .terminal)
            XCTAssertEqual(document.messages[0].idSource, .provided)
            let model = NativeAppModel(); model.documents[route] = document
            model.state = .init(connectionID: route.connectionID, phase: .ready)
            XCTAssertEqual(model.adoptIncomingLiveText(update("Must not revive"), route: route), .rejected)
            XCTAssertEqual(model.documents[route]?.messages.map(\.text), ["Stale active prefix"])
            XCTAssertFalse(model.present(document.messages[0], agentName: "Agent", route: route).isStreaming)
            XCTAssertFalse(document.sourceAmbiguity?.rejects("source") == true)
            XCTAssertTrue(NativeLiveMessages.text(update("New physical epoch"), in: &document, epoch: UUID()))
        }
    }

    @MainActor
    func testRetiredTerminalCapacityRejectsHeadAtomicallyWhileFreshSourceReductionRemainsAvailable() throws {
        let fullCount = NativeRetiredTerminalSources(epoch: epoch, sources: (0..<NativeRetiredTerminalSources.limit).map {
            Data("retired-\($0)".utf8)
        })
        let fullBytes = NativeRetiredTerminalSources(epoch: epoch, sources: (0..<64).map {
            Data((String(repeating: "x", count: 4_092) + String(format: "%04d", $0)).utf8)
        })
        for memory in [fullCount, fullBytes] {
            XCTAssertTrue(memory.isValid)
            let attachment = try JSONDecoder().decode(NativeMediaReference.self, from: Data(
                #"{"id":"retained-media","resourceID":"11111111-1111-1111-1111-111111111111","kind":"file","mimeType":"text/plain","name":"original.txt"}"#.utf8))
            let terminal = NativeMessage(id: "kept", role: .assistant, text: "Original cached body", runID: "run",
                segmentID: "segment", media: [attachment], providedID: "source", idSource: .provided,
                historyEpoch: epoch, liveSnapshotState: .terminal)
            var document = NativeConversation(draft: "Independent draft", messages: [terminal], historyEpoch: epoch,
                retiredTerminalSources: memory)
            XCTAssertThrowsError(try apply([], to: &document, active: false, evidence: false)) {
                XCTAssertEqual($0 as? NativeHistoryFailure, .full)
            }
            XCTAssertEqual(document.messages, [terminal]); XCTAssertEqual(document.retiredTerminalSources, memory)
            XCTAssertEqual(document.draft, "Independent draft")
            // This tests the reducer after admission, not a cold host's physicalReady gate.
            XCTAssertTrue(NativeLiveMessages.text(update("Fresh reply", source: "fresh-source", run: "fresh-run", segment: "fresh-segment"),
                in: &document, epoch: epoch))
            XCTAssertEqual(document.messages[0], terminal); XCTAssertEqual(document.messages[1].text, "Fresh reply")
            let coldHost = NativeAppModel(); coldHost.documents[route] = document
            coldHost.state = .init(connectionID: route.connectionID, phase: .ready)
            XCTAssertFalse(coldHost.physicalPermitsInput(route)) // Failed first head grants no authority.
        }
    }

    func testRetiredTerminalMemoryIsByteExactEpochScopedLegacyOptionalAndRejectsCorruptCache() throws {
        var memory = NativeRetiredTerminalSources(epoch: epoch)
        try memory.remember(["é", "é"])
        XCTAssertTrue(memory.rejects("é")); XCTAssertFalse(memory.rejects("e\u{301}"))
        XCTAssertFalse(memory.scoped(to: UUID()).rejects("é"))
        XCTAssertEqual(memory.sources.count, 1)
        let document = NativeConversation(historyEpoch: epoch, retiredTerminalSources: memory)
        let copy = try JSONDecoder().decode(NativeConversation.self, from: JSONEncoder().encode(document))
        XCTAssertEqual(copy.retiredTerminalSources, memory)
        let corrupt = NativeConversation(historyEpoch: epoch, retiredTerminalSources: .init(epoch: epoch, sources: [Data([0xff])]))
        XCTAssertThrowsError(try JSONDecoder().decode(NativeConversation.self, from: JSONEncoder().encode(corrupt)))
        let duplicate = NativeConversation(historyEpoch: epoch, retiredTerminalSources: .init(epoch: epoch, sources: [Data("id".utf8), Data("id".utf8)]))
        XCTAssertThrowsError(try JSONDecoder().decode(NativeConversation.self, from: JSONEncoder().encode(duplicate)))
        var legacy = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(document)) as? [String: Any])
        legacy.removeValue(forKey: "retiredTerminalSources")
        XCTAssertNil(try JSONDecoder().decode(NativeConversation.self, from: JSONSerialization.data(withJSONObject: legacy)).retiredTerminalSources)
    }

    @MainActor
    func testActualFinishedJournalColdRestoreBlocksStaleStartTextAndStopWhileUnknownRunsRemainEligible() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("finished-run-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try NativeJournalStore(directory: directory)
        let writer = NativeTaskJournal(store: store, onFailure: { XCTFail("Unexpected write failure") })
        writer.bindHistoryScope(route, epoch: epoch)
        writer.started(route, runID: "run")
        writer.receipt(.init(runID: "run", idempotencyKey: "old-input"), route: route, input: "Original input")
        writer.finished(route, runID: "run", reason: "end_turn")
        let terminalID = try XCTUnwrap(writer.document.runs.first?.id)
        // Await the actual store write, without relying on a debounce timer.
        try await store.write(writer.document)
        let coldStore = try NativeJournalStore(directory: directory)
        let loaded = NativeTaskJournal(store: coldStore, onFailure: { XCTFail("Unexpected cold read failure") })
        await loaded.restore(); loaded.bindHistoryScope(route, epoch: epoch)
        let lateWork = try XCTUnwrap(WorkEvents.canonical(.object(["type": .string("tool_call"),
            "sessionKey": .string(route.sessionID), "runId": .string("run"), "toolCallId": .string("late-tool")])))
        loaded.record(lateWork, route: route)
        XCTAssertEqual(loaded.document.runs.count, 2)
        XCTAssertEqual(loaded.document.runs[0].id, terminalID); XCTAssertTrue(loaded.document.runs[0].status.isTerminal)
        XCTAssertNil(loaded.document.runs[1].lineage.inputMessageKey)
        XCTAssertFalse(loaded.document.runs[1].status.isTerminal)
        XCTAssertTrue(loaded.hasFinishedRun(route, epoch: epoch, runID: "run"))
        loaded.flush()
        let savedRevision = loaded.document.revision, deadline = ContinuousClock.now + .seconds(3)
        while (try await coldStore.read()?.value.revision ?? -1) < savedRevision {
            guard ContinuousClock.now < deadline else { throw NativeHistoryFailure.unavailable }
            await Task.yield()
        }
        let journal = NativeTaskJournal(store: try NativeJournalStore(directory: directory), onFailure: { XCTFail("Unexpected final cold read failure") })
        await journal.restore()
        XCTAssertTrue(journal.hasFinishedRun(route, epoch: epoch, runID: "run"))
        XCTAssertFalse(journal.hasFinishedRun(route, epoch: nil, runID: "run"))
        XCTAssertFalse(journal.hasFinishedRun(route, epoch: UUID(), runID: "run"))
        XCTAssertFalse(journal.hasFinishedRun(.init(connectionID: route.connectionID, agentID: "another", sessionID: route.sessionID), epoch: epoch, runID: "run"))
        var capabilities = RuntimeCapabilities(); capabilities.chat = true; capabilities.abort = true
        let model = NativeAppModel(taskJournal: journal)
        model.documents[route] = .init(historyEpoch: epoch)
        model.state = .init(connectionID: route.connectionID, phase: .ready, capabilities: capabilities)
        let stale = RuntimeHistory(key: route.sessionID, messages: [raw()], nextCursor: nil, hasMore: false, pagination: .limit,
            hasActiveRun: true, activeRun: .object(["runId": .string("run")]), activeRunEvidence: true)
        model.applyHistoryActivity(stale, route: route, earlier: false, liveRevision: 0)
        XCTAssertFalse(model.adoptIncomingRunStarted("run", route: route))
        XCTAssertEqual(model.adoptIncomingLiveText(update("Stale complete snapshot"), route: route), .rejected)
        let legacy = RuntimeTextUpdate(sessionKey: route.sessionID, runID: "run", segmentID: "segment", text: "Stale fragment", mode: .delta)
        XCTAssertEqual(model.adoptIncomingLiveText(legacy, route: route), .rejected)
        model.updatePresentation(route)
        XCTAssertTrue(model.documents[route]?.messages.isEmpty == true)
        XCTAssertEqual(model.presentation.conversations[route]?.sendLabel, String(localized: "Send"))
        XCTAssertFalse(try XCTUnwrap(model.presentation.conversations[route]).availability(.stop).isVisible)
        XCTAssertEqual(journal.document.runs.count, 2); XCTAssertTrue(journal.document.runs[0].status.isTerminal)
        // A source terminal is not evidence that another/multi-message run finished.
        var unknown = NativeConversation(historyEpoch: epoch)
        _ = try apply([raw("terminal-source", text: "Earlier item", run: "fresh-run")], to: &unknown, active: false, evidence: false)
        model.documents[route] = unknown
        let fresh = RuntimeHistory(key: route.sessionID, messages: [], nextCursor: nil, hasMore: false, pagination: .limit,
            hasActiveRun: true, activeRun: .object(["runId": .string("fresh-run")]), activeRunEvidence: true)
        model.applyHistoryActivity(fresh, route: route, earlier: false, liveRevision: 0)
        model.updatePresentation(route)
        XCTAssertEqual(model.presentation.conversations[route]?.sendLabel, String(localized: "Add to queue"))
        // The un-restored writer reduces actual events without starting a
        // background save into a directory this test is about to retire.
        let freshHost = NativeAppModel(taskJournal: writer)
        freshHost.documents[route] = unknown; freshHost.state = model.state
        XCTAssertTrue(freshHost.adoptIncomingRunStarted("fresh-run", route: route))
        XCTAssertEqual(freshHost.adoptIncomingLiveText(update("Fresh source reply", source: "fresh-source", run: "fresh-run"), route: route), .accepted)
        XCTAssertEqual(freshHost.documents[route]?.messages.last?.text, "Fresh source reply")
        let differentInput = try XCTUnwrap(WorkEvents.canonical(.object(["type": .string("tool_call"),
            "sessionKey": .string(route.sessionID), "runId": .string("run"), "toolCallId": .string("new-tool"),
            "inputMessageKey": .string("new-input")])))
        writer.record(differentInput, route: route)
        XCTAssertFalse(writer.hasFinishedRun(route, epoch: epoch, runID: "run"))
        XCTAssertTrue(freshHost.adoptIncomingRunStarted("run", route: route))
        XCTAssertEqual(freshHost.adoptIncomingLiveText(update("Actual different input", source: "new-input-source", key: "new-input"), route: route), .accepted)
        freshHost.saveTasks.values.forEach { $0.cancel() }
    }

    @MainActor
    func testActualHostPersistsRejectedSourceEvidenceWithoutRunActivityOrStreamingProofAndAcceptsValidText() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("snapshot-host-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        var capabilities = RuntimeCapabilities(); capabilities.chat = true; capabilities.abort = true
        let queued = NativeMessage(id: "owned", role: .user, local: true, text: "Queued", idempotencyKey: "owned-key",
            delivery: .queued, historyEpoch: epoch)
        let cached = NativeMessage(id: "display", role: .assistant, text: "Cached body", runID: "run", segmentID: "segment",
            streaming: true, providedID: "source", idSource: .provided, historyEpoch: epoch,
            turnID: "turn", inputMessageID: "input", inputMessageKey: "key", liveSnapshotState: .active)
        let seed = NativeConversation(revision: 10, draft: "Independent draft", messages: [queued, cached], historyEpoch: epoch)
        let model = NativeAppModel()
        model.cache = try NativeConversationStore(directory: directory.appendingPathComponent("negative"))
        model.state = .init(connectionID: route.connectionID, phase: .ready, capabilities: capabilities)
        model.documents[route] = seed
        XCTAssertFalse(model.present(cached, agentName: "Agent", route: route).isStreaming)
        XCTAssertEqual(model.adoptIncomingLiveText(update("Rejected body", turn: "conflicting-turn"), route: route), .sourceAmbiguityChanged)
        let adopted = try XCTUnwrap(model.documents[route])
        XCTAssertEqual(adopted.messages.map(\.id), seed.messages.map(\.id))
        XCTAssertEqual(adopted.messages.map(\.text), seed.messages.map(\.text))
        XCTAssertEqual(adopted.messages[0], queued); XCTAssertEqual(adopted.draft, seed.draft)
        XCTAssertEqual(adopted.revision, seed.revision + 1)
        XCTAssertTrue(adopted.sourceAmbiguity?.rejects("source") == true)
        XCTAssertEqual(adopted.messages[1].idSource, .ambiguousProvided)
        let negativeUI = try XCTUnwrap(model.presentation.conversations[route])
        XCTAssertEqual(negativeUI.sendLabel, String(localized: "Send"))
        XCTAssertFalse(negativeUI.availability(.stop).isVisible)
        XCTAssertFalse(negativeUI.messages.contains(where: \.isStreaming))
        let negativeSave = try XCTUnwrap(model.saveTasks[route]); await negativeSave.value
        let reopened = try NativeConversationStore(directory: directory.appendingPathComponent("negative"))
        let saved = try await reopened.read(connectionID: route.connectionID, agentID: route.agentID, sessionID: route.sessionID)
        XCTAssertTrue(saved.sourceAmbiguity?.rejects("source") == true)
        XCTAssertEqual(saved.messages.map(\.id), seed.messages.map(\.id))
        XCTAssertEqual(saved.messages.map(\.text), seed.messages.map(\.text))
        XCTAssertEqual(saved.messages[0].idempotencyKey, queued.idempotencyKey)
        XCTAssertEqual(saved.messages[0].delivery, .held) // Existing cold-recovery rule, never a dispatch.
        XCTAssertEqual(saved.draft, seed.draft)
        model.saveTasks.removeValue(forKey: route)
        XCTAssertEqual(model.adoptIncomingLiveText(update("Still rejected"), route: route), .rejected)
        XCTAssertEqual(model.documents[route]?.revision, adopted.revision); XCTAssertNil(model.saveTasks[route])

        let positive = NativeAppModel()
        positive.cache = try NativeConversationStore(directory: directory.appendingPathComponent("positive"))
        positive.state = model.state
        var historyFirst = seed
        historyFirst.messages[1].streaming = false; historyFirst.messages[1].segmentID = nil
        historyFirst.messages[1].liveSnapshotState = .historyActive
        positive.documents[route] = historyFirst
        XCTAssertEqual(positive.adoptIncomingLiveText(update("Accepted complete body"), route: route), .accepted)
        let accepted = try XCTUnwrap(positive.documents[route])
        XCTAssertEqual(accepted.messages.map(\.id), seed.messages.map(\.id))
        XCTAssertEqual(accepted.messages[0], queued); XCTAssertEqual(accepted.messages[1].text, "Accepted complete body")
        XCTAssertTrue(positive.present(accepted.messages[1], agentName: "Agent", route: route).isStreaming)
        let positiveUI = try XCTUnwrap(positive.presentation.conversations[route])
        XCTAssertEqual(positiveUI.sendLabel, String(localized: "Add to queue"))
        XCTAssertTrue(positiveUI.availability(.stop).isVisible)
        let positiveSave = try XCTUnwrap(positive.saveTasks[route]); await positiveSave.value
    }

    @MainActor
    func testActualHostUnknownHistoryActivityPreservesStopQueueAndDraftUntilExplicitTerminalEvidence() throws {
        var capabilities = RuntimeCapabilities(); capabilities.chat = true; capabilities.abort = true
        let model = NativeAppModel()
        model.state = .init(connectionID: route.connectionID, phase: .ready, capabilities: capabilities)
        let queued = NativeMessage(id: "queued", role: .user, local: true, text: "Next input", idempotencyKey: "next-key",
            delivery: .queued, historyEpoch: epoch)
        model.documents[route] = .init(draft: "Third independent input", messages: [queued], historyEpoch: epoch)
        let positive = RuntimeHistory(key: route.sessionID, messages: [], nextCursor: nil, hasMore: false, pagination: .limit,
            hasActiveRun: false, activeRun: .object(["runId": .string("actual-run")]), activeRunEvidence: true)
        model.applyHistoryActivity(positive, route: route, earlier: false, liveRevision: 0)
        model.updatePresentation(route)
        XCTAssertEqual(model.presentation.conversations[route]?.sendLabel, String(localized: "Add to queue"))
        XCTAssertTrue(try XCTUnwrap(model.presentation.conversations[route]).availability(.stop).isVisible)
        let unknowns = [
            RuntimeHistory(key: route.sessionID, messages: [], nextCursor: nil, hasMore: false, pagination: .limit,
                hasActiveRun: false, activeRun: nil),
            RuntimeHistory(key: route.sessionID, messages: [], nextCursor: nil, hasMore: false, pagination: .limit,
                hasActiveRun: false, activeRun: .object(["runId": .string("conflicting-run")]), activeRunEvidence: nil)
        ]
        for history in unknowns {
            model.applyHistoryActivity(history, route: route, earlier: false, liveRevision: 0)
            model.updatePresentation(route)
            let ui = try XCTUnwrap(model.presentation.conversations[route])
            XCTAssertEqual(ui.sendLabel, String(localized: "Add to queue")); XCTAssertTrue(ui.availability(.stop).isVisible)
            XCTAssertEqual(model.documents[route]?.messages, [queued])
            XCTAssertEqual(model.documents[route]?.draft, "Third independent input")
        }
        let terminal = RuntimeHistory(key: route.sessionID, messages: [], nextCursor: nil, hasMore: false, pagination: .limit,
            hasActiveRun: false, activeRun: nil, activeRunEvidence: false)
        model.applyHistoryActivity(terminal, route: route, earlier: false, liveRevision: 0)
        model.updatePresentation(route)
        XCTAssertEqual(model.presentation.conversations[route]?.sendLabel, String(localized: "Send"))
        XCTAssertFalse(try XCTUnwrap(model.presentation.conversations[route]).availability(.stop).isVisible)
        XCTAssertEqual(model.documents[route]?.messages, [queued]); XCTAssertEqual(model.documents[route]?.draft, "Third independent input")
    }

    @MainActor
    func testActualHostEarlierOrStaleActivityCannotRetireAcceptedLiveRunAndNegativeOnlyDoesNotAdvanceLiveRevision() throws {
        var capabilities = RuntimeCapabilities(); capabilities.chat = true; capabilities.abort = true
        let model = NativeAppModel()
        model.state = .init(connectionID: route.connectionID, phase: .ready, capabilities: capabilities)
        model.documents[route] = .init(historyEpoch: epoch)
        XCTAssertEqual(model.adoptIncomingLiveText(update("Accepted body"), route: route), .accepted)
        defer { model.saveTasks.values.forEach { $0.cancel() } }
        let terminal = RuntimeHistory(key: route.sessionID, messages: [], nextCursor: nil, hasMore: false, pagination: .limit,
            hasActiveRun: false, activeRun: nil, activeRunEvidence: false)
        for (earlier, revision) in [(false, Int64(0)), (true, Int64(1))] {
            model.applyHistoryActivity(terminal, route: route, earlier: earlier, liveRevision: revision)
            model.updatePresentation(route)
            XCTAssertEqual(model.presentation.conversations[route]?.sendLabel, String(localized: "Add to queue"))
            XCTAssertTrue(try XCTUnwrap(model.presentation.conversations[route]).availability(.stop).isVisible)
        }
        XCTAssertEqual(model.adoptIncomingLiveText(update("Rejected contradiction", turn: "different"), route: route), .sourceAmbiguityChanged)
        model.applyHistoryActivity(terminal, route: route, earlier: false, liveRevision: 1)
        model.updatePresentation(route)
        XCTAssertEqual(model.presentation.conversations[route]?.sendLabel, String(localized: "Send"))
        XCTAssertFalse(try XCTUnwrap(model.presentation.conversations[route]).availability(.stop).isVisible)
        XCTAssertEqual(model.documents[route]?.messages.map(\.text), ["Accepted body"])
        XCTAssertTrue(model.documents[route]?.sourceAmbiguity?.rejects("source") == true)
    }

    @MainActor
    func testSnapshotHandoffPreservesLocalOutboxMediaTargetsAndLegacyCacheDecoding() throws {
        let old = try JSONDecoder().decode(NativeMessage.self, from: Data(#"{"id":"old","role":"assistant","text":"cache"}"#.utf8))
        XCTAssertNil(old.liveSnapshotState)
        let owned = NativeMessage(id: "owned", role: .user, local: true, text: "Queued", idempotencyKey: "send",
            delivery: .held, historyEpoch: epoch)
        var document = NativeConversation(messages: [owned], historyEpoch: epoch)
        _ = try apply([raw()], to: &document)
        XCTAssertTrue(NativeLiveMessages.text(update("Snapshot"), in: &document, epoch: epoch))
        let target = try XCTUnwrap(finish(&document, attachments: true))
        XCTAssertEqual(document.messages.first { $0.id == "owned" }, owned)
        let model = NativeAppModel(); model.documents[route] = document
        let final = RuntimeSessionUpdate.runFinished(sessionKey: "session", runID: "run", reason: "end_turn", segmentID: "segment",
            raw: .object(["message": .object(["role": .string("assistant"), "id": .string("source"),
                "attachments": .array([.object(["type": .string("image"), "artifactId": .string("artifact"), "mimeType": .string("image/png")])])])]))
        model.bindFinalMedia(final, route: route, messageID: target)
        let result = try XCTUnwrap(model.documents[route])
        XCTAssertEqual(result.messages.first { $0.id == "owned" }, owned)
        XCTAssertEqual(result.messages.first { $0.id == target }?.media.count, 1)
        XCTAssertFalse(result.messages.first { $0.id == target }!.streaming)
        var staleHead = result
        XCTAssertTrue(try apply([raw(text: "Stale body without final image")], to: &staleHead).isEmpty)
        XCTAssertEqual(staleHead.messages, result.messages)
        let decoded = try JSONDecoder().decode(NativeConversation.self, from: JSONEncoder().encode(result))
        XCTAssertEqual(decoded.messages, result.messages)
        var recovered = decoded
        XCTAssertFalse(NativeLiveMessages.text(update("Late"), in: &recovered, epoch: epoch))
    }
}
