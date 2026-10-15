import ClawketRuntime
import ClawketUI
import Foundation

enum NativeTaskPresentation {
    static func approval(_ value: RuntimeApproval, available: Bool, submitting: ApprovalDecision?, error: String?) -> ApprovalPresentation {
        let kind: ApprovalPresentation.Kind = switch value.kind {
        case .execution: .execution
        case .plugin: .plugin
        case .pairing: .pairing
        }
        let details = [value.cwd, value.host, value.displayName, value.platform].compactMap { $0 }.filter { !$0.isEmpty }
        return .init(id: value.id.uuidString, kind: kind,
            title: value.title ?? value.displayName ?? String(localized: "Approval needed"),
            reason: value.reason ?? value.category, command: value.command,
            scope: details.isEmpty ? nil : details.joined(separator: "\n"),
            symbol: value.kind == .pairing ? (value.pairingTarget == .node ? "desktopcomputer" : "iphone") : "hand.raised",
            decisions: value.decisions.compactMap { decision($0) },
            submitting: value.state == .uncertain ? nil : submitting, error: error,
            expiryLabel: value.expiresAtMs.map { Date(timeIntervalSince1970: Double($0) / 1_000).formatted(.dateTime.month().day().hour().minute()) },
            canResolve: available && value.state == .pending)
    }

    static func question(_ value: RuntimeQuestion, available: Bool,
                         submitting: QuestionPresentation.Submission?, error: String?) -> QuestionPresentation {
        let kind: QuestionPresentation.Kind = switch value.kind {
        case .select: .select
        case .confirm: .confirm
        case .input: .input
        case .editor: .editor
        case .form: .form
        }
        let fields: [QuestionField]
        switch value.kind {
        case .confirm: fields = []
        case .input, .editor:
            fields = [.init(id: "value", title: value.title, allowsCustom: true,
                placeholder: value.placeholder, isRequired: false)]
        case .select:
            fields = [.init(id: "value", title: value.title,
                options: value.options.map { .init(id: $0, label: $0) })]
        case .form:
            fields = value.fields.map { field in
                .init(id: field.id, title: field.title,
                    options: field.options.map { .init(id: $0.label, label: $0.label, detail: $0.description) },
                    allowsMultiple: field.allowsMultiple, allowsCustom: field.allowsCustom,
                    isRequired: true, header: field.header)
            }
        }
        return .init(id: value.id.uuidString, title: value.title, detail: value.message, fields: fields,
            isSubmitting: value.state != .uncertain && (value.state == .submitting || submitting != nil),
            error: error, canSubmit: available && value.canAnswer && value.state == .pending,
            kind: kind, canCancel: available && value.canAnswer && value.state == .pending,
            submittingAction: value.state == .uncertain ? nil : submitting,
            canEdit: available && value.state == .pending && submitting == nil)
    }

    static func initialResponse(_ value: RuntimeQuestion) -> QuestionResponse {
        if [.input, .editor].contains(value.kind), let text = value.prefill {
            return .init(fields: ["value": .init(text: text)])
        }
        return .init()
    }

    /// Restoring editing data cannot select a new choice merely because its array index moved.
    static func restore(_ draft: QuestionResponse, for question: QuestionPresentation) -> QuestionResponse {
        if question.kind == .confirm { return .init(confirmed: draft.confirmed) }
        var response = QuestionResponse()
        for field in question.fields {
            guard var answer = draft.fields[field.id] else { continue }
            let known = Set(field.options.map(\.id))
            answer.selectedOptionIDs = answer.selectedOptionIDs.filter { known.contains($0) }
            if !field.allowsMultiple { answer.selectedOptionIDs = Array(answer.selectedOptionIDs.prefix(1)) }
            if !field.allowsCustom && !field.options.isEmpty { answer.text = ""; answer.isCustom = false }
            if answer.isCustom { answer.selectedOptionIDs = [] }
            response.fields[field.id] = answer
        }
        return response
    }

    static func decision(_ value: RuntimeApprovalDecision) -> ApprovalDecision? {
        switch value {
        case .allowOnce: .allowOnce
        case .allowAlways: .allowAlways
        case .deny: .deny
        case .approve: .approve
        case .reject: .reject
        }
    }

    static func decision(_ value: ApprovalDecision) -> RuntimeApprovalDecision {
        switch value {
        case .allowOnce: .allowOnce
        case .allowAlways: .allowAlways
        case .deny: .deny
        case .approve: .approve
        case .reject: .reject
        }
    }

    static func byteCount(_ content: MessageContent, response: QuestionResponse?) -> Int {
        func count(_ values: [String?]) -> Int { values.compactMap { $0 }.reduce(0) { $0 + $1.utf8.count } }
        let base: Int
        switch content {
        case let .approval(value): base = count([value.title, value.reason, value.command, value.scope, value.error, value.expiryLabel])
        case let .question(value):
            base = count([value.title, value.detail, value.error, value.resolvedLabel]) + value.fields.reduce(0) { result, field in
                result + count([field.id, field.title, field.header, field.placeholder])
                    + field.options.reduce(0) { $0 + count([$1.id, $1.label, $1.detail]) }
            }
        default: base = 8 * 1_024 * 1_024 + 1
        }
        return base + (response.flatMap { try? JSONEncoder().encode($0).count } ?? 0)
    }
}
