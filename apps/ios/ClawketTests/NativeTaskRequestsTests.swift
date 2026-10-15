import ClawketPersistence
import ClawketTransport
import ClawketUI
import Foundation
import XCTest
@testable import ClawketRuntime
@testable import Clawket

private actor RequestValues: ValueStore {
    var values: [String: Data] = [:]
    func read(_ key: String) -> Data? { values[key] }
    func write(_ value: Data, for key: String) { values[key] = value }
    func remove(_ key: String) { values.removeValue(forKey: key) }
}
private actor RequestRuntime: NativeTaskRuntime {
    var prepared: [RuntimeRequestReference] = []
    var decisions: [(RuntimeRequestReference, RuntimeApprovalDecision, RuntimeApprovalConfirmation?)] = []
    var answers: [(RuntimeRequestReference, RuntimeQuestionAnswer)] = []
    var failure: RuntimeFailure?
    func listPending(sessionKey: String?) -> RuntimePendingRequests { .init(connectionID: "c", approvals: [], questions: []) }
    func prepareApprovalConfirmation(_ reference: RuntimeRequestReference) -> RuntimeApprovalConfirmation {
        prepared.append(reference); return .init(id: UUID(), reference: reference)
    }
    func resolve(_ reference: RuntimeRequestReference, decision: RuntimeApprovalDecision, confirmation: RuntimeApprovalConfirmation?) throws {
        decisions.append((reference, decision, confirmation)); if let failure { throw failure }
    }
    func answer(_ reference: RuntimeRequestReference, answer: RuntimeQuestionAnswer) throws {
        answers.append((reference, answer)); if let failure { throw failure }
    }
    func setFailure(_ value: RuntimeFailure) { failure = value }
}

final class NativeTaskRequestsTests: XCTestCase, @unchecked Sendable {
    @MainActor private func fixture() throws -> (NativeTaskRequests, ClientPresentation, RequestRuntime, NativeQuestionDraftStore) {
        let presentation = ClientPresentation(), runtime = RequestRuntime(), drafts = try NativeQuestionDraftStore(values: RequestValues())
        let requests = NativeTaskRequests(presentation: presentation, runtime: runtime, drafts: drafts,
            onChange: {}, onStorageFailure: { XCTFail("Unexpected draft failure") })
        requests.update(ready())
        return (requests, presentation, runtime, drafts)
    }
    private func ready(_ connection: String = "c") -> RuntimeConnectionState {
        var capabilities = RuntimeCapabilities(); capabilities.questions = true
        capabilities.executionApprovals = true; capabilities.pairingApprovals = true
        return .init(connectionID: connection, phase: .ready, capabilities: capabilities)
    }
    private func connection(_ backend: BackendKind = .openclaw) -> BackendConnection {
        .init(id: "c", backendKind: backend, transportKind: .local, label: "QA", url: URL(string: "ws://127.0.0.1:1")!)
    }
    private func approval(command: String = "git status", session: String? = "s", kind: String = "exec") throws -> RuntimeApproval {
        let raw: JSONValue = .object(["id": .string("wire"), "kind": .string(kind), "target": .string("device"),
            "command": .string(command), "decisions": .array([.string("allow-once"), .string("allow-always"), .string("deny")])])
        let (_, value) = try ConsentWire.approval(raw, sessionKey: session, connection: connection())
        guard case .approval(let result) = value else { throw StoreFailure.invalidDocument }; return result
    }
    private func question(kind: String = "input", options: [String] = ["One", "Two"]) throws -> RuntimeQuestion {
        let raw: JSONValue = .object(["id": .string("wire"), "kind": .string(kind), "title": .string("Question"),
            "options": .array(options.map(JSONValue.string))])
        let (_, value) = try ConsentWire.question(raw, sessionKey: "s", connection: connection(.pi))
        guard case .question(let result) = value else { throw StoreFailure.invalidDocument }; return result
    }
    @MainActor private func waitUntil(_ check: @MainActor () async -> Bool) async throws {
        for _ in 0..<2_000 {
            if await check() { return }; try await Task.sleep(for: .milliseconds(2))
        }
        XCTFail("Request operation did not reach its expected state"); throw StoreFailure.unavailable
    }
    private var route: ConversationID { .init(connectionID: "c", agentID: "a", sessionID: "s") }

    @MainActor func testAlwaysNeedsFrozenConfirmationAndConsumesItBeforeAnyAwait() async throws {
        let (requests, presentation, runtime, _) = try fixture(), value = try approval()
        requests.apply(.init(connectionID: "c", approvals: [value], questions: []))
        requests.resolve(id: value.id.uuidString, decision: .allowAlways)
        requests.prepareApproval(id: value.id.uuidString)
        try await waitUntil { presentation.approvalConfirmation != nil }
        let confirmation = try XCTUnwrap(presentation.approvalConfirmation)
        let before = await runtime.decisions; XCTAssertTrue(before.isEmpty)
        requests.dismissConfirmation(id: "stale-dialog")
        XCTAssertEqual(presentation.approvalConfirmation?.id, confirmation.id)
        requests.confirmApproval(id: confirmation.id); requests.confirmApproval(id: confirmation.id)
        requests.dismissConfirmation(id: confirmation.id)
        XCTAssertNil(presentation.approvalConfirmation)
        try await waitUntil { await runtime.decisions.count == 1 }
        let decisions = await runtime.decisions
        XCTAssertEqual(decisions[0].0, value.reference); XCTAssertEqual(decisions[0].1, .allowAlways)
        XCTAssertEqual(decisions[0].2?.reference, value.reference)
    }

    @MainActor func testReplacementReviewInvalidatesOldDialogWithoutRetargetingIt() async throws {
        let (requests, presentation, runtime, _) = try fixture(), old = try approval(), replacement = try approval(command: "git diff")
        requests.apply(.init(connectionID: "c", approvals: [old], questions: []))
        requests.prepareApproval(id: old.id.uuidString)
        try await waitUntil { presentation.approvalConfirmation != nil }
        let dialog = try XCTUnwrap(presentation.approvalConfirmation)
        requests.apply(.init(connectionID: "c", approvals: [replacement], questions: []))
        XCTAssertNil(presentation.approvalConfirmation)
        requests.confirmApproval(id: dialog.id); requests.resolve(id: old.id.uuidString, decision: .allowOnce)
        await Task.yield()
        let decisions = await runtime.decisions; XCTAssertTrue(decisions.isEmpty)
        XCTAssertEqual(requests.messages(for: route).count, 1)
        guard case let .approval(card) = requests.messages(for: route)[0].content[0] else { return XCTFail("Missing review") }
        XCTAssertEqual(card.command, "git diff"); XCTAssertTrue(card.canResolve)
    }

    @MainActor func testDisconnectedQuestionKeepsEditingWithoutOldAuthorityAndFreshOptionsAreValueScoped() async throws {
        let (requests, presentation, runtime, _) = try fixture(), old = try question(kind: "select")
        requests.apply(.init(connectionID: "c", approvals: [], questions: [old]))
        let response = QuestionResponse(fields: ["value": .init(selectedOptionIDs: ["Two"])])
        requests.draftChanged(id: old.id.uuidString, response: response)
        requests.invalidate(); requests.answer(id: old.id.uuidString, response: response)
        guard case let .question(held) = requests.messages(for: route)[0].content[0] else { return XCTFail("Lost review") }
        XCTAssertFalse(held.canSubmit); XCTAssertNotNil(held.error)
        XCTAssertEqual(presentation.questionResponses[old.id.uuidString], response)
        requests.update(ready()); let fresh = try question(kind: "select", options: ["Two", "One"])
        requests.apply(.init(connectionID: "c", approvals: [], questions: [fresh]))
        XCTAssertEqual(requests.messages(for: route).count, 1)
        XCTAssertNil(presentation.questionResponses[old.id.uuidString])
        XCTAssertEqual(presentation.questionResponses[fresh.id.uuidString]?.fields["value"]?.selectedOptionIDs, ["Two"])
        let answers = await runtime.answers; XCTAssertTrue(answers.isEmpty)
    }

    @MainActor func testExplicitFalseIsSentOnceAndDismissalHasNoAnswerSideEffect() async throws {
        let (requests, presentation, runtime, _) = try fixture(), value = try question(kind: "confirm")
        requests.apply(.init(connectionID: "c", approvals: [], questions: [value]))
        requests.draftChanged(id: value.id.uuidString, response: .init(confirmed: false))
        XCTAssertEqual(presentation.questionResponses[value.id.uuidString]?.confirmed, false)
        requests.dismissConfirmation(id: "unrelated"); let before = await runtime.answers; XCTAssertTrue(before.isEmpty)
        requests.answer(id: value.id.uuidString, response: .init(confirmed: false))
        requests.answer(id: value.id.uuidString, response: .init(confirmed: true))
        try await waitUntil { await runtime.answers.count == 1 }
        let answers = await runtime.answers; XCTAssertEqual(answers[0].1, .confirmed(false))
        guard case let .question(card) = requests.messages(for: route)[0].content[0] else { return XCTFail("Missing question") }
        XCTAssertEqual(card.submittingAction, .confirm(false))
    }

    @MainActor func testUnknownWriteStaysHeldWithoutSpinnerOrMetadataRetry() async throws {
        let (requests, _, runtime, _) = try fixture(); var value = try question()
        await runtime.setFailure(.init(.timeout, delivery: .uncertain))
        requests.apply(.init(connectionID: "c", approvals: [], questions: [value]))
        requests.answer(id: value.id.uuidString, response: .init(fields: ["value": .init(text: "answer")]))
        try await waitUntil {
            guard case let .question(card) = requests.messages(for: self.route).first?.content.first else { return false }
            return card.error != nil
        }
        value.state = .pending; requests.apply(.init(connectionID: "c", approvals: [], questions: [value]))
        requests.answer(id: value.id.uuidString, response: .init(fields: ["value": .init(text: "retry")]))
        guard case let .question(card) = requests.messages(for: route)[0].content[0] else { return XCTFail("Missing question") }
        XCTAssertFalse(card.canSubmit); XCTAssertFalse(card.isSubmitting); XCTAssertNil(card.submittingAction)
        let answers = await runtime.answers; XCTAssertEqual(answers.count, 1)
    }

    @MainActor func testScopeRetirementBeforeDispatchCannotSendIntoReconnectedSameConnection() async throws {
        let (requests, _, runtime, _) = try fixture(), value = try approval()
        requests.apply(.init(connectionID: "c", approvals: [value], questions: []))
        requests.resolve(id: value.id.uuidString, decision: .allowOnce)
        requests.invalidate(); requests.update(ready())
        await Task.yield(); let decisions = await runtime.decisions; XCTAssertTrue(decisions.isEmpty)
        requests.resolve(id: value.id.uuidString, decision: .deny)
        await Task.yield(); let later = await runtime.decisions; XCTAssertTrue(later.isEmpty)
    }

    @MainActor func testPairingUsesAdvertisedApproveAndPluginNeverExposesActions() async throws {
        let (requests, presentation, runtime, _) = try fixture()
        let pair = try approval(session: nil, kind: "pair"), plugin = try approval(session: nil, kind: "plugin")
        requests.apply(.init(connectionID: "c", approvals: [pair, plugin], questions: []))
        XCTAssertEqual(presentation.connectionApprovals.count, 2)
        XCTAssertEqual(presentation.connectionApprovals[0].visibleDecisions, [.approve, .reject])
        XCTAssertTrue(presentation.connectionApprovals[1].visibleDecisions.isEmpty)
        requests.resolve(id: plugin.id.uuidString, decision: .allowOnce)
        requests.resolve(id: pair.id.uuidString, decision: .allowOnce)
        requests.resolve(id: pair.id.uuidString, decision: .approve)
        try await waitUntil { await runtime.decisions.count == 1 }
        let decisions = await runtime.decisions; XCTAssertEqual(decisions[0].1, .approve)
    }

    @MainActor func testResolutionKeepsReadonlyAnswerAndRetiresOnlyThatScopedDraft() async throws {
        let (requests, presentation, _, drafts) = try fixture(), value = try question()
        requests.apply(.init(connectionID: "c", approvals: [], questions: [value]))
        let response = QuestionResponse(fields: ["value": .init(text: "Exact answer")])
        try await drafts.save(response, key: value.draftKey, revision: 1)
        requests.draftChanged(id: value.id.uuidString, response: response); requests.flushDrafts()
        requests.resolved(reference: value.reference, resolution: .answered)
        XCTAssertEqual(presentation.questionResponses[value.id.uuidString], response)
        guard case let .question(card) = requests.messages(for: route)[0].content[0] else { return XCTFail("Missing receipt") }
        XCTAssertFalse(card.canSubmit); XCTAssertNotNil(card.resolvedLabel)
        try await waitUntil { (try? await drafts.read(key: value.draftKey)) == nil }
    }

    @MainActor func testMissingListDoesNotManufactureApprovalAndConnectionWideHoldIsInert() async throws {
        let (requests, presentation, _, _) = try fixture(), value = try approval(session: nil)
        requests.apply(.init(connectionID: "c", approvals: [value], questions: []))
        requests.apply(.init(connectionID: "c", approvals: [], questions: []))
        XCTAssertEqual(presentation.accountAttentionCount, 1)
        XCTAssertNil(presentation.connectionApprovals[0].outcome); XCTAssertFalse(presentation.connectionApprovals[0].canResolve)
        requests.update(ready("other")); XCTAssertTrue(presentation.connectionApprovals.isEmpty)
    }

    @MainActor func testUnsupportedCapabilitiesAndInvalidAnswersNeverDispatch() async throws {
        let (requests, _, runtime, _) = try fixture(), value = try question(kind: "select")
        requests.apply(.init(connectionID: "c", approvals: [], questions: [value]))
        requests.answer(id: value.id.uuidString, response: .init(fields: ["value": .init(selectedOptionIDs: ["forged"])]))
        requests.update(.init(connectionID: "c", phase: .ready))
        requests.answer(id: value.id.uuidString, response: .init(fields: ["value": .init(selectedOptionIDs: ["One"])]))
        await Task.yield(); let answers = await runtime.answers; XCTAssertTrue(answers.isEmpty)
    }
}
