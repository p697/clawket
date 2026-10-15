import ClawketPersistence
import ClawketUI
import Foundation
import XCTest
@testable import Clawket

private actor DraftValues: ValueStore {
    var values: [String: Data] = [:]
    var corrupt = false
    var gate: CheckedContinuation<Void, Never>?
    var gated = false
    var writing = false
    func read(_ key: String) -> Data? { values[key] }
    func write(_ value: Data, for key: String) async {
        if gated { writing = true; await withCheckedContinuation { gate = $0 } }
        values[key] = corrupt ? Data("corrupt".utf8) : value; corrupt = false
    }
    func remove(_ key: String) { values.removeValue(forKey: key) }
    func inject(_ value: Data) { values["question-drafts.v1"] = value }
    func corruptWrite() { corrupt = true }
    func suspendWrite() { gated = true }
    func releaseWrite() { gated = false; gate?.resume(); gate = nil }
}

final class NativeQuestionDraftStoreTests: XCTestCase, @unchecked Sendable {
    private func key(_ value: Int) -> String { String(format: "%064x", value) }
    private func response(_ text: String) -> QuestionResponse { .init(fields: ["value": .init(text: text)]) }

    func testUnicodeAndExplicitFalseSurviveReopeningAndStayScoped() async throws {
        let values = DraftValues(), time: Int64 = 1_000_000
        let store = try NativeQuestionDraftStore(values: values, now: { time })
        let original = response("未发送 👩🏽‍💻\n  exact whitespace  ")
        try await store.save(original, key: key(1), revision: 1)
        try await store.save(.init(confirmed: false), key: key(2), revision: 2)
        let reopened = try NativeQuestionDraftStore(values: values, now: { time })
        let first = try await reopened.read(key: key(1)), second = try await reopened.read(key: key(2))
        let absent = try await reopened.read(key: key(3))
        XCTAssertEqual(first, original); XCTAssertEqual(second?.confirmed, false); XCTAssertNil(absent)
    }

    func testLateOlderRevisionCannotOverwriteNewerEditing() async throws {
        let store = try NativeQuestionDraftStore(values: DraftValues())
        try await store.save(response("new"), key: key(1), revision: 5)
        try await store.save(response("old"), key: key(1), revision: 4)
        let read = try await store.read(key: key(1)); XCTAssertEqual(read, response("new"))
    }

    func testExpiredAndFutureDatedDraftsNeverRestore() async throws {
        let values = DraftValues()
        let initial = try NativeQuestionDraftStore(values: values, now: { 1_000_000 })
        try await initial.save(response("original"), key: key(1), revision: 1)
        for time: Int64 in [999_999, 1_000_000 + 7 * 24 * 60 * 60 * 1_000] {
            let reopened = try NativeQuestionDraftStore(values: values, now: { time })
            let draft = try await reopened.read(key: key(1)); XCTAssertNil(draft)
        }
    }

    func testCorruptDocumentsAndInvalidKeysFailWithoutBecomingEmpty() async throws {
        let values = DraftValues(); await values.inject(Data("{}".utf8))
        let store = try NativeQuestionDraftStore(values: values)
        do { _ = try await store.read(key: key(1)); XCTFail("Accepted corrupt table") }
        catch { XCTAssertEqual(error as? StoreFailure, .invalidDocument) }
        for key in ["", "request-id", String(repeating: "A", count: 64), String(repeating: "a", count: 65)] {
            do { _ = try await store.read(key: key); XCTFail("Accepted invalid key") }
            catch { XCTAssertEqual(error as? StoreFailure, .invalidKey) }
        }
        let raw = await values.read("question-drafts.v1"); XCTAssertEqual(raw, Data("{}".utf8))
    }

    func testCountAndEncodedByteBudgetsBoundRetainedEditing() async throws {
        let values = DraftValues(), store = try NativeQuestionDraftStore(values: values)
        for index in 1...35 { try await store.save(response("small"), key: key(index), revision: UInt64(index)) }
        let oldest = try await store.read(key: key(1)), newest = try await store.read(key: key(35))
        XCTAssertNil(oldest); XCTAssertNotNil(newest)
        for index in 36...45 {
            try await store.save(response(String(repeating: "漢", count: 60_000)), key: key(index), revision: UInt64(index))
        }
        let bytes = await values.read("question-drafts.v1")
        XCTAssertLessThanOrEqual(try XCTUnwrap(bytes).count, 256_000)
        let retained = try await store.read(key: key(45)); XCTAssertEqual(retained?.fields["value"]?.text.count, 60_000)
        // An old write to an evicted key cannot resurrect it in this process.
        try await store.save(response("stale"), key: key(1), revision: 1)
        let stale = try await store.read(key: key(1)); XCTAssertNil(stale)
    }

    func testResolvedDraftRejectsQueuedSaveAndRemainsAbsentAfterReopen() async throws {
        let values = DraftValues(), store = try NativeQuestionDraftStore(values: values)
        try await store.save(response("saved"), key: key(1), revision: 1)
        try await store.retire(key: key(1), revision: 3)
        try await store.save(response("late"), key: key(1), revision: 2)
        let reopened = try NativeQuestionDraftStore(values: values)
        let draft = try await reopened.read(key: key(1)); XCTAssertNil(draft)
    }

    func testRetirementWaitsForInFlightWriteThenRemovesItsResult() async throws {
        let values = DraftValues(), store = try NativeQuestionDraftStore(values: values)
        await values.suspendWrite()
        let write = Task { try await store.save(response("in flight"), key: key(1), revision: 1) }
        for _ in 0..<2_000 {
            if await values.writing { break }; try await Task.sleep(for: .milliseconds(2))
        }
        let writing = await values.writing; XCTAssertTrue(writing)
        let retirement = Task { try await store.retire(key: key(1), revision: 2) }
        await Task.yield(); await values.releaseWrite()
        try await write.value; try await retirement.value
        let draft = try await store.read(key: key(1)); XCTAssertNil(draft)
    }

    func testInvalidDraftAndFailedReadbackAreExplicit() async throws {
        let values = DraftValues(), store = try NativeQuestionDraftStore(values: values)
        var invalid = response("text"); invalid.fields["value"]?.selectedOptionIDs = ["One", "One"]
        do { try await store.save(invalid, key: key(1), revision: 1); XCTFail("Accepted duplicate choices") }
        catch { XCTAssertEqual(error as? StoreFailure, .invalidDocument) }
        await values.corruptWrite()
        do { try await store.save(response("text"), key: key(1), revision: 2); XCTFail("Ignored failed verification") }
        catch { XCTAssertEqual(error as? StoreFailure, .verificationFailed) }
    }
}
