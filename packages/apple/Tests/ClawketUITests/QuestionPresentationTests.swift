import Testing
@testable import ClawketUI

@Suite(.serialized)
struct QuestionPresentationTests {
    @Test func pressedAnswerOrConfirmationStaysVisibleAfterWireAuthorityIsLocked() {
        var question = QuestionPresentation(id: "q", title: "Question", fields: [], isSubmitting: true,
            canSubmit: false, kind: .input, submittingAction: .answer)
        #expect(question.showsAnswerActions)
        #expect(!question.showsCancelAction)
        #expect(!question.canEditFields)
        question.kind = .confirm; question.submittingAction = .confirm(false)
        #expect(question.showsAnswerActions)
        question.submittingAction = .confirm(true)
        #expect(question.showsAnswerActions)
        question.resolvedLabel = "Resolved"
        #expect(!question.showsAnswerActions)
    }

    @Test func cancellationKeepsOnlyItsOwnSubmissionAndUnknownDoesNotInventAButtonOrSpinner() {
        var question = QuestionPresentation(id: "q", title: "Question", fields: [], isSubmitting: true,
            canSubmit: false, kind: .confirm, canCancel: false, submittingAction: .cancel)
        #expect(question.showsCancelAction)
        #expect(!question.showsAnswerActions)
        question.isSubmitting = false; question.submittingAction = nil
        #expect(!question.showsCancelAction)
        #expect(!question.showsAnswerActions)
        // A generic runtime busy state does not identify an answer the local user pressed.
        question.isSubmitting = true
        #expect(!question.showsAnswerActions)
    }

    @Test func editingPermissionIsIndependentAndCannotReopenBusyOrResolvedFields() {
        var question = QuestionPresentation(id: "q", title: "Question", fields: [])
        #expect(question.canEditFields)
        question.canSubmit = false // Older hosts may disable a copied held review after construction.
        #expect(!question.canEditFields)
        question.canEdit = true
        #expect(question.canEditFields) // Explicit host-owned offline local editing is possible.
        question.submittingAction = .answer
        #expect(!question.canEditFields)
        question.submittingAction = nil; question.isSubmitting = true
        #expect(!question.canEditFields)
        question.isSubmitting = false; question.resolvedLabel = "Expired"
        #expect(!question.canEditFields)
        #expect(!question.responseIsAccepted)
    }

    @Test func readOnlyConfirmationNeverTurnsAnAbsentAnswerIntoNo() {
        let question = QuestionPresentation(id: "q", title: "Confirm", fields: [], canSubmit: false, kind: .confirm)
        #expect(question.readonlyResponse(.init()) == nil)
        #expect(question.readonlyResponse(.init(confirmed: false)) == .confirmation(false))
        #expect(question.readonlyResponse(.init(confirmed: true)) == .confirmation(true))
        #expect(!question.responseIsAccepted)
    }

    @Test func readonlyDraftMapsActualOptionValuesAndPreservesExactCustomTextWithoutClaimingAcceptance() {
        let question = QuestionPresentation(id: "q", title: "Question", fields: [
            .init(id: "choice", title: "Choose", options: [.init(id: "a", label: "First"), .init(id: "b", label: "Second")]),
            .init(id: "custom", title: "Explain", allowsCustom: true, header: "Original context"),
        ], resolvedLabel: "Expired", canSubmit: false)
        let draft = QuestionResponse(fields: [
            "choice": .init(selectedOptionIDs: ["b", "unknown-private-id"]),
            "custom": .init(text: "  日本語 👩🏽‍💻\n", isCustom: true),
            "foreign": .init(text: "Never displayed"),
        ])
        #expect(question.readonlyResponse(draft) == .fields([
            .init(id: "choice", title: "Choose", values: ["Second"]),
            .init(id: "custom", title: "Explain", header: "Original context", values: ["  日本語 👩🏽‍💻\n"]),
        ]))
        #expect(!question.responseIsAccepted)
    }

    @Test func explicitlyAcceptedEmptyInputIsVisibleButUntouchedExpiredDraftStaysAbsent() {
        var question = QuestionPresentation(id: "q", title: "Input", fields: [.init(id: "value", title: "Input")],
            resolvedLabel: "Expired", canSubmit: false, kind: .input)
        #expect(question.readonlyResponse(.init()) == nil)
        question.responseIsAccepted = true
        #expect(question.readonlyResponse(.init()) == .fields([.init(id: "value", title: "Input", values: [""])]))
    }
}
