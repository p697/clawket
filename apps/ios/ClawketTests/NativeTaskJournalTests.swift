import ClawketPersistence
import ClawketTransport
import ClawketUI
import Foundation
import XCTest
@testable import ClawketRuntime
@testable import Clawket

private actor JournalValues: ValueStore {
    private var values: [String: Data] = [:]
    func read(_ key: String) -> Data? { values[key] }
    func write(_ value: Data, for key: String) { values[key] = value }
    func remove(_ key: String) { values.removeValue(forKey: key) }
    func corrupt(_ bytes: Data, key: String = "tasks.v1") { values[key] = bytes }
}

final class NativeTaskJournalTests: XCTestCase, @unchecked Sendable {
    @MainActor func testOnlyAcceptedHistoryRowsEnterJournalUsingPersistentRenderAnchors() async throws {
        let journal = NativeTaskJournal(store: try NativeJournalStore(values: JournalValues()), onFailure: { XCTFail("Unexpected failure") })
        await journal.restore()
        let row = RuntimeMessage(id: "same-synthetic", role: .tool, text: "", timestampMs: nil, runID: nil,
            turnID: nil, idempotencyKey: nil, sentLocally: false,
            raw: .object(["tool": .object(["name": .string("read"), "output": .string("original")])]))
        let history = RuntimeHistory(key: "s", messages: [row, row], nextCursor: nil, hasMore: false,
                                     pagination: .limit, hasActiveRun: false, activeRun: nil)
        journal.history(history, route: route, acceptedHistoryIDs: [:])
        XCTAssertNil(journal.work(for: route))
        journal.history(history, route: route, acceptedHistoryIDs: [0: "render-one", 1: "render-two"])
        let records = try XCTUnwrap(journal.work(for: route)?.records)
        XCTAssertEqual(records.count, 2)
        XCTAssertEqual(Set(journal.document.runs.compactMap(\.historyAnchor)), ["render-one:0", "render-two:0"])
        journal.history(history, route: route, acceptedHistoryIDs: [0: "render-one", 1: "render-two"])
        XCTAssertEqual(journal.work(for: route)?.records.map(\.id), records.map(\.id))
    }

    @MainActor func testPhysicalEpochKeepsOldWorkInspectableButCannotJoinReusedRunOrFinishIt() async throws {
        let journal = NativeTaskJournal(store: try NativeJournalStore(values: JournalValues()), onFailure: { XCTFail("Unexpected failure") })
        await journal.restore()
        let first = UUID(), second = UUID()
        journal.bindHistoryScope(route, epoch: first)
        journal.started(route, runID: "reused")
        let old = try XCTUnwrap(journal.document.runs.first)
        journal.bindHistoryScope(route, epoch: second)
        let held = try XCTUnwrap(journal.work(for: route))
        XCTAssertEqual(held.status, .unknown); XCTAssertEqual(held.records.map(\.id), [old.id])
        XCTAssertEqual(journal.document.runs.first?.status, .unknown)
        journal.started(route, runID: "reused")
        journal.finished(route, runID: "reused", reason: "end_turn")
        XCTAssertEqual(journal.document.runs.count, 2)
        XCTAssertEqual(journal.document.runs[0].id, old.id); XCTAssertEqual(journal.document.runs[0].status, .unknown)
        XCTAssertEqual(journal.document.runs[0].scope.historyEpoch, first)
        XCTAssertEqual(journal.document.runs[1].scope.historyEpoch, second)
        XCTAssertEqual(journal.document.runs[1].status, .succeeded)
        XCTAssertEqual(journal.work(for: route)?.records.count, 2)
    }

    func testOpaqueUnicodeScopeAndLineageRemainDistinctAcrossJournalBindings() {
        let epoch = UUID()
        let first = NativeJournalScope(connectionID: "c", agentID: "a", sessionID: "é", historyEpoch: epoch)
        let second = NativeJournalScope(connectionID: "c", agentID: "a", sessionID: "e\u{301}", historyEpoch: epoch)
        XCTAssertNotEqual(first, second); XCTAssertEqual(Set([first, second]).count, 2)
        var value = NativeJournalDocument()
        _ = NativeWorkReducer.index(&value, scope: first, lineage: .init(runID: "é"))
        _ = NativeWorkReducer.index(&value, scope: first, lineage: .init(runID: "e\u{301}"))
        XCTAssertEqual(value.runs.count, 2)
        XCTAssertTrue(NativeWorkLineage(runID: "é").conflicts(with: .init(runID: "e\u{301}")))
    }

    private var scope: NativeJournalScope { .init(connectionID: "c", agentID: "a", sessionID: "s") }
    private var route: ConversationID { .init(connectionID: "c", agentID: "a", sessionID: "s") }
    private func work(_ values: [String: JSONValue] = [:]) throws -> RuntimeWorkUpdate {
        let base: [String: JSONValue] = ["type": .string("tool_call"), "sessionKey": .string("s"),
            "runId": .string("r"), "toolCallId": .string("tool"), "title": .string("Read fixture")]
        return try XCTUnwrap(WorkEvents.canonical(.object(base.merging(values) { _, new in new })))
    }

    func testReusedRunWithDifferentInputNeverJoinsAndPartialFinishCannotPickOne() throws {
        var document = NativeJournalDocument()
        _ = NativeWorkReducer.apply(try work(["inputMessageKey": .string("first")]), scope: scope, document: &document)
        _ = NativeWorkReducer.apply(try work(["inputMessageKey": .string("second")]), scope: scope, document: &document)
        XCTAssertEqual(document.runs.count, 2)
        XCTAssertNotEqual(document.runs[0].id, document.runs[1].id)
        XCTAssertNil(NativeWorkReducer.finish(scope: scope, runID: "r", reason: "end_turn", document: &document))
        XCTAssertTrue(document.runs.allSatisfy { $0.status == .unknown })
        let completion = try WorkEvents.completion(.object(["inputMessageKey": .string("second")]))
        _ = NativeWorkReducer.finish(scope: scope, runID: "r", reason: "error", document: &document, completion: completion)
        XCTAssertEqual(document.runs[0].status, .unknown); XCTAssertEqual(document.runs[1].status, .failed)
        var window = NativeJournalDocument()
        _ = NativeWorkReducer.apply(try work(["inputMessageKey": .string("first")]), scope: scope, document: &window)
        _ = NativeWorkReducer.finish(scope: scope, runID: "r", reason: "end_turn", document: &window)
        let oldID = window.runs[0].id
        _ = NativeWorkReducer.index(&window, scope: scope, lineage: .init(runID: "r"), freshStart: true)
        _ = NativeWorkReducer.apply(try work(["toolCallId": .string("new-tool")]), scope: scope, document: &window)
        _ = NativeWorkReducer.index(&window, scope: scope, lineage: .init(runID: "r", inputMessageKey: "second"))
        XCTAssertEqual(window.runs.count, 3)
        XCTAssertEqual(window.runs.first(where: { $0.id == oldID })?.steps.count, 1)
        let unattributed = try XCTUnwrap(window.runs.first(where: { $0.lineage.inputMessageKey == nil }))
        XCTAssertEqual(unattributed.steps.first?.sourceItemID, "new-tool")
        XCTAssertTrue(window.runs.first(where: { $0.lineage.inputMessageKey == "second" })?.steps.isEmpty == true)
    }

    func testCumulativeCommentaryAndToolUpdateKeepIndependentStableIdentity() throws {
        var document = NativeJournalDocument()
        // Canonical commentary has its own item ID, not a synthetic tool boundary.
        var raw: [String: JSONValue] = ["type": .string("agent_commentary_chunk"), "sessionKey": .string("s"),
            "runId": .string("r"), "itemId": .string("comment"), "text": .string("A")]
        _ = NativeWorkReducer.apply(try XCTUnwrap(WorkEvents.canonical(.object(raw))), scope: scope, document: &document)
        let id = document.runs[0].steps[0].id
        raw["text"] = .string("A then B")
        _ = NativeWorkReducer.apply(try XCTUnwrap(WorkEvents.canonical(.object(raw))), scope: scope, document: &document)
        _ = NativeWorkReducer.apply(try work(), scope: scope, document: &document)
        XCTAssertEqual(document.runs[0].steps.count, 2)
        XCTAssertEqual(document.runs[0].steps[0].id, id)
        XCTAssertEqual(document.runs[0].steps[0].text, "A then B")
        XCTAssertEqual(document.runs[0].steps[0].kind, .commentary)
    }

    func testOnlyExplicitToolStatusCompletesAndLateStartCannotReviveIt() throws {
        var document = NativeJournalDocument()
        _ = NativeWorkReducer.apply(try work(["status": .string("error"), "rawOutput": .string("exact output")]), scope: scope, document: &document)
        let id = document.runs[0].steps[0].id
        _ = NativeWorkReducer.apply(try work(), scope: scope, document: &document)
        XCTAssertEqual(document.runs[0].steps[0].id, id)
        XCTAssertEqual(document.runs[0].steps[0].status, .failed)
        XCTAssertEqual(document.runs[0].steps[0].output, .string("exact output"))
        XCTAssertEqual(document.runs[0].steps[0].outputComplete, false)
        _ = NativeWorkReducer.finish(scope: scope, runID: "r", reason: "end_turn", document: &document)
        XCTAssertEqual(document.runs[0].status, .succeeded)
        XCTAssertEqual(document.runs[0].steps[0].status, .failed)
    }

    func testProducerClocksRetainSkewAndDoNotEstablishCompletion() throws {
        var document = NativeJournalDocument()
        _ = NativeWorkReducer.apply(try work(["type": .string("tool_call_update"), "status": .string("future"),
            "startedAtMs": .number(100), "finishedAtMs": .number(10), "durationMs": .number(50)]), scope: scope, document: &document)
        let clock = document.runs[0].steps[0].clock
        XCTAssertEqual(clock.startedAtMs, 100); XCTAssertEqual(clock.finishedAtMs, 10); XCTAssertEqual(clock.durationMs, 50)
        XCTAssertNil(clock.observedDurationMs)
        XCTAssertEqual(document.runs[0].steps[0].status, .unknown)
        XCTAssertEqual(NativeJournalProjection.clock(clock).durationMilliseconds, 50)
    }

    func testLargeAndDeepRawPreservesBoundedSelectablePreviewWithoutClaimingComplete() throws {
        let original = String(repeating: "中", count: 100_000)
        let bounded = NativeWorkReducer.boundedRaw(.string(original))
        XCTAssertFalse(bounded.complete)
        XCTAssertLessThanOrEqual(bounded.value.stringValue?.utf8.count ?? .max, 256 * 1_024)
        var nested: JSONValue = .string("leaf")
        for _ in 0..<60 { nested = .array([nested]) }
        let deep = NativeWorkReducer.boundedRaw(nested)
        XCTAssertFalse(deep.complete)
        XCTAssertNotNil(deep.value.stringValue)
        let small = NativeWorkReducer.boundedRaw(.object(["a": .string("complete wire value")]))
        XCTAssertTrue(small.complete)
    }

    func testStoreRejectsStaleRevisionsAndRecoversVerifiedRollbackWithoutChangingCorruption() async throws {
        let values = JournalValues(), store = try NativeJournalStore(values: values)
        var first = NativeJournalDocument(); first.revision = 1
        try await store.write(first)
        var second = first; second.revision = 2; second.nextOrder = 1
        second.runs = [.init(scope: scope, order: 0, lineage: .init(runID: "run"))]
        try await store.write(second); try await store.write(first)
        let saved = try await store.read(); XCTAssertEqual(saved?.value.revision, 2)
        let corrupt = Data("{\"version\":2}".utf8)
        await values.corrupt(corrupt)
        let reopened = try NativeJournalStore(values: values)
        let recovered = try await reopened.read()
        XCTAssertTrue(recovered?.recoveredFromRollback == true); XCTAssertEqual(recovered?.value.revision, 1)
        let untouched = await values.read("tasks.v1"); XCTAssertEqual(untouched, corrupt)
    }

    func testDomainInvalidPrimaryAlsoFallsBackAndBothInvalidFailClosed() async throws {
        let values = JournalValues(), store = try NativeJournalStore(values: values)
        var first = NativeJournalDocument(); first.revision = 1; try await store.write(first)
        first.revision = 2; try await store.write(first)
        var bad = first; bad.version = 9
        let bytes = try JSONEncoder().encode(bad)
        await values.corrupt(bytes)
        let recovered = try await NativeJournalStore(values: values).read()
        XCTAssertEqual(recovered?.value.revision, 1)
        await values.corrupt(bytes, key: "tasks.v1.rollback")
        do { _ = try await NativeJournalStore(values: values).read(); XCTFail("Invalid journal became empty") }
        catch { XCTAssertEqual(error as? StoreFailure, .invalidDocument) }
        for field in ["revision", "nextOrder"] {
            let values = JournalValues(), store = try NativeJournalStore(values: values)
            var safe = NativeJournalDocument(); safe.revision = 1; try await store.write(safe)
            safe.revision = 2; try await store.write(safe)
            var object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(safe)) as? [String: Any])
            object[field] = Int64.max
            let corrupted = try JSONSerialization.data(withJSONObject: object)
            await values.corrupt(corrupted)
            let rollback = try await NativeJournalStore(values: values).read()
            XCTAssertEqual(rollback?.value.revision, 1)
            await values.corrupt(corrupted, key: "tasks.v1.rollback")
            do { _ = try await NativeJournalStore(values: values).read(); XCTFail("Overflow counter accepted") }
            catch { XCTAssertEqual(error as? StoreFailure, .invalidDocument) }
        }
        var full = NativeJournalDocument(); full.nextOrder = NativeJournalDocument.maximumCounter - 1
        XCTAssertNil(full.allocateOrder())
    }

    @MainActor func testColdRecoveryRetainsIdentityButNeverRestartsUnknownClockOrTask() async throws {
        let values = JournalValues(), store = try NativeJournalStore(values: values)
        var document = NativeJournalDocument(); document.revision = 1
        _ = NativeWorkReducer.apply(try work(), scope: scope, document: &document)
        document.runs[0].status = .running
        document.runs[0].clock.observedStartedAtMs = 10
        try await store.write(document)
        let journal = NativeTaskJournal(store: try NativeJournalStore(values: values), onFailure: { XCTFail("Unexpected failure") })
        await journal.restore()
        let restored = try XCTUnwrap(journal.work(for: route))
        XCTAssertEqual(restored.records[0].id, document.runs[0].id)
        XCTAssertEqual(restored.records[0].steps[0].id, document.runs[0].steps[0].id)
        XCTAssertEqual(restored.status, .unknown); XCTAssertEqual(restored.records[0].steps[0].status, .unknown)
        XCTAssertNil(restored.clock.durationMilliseconds)
        XCTAssertTrue(journal.canInspect(route, workID: restored.id))
        XCTAssertFalse(journal.canInspect(route, workID: restored.id, recordID: "stale", stepID: "other"))
    }

    func testReviewEncodingHasNoReferenceOrDecisionsAndExplicitFalseRemainsReadonly() throws {
        let review = NativeQuestionReview(kind: .confirm, title: "Continue?", options: [], fields: [],
            response: .init(confirmed: false), responseIsAccepted: true)
        let record = NativeReviewRecord(correlationKey: String(repeating: "a", count: 64), connectionID: "c", sessionID: "s",
            order: 0, held: false, content: .question(review))
        var document = NativeJournalDocument(); document.nextOrder = 1; document.reviews = [record]
        try NativeJournalStore.validate(document)
        let bytes = try JSONEncoder().encode(document)
        let source = String(decoding: bytes, as: UTF8.self)
        for forbidden in ["reference", "decisions", "confirmation", "token", "canAnswer"] { XCTAssertFalse(source.contains("\"" + forbidden + "\"")) }
        let decoded = try JSONDecoder().decode(NativeJournalDocument.self, from: bytes)
        guard case let .question(card) = NativeJournalProjection.review(decoded.reviews[0]).content[0] else { return XCTFail("Missing review") }
        XCTAssertFalse(card.canEdit); XCTAssertFalse(card.canSubmit); XCTAssertFalse(card.canCancel)
        XCTAssertTrue(card.responseIsAccepted)
        if case let .question(value) = decoded.reviews[0].content { XCTAssertEqual(value.response.confirmed, false) }
    }

    func testAcceptedReceiptRejectsInvalidAnswerHeldStateAndDuplicateIdentities() throws {
        let review = NativeQuestionReview(kind: .select, title: "Pick", options: ["A"], fields: [],
            response: .init(fields: ["value": .init(selectedOptionIDs: ["forged"])]), responseIsAccepted: true)
        var document = NativeJournalDocument(); document.nextOrder = 1
        document.reviews = [.init(correlationKey: String(repeating: "b", count: 64), connectionID: "c", order: 0, held: false, content: .question(review))]
        XCTAssertThrowsError(try NativeJournalStore.validate(document))
        var valid = review; valid.response = .init(fields: ["value": .init(selectedOptionIDs: ["A"])])
        document.reviews[0].content = .question(valid); try NativeJournalStore.validate(document)
        document.reviews[0].held = true; XCTAssertThrowsError(try NativeJournalStore.validate(document))
        document.reviews[0].held = false; document.reviews.append(document.reviews[0])
        XCTAssertThrowsError(try NativeJournalStore.validate(document))
    }

    @MainActor func testReviewRestoreIsInertAndFreshDraftCopyCannotClaimAccepted() async throws {
        let values = JournalValues(), store = try NativeJournalStore(values: values)
        let review = NativeQuestionReview(kind: .input, title: "Explain", options: [], fields: [],
            response: .init(fields: ["value": .init(text: " exact draft ")]))
        var document = NativeJournalDocument(); document.revision = 1; document.nextOrder = 1
        document.reviews = [.init(correlationKey: String(repeating: "c", count: 64), connectionID: "c", sessionID: "s", order: 0, held: true, content: .question(review))]
        try await store.write(document)
        let journal = NativeTaskJournal(store: try NativeJournalStore(values: values), onFailure: { XCTFail("Unexpected failure") })
        await journal.restore()
        guard case let .question(card) = NativeJournalProjection.review(journal.reviews[0]).content[0] else { return XCTFail("Missing draft") }
        XCTAssertFalse(card.responseIsAccepted); XCTAssertFalse(card.canEditFields); XCTAssertNil(card.resolvedLabel)
        XCTAssertEqual(journal.reviews[0].id, document.reviews[0].id)
    }

    @MainActor func testAggregateCacheBoundDoesNotTouchComposerOrInventSuccess() async throws {
        let journal = NativeTaskJournal(store: try NativeJournalStore(values: JournalValues()), onFailure: { XCTFail("Unexpected failure") })
        await journal.restore()
        for index in 0..<130 { journal.started(route, runID: "run-" + String(index)) }
        XCTAssertEqual(journal.document.runs.count, 128)
        XCTAssertEqual(journal.document.runs.last?.lineage.runID, "run-129")
        journal.hold(connectionID: "c")
        XCTAssertTrue(journal.document.runs.allSatisfy { $0.status == .unknown })
        try NativeJournalStore.validate(journal.document)
        let historyJournal = NativeTaskJournal(store: try NativeJournalStore(values: JournalValues()), onFailure: { XCTFail("Unexpected failure") })
        await historyJournal.restore()
        historyJournal.record(try work(["runId": .string("recent"), "toolCallId": .string("recent-tool")]), route: route)
        let original = try XCTUnwrap(historyJournal.work(for: route)?.records.first)
        func history(_ run: String, _ item: String) throws -> RuntimeHistory {
            try WireModels.history(.object(["messages": .array([.object(["id": .string(item), "role": .string("toolResult"),
                "runId": .string(run), "toolCallId": .string(item), "content": .string("output")])])]), key: "s", backend: .hermes)
        }
        historyJournal.history(try history("older", "old-tool"), route: route, earlier: true)
        let after = try XCTUnwrap(historyJournal.work(for: route))
        XCTAssertEqual(after.newestFirstRecords.first?.id, original.id)
        XCTAssertEqual(after.newestFirstRecords.first?.steps.first?.id, original.steps.first?.id)
        historyJournal.history(try history("recent", "earlier-step"), route: route, earlier: true)
        let recent = try XCTUnwrap(historyJournal.work(for: route)?.records.first(where: { $0.id == original.id }))
        XCTAssertEqual(recent.newestFirstSteps.first?.id, original.steps.first?.id)
        try NativeJournalStore.validate(historyJournal.document)
    }
}
