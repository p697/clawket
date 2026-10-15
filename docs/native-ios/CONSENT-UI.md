# Native consent presentation

`ClawketUI` owns rendering and pure answer validation. It has no dependency on `ClawketRuntime` and never creates a wire request, runtime reference, confirmation token or backend capability. The app host maps each host-wide presentation ID to the exact current runtime request generation. The production host keeps request actions unavailable until its real binding exists.

## Approval confirmation

`ApprovalPresentation.decisions` defaults to an empty list; `canResolve` defaults to false. The host supplies implemented decisions and enables actions only while the captured request is pending. Unknown delivery disables actions without inventing a submitting decision. Only the pressed action spins. Pairing uses `approve`/`reject` and `approved`/`rejected`; execution uses `allowOnce`/`allowAlways`/`deny`. Plugin actions remain hidden because none of the current adapters implements their resolver.

The Always menu emits `prepareApprovalConfirmation(approvalID:)`. The host must obtain a runtime confirmation token **before** publishing `approvalConfirmation: ApprovalConfirmationPresentation`. Its immutable unique ID identifies the host's frozen reference/token tuple; its title/detail are already prepared presentation text. The matching approval card presents the system dialog inside its own view hierarchy, including when the card lives in the connection-approval sheet. A separate presenter keyed by the confirmation ID prevents an existing dialog from retargeting a replacement review.

The dialog emits `confirmApproval(confirmationID:)`, never an updated card's approval ID. Ordinary dismissal emits only `dismissApprovalConfirmation(confirmationID:)`. Its notification is deferred to the next main-actor turn so automatic system dismissal cannot clear a snapshot before the explicit button action consumes it. The host must synchronously clear the presentation when confirmation starts, make later dismissal idempotent, and ignore stale IDs when a newer confirmation exists. Clear it on review replacement, expiry, disconnect and scope changes. Runtime validation of the original reference/token remains mandatory.

## Question drafts and answers

`questionDraftChanged(questionID:response:)` is the only view event for draft edits. The host updates `questionResponses` synchronously, then persists its scoped draft asynchronously. `QuestionResponse` and `QuestionFieldAnswer` are Codable draft values; request references and approval confirmations are not persisted. Views do not write the draft store, submit on selection, or perform any answer/cancellation on disappearance. Stable field IDs preserve native input identity. Option IDs must represent their actual value, not an array position that could select a different label after restore. A custom answer is an explicit alternative to listed selections, even in a multiple-choice field; switching to it clears the listed selections, and selecting an option leaves custom mode.

| Kind | Presentation fields and response | Validation |
| --- | --- | --- |
| `select` | Exactly one field with actual options; response contains one option ID. | Only a listed option is valid. Selection never submits automatically. |
| `confirm` | No fields; `QuestionResponse.confirmed` holds the explicit Boolean. | False is a valid answer, distinct from cancellation. |
| `input` | Exactly one text field; response uses that field's text. | Empty and whitespace values are valid and preserved exactly, matching Mobile. |
| `editor` | Exactly one native multiline editor; response uses that field's text. | Same value semantics as input, with a larger native editing area. |
| `form` | Native field IDs, titles/headers, described choices and advertised multiple/custom flags. | Required fields need nonempty trimmed values; known option IDs and unique values; single selection unless advertised multiple; one custom answer only when allowed, never mixed with listed choices. |

All current runtime form fields are required; the host must map `isRequired=true`. The host also retains the runtime's Codex single-selection downgrade. `canSubmit` and `canCancel` are independent capabilities and default cancellation remains unavailable. Only an explicit cancel button emits `cancelQuestion`; a form uses the existing Stop task wording. A cancel acknowledgement does not manufacture resolution. The host supplies `submittingAction` for the exact answer/confirmation/cancel button that is pending; uncertain delivery must not become a spinner or a retry.

`QuestionResponseValidator.validate` returns backend-neutral `ValidatedQuestionAnswer.value`, `.confirmed` or `.form` values and typed failures. It preserves exact submitted text, bounds it to 64,000 UTF-16 units without truncating marked text, rejects unknown fields/options, duplicate selections, invalid definitions, mixed custom/listed answers and incompatible response kinds. The host may use this result for its runtime mapping, but must still revalidate the actual request reference, generation, expiry, state and capabilities immediately before dispatch. Current server rules remain the final boundary.

## Evidence

The focused `QuestionValidationTests.swift` contains ten tests (including parameterized input/editor cases) for draft encoding, invalid/restored selections, required answers, multiple/custom semantics, custom-only fields, exact empty/whitespace values, the UTF-16 boundary, explicit false, fail-closed approval choices and Always preparation. All ten actual UI sources typecheck for Swift 6/iOS 16.4. No local simulator or phone was started for this task; native CI builds the real app, runs its tests and checks the compiled 19-language catalogs. Actual host request binding and device consent interaction remain separate acceptance work.
