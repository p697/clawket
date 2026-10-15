import ClawketPersistence
import Foundation
import XCTest
@testable import Clawket

private actor SavedHistoryValues: ValueStore {
    var values: [String: Data] = [:]
    var fail = false
    func read(_ key: String) throws -> Data? { values[key] }
    func write(_ data: Data, for key: String) throws {
        values[key] = data
        if fail { fail = false; throw StoreFailure.verificationFailed }
    }
    func remove(_ key: String) throws { values[key] = nil }
    func set(_ data: Data, key: String) { values[key] = data }
    func failNextWrite() { fail = true }
}

final class NativeSavedHistoryTests: XCTestCase, @unchecked Sendable {
    private let scope = NativeHistoryScope(connectionID: "c", agentID: "a", sessionID: "s")
    private func transcript(_ text: String = "answer", title: String = "Title") -> NativePublicTranscript {
        .init(title: title, messages: [.init(role: .assistant, text: text, timestampMs: 1_234, attachments: ["résumé.pdf"])])
    }
    private func entry(_ index: Int, text: String = "answer") -> NativeSavedConversation {
        .init(id: String(format: "%064x", index), connectionId: "c", agentId: "a", sessionKey: "s",
            savedAt: Double(index + 1), transcript: transcript(text, title: "Entry \(index)"))
    }

    func testSaveDeduplicatesExactScopeAndPreservesNamePinAndImportedIdentity() async throws {
        let values = SavedHistoryValues(), imported = entry(7)
        try await values.write(historyEncode([imported]), for: "conversation-archives.v1")
        let store = try NativeSavedConversations(values: values)
        _ = try await store.rename(imported.id, name: "  Named  ")
        _ = try await store.setPinned(imported.id, pinned: true)
        let result = try await store.save(scope: scope, transcript: imported.transcript)
        XCTAssertEqual(result.id, imported.id); XCTAssertEqual(result.name, "Named"); XCTAssertEqual(result.pinned, true)
        let list = try await store.list(); XCTAssertEqual(list.entries.count, 1)
    }

    func testSearchFiltersOrderingAndDeletionStayLocalAndDoNotMixEquivalentOpaqueScopes() async throws {
        let store = try NativeSavedConversations(values: SavedHistoryValues())
        let first = try await store.save(scope: scope, transcript: transcript("needle"))
        let second = try await store.save(scope: .init(connectionID: "c", agentID: "a", sessionID: "other"), transcript: transcript("second"))
        _ = try await store.setPinned(first.id, pinned: true)
        let list = try await store.list(), matches = try await store.search("résumé", filter: .files)
        XCTAssertEqual(list.entries.first?.id, first.id); XCTAssertEqual(matches.count, 2)
        let pinned = try await store.search("needle", filter: .pinned); XCTAssertEqual(pinned.map(\.id), [first.id])
        try await store.remove(second.id)
        let reopened = try await store.list(); XCTAssertEqual(reopened.entries.map(\.id), [first.id])
        let composed = NativeHistoryScope(connectionID: "c", agentID: "a", sessionID: "caf\u{e9}")
        let decomposed = NativeHistoryScope(connectionID: "c", agentID: "a", sessionID: "cafe\u{301}")
        let a = try await store.save(scope: composed, transcript: transcript()), b = try await store.save(scope: decomposed, transcript: transcript())
        XCTAssertNotEqual(a.id, b.id)
    }

    func testUTF16SingleAndTotalLimitsRejectWithoutEvictionOrTruncation() async throws {
        let values = SavedHistoryValues(), store = try NativeSavedConversations(values: values)
        let original = try await store.save(scope: scope, transcript: transcript())
        do {
            _ = try await store.save(scope: scope, transcript: transcript(String(repeating: "😀", count: 250_000)))
            XCTFail("500k UTF16 includes title and attachment names")
        } catch { XCTAssertEqual(error as? NativeHistoryFailure, .full) }
        _ = try await store.save(scope: scope, transcript: transcript(String(repeating: "a", count: 490_000)))
        _ = try await store.save(scope: scope, transcript: transcript(String(repeating: "b", count: 490_000)))
        do {
            _ = try await store.save(scope: scope, transcript: transcript(String(repeating: "c", count: 30_000)))
            XCTFail("The total UTF16 limit is independent")
        } catch { XCTAssertEqual(error as? NativeHistoryFailure, .full) }
        let list = try await store.list(); XCTAssertEqual(list.entries.count, 3)
        XCTAssertTrue(list.entries.contains { $0.id == original.id })
    }

    func testOneHundredRecordCapAndOversizedRenameKeepEveryStoredCopy() async throws {
        let values = SavedHistoryValues(), originals = (1...100).map { entry($0) }
        try await values.write(historyEncode(originals), for: "conversation-archives.v1")
        let store = try NativeSavedConversations(values: values)
        do { _ = try await store.save(scope: scope, transcript: transcript("new")); XCTFail("No eviction") }
        catch { XCTAssertEqual(error as? NativeHistoryFailure, .full) }
        do { _ = try await store.rename(originals[0].id, name: String(repeating: "x", count: 201)); XCTFail("No truncation") }
        catch { XCTAssertEqual(error as? NativeHistoryFailure, .invalid) }
        let list = try await store.list(); XCTAssertEqual(Set(list.entries.map(\.id)), Set(originals.map(\.id)))
    }

    func testSemanticCorruptionUsesVerifiedRollbackAndNeverBecomesAnEmptyLibrary() async throws {
        let values = SavedHistoryValues(), original = entry(1)
        try await values.write(historyEncode([original]), for: "conversation-archives.v1.rollback")
        var invalid = original; invalid.name = " "
        try await values.write(historyEncode([invalid]), for: "conversation-archives.v1")
        let store = try NativeSavedConversations(values: values), listing = try await store.list()
        XCTAssertTrue(listing.recoveredFromRollback); XCTAssertEqual(listing.entries.map(\.id), [original.id])
        await values.set(Data("corrupt".utf8), key: "conversation-archives.v1.rollback")
        do { _ = try await store.list(); XCTFail("Corrupt copies must not silently become empty") } catch { }
        let retained = try await values.read("conversation-archives.v1")
        XCTAssertEqual(retained, try historyEncode([invalid]))
    }

    func testUnknownWriteBlocksInProcessAndColdReadRecoversVerifiedState() async throws {
        let values = SavedHistoryValues(), store = try NativeSavedConversations(values: values)
        _ = try await store.save(scope: scope, transcript: transcript())
        await values.failNextWrite()
        do { _ = try await store.save(scope: scope, transcript: transcript("second")); XCTFail("Write failure must be surfaced") }
        catch { XCTAssertEqual(error as? NativeHistoryFailure, .commitUncertain) }
        do { _ = try await store.list(); XCTFail("No automatic write retry") }
        catch { XCTAssertEqual(error as? NativeHistoryFailure, .commitUncertain) }
        let reopened = try NativeSavedConversations(values: values), list = try await reopened.list()
        XCTAssertEqual(list.entries.count, 1)
    }
}
