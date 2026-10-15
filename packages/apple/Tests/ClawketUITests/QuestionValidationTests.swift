import Testing
@testable import ClawketUI

@Suite(.serialized)
struct QuestionValidationTests {
    private func question(_ fields: [QuestionField], kind: QuestionPresentation.Kind = .form) -> QuestionPresentation {
        .init(id: "scoped-request", title: "Question", fields: fields, kind: kind)
    }
    private var choice: QuestionField {
        .init(id: "choice", title: "Choose", options: [.init(id: "a", label: "First"), .init(id: "b", label: "Second")])
    }

    @Test func requiredAndUnknownFieldsCannotBecomeAnAnswer() throws {
        let form = question([choice])
        #expect(throws: QuestionValidationError.requiredAnswerMissing) { try QuestionResponseValidator.validate(.init(), for: form) }
        #expect(throws: QuestionValidationError.unknownField) {
            try QuestionResponseValidator.validate(.init(fields: ["foreign": .init(text: "hidden")]), for: form)
        }
        #expect(throws: QuestionValidationError.unknownOption) {
            try QuestionResponseValidator.validate(.init(fields: ["choice": .init(selectedOptionIDs: ["stale"])]), for: form)
        }
    }

    @Test func singleAndMultipleSelectionsPreserveActualOptionValues() throws {
        let response = QuestionResponse(fields: ["choice": .init(selectedOptionIDs: ["b", "a"])])
        #expect(throws: QuestionValidationError.multipleSelectionNotAllowed) { try QuestionResponseValidator.validate(response, for: question([choice])) }
        var field = choice; field.allowsMultiple = true
        #expect(try QuestionResponseValidator.validate(response, for: question([field])) == .form(["choice": ["Second", "First"]]))
        #expect(throws: QuestionValidationError.duplicateSelection) {
            try QuestionResponseValidator.validate(.init(fields: ["choice": .init(selectedOptionIDs: ["a", "a"])]), for: question([field]))
        }
    }

    @Test func customIsAnExplicitExclusiveAlternativeEvenForMultipleChoice() throws {
        var field = choice; field.allowsCustom = true; field.allowsMultiple = true
        let custom = QuestionResponse(fields: ["choice": .init(text: "  Exact custom\n", isCustom: true)])
        #expect(try QuestionResponseValidator.validate(custom, for: question([field])) == .form(["choice": ["  Exact custom\n"]]))
        #expect(throws: QuestionValidationError.mixedCustomAndSelection) {
            try QuestionResponseValidator.validate(.init(fields: ["choice": .init(selectedOptionIDs: ["a"], text: "custom", isCustom: true)]), for: question([field]))
        }
        field.allowsCustom = false
        #expect(throws: QuestionValidationError.customNotAllowed) { try QuestionResponseValidator.validate(custom, for: question([field])) }
    }

    @Test func customOnlyFieldAcceptsOneValueWithNoListedOptions() throws {
        let field = QuestionField(id: "text", title: "Explain", allowsMultiple: true, allowsCustom: true)
        #expect(try QuestionResponseValidator.validate(.init(fields: ["text": .init(text: "Response", isCustom: true)]), for: question([field])) == .form(["text": ["Response"]]))
        #expect(throws: QuestionValidationError.requiredAnswerMissing) {
            try QuestionResponseValidator.validate(.init(fields: ["text": .init(text: " \n", isCustom: true)]), for: question([field]))
        }
    }

    @Test(arguments: [QuestionPresentation.Kind.input, .editor])
    func freeInputPreservesEmptyAndWhitespaceRatherThanApplyingFormRequiredRules(kind: QuestionPresentation.Kind) throws {
        let prompt = question([.init(id: "value", title: "Input")], kind: kind)
        #expect(try QuestionResponseValidator.validate(.init(), for: prompt) == .value(""))
        #expect(try QuestionResponseValidator.validate(.init(fields: ["value": .init(text: "  unchanged\n")]), for: prompt) == .value("  unchanged\n"))
        #expect(throws: QuestionValidationError.answerTooLong) {
            try QuestionResponseValidator.validate(.init(fields: ["value": .init(text: String(repeating: "😀", count: 32_001))]), for: prompt)
        }
    }

    @Test func explicitFalseConfirmationIsAnAnswerAndNotCancellation() throws {
        let prompt = question([], kind: .confirm)
        #expect(try QuestionResponseValidator.validate(.init(confirmed: false), for: prompt) == .confirmed(false))
        #expect(throws: QuestionValidationError.incompatibleResponse) { try QuestionResponseValidator.validate(.init(), for: prompt) }
        #expect(throws: QuestionValidationError.incompatibleResponse) {
            try QuestionResponseValidator.validate(.init(confirmed: true), for: question([choice]))
        }
    }

    @Test func selectNeverAcceptsCustomOrMultipleAndMalformedDefinitionsFail() throws {
        let prompt = question([choice], kind: .select)
        #expect(try QuestionResponseValidator.validate(.init(fields: ["choice": .init(selectedOptionIDs: ["b"])]), for: prompt) == .value("Second"))
        #expect(throws: QuestionValidationError.customNotAllowed) {
            try QuestionResponseValidator.validate(.init(fields: ["choice": .init(text: "First", isCustom: true)]), for: prompt)
        }
        #expect(throws: QuestionValidationError.invalidDefinition) { try QuestionResponseValidator.validate(.init(), for: question([choice, choice])) }
    }

    @Test func pairingDecisionsCannotBorrowExecutionAuthority() {
        #expect(ApprovalPresentation(id: "pair", kind: .pairing, title: "Pair").visibleDecisions.isEmpty)
        #expect(ApprovalPresentation(id: "pair", kind: .pairing, title: "Pair", decisions: [.reject, .approve]).visibleDecisions == [.reject, .approve])
        #expect(ApprovalPresentation(id: "pair", kind: .pairing, title: "Pair", decisions: [.allowAlways, .allowOnce, .deny]).visibleDecisions.isEmpty)
        #expect(ApprovalPresentation(id: "exec", title: "Execute", decisions: [.approve, .reject]).visibleDecisions.isEmpty)
        #expect(ApprovalPresentation(id: "plugin", kind: .plugin, title: "Plugin", decisions: [.allowOnce, .deny], canResolve: true).visibleDecisions.isEmpty)
    }

    @Test func alwaysOnlyPreparesAndAnUncertainOrBusyReviewCannotEmitActions() {
        var approval = ApprovalPresentation(id: "frozen-review", title: "Execute", decisions: [.allowAlways, .allowOnce], canResolve: true)
        if case let .prepareApprovalConfirmation(id)? = approval.intent(for: .allowAlways) { #expect(id == "frozen-review") }
        else { Issue.record("Always must prepare host confirmation before any resolution") }
        approval.canResolve = false
        #expect(approval.intent(for: .allowOnce) == nil)
        approval.canResolve = true; approval.submitting = .allowOnce
        #expect(approval.intent(for: .allowAlways) == nil)
    }
}
