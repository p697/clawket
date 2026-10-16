import ClawketRuntime
import ClawketUI
import Foundation
import XCTest
@testable import Clawket

final class NativePhysicalHistoryHostTests: XCTestCase, @unchecked Sendable {
    private var route: ConversationID { .init(connectionID: "c", agentID: "a", sessionID: "s") }
    private func root() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent("physical-host-" + UUID().uuidString) }
    private func original() -> NativeConversation {
        let epoch = UUID()
        return .init(revision: 3, draft: "original draft", messages: [
            .init(id: "remote", role: .assistant, text: "old answer", runID: "old-run", streaming: true, historyEpoch: epoch),
            .init(id: "queued", role: .user, local: true, text: "not dispatched", idempotencyKey: "queue-key", delivery: .queued, historyEpoch: epoch),
            .init(id: "uncertain", role: .user, local: true, text: "unknown", idempotencyKey: "unknown-key", delivery: .uncertain, historyEpoch: epoch)
        ], draftResourceIDs: [UUID()], historyEpoch: epoch, physicalSessionID: "before", physicalMutationUnconfirmed: true)
    }
    @MainActor func testActualHostArchivesBeforeAdoptingNewScopeAndKeepsLatestDraftAndOutboxIdentity() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let model = NativeAppModel(), store = try NativeConversationStore(directory: directory), old = original()
        model.cache = store; model.documents[route] = old
        let other = ConversationID(connectionID: "c", agentID: "a", sessionID: "other")
        model.documents[other] = .init(draft: "other draft")
        var changedDraft = false
        try await model.reconcilePhysicalHistory(route, decision: .rollover(nil), acknowledgedMutation: true) {
            if !model.physicalPermitsLocalChanges(self.route), !changedDraft {
                changedDraft = true; model.documents[self.route]?.draft = "edited during storage await"
                model.changed(self.route)
            }
            return true
        }
        let adopted = try XCTUnwrap(model.documents[route])
        XCTAssertTrue(changedDraft); XCTAssertNotEqual(adopted.historyEpoch, old.historyEpoch)
        XCTAssertNil(adopted.physicalSessionID); XCTAssertNil(adopted.physicalMutationUnconfirmed)
        XCTAssertEqual(adopted.draft, "edited during storage await"); XCTAssertEqual(adopted.draftResourceIDs, old.draftResourceIDs)
        XCTAssertEqual(adopted.messages.map(\.id), ["queued", "uncertain"])
        XCTAssertEqual(adopted.messages.map(\.idempotencyKey), ["queue-key", "unknown-key"])
        XCTAssertEqual(adopted.messages.map(\.historyEpoch), [old.historyEpoch, old.historyEpoch])
        XCTAssertEqual(adopted.messages.map(\.delivery), [.held, .uncertain]); XCTAssertFalse(model.physicalPermitsInput(route))
        XCTAssertTrue(model.physicalPermitsLocalChanges(route)); XCTAssertEqual(model.documents[other]?.draft, "other draft")
        let archives = try await store.physicalArchives(scope: NativeHistoryScope(route))
        XCTAssertEqual(archives.count, 1)
        let (_, archived) = try await store.physicalArchive(archives[0].id)
        XCTAssertEqual(archived.messages, old.messages); XCTAssertEqual(archived.draft, old.draft)
        let saved = try await store.read(connectionID: "c", agentID: "a", sessionID: "s")
        XCTAssertEqual(saved.historyEpoch, adopted.historyEpoch); XCTAssertEqual(saved.draft, adopted.draft)
    }
    @MainActor func testCommittedLocalRolloverIsAdoptedEvenWhenItsWireReadBecomesStale() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let model = NativeAppModel(), store = try NativeConversationStore(directory: directory), old = original()
        model.cache = store; model.documents[route] = old
        do {
            try await model.reconcilePhysicalHistory(route, decision: .rollover("after")) {
                model.documents[self.route]?.historyEpoch == old.historyEpoch
            }
            XCTFail("Old head must not continue after local commit")
        } catch { XCTAssertEqual((error as? RuntimeFailure)?.code, .superseded) }
        XCTAssertNotEqual(model.documents[route]?.historyEpoch, old.historyEpoch)
        XCTAssertEqual(model.documents[route]?.physicalSessionID, "after")
        XCTAssertTrue(model.physicalPermitsLocalChanges(route)); XCTAssertFalse(model.physicalPermitsInput(route))
        let saved = try await store.read(connectionID: "c", agentID: "a", sessionID: "s")
        XCTAssertEqual(saved.historyEpoch, model.documents[route]?.historyEpoch)
        let archives = try await store.physicalArchives(); XCTAssertEqual(archives.count, 1)
    }
    @MainActor func testUnknownLocalCommitLocksOnlyItsRouteAndCannotOverwriteRecoveryEvidence() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let old = original(), model = NativeAppModel()
        let store = try NativeConversationStore(directory: directory) { phase in
            if phase == .currentWritten { throw NativeHistoryFailure.unavailable }
        }
        model.cache = store; model.documents[route] = old
        do { try await model.reconcilePhysicalHistory(route, decision: .rollover("after")) { true }; XCTFail("Unknown write") }
        catch { XCTAssertEqual(error as? NativeHistoryFailure, .commitUncertain) }
        XCTAssertEqual(model.documents[route]?.messages, old.messages)
        XCTAssertFalse(model.physicalPermitsLocalChanges(route)); XCTAssertFalse(model.physicalPermitsInput(route))
        XCTAssertTrue(model.physicalPermitsLocalChanges(.init(connectionID: "c", agentID: "a", sessionID: "other")))
        do { try await model.persist(route); XCTFail("No ordinary overwrite on an unknown commit") } catch { }
        let reopened = try NativeConversationStore(directory: directory)
        let saved = try await reopened.read(connectionID: "c", agentID: "a", sessionID: "s")
        XCTAssertEqual(saved.physicalSessionID, "after")
        let archives = try await reopened.physicalArchives(); XCTAssertEqual(archives.count, 1)
    }
    @MainActor func testAcknowledgedEmptyScopeBindsFreshPhysicalIDWithoutRearchivingHeldInput() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let model = NativeAppModel(), store = try NativeConversationStore(directory: directory), old = original()
        model.cache = store; model.documents[route] = old
        try await model.reconcilePhysicalHistory(route, decision: .rollover(nil), acknowledgedMutation: true) { true }
        let next = try XCTUnwrap(model.documents[route])
        let decision = try NativePhysicalHistoryPolicy.head("actual-new-id", current: next, earlier: false)
        XCTAssertEqual(decision, .bind("actual-new-id"))
        try await model.reconcilePhysicalHistory(route, decision: decision) { true }
        XCTAssertEqual(model.documents[route]?.historyEpoch, next.historyEpoch)
        XCTAssertEqual(model.documents[route]?.physicalSessionID, "actual-new-id")
        XCTAssertEqual(model.documents[route]?.messages, next.messages)
        let archives = try await store.physicalArchives(); XCTAssertEqual(archives.count, 1)
    }
    func testUncertainDestructiveIntentSurvivesColdReadAndSamePhysicalHeadGrantsNoNewEpoch() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let store = try NativeConversationStore(directory: directory), old = original()
        try await store.write(old, connectionID: "c", agentID: "a", sessionID: "s")
        let reopened = try NativeConversationStore(directory: directory)
        let value = try await reopened.read(connectionID: "c", agentID: "a", sessionID: "s")
        XCTAssertEqual(value.physicalMutationUnconfirmed, true)
        XCTAssertEqual(try NativePhysicalHistoryPolicy.head("before", current: value, earlier: false), .unchanged)
        XCTAssertEqual(value.messages.first { $0.id == "queued" }?.delivery, .held)
        XCTAssertEqual(value.messages.first { $0.id == "uncertain" }?.delivery, .uncertain)
    }
    @MainActor func testLegacyOrFirstKnownHeadDoesNotClearAnUnknownMutationIntent() async throws {
        for physical in [nil, "first-known"] as [String?] {
            let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
            let store = try NativeConversationStore(directory: directory), model = NativeAppModel()
            var old = original(); old.historyEpoch = nil; old.physicalSessionID = nil
            model.cache = store; model.documents[route] = old
            let decision = try NativePhysicalHistoryPolicy.head(physical, current: old, earlier: false)
            try await model.reconcilePhysicalHistory(route, decision: decision) { true }
            XCTAssertEqual(model.documents[route]?.physicalMutationUnconfirmed, true)
            XCTAssertFalse(model.physicalPermitsInput(route))
            let cold = try await store.read(connectionID: "c", agentID: "a", sessionID: "s")
            XCTAssertEqual(cold.physicalMutationUnconfirmed, true)
        }
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let model = NativeAppModel(), store = try NativeConversationStore(directory: directory)
        model.cache = store; model.documents[route] = .init(physicalMutationUnconfirmed: true)
        try await model.reconcilePhysicalHistory(route, decision: .establish("first-known")) { true }
        XCTAssertEqual(model.documents[route]?.physicalMutationUnconfirmed, true)
    }

    @MainActor func testDelayedPreparationReadCannotOverwriteReenteredDocumentOrNewWire() async throws {
        for changeWire in [false, true] {
            let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
            let model = NativeAppModel(), store = try NativeConversationStore(directory: directory), operation = UUID()
            model.state = .init(connectionID: "c", phase: .ready)
            try model.beginPhysicalOperation(route, token: operation)
            let host = NativeSessionHostContext(activation: model.activationRevision, wire: model.wireRevision, selection: model.selectionRevision)
            var release: CheckedContinuation<Void, Never>?
            let task = Task { @MainActor in
                let loaded = try await store.read(connectionID: "c", agentID: "a", sessionID: "s")
                await withCheckedContinuation { release = $0 }
                try model.adoptPreparedPhysicalConversation(loaded, route: self.route, operation: operation, host: host)
            }
            let deadline = ContinuousClock.now + .seconds(3)
            while release == nil {
                guard ContinuousClock.now < deadline else { task.cancel(); throw NativeHistoryFailure.unavailable }
                await Task.yield()
            }
            let replacement = NativeConversation(draft: "new working draft", historyEpoch: UUID(), physicalSessionID: "replacement")
            model.documents[route] = replacement
            if changeWire { model.wireRevision = UUID() }
            release?.resume()
            do { try await task.value; XCTFail("Retired read must reject before assignment") }
            catch { XCTAssertEqual((error as? RuntimeFailure)?.code, .superseded) }
            XCTAssertEqual(model.documents[route]?.draft, replacement.draft)
            XCTAssertEqual(model.documents[route]?.historyEpoch, replacement.historyEpoch)
            XCTAssertEqual(model.documents[route]?.physicalSessionID, replacement.physicalSessionID)
            XCTAssertNil(model.documents[route]?.physicalMutationUnconfirmed)
        }
    }

}
