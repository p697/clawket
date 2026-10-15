import Foundation
import Testing
import ClawketTransport
@testable import ClawketRuntime

// Sanitized shapes mirror agent-protocol descriptors, Hermes run-control, Codex service
// and ClaudeInteractions/Pi extension UI tests. They are protocol tests, not live inference.
func execution(_ id: String = "approval", decisions: [String]? = ["allow-once", "deny"], command: String = "git status") -> JSONValue {
    var value: [String: JSONValue] = ["kind": .string("exec"), "id": .string(id), "command": .string(command), "expiresAtMs": .null]
    if let decisions { value["decisions"] = .array(decisions.map(JSONValue.string)) }
    return .object(value)
}
func inputQuestion(_ id: String = "question", kind: String = "input", expiry: Int64? = nil) -> JSONValue {
    .object(["id": .string(id), "kind": .string(kind), "title": .string("Choose a response"),
             "options": .array([.string("One"), .string("Two")]), "expiresAtMs": expiry.map { .number(Double($0)) } ?? .null])
}
func formQuestion(multi: Bool = false, custom: Bool = true) -> JSONValue {
    .object(["id": .string("form"), "kind": .string("form"), "title": .string("Need input"), "expiresAtMs": .null,
             "fields": .array([.object(["id": .string("q0"), "title": .string("Approach?"), "header": .string("Plan"),
                "allowCustom": .bool(custom), "multiSelect": .bool(multi), "options": .array([
                    .object(["label": .string("One"), "description": .string("First choice")]), .object(["label": .string("Two")])])])])])
}

@Suite(.serialized)
struct ConsentContractTests {
    @Test func exactChoicesDoNotInventAlwaysOrLegacyOptions() throws {
        for backend in [BackendKind.openclaw, .hermes, .codex, .claudeCode] {
            let (_, parsed) = try ConsentWire.approval(execution(decisions: ["allow-once", "allow-always", "deny"]), sessionKey: "s", connection: connection(backend))
            guard case .approval(let approval) = parsed else { Issue.record("Missing approval"); return }
            #expect(approval.decisions.contains(.allowAlways) == [.openclaw, .hermes].contains(backend))
        }
        let (_, missing) = try ConsentWire.approval(execution(decisions: nil), sessionKey: "s", connection: connection(.openclaw))
        guard case .approval(let approval) = missing else { return }
        #expect(approval.decisions.isEmpty)
        let (_, plugin) = try ConsentWire.approval(.object(["kind": .string("plugin"), "id": .string("p"), "pluginId": .string("plugin-id"), "title": .string("Review plugin"), "expiresAtMs": .number(9_007_199_254_740_000)]), sessionKey: nil, connection: connection(.codex))
        guard case .approval(let value) = plugin else { return }
        #expect(value.kind == .plugin); #expect(value.pluginID == "plugin-id"); #expect(value.decisions.isEmpty)
    }

    @Test func questionKindsAndAdvertisedFieldsControlAnswers() throws {
        let (_, parsed) = try ConsentWire.question(formQuestion(multi: true), sessionKey: "s", connection: connection(.claudeCode))
        guard case .question(let question) = parsed else { return }
        #expect(question.fields[0].header == "Plan"); #expect(question.fields[0].options[0].description == "First choice")
        #expect(try ConsentWire.answer(.form(["q0": ["One", "Two"]]), question: question)["answers"]?["q0"]?.array?.count == 2)
        #expect(throws: RuntimeFailure.self) { try ConsentWire.answer(.form(["q0": ["One", "Forged"]]), question: question) }
        #expect(throws: RuntimeFailure.self) { try ConsentWire.answer(.form(["q0": ["One", "One"]]), question: question) }
        #expect(throws: RuntimeFailure.self) { try ConsentWire.answer(.form(["other": ["One"]]), question: question) }
        #expect(try ConsentWire.answer(.form(["q0": ["Custom text"]]), question: question)["answers"] != nil)
        let (_, codex) = try ConsentWire.question(formQuestion(multi: true, custom: false), sessionKey: "s", connection: connection(.codex))
        guard case .question(let single) = codex else { return }
        #expect(!single.fields[0].allowsMultiple)
        #expect(throws: RuntimeFailure.self) { try ConsentWire.answer(.form(["q0": ["One", "Two"]]), question: single) }
        #expect(throws: RuntimeFailure.self) { try ConsentWire.answer(.form(["q0": ["Unknown"]]), question: single) }
    }

    @Test func piConfirmAndSelectionHaveSeparateWireShapes() throws {
        for kind in ["confirm", "select", "input", "editor"] {
            let (_, parsed) = try ConsentWire.question(inputQuestion(kind: kind), sessionKey: "s", connection: connection(.pi))
            guard case .question(let question) = parsed else { return }
            if kind == "confirm" {
                #expect(try ConsentWire.answer(.confirmed(false), question: question) == ["confirmed": .bool(false)])
                #expect(throws: RuntimeFailure.self) { try ConsentWire.answer(.value("One"), question: question) }
            } else {
                #expect(try ConsentWire.answer(.value("One"), question: question) == ["value": .string("One")])
                #expect(throws: RuntimeFailure.self) { try ConsentWire.answer(.confirmed(true), question: question) }
            }
            #expect(try ConsentWire.answer(.cancel, question: question) == ["cancelled": .bool(true)])
            if kind == "select" { #expect(throws: RuntimeFailure.self) { try ConsentWire.answer(.value("Forged"), question: question) } }
        }
    }

    @Test func malformedAndOversizedRequestsFailClosed() throws {
        #expect(throws: RuntimeFailure.self) { try ConsentWire.approval(execution(decisions: ["deny", "deny"]), sessionKey: "s", connection: connection(.hermes)) }
        #expect(throws: RuntimeFailure.self) { try ConsentWire.approval(execution(command: String(repeating: "x", count: 128_001)), sessionKey: "s", connection: connection(.codex)) }
        var form = formQuestion().object!
        var field = form["fields"]!.array![0].object!
        field["id"] = .string("__proto__"); form["fields"] = .array([.object(field)])
        #expect(throws: RuntimeFailure.self) { try ConsentWire.question(.object(form), sessionKey: "s", connection: connection(.codex)) }
        var bad = inputQuestion().object!; bad["expiresAtMs"] = .number(-1)
        #expect(throws: RuntimeFailure.self) { try ConsentWire.question(.object(bad), sessionKey: "s", connection: connection(.pi)) }
    }

    @Test func draftKeysStayStableWithoutGrantingActionAuthority() throws {
        let (_, first) = try ConsentWire.question(inputQuestion(), sessionKey: "s", connection: connection(.pi))
        var updated = inputQuestion().object!; updated["title"] = .string("Updated question wording")
        let (_, second) = try ConsentWire.question(.object(updated), sessionKey: "s", connection: connection(.pi))
        let (_, other) = try ConsentWire.question(inputQuestion(), sessionKey: "other", connection: connection(.pi))
        guard case .question(let a) = first, case .question(let b) = second, case .question(let c) = other else { return }
        #expect(a.reference != b.reference); #expect(a.draftKey == b.draftKey)
        #expect(a.draftKey != c.draftKey); #expect(a.draftKey.count == 64)
        #expect(!a.draftKey.contains("question")); #expect(b.title == "Updated question wording")
    }

    @Test func canonicalWorkKeepsLineageProducerClocksAndUnknownStatus() throws {
        var mapper = SessionEvents()
        let raw: JSONValue = .object(["type": .string("tool_call_update"), "sessionKey": .string("s"), "runId": .string("r"),
            "toolCallId": .string("tool"), "status": .string("unknown"), "turnId": .string("turn"),
            "inputMessageId": .string("input-id"), "inputMessageKey": .string("key"),
            "startedAtMs": .number(1_000), "finishedAtMs": .number(1_050), "durationMs": .number(50),
            "rawOutput": .object(["text": .string("actual output")])])
        let updates = try mapper.map(event("codex.update", raw), connection: connection(.codex))
        guard case .work(let work) = updates[0] else { Issue.record("Missing work metadata"); return }
        #expect(work.kind == .toolUpdate); #expect(work.status == .unknown); #expect(work.itemID == "tool")
        #expect(work.inputMessageID == "input-id"); #expect(work.inputMessageKey == "key"); #expect(work.turnID == "turn")
        #expect(work.durationMs == 50); #expect(work.rawOutput == raw["rawOutput"]); #expect(work.raw == raw)
        let commentary = try mapper.map(event("codex.update", .object(["type": .string("agent_commentary_chunk"),
            "sessionKey": .string("s"), "runId": .string("r"), "itemId": .string("paragraph"), "text": .string("Work note")])), connection: connection(.codex))
        guard case .work(let note) = commentary[0] else { return }
        #expect(note.kind == .commentary); #expect(note.itemID == "paragraph"); #expect(note.text == "Work note")
        #expect(try mapper.map(event("codex.update", .object(["type": .string("compaction"), "sessionKey": .string("s"), "phase": .string("start")])), connection: connection(.codex)).count == 1)
    }
}
