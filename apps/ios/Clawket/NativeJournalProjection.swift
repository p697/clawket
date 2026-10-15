import ClawketRuntime
import ClawketTransport
import ClawketUI
import Foundation

enum NativeJournalProjection {
    static func clock(_ value: NativeWorkClock) -> WorkClockPresentation {
        // Backend clocks stay separate from phone observations. Do not combine clock domains.
        .init(startedAt: value.startedAtMs.map { Date(timeIntervalSince1970: Double($0) / 1_000) },
              finishedAt: value.finishedAtMs.map { Date(timeIntervalSince1970: Double($0) / 1_000) },
              durationMilliseconds: value.durationMs)
    }

    static func run(_ value: NativeWorkRun) -> WorkRunPresentation {
        .init(id: value.id, order: value.order,
            lineage: .init(runID: value.lineage.runID, turnID: value.lineage.turnID,
                inputMessageID: value.lineage.inputMessageID, inputMessageKey: value.lineage.inputMessageKey),
            inputPreview: value.inputPreview, status: .init(rawValue: value.status.rawValue) ?? .unknown,
            clock: clock(value.clock), steps: value.steps.map(step))
    }

    static func step(_ value: NativeWorkStep) -> WorkStepPresentation {
        var content: [WorkContentSection] = []
        if let input = value.input {
            content.append(.init(id: value.id + ":input", kind: .input, text: text(input),
                availability: .available, canSelectText: true, isComplete: value.inputComplete == true))
        }
        if let output = value.output {
            content.append(.init(id: value.id + ":output", kind: .output, text: text(output),
                availability: .available, canSelectText: true, isComplete: value.outputComplete == true))
        }
        if let text = value.text {
            content.append(.init(id: value.id + ":text", kind: value.kind == .error ? .error : .detail,
                text: text, availability: .available, canSelectText: true, isComplete: value.textComplete))
        }
        return .init(id: value.id, order: value.order, kind: .init(rawValue: value.kind.rawValue) ?? .activity,
            title: value.title ?? value.toolName ?? (value.kind == .tool ? String(localized: "Tools") : String(localized: "Work record")),
            status: .init(rawValue: value.status.rawValue) ?? .unknown,
            clock: clock(value.clock), inspect: .available, content: content)
    }

    static func approval(_ value: RuntimeApproval, outcome: ApprovalPresentation.Outcome? = nil) -> NativeApprovalReview {
        .init(kind: .init(rawValue: value.kind.rawValue) ?? .execution, title: value.title,
            reason: value.reason ?? value.category, command: value.command, cwd: value.cwd, host: value.host,
            displayName: value.displayName, platform: value.platform, pluginID: value.pluginID,
            isNode: value.pairingTarget == .node, expiresAtMs: value.expiresAtMs,
            outcome: outcome.flatMap { .init(rawValue: $0.rawValue) })
    }

    static func question(_ value: RuntimeQuestion, response: QuestionResponse,
                         accepted: Bool = false, expired: Bool = false) -> NativeQuestionReview {
        .init(kind: .init(rawValue: value.kind.rawValue) ?? .form, title: value.title, message: value.message,
            options: value.options, fields: value.fields.map { field in
                .init(id: field.id, title: field.title, header: field.header,
                    options: field.options.map { .init(value: $0.label, detail: $0.description) },
                    allowsMultiple: field.allowsMultiple, allowsCustom: field.allowsCustom)
            }, placeholder: value.placeholder, response: response, responseIsAccepted: accepted, expired: expired)
    }

    static func review(_ record: NativeReviewRecord) -> MessagePresentation {
        let content: MessageContent
        switch record.content {
        case let .approval(value):
            let scope = [value.cwd, value.host, value.displayName, value.platform].compactMap { $0 }.joined(separator: "\n")
            content = .approval(.init(id: record.id, kind: .init(rawValue: value.kind.rawValue) ?? .execution,
                title: value.title ?? value.displayName ?? String(localized: "Approval needed"),
                reason: value.reason, command: value.command, scope: scope.isEmpty ? nil : scope,
                symbol: value.kind == .pairing ? (value.isNode ? "desktopcomputer" : "iphone") : "hand.raised",
                decisions: [], outcome: value.outcome.flatMap { .init(rawValue: $0.rawValue) },
                error: record.held ? unavailable : nil,
                expiryLabel: value.expiresAtMs.map { Date(timeIntervalSince1970: Double($0) / 1_000).formatted(.dateTime.month().day().hour().minute()) },
                canResolve: false))
        case let .question(value):
            let fields: [QuestionField]
            switch value.kind {
            case .confirm: fields = []
            case .input, .editor: fields = [.init(id: "value", title: value.title, allowsCustom: true, placeholder: value.placeholder, isRequired: false)]
            case .select: fields = [.init(id: "value", title: value.title, options: value.options.map { .init(id: $0, label: $0) })]
            case .form: fields = value.fields.map { field in
                .init(id: field.id, title: field.title,
                    options: field.options.map { .init(id: $0.value, label: $0.value, detail: $0.detail) },
                    allowsMultiple: field.allowsMultiple, allowsCustom: field.allowsCustom, isRequired: true, header: field.header)
            }
            }
            content = .question(.init(id: record.id, title: value.title, detail: value.message, fields: fields,
                resolvedLabel: value.responseIsAccepted ? String(localized: "Answer sent")
                    : value.expired ? String(localized: "Expired") : record.held ? nil : unavailable,
                error: record.held ? unavailable : nil, canSubmit: false,
                kind: .init(rawValue: value.kind.rawValue) ?? .form, canCancel: false,
                canEdit: false, responseIsAccepted: value.responseIsAccepted))
        }
        return .init(id: "review-" + record.id, author: .system, content: [content])
    }

    static var unavailable: String { String(localized: "This request is no longer available.") }
    private static func text(_ value: JSONValue) -> String {
        if case let .string(text) = value { return text }
        return (try? FrameCodec.encode(value)) ?? ""
    }
}
