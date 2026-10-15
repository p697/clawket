import Foundation
import XCTest
@testable import Clawket

final class NativeHistoryLimitsTests: XCTestCase, @unchecked Sendable {
    private let scope = NativeHistoryScope(connectionID: "limits", agentID: "agent", sessionID: "key")
    private func root() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("history-limits-" + UUID().uuidString) }
    private func bytes() throws -> Data {
        let value = NativeConversation(revision: 2, messages: [.init(id: "answer", role: .assistant, text: "preserve")], historyEpoch: UUID())
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: historyEncode(value)) as? [String: Any])
        object["unknownLegacyField"] = ""
        let empty = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
        object["unknownLegacyField"] = String(repeating: "x", count: NativeHistoryLimits.recordBytes - empty.count)
        return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
    }
    private func archive(_ files: NativeHistoryFiles, body: Data, scope: NativeHistoryScope) throws {
        let value = try JSONDecoder().decode(NativeConversation.self, from: body)
        let metadata = NativePhysicalArchive(id: UUID(), scope: scope, fromEpoch: value.historyEpoch, toEpoch: UUID(),
            physicalSessionID: value.physicalSessionID, savedAt: 1, byteCount: body.count, sha256: historyHash(body),
            replacementSHA256: String(repeating: "1", count: 64), sourceRevision: value.revision, resourceIDs: [])
        try files.put(body, name: NativeHistoryFiles.name(metadata.id, "body"))
        try files.put(historyEncode(metadata), name: NativeHistoryFiles.name(metadata.id, "meta"))
    }

    func testExactEightMiBLegacyBodyIsArchivedWithoutAWrapperOrDroppingUnknownFields() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let cache = try NativeConversationStore(directory: directory), raw = try bytes()
        XCTAssertEqual(raw.count, 8 * 1_024 * 1_024)
        let key = try await cache.scopedKey(scope.connectionID, scope.agentID, scope.sessionID)
        try await cache.values.write(raw, for: key)
        let old = try JSONDecoder().decode(NativeConversation.self, from: raw)
        let result = try await cache.rollover(scope: scope, expectedRevision: old.revision, fromEpoch: old.historyEpoch,
            toEpoch: UUID(), physicalSessionID: nil, retainingMessageIDs: [])
        let file = directory.appendingPathComponent("History/" + NativeHistoryFiles.name(result.archive.id, "body"))
        XCTAssertEqual(try Data(contentsOf: file), raw)
        XCTAssertTrue(result.current.messages.isEmpty)
    }

    func testWorstCaseCurrentRollbackAndAtomicCopiesRejectBeforeAnyMutation() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let cache = try NativeConversationStore(directory: directory), raw = try bytes()
        let key = try await cache.scopedKey(scope.connectionID, scope.agentID, scope.sessionID)
        try await cache.values.write(raw, for: key); try await cache.values.write(raw, for: key + ".rollback")
        let files = try NativeHistoryFiles(directory: directory.appendingPathComponent("History"))
        for _ in 0..<4 { try archive(files, body: raw, scope: scope) }
        let before = try files.inventory(), old = try JSONDecoder().decode(NativeConversation.self, from: raw)
        do {
            _ = try await cache.rollover(scope: scope, expectedRevision: old.revision, fromEpoch: old.historyEpoch,
                toEpoch: UUID(), physicalSessionID: nil, retainingMessageIDs: [])
            XCTFail("The worst atomic footprint must fit before publishing intent")
        } catch { XCTAssertEqual(error as? NativeHistoryFailure, .full) }
        let current = try await cache.values.read(key), rollback = try await cache.values.read(key + ".rollback")
        XCTAssertEqual(current, raw); XCTAssertEqual(rollback, raw); XCTAssertEqual(try files.inventory(), before)
    }

    func testRecordCapRefusesWithoutEvictingAnyArchiveOrCurrentTranscript() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let cache = try NativeConversationStore(directory: directory)
        let old = NativeConversation(revision: 1, messages: [.init(id: "old", role: .assistant, text: "keep")], historyEpoch: UUID())
        try await cache.write(old, connectionID: scope.connectionID, agentID: scope.agentID, sessionID: scope.sessionID)
        let files = try NativeHistoryFiles(directory: directory.appendingPathComponent("History")), raw = try historyEncode(old)
        for _ in 0..<128 { try archive(files, body: raw, scope: scope) }
        do {
            _ = try await cache.rollover(scope: scope, expectedRevision: old.revision, fromEpoch: old.historyEpoch,
                toEpoch: UUID(), physicalSessionID: nil, retainingMessageIDs: [])
            XCTFail("No implicit eviction")
        } catch { XCTAssertEqual(error as? NativeHistoryFailure, .full) }
        let entries = try await cache.physicalArchives(), current = try await cache.read(connectionID: scope.connectionID,
            agentID: scope.agentID, sessionID: scope.sessionID)
        XCTAssertEqual(entries.count, 128); XCTAssertEqual(try historyEncode(current), raw)
    }

    func testOpaqueScopeAndPhysicalIdentityUseExactUTF8IncludingIdempotentRetry() async throws {
        let composed = "caf\u{e9}", decomposed = "cafe\u{301}"
        XCTAssertEqual(composed, decomposed)
        let first = NativeHistoryScope(connectionID: "c", agentID: "a", sessionID: composed)
        let second = NativeHistoryScope(connectionID: "c", agentID: "a", sessionID: decomposed)
        XCTAssertNotEqual(first, second); XCTAssertEqual(Set([first, second]).count, 2)
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let cache = try NativeConversationStore(directory: directory), epoch = UUID()
        let bound = try await cache.establishHistoryScope(scope: first, expectedRevision: 0, epoch: epoch, physicalSessionID: composed)
        do {
            _ = try await cache.establishHistoryScope(scope: first, expectedRevision: 0, epoch: epoch, physicalSessionID: decomposed)
            XCTFail("Display equivalence does not prove physical identity")
        } catch { XCTAssertEqual(error as? NativeHistoryFailure, .changed) }
        let next = UUID()
        _ = try await cache.rollover(scope: first, expectedRevision: bound.revision, fromEpoch: epoch, toEpoch: next,
            physicalSessionID: composed, retainingMessageIDs: [])
        do {
            _ = try await cache.rollover(scope: first, expectedRevision: bound.revision, fromEpoch: epoch, toEpoch: next,
                physicalSessionID: decomposed, retainingMessageIDs: [])
            XCTFail("A retry cannot retarget the committed physical identity")
        } catch { XCTAssertEqual(error as? NativeHistoryFailure, .changed) }
        let other = try await cache.physicalArchives(scope: second); XCTAssertTrue(other.isEmpty)
    }

    func testNormalTemporaryDirectoryAliasesWorkButOwnedSymlinkFilesCannotEscape() throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let files = try NativeHistoryFiles(directory: directory.appendingPathComponent("History"))
        let name = NativeHistoryFiles.name(UUID(), "body"), bytes = Data("owned".utf8)
        try files.put(bytes, name: name)
        XCTAssertEqual(try files.read(name), bytes)
        XCTAssertThrowsError(try files.put(bytes, name: "../outside.json"))
        let outside = directory.appendingPathComponent("outside.json"); try bytes.write(to: outside)
        let linked = directory.appendingPathComponent("History/" + NativeHistoryFiles.name(UUID(), "body"))
        try FileManager.default.createSymbolicLink(at: linked, withDestinationURL: outside)
        XCTAssertThrowsError(try files.inventory())
        XCTAssertEqual(try Data(contentsOf: outside), bytes)
    }

    func testRevisionExhaustionRejectsBeforePublishingAnUnrecoverableIntent() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let cache = try NativeConversationStore(directory: directory)
        let old = NativeConversation(revision: 9_007_199_254_740_990, historyEpoch: UUID())
        try await cache.write(old, connectionID: scope.connectionID, agentID: scope.agentID, sessionID: scope.sessionID)
        do {
            _ = try await cache.rollover(scope: scope, expectedRevision: old.revision, fromEpoch: old.historyEpoch,
                toEpoch: UUID(), physicalSessionID: nil, retainingMessageIDs: [])
            XCTFail("Do not stage a revision that the recovery decoder rejects")
        } catch { XCTAssertEqual(error as? NativeHistoryFailure, .invalid) }
        let current = try await cache.read(connectionID: scope.connectionID, agentID: scope.agentID, sessionID: scope.sessionID)
        XCTAssertEqual(current.revision, old.revision)
        let inventory = try NativeHistoryFiles(directory: directory.appendingPathComponent("History")).inventory()
        XCTAssertTrue(inventory.isEmpty)
        var malformed = old; malformed.revision = Int64.max
        XCTAssertThrowsError(try malformed.validateMedia())
    }

    func testLaterOrdinaryCurrentWritesAlsoRespectArchiveAndAtomicTemporaryQuota() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let cache = try NativeConversationStore(directory: directory), old = NativeConversation(revision: 2, draft: "preserved", historyEpoch: UUID())
        try await cache.write(old, connectionID: scope.connectionID, agentID: scope.agentID, sessionID: scope.sessionID)
        let files = try NativeHistoryFiles(directory: directory.appendingPathComponent("History")), body = try bytes()
        for _ in 0..<7 { try archive(files, body: body, scope: scope) }
        var next = old; next.revision += 1
        next.messages = [.init(id: "large", role: .assistant, text: String(repeating: "x", count: 8 * 1_024 * 1_024 - 1_000))]
        XCTAssertLessThanOrEqual(try historyEncode(next).count, 8 * 1_024 * 1_024)
        do {
            try await cache.write(next, connectionID: scope.connectionID, agentID: scope.agentID, sessionID: scope.sessionID)
            XCTFail("Ordinary cache growth cannot escape the affected-scope quota")
        } catch { XCTAssertEqual(error as? NativeHistoryFailure, .full) }
        let retained = try await cache.read(connectionID: scope.connectionID, agentID: scope.agentID, sessionID: scope.sessionID)
        XCTAssertEqual(try historyEncode(retained), try historyEncode(old))
    }
}
