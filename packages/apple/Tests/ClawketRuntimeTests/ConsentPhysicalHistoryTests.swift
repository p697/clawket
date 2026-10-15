import Foundation
import Testing
import ClawketTransport
@testable import ClawketRuntime

func consentHistoryPayload(_ physicalID: String?) -> JSONValue {
    var value: [String: JSONValue] = ["messages": .array([])]
    if let physicalID { value["sessionId"] = .string(physicalID) }
    return .object(value)
}

func loadConsentHistory(_ runtime: RuntimeCoordinator, socket: ScriptSocket, physicalID: String?, key: String = "owned", cursor: String? = nil) async throws -> RuntimeHistory {
    let count = await socket.requests("chat.history").count
    let read = Task { try await runtime.loadSession(key: key, cursor: cursor) }
    try await eventually { await socket.requests("chat.history").count == count + 1 }
    try await socket.reply(await socket.requests("chat.history")[count], payload: consentHistoryPayload(physicalID))
    return try await read.value
}

@Suite(.serialized)
struct ConsentPhysicalHistoryTests {
    @Test(arguments: [BackendKind.openclaw, .hermes, .codex, .claudeCode, .pi])
    func onlyAcceptedPhysicalHeadChangeRetiresCurrentSession(_ backend: BackendKind) async throws {
        let (runtime, socket, reader) = try retirementFixture(backend, held: ["chat.history"])
        try await runtime.activate(connection(backend))
        try await socket.emit(retirementReview(backend, id: "target", session: "owned"))
        try await socket.emit(retirementReview(backend, id: "other", session: "other"))
        try await eventually { (try? await retirementReferences(runtime).count) == 2 }
        let target = try await retirementReferences(runtime).first { $0.sessionKey == "owned" }!
        let other = try await retirementReferences(runtime).first { $0.sessionKey == "other" }!
        let confirmation = [.openclaw, .hermes].contains(backend) ? try await runtime.prepareApprovalConfirmation(target) : nil
        _ = try await loadConsentHistory(runtime, socket: socket, physicalID: nil)
        #expect(try await retirementReferences(runtime).contains(target))
        _ = try await loadConsentHistory(runtime, socket: socket, physicalID: "first-known")
        #expect(try await retirementReferences(runtime).contains(target))
        _ = try await loadConsentHistory(runtime, socket: socket, physicalID: "first-known")
        #expect(try await retirementReferences(runtime).contains(target))
        _ = try await loadConsentHistory(runtime, socket: socket, physicalID: "older-page", cursor: "opaque-page")
        #expect(try await retirementReferences(runtime).contains(target))
        _ = try await loadConsentHistory(runtime, socket: socket, physicalID: "new-physical")
        #expect(try await retirementReferences(runtime) == [other])
        await #expect(throws: RuntimeFailure.self) { try await respondToRetirementReview(runtime, reference: target, backend: backend) }
        if let confirmation {
            await #expect(throws: RuntimeFailure.self) { try await runtime.resolve(target, decision: .allowAlways, confirmation: confirmation) }
        }
        try await socket.emit(retirementReview(backend, id: "target", session: "owned"))
        try await socket.emit(retirementReview(backend, id: "fresh", session: "owned"))
        try await eventually { (try? await retirementReferences(runtime).count) == 2 }
        #expect(try await retirementReferences(runtime).allSatisfy { $0 != target })
        try await respondToRetirementReview(runtime, reference: other, backend: backend)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func olderHeadCannotChangeAuthorityWhileNewerHeadIsWaiting() async throws {
        let (runtime, socket, reader) = try retirementFixture(.codex, held: ["chat.history"])
        try await runtime.activate(connection(.codex))
        _ = try await loadConsentHistory(runtime, socket: socket, physicalID: "current")
        try await socket.emit(retirementReview(.codex, id: "q", session: "owned"))
        try await eventually { (try? await retirementReferences(runtime).count) == 1 }
        let reference = try await retirementReferences(runtime)[0]
        let older = Task { try await runtime.loadSession(key: "owned") }
        try await eventually { await socket.requests("chat.history").count == 2 }
        let newer = Task { try await runtime.loadSession(key: "owned") }
        try await eventually { await runtime.historyPending == 2 }
        try await socket.reply(await socket.requests("chat.history")[1], payload: consentHistoryPayload("stale-head"))
        _ = try await older.value
        #expect(try await retirementReferences(runtime) == [reference])
        try await eventually { await socket.requests("chat.history").count == 3 }
        try await socket.reply(await socket.requests("chat.history")[2], payload: consentHistoryPayload("current"))
        _ = try await newer.value
        #expect(try await retirementReferences(runtime) == [reference])
        await runtime.disconnect(); reader.cancel()
    }

    @Test func physicalChangeInvalidatesAlreadyDispatchedQuestionAndApprovalLists() async throws {
        let (runtime, socket, reader) = try retirementFixture(.codex, held: ["chat.history", "questions.list"])
        try await runtime.activate(connection(.codex))
        _ = try await loadConsentHistory(runtime, socket: socket, physicalID: "before")
        let list = Task { try await runtime.listPending(sessionKey: "owned") }
        try await eventually { await socket.requests("questions.list").count == 1 }
        _ = try await loadConsentHistory(runtime, socket: socket, physicalID: "after")
        try await socket.reply(await socket.requests("questions.list")[0], payload: .array([inputQuestion("old-unobserved")]))
        #expect(try await list.value.questions.isEmpty)
        #expect(await socket.requests("approvals.list").isEmpty)
        #expect(try await retirementReferences(runtime).isEmpty)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func directExportReadDoesNotPublishPhysicalContextChanges() async throws {
        let (runtime, socket, reader) = try retirementFixture(.pi, held: ["chat.history"])
        try await runtime.activate(connection(.pi))
        _ = try await loadConsentHistory(runtime, socket: socket, physicalID: "current")
        try await socket.emit(retirementReview(.pi, id: "q", session: "owned"))
        try await eventually { (try? await retirementReferences(runtime).count) == 1 }
        let reference = try await retirementReferences(runtime)[0]
        let scope = try await runtime.scope()
        let exported = Task { try await runtime.readHistory(key: "owned", limit: 1_000, cursor: nil, scope: scope) }
        try await eventually { await socket.requests("chat.history").count == 2 }
        try await socket.reply(await socket.requests("chat.history")[1], payload: consentHistoryPayload("archive-other-physical"))
        #expect(try await exported.value.sessionID == "archive-other-physical")
        #expect(try await retirementReferences(runtime) == [reference])
        _ = try await loadConsentHistory(runtime, socket: socket, physicalID: "current")
        #expect(try await retirementReferences(runtime) == [reference])
        await runtime.disconnect(); reader.cancel()
    }

    @Test func opaqueRouteAndPhysicalIdentityUseExactUTF8() async throws {
        let (runtime, socket, reader) = try retirementFixture(.pi, held: ["chat.history"])
        try await runtime.activate(connection(.pi))
        let composed = "caf\u{00e9}", decomposed = "cafe\u{0301}"
        try await socket.emit(retirementReview(.pi, id: "same-id", session: composed))
        try await socket.emit(retirementReview(.pi, id: "same-id", session: decomposed))
        try await eventually { (try? await retirementReferences(runtime).count) == 2 }
        let original = try await retirementReferences(runtime).first { $0.sessionKey?.utf8.elementsEqual(composed.utf8) == true }!
        let other = try await retirementReferences(runtime).first { $0.sessionKey?.utf8.elementsEqual(decomposed.utf8) == true }!
        _ = try await loadConsentHistory(runtime, socket: socket, physicalID: composed, key: composed)
        _ = try await loadConsentHistory(runtime, socket: socket, physicalID: decomposed, key: composed)
        #expect(try await retirementReferences(runtime) == [other])
        await #expect(throws: RuntimeFailure.self) { try await runtime.answer(original, answer: .value("One")) }
        try await runtime.answer(other, answer: .value("One"))
        #expect(await socket.requests("questions.respond")[0]["params"]?["sessionKey"]?.stringValue?.utf8.elementsEqual(decomposed.utf8) == true)
        await runtime.disconnect(); reader.cancel()
    }
}
