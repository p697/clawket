import ClawketRuntime
import Foundation
import XCTest
@testable import Clawket

final class NativePhysicalHistoryBindingTests: XCTestCase, @unchecked Sendable {
    private let scope = NativeHistoryScope(connectionID: "physical", agentID: "agent", sessionID: "logical")
    private func root() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("physical-bind-" + UUID().uuidString) }
    private func value(epoch: UUID) throws -> NativeConversation {
        let resource = UUID()
        let reference = try JSONDecoder().decode(NativeMediaReference.self, from: JSONSerialization.data(withJSONObject: [
            "id": "original-file", "resourceID": resource.uuidString,
            "kind": "file", "mimeType": "text/plain", "name": "original-e\u{301}.txt"
        ]))
        return .init(revision: 8, draft: "retained e\u{301}", messages: [
            .init(id: "pending", role: .user, local: true, text: "original", runID: "old-run",
                  idempotencyKey: "send-key", delivery: .uncertain, media: [reference], historyEpoch: UUID())
        ], draftResourceIDs: [UUID()], historyEpoch: epoch)
    }
    private func version(_ store: NativeConversationStore) async throws -> NativeHistoryStoredVersion {
        guard let value = try await store.historyStoredVersion(scope: scope) else { throw NativeHistoryFailure.missing }
        return value
    }
    private func bind(_ store: NativeConversationStore, version: NativeHistoryStoredVersion,
                      epoch: UUID, physicalID: String = "physical-one") async throws -> NativeConversation {
        try await store.bindPhysicalSession(scope: scope, expectedRevision: version.revision, epoch: epoch,
            expectedCurrentHash: version.sha256, physicalSessionID: physicalID)
    }

    func testBindingRetainsOldPendingEpochDraftMediaReferencesAndUnknownFieldsWithoutAnotherArchive() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let store = try NativeConversationStore(directory: directory), epoch = UUID(), original = try value(epoch: epoch)
        let key = try await store.scopedKey(scope.connectionID, scope.agentID, scope.sessionID)
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: historyEncode(original)) as? [String: Any])
        object["unknownLegacy"] = ["retained": ["e\u{301}"]]
        let raw = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
        try await store.values.write(raw, for: key)
        let before = try await version(store), result = try await bind(store, version: before, epoch: epoch)
        XCTAssertEqual(result.revision, 9); XCTAssertEqual(result.historyEpoch, epoch)
        XCTAssertEqual(result.physicalSessionID, "physical-one")
        XCTAssertEqual(result.messages, original.messages); XCTAssertEqual(Data(result.draft.utf8), Data(original.draft.utf8))
        XCTAssertEqual(result.draftResourceIDs, original.draftResourceIDs)
        XCTAssertEqual(result.mediaResourceIDs.count, 2)
        let allResources = try await store.allMediaResourceIDs()
        XCTAssertEqual(allResources, original.mediaResourceIDs)
        let retainedBytes = try await store.values.read(key)
        let retained = try XCTUnwrap(retainedBytes)
        let retainedObject = try XCTUnwrap(JSONSerialization.jsonObject(with: retained) as? [String: Any])
        XCTAssertNotNil(retainedObject["unknownLegacy"])
        let archives = try await store.physicalArchives(scope: scope), backup = try await store.values.read(key + ".rollback")
        XCTAssertTrue(archives.isEmpty); XCTAssertEqual(backup, raw)
        let repeated = try await bind(store, version: before, epoch: epoch)
        XCTAssertEqual(repeated.messages, result.messages); XCTAssertEqual(repeated.revision, result.revision)
    }

    func testThirdDocumentWithMatchingMetadataCannotMasqueradeAsCompletedBinding() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let store = try NativeConversationStore(directory: directory), epoch = UUID(), original = try value(epoch: epoch)
        try await store.write(original, connectionID: scope.connectionID, agentID: scope.agentID, sessionID: scope.sessionID)
        let before = try await version(store)
        var third = try await bind(store, version: before, epoch: epoch)
        third.draft = "different document, same metadata"
        let key = try await store.scopedKey(scope.connectionID, scope.agentID, scope.sessionID), raw = try historyEncode(third)
        try await store.values.write(raw, for: key)
        do { _ = try await bind(store, version: before, epoch: epoch); XCTFail("Third version must be rejected") }
        catch { XCTAssertEqual(error as? NativeHistoryFailure, .changed) }
        let current = try await store.values.read(key); XCTAssertEqual(current, raw)
    }

    func testUnknownBindingRequiresReopenAndOnlyItsExactOriginalOrReplacementCanRecover() async throws {
        for fault in [NativeHistoryFault.rollbackWritten, .currentWritten, .currentVerified] {
            let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
            let writer = try NativeConversationStore(directory: directory), epoch = UUID(), original = try value(epoch: epoch)
            try await writer.write(original, connectionID: scope.connectionID, agentID: scope.agentID, sessionID: scope.sessionID)
            let before = try await version(writer)
            let failing = try NativeConversationStore(directory: directory, historyFault: { stage in
                if stage == fault { throw NativeHistoryFailure.unavailable }
            })
            do { _ = try await bind(failing, version: before, epoch: epoch); XCTFail("Unknown metadata write must hold") }
            catch { XCTAssertEqual(error as? NativeHistoryFailure, .commitUncertain) }
            do { _ = try await bind(failing, version: before, epoch: epoch); XCTFail("Process cannot guess through an unknown write") }
            catch { XCTAssertEqual(error as? NativeHistoryFailure, .commitUncertain) }
            let reopened = try NativeConversationStore(directory: directory)
            let result = try await bind(reopened, version: before, epoch: epoch)
            XCTAssertEqual(result.revision, original.revision + 1); XCTAssertEqual(result.messages, original.messages)
        }
    }

    func testBindingRejectsRemoteQueuedStreamingForeignEpochStaleHashAndUnicodeAlias() async throws {
        for variant in 0..<9 {
            let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
            let store = try NativeConversationStore(directory: directory), epoch = UUID()
            var original = try value(epoch: epoch)
            if variant == 0 { original.messages[0].local = false }
            if variant == 1 { original.messages[0].delivery = .queued }
            if variant == 2 { original.messages[0].streaming = true }
            if variant == 3 { original.messages[0].idempotencyKey = nil }
            if variant == 7 { original.physicalSessionID = "e\u{301}" }
            if variant == 8 { original.messages[0].attribution = .init(channel: "slack", sender: .init(id: "other")) }
            try await store.write(original, connectionID: scope.connectionID, agentID: scope.agentID, sessionID: scope.sessionID)
            let before = try await version(store)
            do {
                _ = try await store.bindPhysicalSession(scope: scope,
                    expectedRevision: before.revision + (variant == 4 ? 1 : 0), epoch: variant == 5 ? UUID() : epoch,
                    expectedCurrentHash: variant == 6 ? String(repeating: "0", count: 64) : before.sha256,
                    physicalSessionID: variant == 7 ? "é" : "physical-one")
                XCTFail("Invalid identity or outbox state must not bind")
            } catch { XCTAssertEqual(error as? NativeHistoryFailure, .changed) }
            let after = try await version(store); XCTAssertEqual(after.sha256, before.sha256)
        }
    }

    func testHeadPolicyNeverInfersResetFromMissingIDsOrEarlierPagesAndArchivesUnknownHistory() throws {
        let epoch = UUID()
        XCTAssertEqual(try NativePhysicalHistoryPolicy.head(nil, current: .init(), earlier: false), .establish(nil))
        XCTAssertEqual(try NativePhysicalHistoryPolicy.head("first", current: .init(), earlier: false), .establish("first"))
        var current = try value(epoch: epoch)
        XCTAssertEqual(try NativePhysicalHistoryPolicy.head("new", current: current, earlier: true), .unchanged)
        XCTAssertEqual(try NativePhysicalHistoryPolicy.head(nil, current: current, earlier: false), .unchanged)
        XCTAssertEqual(try NativePhysicalHistoryPolicy.head("new", current: current, earlier: false), .bind("new"))
        current.messages.append(.init(id: "old", role: .assistant, text: "archive"))
        XCTAssertEqual(try NativePhysicalHistoryPolicy.head("new", current: current, earlier: false), .rollover("new"))
        current.physicalSessionID = "e\u{301}"
        XCTAssertEqual(try NativePhysicalHistoryPolicy.head("é", current: current, earlier: false), .rollover("é"))
        XCTAssertEqual(try NativePhysicalHistoryPolicy.head("e\u{301}", current: current, earlier: false), .unchanged)
        current.historyEpoch = nil
        XCTAssertEqual(try NativePhysicalHistoryPolicy.head(nil, current: current, earlier: false), .rollover(nil))
        let oldEpoch = current.messages[0].historyEpoch
        current.messages[0].delivery = .sending
        NativePhysicalHistoryPolicy.hold(&current)
        XCTAssertEqual(current.messages[0].delivery, .uncertain); XCTAssertEqual(current.messages[0].historyEpoch, oldEpoch)
    }
    func testLiveEvidenceRequiresCurrentInputOrAcceptedRunAndKeepsByteExactRetirement() {
        let epoch = UUID(), oldEpoch = UUID()
        var current = NativeConversation(messages: [
            .init(id: "old", role: .user, local: true, text: "old", idempotencyKey: "old-key", delivery: .uncertain, historyEpoch: oldEpoch),
            .init(id: "new", role: .user, local: true, text: "new", idempotencyKey: "new-key", delivery: .sending, historyEpoch: epoch)
        ], historyEpoch: epoch)
        var evidence = NativePhysicalLiveEvidence(epoch: epoch, retiringRunIDs: ["old-run", "é"])
        XCTAssertFalse(evidence.accepts(runID: "old-run", inputKey: nil, current: current))
        evidence.admit("old-run")
        XCTAssertFalse(evidence.accepts(runID: "old-run", inputKey: "old-key", current: current))
        XCTAssertFalse(evidence.accepts(runID: "unknown", inputKey: nil, current: current))
        XCTAssertTrue(evidence.accepts(runID: "old-run", inputKey: "new-key", current: current))
        XCTAssertFalse(evidence.accepts(runID: "old-run", inputKey: nil, current: current))
        XCTAssertTrue(evidence.accepts(runID: "new-run", inputKey: "new-key", current: current))
        XCTAssertTrue(evidence.accepts(runID: "new-run", inputKey: nil, current: current))
        XCTAssertFalse(evidence.accepts(runID: "new-run", inputKey: "old-key", current: current))
        XCTAssertFalse(evidence.accepts(runID: "new-run", inputKey: "foreign-key", current: current))
        current.messages.append(.init(id: "remote-user", remoteID: "source", role: .user, text: "external",
            idempotencyKey: "external-key", idSource: .provided, historyEpoch: epoch))
        XCTAssertTrue(evidence.accepts(runID: "external-run", inputKey: "external-key", current: current))
        evidence.admit("e\u{301}")
        XCTAssertTrue(evidence.accepts(runID: "e\u{301}", inputKey: nil, current: current))
        XCTAssertFalse(evidence.accepts(runID: "é", inputKey: nil, current: current))
        current.historyEpoch = UUID()
        XCTAssertFalse(evidence.accepts(runID: "new-run", inputKey: "new-key", current: current))
        var full = NativePhysicalLiveEvidence(epoch: epoch, retiringRunIDs: (0...128).map { "r-\($0)" })
        full.admit("new")
        current.historyEpoch = epoch
        XCTAssertFalse(full.accepts(runID: "new", inputKey: nil, current: current))
        XCTAssertTrue(full.accepts(runID: "new", inputKey: "new-key", current: current))
        var recent = NativePhysicalLiveEvidence(epoch: epoch, retiringRunIDs: [])
        for index in 0...128 { recent.admit("new-\(index)") }
        XCTAssertTrue(recent.accepts(runID: "new-128", inputKey: nil, current: current))
        XCTAssertFalse(recent.accepts(runID: "new-0", inputKey: nil, current: current))
    }

}
