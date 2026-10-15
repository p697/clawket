import ClawketPersistence
import Foundation
import XCTest
@testable import Clawket

private final class HistoryFaultSwitch: @unchecked Sendable {
    private let lock = NSLock()
    private let phase: NativeHistoryFault
    private var fired = false
    init(_ phase: NativeHistoryFault) { self.phase = phase }
    func check(_ current: NativeHistoryFault) throws {
        lock.lock(); defer { lock.unlock() }
        if current == phase && !fired { fired = true; throw NativeHistoryFailure.unavailable }
    }
}

final class NativePhysicalHistoryTests: XCTestCase, @unchecked Sendable {
    private let scope = NativeHistoryScope(connectionID: "history", agentID: "agent", sessionID: "logical")
    private func directory() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("physical-history-" + UUID().uuidString) }
    private func seed() -> NativeConversation {
        .init(revision: 4, draft: "  keep my draft\n", messages: [
            .init(id: "remote", role: .assistant, text: "old physical answer"),
            .init(id: "pending", role: .user, local: true, text: "unknown input", idempotencyKey: "original-key", delivery: .uncertain)
        ], nextCursor: "old-cursor", hasMore: true, draftResourceIDs: [UUID()], historyEpoch: UUID(), physicalSessionID: "old-physical")
    }
    private func write(_ value: NativeConversation, cache: NativeConversationStore) async throws {
        try await cache.write(value, connectionID: scope.connectionID, agentID: scope.agentID, sessionID: scope.sessionID)
    }
    private func read(_ cache: NativeConversationStore) async throws -> NativeConversation {
        try await cache.read(connectionID: scope.connectionID, agentID: scope.agentID, sessionID: scope.sessionID)
    }
    private func rollover(_ cache: NativeConversationStore, old: NativeConversation, to: UUID = UUID()) async throws -> NativeHistoryRollover {
        try await cache.rollover(scope: scope, expectedRevision: old.revision, fromEpoch: old.historyEpoch, toEpoch: to,
            physicalSessionID: "next-physical", retainingMessageIDs: ["pending"])
    }

    func testOldV1DecodingDefaultsAndFirstEmptyIdentityBindingPreserveDraft() async throws {
        let root = directory(); defer { try? FileManager.default.removeItem(at: root) }
        let old = Data(#"{"version":1,"revision":0,"draft":"before upgrade","messages":[],"historyLimit":80,"hasMore":false}"#.utf8)
        let decoded = try JSONDecoder().decode(NativeConversation.self, from: old)
        XCTAssertNil(decoded.historyEpoch); XCTAssertNil(decoded.physicalSessionID)
        let cache = try NativeConversationStore(directory: root); try await write(decoded, cache: cache)
        let epoch = UUID()
        let bound = try await cache.establishHistoryScope(scope: scope, expectedRevision: 0, epoch: epoch, physicalSessionID: nil)
        XCTAssertEqual(bound.draft, decoded.draft); XCTAssertEqual(bound.revision, 1); XCTAssertEqual(bound.historyEpoch, epoch)
        let adopted = try await cache.establishHistoryScope(scope: scope, expectedRevision: 1, epoch: epoch, physicalSessionID: "observed")
        XCTAssertEqual(adopted.revision, 2); XCTAssertEqual(adopted.physicalSessionID, "observed")
        let repeated = try await cache.establishHistoryScope(scope: scope, expectedRevision: 1, epoch: epoch, physicalSessionID: "observed")
        XCTAssertEqual(repeated.revision, 2)
        let archives = try await cache.physicalArchives(); XCTAssertTrue(archives.isEmpty)
        let reopened = try await read(NativeConversationStore(directory: root))
        XCTAssertEqual(reopened.historyEpoch, epoch); XCTAssertEqual(reopened.physicalSessionID, "observed")
    }

    func testMissingConversationCanBindButNonemptyLegacyCannotBeReassigned() async throws {
        let root = directory(); defer { try? FileManager.default.removeItem(at: root) }
        let cache = try NativeConversationStore(directory: root), epoch = UUID()
        let first = try await cache.establishHistoryScope(scope: scope, expectedRevision: 0, epoch: epoch, physicalSessionID: nil)
        XCTAssertEqual(first.historyEpoch, epoch)
        let other = NativeHistoryScope(connectionID: "history", agentID: "agent", sessionID: "legacy")
        let value = NativeConversation(messages: [.init(id: "old", role: .assistant, text: "preserve")])
        try await cache.write(value, connectionID: other.connectionID, agentID: other.agentID, sessionID: other.sessionID)
        do { _ = try await cache.establishHistoryScope(scope: other, expectedRevision: 0, epoch: UUID(), physicalSessionID: "new"); XCTFail("Nonempty legacy history needs an archive") }
        catch { XCTAssertEqual(error as? NativeHistoryFailure, .changed) }
        let result = try await cache.rollover(scope: other, expectedRevision: 0, fromEpoch: nil, toEpoch: UUID(), physicalSessionID: "new", retainingMessageIDs: [])
        let (_, preserved) = try await cache.physicalArchive(result.archive.id)
        XCTAssertEqual(preserved.messages.first?.text, "preserve"); XCTAssertTrue(result.current.messages.isEmpty)
    }

    func testRolloverPreservesExactDraftOutboxMediaAndImmutableOriginalBytes() async throws {
        let root = directory(); defer { try? FileManager.default.removeItem(at: root) }
        let cache = try NativeConversationStore(directory: root), old = seed(), epoch = UUID()
        try await write(old, cache: cache)
        let original = try historyEncode(old), value = try await rollover(cache, old: old, to: epoch)
        XCTAssertEqual(value.current.draft, old.draft); XCTAssertEqual(value.current.draftResourceIDs, old.draftResourceIDs)
        XCTAssertEqual(try historyEncode(value.current.messages), try historyEncode([old.messages[1]]))
        XCTAssertEqual(value.current.revision, 5); XCTAssertEqual(value.current.historyEpoch, epoch)
        XCTAssertNil(value.current.nextCursor); XCTAssertFalse(value.current.hasMore)
        let physical = try NativeHistoryFiles(directory: root.appendingPathComponent("History"))
        XCTAssertEqual(try physical.read(NativeHistoryFiles.name(value.archive.id, "body")), original)
        let (_, archived) = try await cache.physicalArchive(value.archive.id)
        XCTAssertEqual(archived.physicalSessionID, "old-physical"); XCTAssertEqual(archived.messages.count, 2)
        let refs = try await cache.allMediaResourceIDs(); XCTAssertEqual(refs, old.mediaResourceIDs)
        let again = try await rollover(cache, old: old, to: epoch)
        XCTAssertEqual(again.archive.id, value.archive.id)
        let entries = try await cache.physicalArchives(); XCTAssertEqual(entries.count, 1)
    }

    func testStaleEpochRevisionHashAndInvalidRetainedIdentitiesNeverMutateSource() async throws {
        let root = directory(); defer { try? FileManager.default.removeItem(at: root) }
        let cache = try NativeConversationStore(directory: root), old = seed(); try await write(old, cache: cache)
        let invalidIDs: [Set<String>] = [["missing"], ["remote"]]
        for ids in invalidIDs {
            do {
                _ = try await cache.rollover(scope: scope, expectedRevision: old.revision, fromEpoch: old.historyEpoch,
                    toEpoch: UUID(), physicalSessionID: "new", retainingMessageIDs: ids)
                XCTFail("Invalid ownership must fail")
            } catch { XCTAssertEqual(error as? NativeHistoryFailure, .invalid) }
        }
        for (revision, epoch, hash) in [(old.revision + 1, old.historyEpoch, nil as String?), (old.revision, UUID(), nil), (old.revision, old.historyEpoch, String(repeating: "0", count: 64))] {
            do {
                _ = try await cache.rollover(scope: scope, expectedRevision: revision, fromEpoch: epoch, toEpoch: UUID(),
                    physicalSessionID: "new", retainingMessageIDs: ["pending"], expectedCurrentHash: hash)
                XCTFail("Stale evidence must fail")
            } catch { XCTAssertEqual(error as? NativeHistoryFailure, .changed) }
        }
        let current = try await read(cache)
        XCTAssertEqual(try historyEncode(current), try historyEncode(old))
        let entries = try await cache.physicalArchives(); XCTAssertTrue(entries.isEmpty)
    }

    func testLateOrdinaryWriteCannotRestoreAnOldPhysicalScope() async throws {
        let root = directory(); defer { try? FileManager.default.removeItem(at: root) }
        let cache = try NativeConversationStore(directory: root), old = seed(); try await write(old, cache: cache)
        let result = try await rollover(cache, old: old)
        for revision in [old.revision, result.current.revision] {
            var late = old; late.revision = revision; late.draft = "stale overwrite"
            do { try await write(late, cache: cache); XCTFail("Old physical identity must reject even a lower revision") }
            catch { XCTAssertEqual(error as? NativeHistoryFailure, .changed) }
        }
        var sameScope = result.current; sameScope.revision -= 1; sameScope.draft = "stale same-epoch draft"
        try await write(sameScope, cache: cache)
        let retained = try await read(cache); XCTAssertEqual(retained.historyEpoch, result.current.historyEpoch); XCTAssertEqual(retained.draft, old.draft)
    }

    func testEveryCrashCheckpointRecoversOneExactEpochWithoutReplayingOrLosingOwnership() async throws {
        let phases: [NativeHistoryFault] = [.stagePrepared, .intentPublished, .archivePublished, .metadataPublished, .rollbackWritten, .currentWritten, .currentVerified, .intentRemoved]
        for phase in phases {
            let root = directory(); defer { try? FileManager.default.removeItem(at: root) }
            let fault = HistoryFaultSwitch(phase), old = seed(), target = UUID()
            let cache = try NativeConversationStore(directory: root, historyFault: fault.check)
            try await write(old, cache: cache)
            do { _ = try await rollover(cache, old: old, to: target); XCTFail("Injected failure must be visible") }
            catch { if phase != .stagePrepared { XCTAssertEqual(error as? NativeHistoryFailure, .commitUncertain) } }
            if phase != .stagePrepared {
                do { _ = try await read(cache); XCTFail("Unknown outcome remains held in-process") }
                catch { XCTAssertEqual(error as? NativeHistoryFailure, .commitUncertain) }
            }
            let reopened = try NativeConversationStore(directory: root), current = try await read(reopened)
            XCTAssertEqual(current.historyEpoch, phase == .stagePrepared ? old.historyEpoch : target)
            XCTAssertEqual(current.draft, old.draft); XCTAssertEqual(current.draftResourceIDs, old.draftResourceIDs)
            XCTAssertEqual(current.messages.last?.idempotencyKey, "original-key")
            XCTAssertEqual(current.messages.last?.delivery, .uncertain)
            let entries = try await reopened.physicalArchives(); XCTAssertEqual(entries.count, phase == .stagePrepared ? 0 : 1)
            let inventory = try NativeHistoryFiles(directory: root.appendingPathComponent("History")).inventory()
            XCTAssertFalse(inventory.keys.contains("intent.json")); XCTAssertFalse(inventory.keys.contains { $0.hasSuffix(".next.json") || $0.hasPrefix("work-") })
        }
    }

    func testRecoveryNeverOverwritesAThirdCurrentVersion() async throws {
        let root = directory(); defer { try? FileManager.default.removeItem(at: root) }
        let fault = HistoryFaultSwitch(.intentPublished), cache = try NativeConversationStore(directory: root, historyFault: fault.check)
        let old = seed(); try await write(old, cache: cache)
        do { _ = try await rollover(cache, old: old) } catch { }
        var third = old; third.revision = 99; third.draft = "external third version"
        let key = try await cache.scopedKey(scope.connectionID, scope.agentID, scope.sessionID)
        let raw = try historyEncode(third), values = await cache.values
        try await values.write(raw, for: key)
        let reopened = try NativeConversationStore(directory: root)
        do { _ = try await read(reopened); XCTFail("Third version needs explicit recovery") }
        catch { XCTAssertEqual(error as? NativeHistoryFailure, .changed) }
        let preserved = try await values.read(key); XCTAssertEqual(preserved, raw)
    }

    func testCorruptArchiveStopsReclamationWithoutSilentlyEmptyingCurrentHistory() async throws {
        let root = directory(); defer { try? FileManager.default.removeItem(at: root) }
        let cache = try NativeConversationStore(directory: root), old = seed(); try await write(old, cache: cache)
        let result = try await rollover(cache, old: old)
        let body = root.appendingPathComponent("History").appendingPathComponent(NativeHistoryFiles.name(result.archive.id, "body"))
        let corrupt = Data("corrupt preserved archive".utf8); try corrupt.write(to: body)
        let current = try await read(cache); XCTAssertEqual(current.historyEpoch, result.current.historyEpoch)
        do { _ = try await cache.allMediaResourceIDs(); XCTFail("Corruption must disable reclamation") } catch { }
        XCTAssertEqual(try Data(contentsOf: body), corrupt)
    }
}
