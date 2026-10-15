#if os(iOS)
import SwiftUI
import UIKit

@MainActor
struct NativeMessageRow: View {
    let message: MessagePresentation
    let conversationID: ConversationID
    @ObservedObject var model: ClientPresentation
    let onIntent: @MainActor (ClientIntent) -> Void
    let onReadingInteraction: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            if message.author.isLocal { Spacer(minLength: 36) }
            VStack(alignment: .leading, spacing: 10) {
                author
                ForEach(Array(message.content.enumerated()), id: \.offset) { index, content in
                    contentView(content, id: "\(message.id)-\(index)")
                }
                if message.isStreaming {
                    HStack(spacing: 7) {
                        ProgressView().controlSize(.small)
                        Text("Responding…").font(.caption).foregroundStyle(.secondary)
                    }.accessibilityElement(children: .combine)
                }
                delivery
            }
            .padding(message.author.isLocal ? 14 : 0)
            .background {
                if message.author.isLocal {
                    RoundedRectangle(cornerRadius: 23, style: .continuous)
                        .fill(Color(uiColor: .secondarySystemBackground))
                }
            }
            .frame(maxWidth: message.author.isLocal ? 650 : .infinity, alignment: .leading)
            if !message.author.isLocal { Spacer(minLength: 0) }
        }
        .frame(maxWidth: 760)
        .frame(maxWidth: .infinity)
        .contextMenu {
            ForEach(message.actions, id: \.self) { action in
                Button(role: action == .remove ? .destructive : nil) {
                    onReadingInteraction()
                    onIntent(.messageAction(conversationID, messageID: message.id, action: action))
                } label: { Label(action.title, systemImage: action.symbol) }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("message-\(message.id)")
    }

    @ViewBuilder private var author: some View {
        switch message.author {
        case let .participant(name, channel):
            HStack(spacing: 6) {
                Text(name).font(.caption.weight(.semibold))
                if let channel { Text(channel).font(.caption).foregroundStyle(.secondary) }
            }
        case let .agent(name, label):
            if let label {
                HStack(spacing: 6) {
                    Text(name).font(.caption.weight(.semibold))
                    Text(label).font(.caption2.weight(.medium)).padding(.horizontal, 5).padding(.vertical, 2)
                        .background(Color(uiColor: .secondarySystemBackground), in: Capsule())
                }
            }
        case .local, .system: EmptyView()
        }
    }

    @ViewBuilder
    private func contentView(_ content: MessageContent, id: String) -> some View {
        switch content {
        case let .markdown(text):
            SelectableMessageText(text: text, onURL: { onIntent(.openURL($0)) }, onReadingInteraction: onReadingInteraction)
        case let .code(language, text):
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text(language ?? "Code").font(.caption.weight(.medium)).foregroundStyle(.secondary)
                    Spacer()
                    Button {
                        UIPasteboard.general.string = text
                    } label: { Label("Copy", systemImage: "doc.on.doc").font(.caption).frame(minHeight: 44) }
                    .accessibilityLabel("Copy code")
                }
                SelectableMessageText(text: text, monospaced: true, onURL: { onIntent(.openURL($0)) }, onReadingInteraction: onReadingInteraction)
            }
            .padding(14)
            .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        case let .attachment(attachment):
            MessageAttachmentView(attachment: attachment) { onIntent(.openAttachment(attachmentID: attachment.id)) }
        case let .work(work):
            WorkContentView(work: work, expanded: expansion(id), onURL: { onIntent(.openURL($0)) }, onReadingInteraction: onReadingInteraction)
        case let .approval(approval):
            ApprovalContentView(approval: approval, model: model, onIntent: onIntent, onReadingInteraction: onReadingInteraction)
        case let .question(question):
            QuestionContentView(question: question, model: model, onIntent: onIntent, onReadingInteraction: onReadingInteraction)
        case let .notice(text):
            Label(text, systemImage: "info.circle").font(.footnote).foregroundStyle(.secondary)
        }
    }

    private func expansion(_ id: String) -> Binding<Bool> {
        Binding(get: { model.expandedContentIDs.contains(id) }, set: { value in
            onReadingInteraction()
            if value { model.expandedContentIDs.insert(id) } else { model.expandedContentIDs.remove(id) }
        })
    }

    @ViewBuilder private var delivery: some View {
        if let delivery = message.delivery {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Image(systemName: delivery.symbol)
                Text(delivery.label).fixedSize(horizontal: false, vertical: true)
                if let time = message.timeLabel { Text(time).foregroundStyle(.tertiary) }
            }
            .font(.caption)
            .foregroundStyle(delivery.isWarning ? Color.orange : Color.secondary)
            .accessibilityElement(children: .combine)
        } else if let time = message.timeLabel {
            Text(time).font(.caption).foregroundStyle(.tertiary)
        }
    }
}

@MainActor
private struct MessageAttachmentView: View {
    let attachment: AttachmentPresentation
    let onOpen: () -> Void
    var body: some View {
        Group {
            if attachment.canOpen { Button(action: onOpen) { content }.buttonStyle(.plain) }
            else { content }
        }
        .accessibilityLabel([attachment.name, attachment.detail].compactMap { $0 }.joined(separator: ", "))
    }
    @ViewBuilder private var content: some View {
        if attachment.kind == .image, let data = attachment.thumbnailData, let image = UIImage(data: data) {
            Image(uiImage: image).resizable().scaledToFit()
                .frame(maxWidth: 420, maxHeight: 420)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        } else {
            HStack(spacing: 12) {
                Image(systemName: attachment.kind == .image ? "photo" : attachment.kind == .audio ? "waveform" : "doc")
                    .font(.title2).foregroundStyle(.secondary).frame(width: 40, height: 48)
                VStack(alignment: .leading, spacing: 4) {
                    Text(attachment.name).font(.subheadline.weight(.medium)).foregroundStyle(.primary)
                    if let detail = attachment.detail { Text(detail).font(.caption).foregroundStyle(.secondary) }
                    if case let .failed(reason) = attachment.phase { Text(reason).font(.caption).foregroundStyle(.orange) }
                }
                Spacer(minLength: 0)
                if attachment.phase == .preparing { ProgressView() }
                else if attachment.canOpen { Image(systemName: "arrow.up.right").font(.caption).foregroundStyle(.secondary) }
            }
            .padding(12)
            .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }
}

@MainActor
private struct WorkContentView: View {
    let work: WorkPresentation
    @Binding var expanded: Bool
    let onURL: (URL) -> Void
    let onReadingInteraction: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let output = work.output, !output.isEmpty {
                DisclosureGroup(isExpanded: $expanded) {
                    SelectableMessageText(text: output, monospaced: true, onURL: onURL, onReadingInteraction: onReadingInteraction)
                        .padding(.top, 8)
                } label: { label }
            } else { label }
        }
        .padding(14)
        .background(Color(uiColor: .secondarySystemBackground).opacity(0.7), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityIdentifier("work-\(work.id)")
    }
    private var label: some View {
        HStack(alignment: .top, spacing: 10) {
            if work.phase == .running { ProgressView().controlSize(.small).padding(.top, 2) }
            else { Image(systemName: work.phase == .failed ? "exclamationmark.circle" : work.phase == .complete ? "checkmark.circle" : "stop.circle").foregroundStyle(.secondary) }
            VStack(alignment: .leading, spacing: 3) {
                Text(work.title).font(.subheadline.weight(.medium)).foregroundStyle(.primary)
                if let detail = work.detail { Text(detail).font(.caption).foregroundStyle(.secondary) }
            }
        }
    }
}

@MainActor
struct ApprovalContentView: View {
    let approval: ApprovalPresentation
    var model: ClientPresentation?
    let onIntent: @MainActor (ClientIntent) -> Void
    var onReadingInteraction: () -> Void = {}
    @State private var localExpanded = false
    @State private var confirmingAlways = false
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: approval.symbol).foregroundStyle(approval.outcome == nil ? Color.orange : Color.secondary)
                Text(approval.title).font(.headline).fixedSize(horizontal: false, vertical: true)
            }
            if let command = approval.command, !command.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    if isExpanded || command.count < 120 && command.components(separatedBy: "\n").count <= 3 {
                        SelectableMessageText(text: command, monospaced: true, onURL: { onIntent(.openURL($0)) }, onReadingInteraction: onReadingInteraction)
                    } else {
                        Text(command).font(.system(.subheadline, design: .monospaced)).lineLimit(3)
                        Button("Show full command") { setExpanded(true) }.font(.caption).frame(minHeight: 44)
                    }
                }
                .padding(12)
                .background(Color(uiColor: .tertiarySystemBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            if let outcome = approval.outcome {
                Label(outcome == .allowed ? "Allowed" : outcome == .denied ? "Denied" : "Expired",
                      systemImage: outcome == .allowed ? "checkmark.circle" : outcome == .denied ? "xmark.circle" : "clock")
                    .font(.subheadline).foregroundStyle(.secondary)
            } else {
                if let reason = approval.reason { Text(reason).font(.subheadline).foregroundStyle(.secondary) }
                if let scope = approval.scope { Text(scope).font(.caption).foregroundStyle(.secondary) }
                if let expiry = approval.expiryLabel { Text(expiry).font(.caption).foregroundStyle(.secondary) }
                if let error = approval.error { Label(error, systemImage: "exclamationmark.circle").font(.footnote).foregroundStyle(.orange) }
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 10) { decisionButtons }
                    VStack(alignment: .leading, spacing: 10) { decisionButtons }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .confirmationDialog("Always allow this action?", isPresented: $confirmingAlways, titleVisibility: .visible) {
            Button("Always allow") { onIntent(.resolveApproval(approvalID: approval.id, decision: .allowAlways)) }
        } message: {
            Text(approval.scope ?? "This permission applies beyond this single request.")
        }
        .accessibilityIdentifier("approval-\(approval.id)")
    }

    private var isExpanded: Bool { model?.expandedContentIDs.contains("approval-\(approval.id)") ?? localExpanded }
    private func setExpanded(_ value: Bool) {
        onReadingInteraction()
        if let model {
            if value { model.expandedContentIDs.insert("approval-\(approval.id)") }
            else { model.expandedContentIDs.remove("approval-\(approval.id)") }
        } else { localExpanded = value }
    }

    @ViewBuilder private var decisionButtons: some View {
        if approval.decisions.contains(.deny) {
            decisionButton(.deny, title: "Reject").buttonStyle(.bordered)
        }
        if approval.decisions.contains(.allowOnce) {
            decisionButton(.allowOnce, title: "Allow once").buttonStyle(.borderedProminent).tint(.primary)
        }
        if approval.decisions.contains(.allowAlways) {
            Menu {
                Button("Always allow…") { confirmingAlways = true }
            } label: {
                Image(systemName: "ellipsis").frame(minWidth: 44, minHeight: 44)
            }.disabled(approval.submitting != nil).accessibilityLabel("More permission options")
        }
    }

    private func decisionButton(_ decision: ApprovalDecision, title: String) -> some View {
        Button {
            onIntent(.resolveApproval(approvalID: approval.id, decision: decision))
        } label: {
            HStack(spacing: 7) {
                if approval.submitting == decision { ProgressView().controlSize(.small) }
                Text(title).font(.subheadline.weight(.medium))
            }.frame(minWidth: 76, minHeight: 44)
        }
        .disabled(approval.submitting != nil)
        .accessibilityIdentifier("approval-\(approval.id)-\(decision.rawValue)")
    }
}

@MainActor
private struct QuestionContentView: View {
    let question: QuestionPresentation
    @ObservedObject var model: ClientPresentation
    let onIntent: @MainActor (ClientIntent) -> Void
    let onReadingInteraction: () -> Void
    private var response: QuestionResponse { model.questionResponses[question.id] ?? .init() }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(question.title, systemImage: "text.bubble").font(.headline)
            if let detail = question.detail { Text(detail).font(.subheadline).foregroundStyle(.secondary) }
            if let resolved = question.resolvedLabel {
                Label(resolved, systemImage: "checkmark.circle").font(.subheadline).foregroundStyle(.secondary)
            } else {
                ForEach(question.fields) { field in
                    VStack(alignment: .leading, spacing: 8) {
                        if !field.title.isEmpty { Text(field.title).font(.subheadline.weight(.medium)) }
                        ForEach(field.options) { option in
                            Button {
                                var value = answer(for: field)
                                if field.allowsMultiple {
                                    if value.selectedOptionIDs.contains(option.id) { value.selectedOptionIDs.removeAll { $0 == option.id } }
                                    else { value.selectedOptionIDs.append(option.id) }
                                } else { value.selectedOptionIDs = [option.id]; value.text = "" }
                                setAnswer(value, for: field)
                            } label: {
                                HStack(alignment: .top, spacing: 10) {
                                    Image(systemName: answer(for: field).selectedOptionIDs.contains(option.id) ? "checkmark.circle.fill" : "circle")
                                        .font(.body).padding(.top, 2)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(option.label).font(.subheadline).foregroundStyle(.primary)
                                        if let detail = option.detail { Text(detail).font(.caption).foregroundStyle(.secondary) }
                                    }
                                    Spacer(minLength: 0)
                                }.padding(12).frame(minHeight: 44)
                                    .background(Color(uiColor: .tertiarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                            }
                            .buttonStyle(.plain)
                            .disabled(question.isSubmitting)
                            .accessibilityAddTraits(answer(for: field).selectedOptionIDs.contains(option.id) ? .isSelected : [])
                        }
                        if field.options.isEmpty || field.allowsCustom {
                            TextField(field.placeholder ?? "Your answer", text: Binding(get: {
                                answer(for: field).text
                            }, set: { text in
                                var value = answer(for: field); value.text = text
                                if !field.allowsMultiple && !text.isEmpty { value.selectedOptionIDs = [] }
                                setAnswer(value, for: field)
                            }), axis: .vertical)
                            .textFieldStyle(.roundedBorder).lineLimit(1...8)
                            .disabled(question.isSubmitting)
                            .accessibilityLabel(field.title.isEmpty ? "Your answer" : field.title)
                        }
                    }
                }
                if let error = question.error { Label(error, systemImage: "exclamationmark.circle").font(.footnote).foregroundStyle(.orange) }
                if question.canSubmit {
                    Button {
                        onIntent(.answerQuestion(questionID: question.id, response: response))
                    } label: {
                        HStack(spacing: 8) {
                            if question.isSubmitting { ProgressView().controlSize(.small) }
                            Text("Send answer").font(.subheadline.weight(.medium))
                        }.frame(minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent).tint(.primary)
                    .disabled(question.isSubmitting || !isValid)
                }
            }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityIdentifier("question-\(question.id)")
    }

    private var isValid: Bool {
        question.fields.allSatisfy { field in
            !field.isRequired || !answer(for: field).selectedOptionIDs.isEmpty || !answer(for: field).text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }
    private func answer(for field: QuestionField) -> QuestionFieldAnswer { response.fields[field.id] ?? .init() }
    private func setAnswer(_ answer: QuestionFieldAnswer, for field: QuestionField) {
        onReadingInteraction()
        var changed = response; changed.fields[field.id] = answer
        model.questionResponses[question.id] = changed
    }
}

private extension MessageDelivery {
    var isWarning: Bool {
        switch self { case .held, .uncertain, .failed: true; default: false }
    }
    var label: String {
        switch self {
        case .queued: String(localized: "Queued")
        case let .held(reason): reason ?? String(localized: "Ready for review")
        case .sending: String(localized: "Sending…")
        case .sent: String(localized: "Sent")
        case .delivered: String(localized: "Delivered")
        case let .uncertain(reason): reason ?? String(localized: "Send status unconfirmed")
        case let .failed(reason): reason
        }
    }
    var symbol: String {
        switch self {
        case .queued, .sending: "clock"
        case .held, .uncertain: "exclamationmark.circle"
        case .sent: "checkmark"
        case .delivered: "checkmark.circle"
        case .failed: "exclamationmark.circle"
        }
    }
}

private extension MessageAction {
    var title: String {
        switch self {
        case .copy: String(localized: "Copy")
        case .share: String(localized: "Share")
        case .favorite: String(localized: "Favorite")
        case .replyInNewSession: String(localized: "Reply in new conversation")
        case .sendNow: String(localized: "Send now")
        case .edit: String(localized: "Edit")
        case .remove: String(localized: "Remove")
        }
    }
    var symbol: String {
        switch self {
        case .copy: "doc.on.doc"
        case .share: "square.and.arrow.up"
        case .favorite: "star"
        case .replyInNewSession: "arrowshape.turn.up.left"
        case .sendNow: "paperplane"
        case .edit: "pencil"
        case .remove: "trash"
        }
    }
}
#endif
