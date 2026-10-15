import ClawketRuntime
import ClawketTransport
import ClawketUI
import Foundation

protocol NativeTaskRuntime: Sendable {
    func listPending(sessionKey: String?) async throws -> RuntimePendingRequests
    func prepareApprovalConfirmation(_ reference: RuntimeRequestReference) async throws -> RuntimeApprovalConfirmation
    func resolve(_ reference: RuntimeRequestReference, decision: RuntimeApprovalDecision,
                 confirmation: RuntimeApprovalConfirmation?) async throws
    func answer(_ reference: RuntimeRequestReference, answer: RuntimeQuestionAnswer) async throws
}
extension RuntimeCoordinator: NativeTaskRuntime {}

/// Owns ephemeral request authority and local editing. Views never resolve a wire ID themselves.
@MainActor
final class NativeTaskRequests {
    private struct Confirmation {
        let id: String
        let reference: RuntimeRequestReference
        let token: RuntimeApprovalConfirmation
        let scope: UUID
    }
    private enum Submission {
        case approval(ApprovalDecision), question(QuestionPresentation.Submission)
    }
    private struct Receipt {
        let connectionID: String
        let sessionKey: String?
        let key: String
        let held: Bool
        let message: MessagePresentation
        let bytes: Int
    }
    private let presentation: ClientPresentation
    private let runtime: any NativeTaskRuntime
    private let drafts: NativeQuestionDraftStore
    private let journal: NativeTaskJournal?
    private let onChange: @MainActor () -> Void
    private let onStorageFailure: @MainActor () -> Void
    private var connectionID: String?
    private var ready = false
    private var capabilities = RuntimeCapabilities()
    private var scope = UUID()
    private var preparing = UUID()
    private var confirmation: Confirmation?
    private var approvals: [String: RuntimeApproval] = [:]
    private var questions: [String: RuntimeQuestion] = [:]
    private var order: [String] = []
    private var submissions: [String: Submission] = [:]
    private var acceptedAnswers: Set<String> = []
    private var blocked: Set<String> = []
    private var errors: [String: String] = [:]
    private var draftRevision: UInt64 = 0
    private var inputRevisions: [String: UInt64] = [:]
    private var saveTasks: [String: Task<Void, Never>] = [:]
    private var saveTokens: [String: UUID] = [:]
    private var receipts: [Receipt] = []

    init(presentation: ClientPresentation, runtime: any NativeTaskRuntime,
         drafts: NativeQuestionDraftStore, onChange: @escaping @MainActor () -> Void,
         onStorageFailure: @escaping @MainActor () -> Void, journal: NativeTaskJournal? = nil) {
        self.presentation = presentation; self.runtime = runtime; self.drafts = drafts
        self.onChange = onChange; self.onStorageFailure = onStorageFailure
        self.journal = journal
        if let journal {
            for record in journal.reviews {
                let message = NativeJournalProjection.review(record)
                let response: QuestionResponse?
                if case let .question(value) = record.content { response = value.response; presentation.questionResponses[record.id] = value.response }
                else { response = nil }
                receipts.append(.init(connectionID: record.connectionID, sessionKey: record.sessionID,
                    key: record.correlationKey, held: record.held, message: message,
                    bytes: message.content.first.map { NativeTaskPresentation.byteCount($0, response: response) } ?? 0))
            }
        }
    }

    func invalidate() {
        flushDrafts()
        ready = false; scope = UUID(); clearConfirmation()
        holdCurrentReviews()
        approvals = [:]; questions = [:]; order = []; submissions = [:]; acceptedAnswers = []; blocked = []; errors = [:]; inputRevisions = [:]
        pruneResponses()
        // Immutable local draft saves and inert review copies survive disconnect, without authority.
        publish()
    }

    func update(_ state: RuntimeConnectionState) {
        if connectionID != state.connectionID || ready && state.phase != .ready { invalidate() }
        connectionID = state.connectionID; ready = state.phase == .ready; capabilities = state.capabilities
        publish()
    }

    func refresh(route: ConversationID? = nil) {
        guard ready, route == nil || route?.connectionID == connectionID else { return }
        let captured = scope, runtime = runtime
        Task {
            guard captured == scope, ready else { return }
            do {
                let snapshot = try await runtime.listPending(sessionKey: route?.sessionID)
                guard captured == scope, ready else { return }
                apply(snapshot)
            } catch { /* Safe optional discovery does not replace connection-health evidence. */ }
        }
    }

    func apply(_ snapshot: RuntimePendingRequests) {
        guard ready, snapshot.connectionID == connectionID else { return }
        let references = snapshot.approvals.map(\.reference) + snapshot.questions.map(\.reference)
        let reviewKeys = snapshot.approvals.map(\.reviewKey) + snapshot.questions.map(\.draftKey)
        guard references.count <= 256, Set(references.map(\.id)).count == references.count,
              Set(reviewKeys).count == reviewKeys.count,
              references.allSatisfy({ $0.connectionID == snapshot.connectionID }) else { invalidate(); return }
        let oldQuestions = questions
        var localDrafts: [String: QuestionResponse] = [:]
        for question in oldQuestions.values {
            if let response = presentation.questionResponses[question.id.uuidString] { localDrafts[question.draftKey] = response }
        }
        for receipt in receipts where receipt.held {
            let id = responseID(receipt)
            if let response = presentation.questionResponses[id] { localDrafts[receipt.key] = response }
        }
        // A disappearing entry may be reauthentication or unsupported discovery, not a decision.
        holdCurrentReviews(except: Set(references.map { $0.id.uuidString }))
        approvals = Dictionary(uniqueKeysWithValues: snapshot.approvals.map { ($0.id.uuidString, $0) })
        questions = Dictionary(uniqueKeysWithValues: snapshot.questions.map { ($0.id.uuidString, $0) })
        order = snapshot.approvals.map { $0.id.uuidString } + snapshot.questions.map { $0.id.uuidString }
        let current = Set(order), freshKeys = Set(reviewKeys)
        receipts.removeAll { $0.connectionID == snapshot.connectionID && freshKeys.contains($0.key) }
        submissions = submissions.filter { current.contains($0.key) }
        acceptedAnswers.formIntersection(current)
        blocked.formUnion(snapshot.approvals.filter { $0.state == .uncertain }.map { $0.id.uuidString })
        blocked.formUnion(snapshot.questions.filter { $0.state == .uncertain }.map { $0.id.uuidString })
        blocked = blocked.intersection(current); errors = errors.filter { current.contains($0.key) }
        if let confirmation, approvals[confirmation.reference.id.uuidString]?.reference != confirmation.reference { clearConfirmation() }
        for id in oldQuestions.keys where questions[id] == nil { inputRevisions.removeValue(forKey: id) }
        for (id, question) in questions where oldQuestions[id] == nil {
            if let local = localDrafts[question.draftKey] {
                presentation.questionResponses[id] = NativeTaskPresentation.restore(local, for: present(question))
                continue // An older disk copy must never replace editing retained across a reconnect.
            }
            presentation.questionResponses[id] = NativeTaskPresentation.initialResponse(question)
            let input = inputRevisions[id, default: 0]
            Task {
                do {
                    guard let draft = try await drafts.read(key: question.draftKey),
                          questions[id]?.reference == question.reference, inputRevisions[id, default: 0] == input else { return }
                    presentation.questionResponses[id] = NativeTaskPresentation.restore(draft, for: present(question))
                    saveReview(question)
                } catch {
                    guard questions[id]?.reference == question.reference else { return }
                    errors[id] = String(localized: "Saved data could not be read safely. Reopen Clawket after unlocking this device."); publish()
                }
            }
        }
        for approval in approvals.values { saveReview(approval) }
        for question in questions.values { saveReview(question) }
        pruneResponses(); publish()
    }

    func draftChanged(id: String, response: QuestionResponse) {
        guard let question = questions[id], question.state == .pending, submissions[id] == nil, !blocked.contains(id) else { return }
        presentation.questionResponses[id] = response
        saveReview(question)
        draftRevision += 1; inputRevisions[id] = draftRevision
        saveDraft(response, question: question, revision: draftRevision, immediate: false)
    }

    func flushDrafts() {
        for (id, question) in questions {
            guard let revision = inputRevisions[id], let response = presentation.questionResponses[id] else { continue }
            saveDraft(response, question: question, revision: revision, immediate: true)
        }
    }

    private func saveDraft(_ response: QuestionResponse, question: RuntimeQuestion, revision: UInt64, immediate: Bool) {
        let key = question.draftKey, id = question.id.uuidString
        saveTasks[key]?.cancel()
        let token = UUID(); saveTokens[key] = token
        saveTasks[key] = Task {
            defer {
                if saveTokens[key] == token { saveTasks.removeValue(forKey: key); saveTokens.removeValue(forKey: key) }
            }
            do {
                if !immediate { try await Task.sleep(for: .milliseconds(250)) }
                try Task.checkCancellation()
                try await drafts.save(response, key: key, revision: revision)
            } catch is CancellationError { }
            catch {
                guard questions[id]?.reference == question.reference, inputRevisions[id] == revision else { return }
                errors[id] = String(localized: "This draft could not be saved. Keep Clawket open and try again."); publish()
            }
        }
    }

    func prepareApproval(id: String) {
        guard let approval = approvals[id], canAct(id), present(approval).visibleDecisions.contains(.allowAlways) else { return }
        clearConfirmation(); preparing = UUID()
        let preparation = preparing, captured = scope
        Task {
            do {
                let token = try await runtime.prepareApprovalConfirmation(approval.reference)
                guard preparation == preparing, captured == scope, canAct(id), approvals[id]?.reference == approval.reference else { return }
                let id = UUID().uuidString
                confirmation = .init(id: id, reference: approval.reference, token: token, scope: captured)
                presentation.approvalConfirmation = .init(id: id, approvalID: approval.id.uuidString,
                    title: String(localized: "Always allow this action?"),
                    detail: String(localized: "This permission applies beyond this single request."))
            } catch { fail(error, id: id, scope: captured) }
        }
    }

    func confirmApproval(id: String) {
        guard let saved = confirmation, saved.id == id else { return }
        // Consume synchronously, before any async task or the presenter's deferred dismissal.
        clearConfirmation()
        guard saved.scope == scope, canAct(saved.reference.id.uuidString),
              approvals[saved.reference.id.uuidString]?.reference == saved.reference else { return }
        resolve(id: saved.reference.id.uuidString, decision: .allowAlways, confirmation: saved.token)
    }

    func dismissConfirmation(id: String) {
        guard confirmation?.id == id else { return }
        clearConfirmation()
    }

    func resolve(id: String, decision: ApprovalDecision, confirmation: RuntimeApprovalConfirmation? = nil) {
        guard let approval = approvals[id], canAct(id), present(approval).visibleDecisions.contains(decision),
              decision != .allowAlways || confirmation != nil else { return }
        let captured = scope
        submissions[id] = .approval(decision); errors.removeValue(forKey: id); publish()
        Task {
            guard captured == scope, approvals[id]?.reference == approval.reference, !blocked.contains(id) else { return }
            do { try await runtime.resolve(approval.reference, decision: NativeTaskPresentation.decision(decision), confirmation: confirmation) }
            catch { fail(error, id: id, scope: captured) }
        }
    }

    func answer(id: String, response: QuestionResponse) {
        guard let question = questions[id], canAct(id), present(question).canSubmit,
              let value = try? QuestionResponseValidator.validate(response, for: present(question)) else { return }
        draftChanged(id: id, response: response)
        let answer: RuntimeQuestionAnswer = switch value {
        case let .value(text): .value(text)
        case let .confirmed(value): .confirmed(value)
        case let .form(fields): .form(fields)
        }
        let action: QuestionPresentation.Submission = if case let .confirmed(value) = value { .confirm(value) } else { .answer }
        submit(question, answer: answer, action: action)
    }

    func cancelQuestion(id: String) {
        guard let question = questions[id], canAct(id), present(question).canCancel else { return }
        submit(question, answer: .cancel, action: .cancel)
    }

    func resolved(reference: RuntimeRequestReference, resolution: RuntimeRequestResolution) {
        guard reference.connectionID == connectionID else { return }
        let id = reference.id.uuidString
        if var value = approvals[id].map({ present($0) }) {
            value.decisions = []; value.canResolve = false; value.submitting = nil; value.error = nil
            value.outcome = switch resolution {
            case .decision(.allowOnce), .decision(.allowAlways): .allowed
            case .decision(.deny): .denied
            case .decision(.approve): .approved
            case .decision(.reject): .rejected
            case .expired: .expired
            case .resolved, .answered: nil
            }
            // An external resolution without an exact decision never invents an Allowed receipt.
            if value.outcome == nil { value.error = NativeJournalProjection.unavailable }
            appendReceipt(reference, key: approvals[id]!.reviewKey, content: .approval(value))
            saveReview(approvals[id]!, held: false, outcome: value.outcome)
            approvals.removeValue(forKey: id)
        }
        if let question = questions.removeValue(forKey: id) {
            var value = present(question); value.canSubmit = false; value.canCancel = false
            let sentAnswer = acceptedAnswers.contains(id) && resolution == .answered
            value.canEdit = false; value.responseIsAccepted = sentAnswer
            value.isSubmitting = false; value.submittingAction = nil; value.error = nil
            value.resolvedLabel = sentAnswer ? String(localized: "Answer sent")
                : resolution == .expired ? String(localized: "Expired") : String(localized: "This request is no longer available.")
            saveReview(question, held: false, accepted: sentAnswer, expired: resolution == .expired)
            appendReceipt(reference, key: question.draftKey, content: .question(value))
            draftRevision += 1; let revision = draftRevision
            saveTasks[question.draftKey]?.cancel(); saveTasks.removeValue(forKey: question.draftKey)
            saveTokens.removeValue(forKey: question.draftKey)
            Task {
                do { try await drafts.retire(key: question.draftKey, revision: revision) }
                catch { onStorageFailure() }
            }
        }
        submissions.removeValue(forKey: id); blocked.remove(id); errors.removeValue(forKey: id)
        acceptedAnswers.remove(id)
        inputRevisions.removeValue(forKey: id)
        if confirmation?.reference == reference { clearConfirmation() }
        order.removeAll { $0 == id }; pruneResponses(); publish()
    }

    func messages(for route: ConversationID) -> [MessagePresentation] {
        let completed = receipts.filter { $0.connectionID == route.connectionID && $0.sessionKey == route.sessionID }.map(\.message)
        guard route.connectionID == connectionID else { return completed }
        return completed + order.compactMap { id in
            if let approval = approvals[id], approval.reference.sessionKey == route.sessionID {
                return .init(id: "request-" + id, author: .system, content: [.approval(present(approval))])
            }
            if let question = questions[id], question.reference.sessionKey == route.sessionID {
                return .init(id: "request-" + id, author: .system, content: [.question(present(question))])
            }
            return nil
        }
    }

    func attention(connectionID: String, sessionKeys: Set<String>) -> AgentPresentation.Attention {
        guard ready, connectionID == self.connectionID else { return .none }
        if approvals.values.contains(where: { $0.reference.sessionKey.map(sessionKeys.contains) == true }) { return .approval }
        if questions.values.contains(where: { $0.reference.sessionKey.map(sessionKeys.contains) == true }) { return .input }
        return .none
    }

    private func submit(_ question: RuntimeQuestion, answer: RuntimeQuestionAnswer, action: QuestionPresentation.Submission) {
        let id = question.id.uuidString, captured = scope
        let response = presentation.questionResponses[id] ?? .init()
        submissions[id] = .question(action); errors.removeValue(forKey: id); publish()
        Task {
            guard captured == scope, questions[id]?.reference == question.reference, !blocked.contains(id) else { return }
            do {
                try await runtime.answer(question.reference, answer: answer)
                guard captured == scope, action != .cancel else { return }
                if questions[id]?.reference == question.reference {
                    acceptedAnswers.insert(id)
                } else if receipts.contains(where: { $0.message.id == "request-" + id && $0.key == question.draftKey }) {
                    // The authoritative resolution may arrive before the exact local RPC acknowledgement.
                    // Only that successful acknowledgement can upgrade this frozen response's receipt.
                    presentation.questionResponses[id] = response
                    var value = NativeTaskPresentation.question(question, available: false, submitting: nil, error: nil)
                    value.canEdit = false; value.canCancel = false; value.responseIsAccepted = true
                    value.resolvedLabel = String(localized: "Answer sent")
                    appendReceipt(question.reference, key: question.draftKey, content: .question(value))
                    journal?.upsertReview(key: question.draftKey, connectionID: question.reference.connectionID,
                        sessionID: question.reference.sessionKey, held: false,
                        content: .question(NativeJournalProjection.question(question, response: response, accepted: true)))
                    publish()
                }
            }
            catch { fail(error, id: id, scope: captured) }
        }
    }

    private func canAct(_ id: String) -> Bool {
        guard ready, submissions[id] == nil, !blocked.contains(id) else { return false }
        let now = Int64(Date().timeIntervalSince1970 * 1_000)
        if let approval = approvals[id] {
            return approval.state == .pending && (approval.expiresAtMs.map { $0 > now } ?? true)
                && (approval.kind == .pairing ? capabilities.pairingApprovals : approval.kind == .execution && capabilities.executionApprovals)
        }
        if let question = questions[id] {
            return question.state == .pending && (question.expiresAtMs.map { $0 > now } ?? true) && question.canAnswer && capabilities.questions
        }
        return false
    }

    private func present(_ approval: RuntimeApproval) -> ApprovalPresentation {
        let action: ApprovalDecision? = if case let .approval(value) = submissions[approval.id.uuidString] { value } else { nil }
        return NativeTaskPresentation.approval(approval, available: canAct(approval.id.uuidString), submitting: action,
            error: errors[approval.id.uuidString] ?? (approval.state == .uncertain ? Self.uncertainText : nil))
    }
    private func present(_ question: RuntimeQuestion) -> QuestionPresentation {
        let action: QuestionPresentation.Submission? = if case let .question(value) = submissions[question.id.uuidString] { value } else { nil }
        return NativeTaskPresentation.question(question, available: canAct(question.id.uuidString), submitting: action,
            error: errors[question.id.uuidString] ?? (question.state == .uncertain ? Self.uncertainText : nil))
    }
    private func fail(_ error: Error, id: String, scope captured: UUID) {
        guard captured == scope, approvals[id] != nil || questions[id] != nil else { return }
        submissions.removeValue(forKey: id)
        if let failure = error as? RuntimeFailure, [.uncertain, .responseReceived].contains(failure.delivery) {
            blocked.insert(id); errors[id] = Self.uncertainText
        } else if (error as? RuntimeFailure)?.code == .confirmationRequired {
            errors[id] = String(localized: "The confirmation expired. Review this request again.")
        } else {
            if let failure = error as? RuntimeFailure, [.requestExpired, .requestUnavailable].contains(failure.code) { blocked.insert(id) }
            errors[id] = String(localized: "This request is no longer available.")
        }
        publish()
    }
    private func publish() {
        let reviews: [ApprovalPresentation] = receipts.compactMap { receipt in
            guard receipt.connectionID == connectionID, receipt.sessionKey == nil,
                  case let .approval(value) = receipt.message.content.first else { return nil }
            return value
        }
        let live: [ApprovalPresentation] = order.compactMap { id in
            guard let approval = approvals[id], approval.reference.sessionKey == nil else { return nil }
            return present(approval)
        }
        presentation.connectionApprovals = reviews + live
        presentation.accountAttentionCount = receipts.filter { $0.held && $0.connectionID == connectionID && $0.sessionKey == nil }.count + live.count
        onChange()
    }
    private func clearConfirmation() {
        preparing = UUID(); confirmation = nil; presentation.approvalConfirmation = nil
    }
    private func holdCurrentReviews(except preserved: Set<String> = []) {
        for id in order where !preserved.contains(id) {
            if let approval = approvals[id] {
                var value = present(approval); value.canResolve = false; value.submitting = nil
                value.error = Self.uncertainText
                appendReceipt(approval.reference, key: approval.reviewKey, content: .approval(value), held: true)
                saveReview(approval)
            }
            if let question = questions[id] {
                var value = present(question); value.canSubmit = false; value.canCancel = false
                value.canEdit = false
                value.isSubmitting = false; value.submittingAction = nil; value.error = Self.uncertainText
                appendReceipt(question.reference, key: question.draftKey, content: .question(value), held: true)
                saveReview(question)
            }
        }
    }

    private func appendReceipt(_ reference: RuntimeRequestReference, key: String, content: MessageContent, held: Bool = false) {
        let id = "request-" + reference.id.uuidString
        receipts.removeAll { $0.message.id == id || $0.key == key && $0.connectionID == reference.connectionID }
        // These bounded review copies contain presentation data, never runtime action references.
        let bytes = NativeTaskPresentation.byteCount(content, response: presentation.questionResponses[reference.id.uuidString])
        receipts.append(.init(connectionID: reference.connectionID, sessionKey: reference.sessionKey, key: key, held: held,
            message: .init(id: id, author: .system, content: [content]), bytes: bytes))
        while receipts.count > 32 || receipts.reduce(0, { $0 + $1.bytes }) > 8 * 1_024 * 1_024 { receipts.removeFirst() }
    }

    private func pruneResponses() {
        let retained = Set(questions.keys).union(receipts.map(responseID))
        presentation.questionResponses = presentation.questionResponses.filter { retained.contains($0.key) }
    }
    private func responseID(_ receipt: Receipt) -> String {
        if case let .question(value) = receipt.message.content.first { return value.id }
        return ""
    }
    private func saveReview(_ value: RuntimeApproval, held: Bool = true, outcome: ApprovalPresentation.Outcome? = nil) {
        journal?.upsertReview(key: value.reviewKey, connectionID: value.reference.connectionID,
            sessionID: value.reference.sessionKey, held: held,
            content: .approval(NativeJournalProjection.approval(value, outcome: outcome)))
    }
    private func saveReview(_ value: RuntimeQuestion, held: Bool = true, accepted: Bool = false, expired: Bool = false) {
        journal?.upsertReview(key: value.draftKey, connectionID: value.reference.connectionID,
            sessionID: value.reference.sessionKey, held: held,
            content: .question(NativeJournalProjection.question(value,
                response: presentation.questionResponses[value.id.uuidString] ?? NativeTaskPresentation.initialResponse(value),
                accepted: accepted, expired: expired)))
    }
    private static var uncertainText: String { String(localized: "The result could not be confirmed. Reconnect to check this request.") }
}
