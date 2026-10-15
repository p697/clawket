#if os(iOS)
import SwiftUI

@MainActor
struct QuestionContentView: View {
    let question: QuestionPresentation
    @ObservedObject var model: ClientPresentation
    let onIntent: @MainActor (ClientIntent) -> Void
    let onReadingInteraction: () -> Void
    private var response: QuestionResponse { model.questionResponses[question.id] ?? .init() }
    private var isBusy: Bool { question.isSubmitting || question.submittingAction != nil }
    private var validationError: QuestionValidationError? {
        do { _ = try QuestionResponseValidator.validate(response, for: question); return nil }
        catch { return error as? QuestionValidationError ?? .incompatibleResponse }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(question.title, systemImage: "text.bubble").font(.headline).accessibilityAddTraits(.isHeader)
            if let detail = question.detail { Text(detail).font(.subheadline).foregroundStyle(.secondary).textSelection(.enabled) }
            if let resolved = question.resolvedLabel {
                Label(resolved, systemImage: "checkmark.circle").font(.subheadline).foregroundStyle(.secondary)
            } else {
                if question.kind != .confirm {
                    ForEach(question.fields) { field in fieldContent(field) }
                }
                if let error = question.error {
                    Label(error, systemImage: "exclamationmark.circle").font(.footnote).foregroundStyle(.orange)
                }
                if validationError == .answerTooLong {
                    Label("This answer is too long.", systemImage: "exclamationmark.circle")
                        .font(.footnote).foregroundStyle(.orange)
                }
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 10) { actions }
                    VStack(alignment: .leading, spacing: 10) { actions }
                }
            }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityIdentifier("question-\(question.id)")
    }

    @ViewBuilder private func fieldContent(_ field: QuestionField) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let header = field.header, !header.isEmpty {
                Text(header).font(.caption.weight(.medium)).foregroundStyle(.secondary)
            }
            if !field.title.isEmpty {
                Text(field.title).font(.subheadline.weight(.medium)).accessibilityAddTraits(.isHeader)
            }
            if question.kind == .form && field.isRequired {
                Text("Required").font(.caption).foregroundStyle(.secondary)
            }
            if !field.options.isEmpty {
                Text(allowsMultiple(field) ? String(localized: "Select all that apply") : String(localized: "Choose one answer"))
                    .font(.caption).foregroundStyle(.secondary)
                ForEach(field.options) { option in optionButton(option, field: field) }
                if question.kind == .form && field.allowsCustom {
                    choiceButton(title: String(localized: "Your answer"), detail: nil, selected: answer(for: field).isCustom,
                                 multiple: false, identifier: "question-\(question.id)-\(field.id)-custom") {
                        var value = answer(for: field)
                        if !value.isCustom { value = .init(isCustom: true) }
                        setAnswer(value, for: field)
                    }
                }
            }
            if question.kind == .input || question.kind == .editor
                || question.kind == .form && field.allowsCustom && (field.options.isEmpty || answer(for: field).isCustom) {
                answerInput(field)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func optionButton(_ option: QuestionOption, field: QuestionField) -> some View {
        let selected = !answer(for: field).isCustom && answer(for: field).selectedOptionIDs.contains(option.id)
        return choiceButton(title: option.label, detail: option.detail, selected: selected, multiple: allowsMultiple(field),
                            identifier: "question-\(question.id)-\(field.id)-\(option.id)") {
            var value = answer(for: field)
            let known = Set(field.options.map(\.id))
            let previous = value.isCustom ? [] : value.selectedOptionIDs.filter(known.contains)
            if allowsMultiple(field) {
                value.selectedOptionIDs = previous.contains(option.id) ? previous.filter { $0 != option.id } : previous + [option.id]
            } else { value.selectedOptionIDs = [option.id] }
            value.text = ""; value.isCustom = false
            setAnswer(value, for: field)
        }
    }

    private func choiceButton(title: String, detail: String?, selected: Bool, multiple: Bool,
                              identifier: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: multiple ? (selected ? "checkmark.square.fill" : "square") : (selected ? "checkmark.circle.fill" : "circle"))
                    .font(.body).padding(.top, 2).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.subheadline).foregroundStyle(.primary)
                    if let detail { Text(detail).font(.caption).foregroundStyle(.secondary) }
                }
                Spacer(minLength: 0)
            }.padding(12).frame(minHeight: 44)
                .background(Color(uiColor: .tertiarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain).disabled(isBusy)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier(identifier)
    }

    @ViewBuilder private func answerInput(_ field: QuestionField) -> some View {
        let binding = Binding(get: { answer(for: field).text }, set: { text in
            var value = answer(for: field); value.text = text
            if question.kind == .form { value.isCustom = true; value.selectedOptionIDs = [] }
            setAnswer(value, for: field)
        })
        if question.kind == .editor {
            TextEditor(text: binding)
                .frame(minHeight: 160, maxHeight: 280)
                .scrollContentBackground(.hidden).padding(8)
                .background(Color(uiColor: .tertiarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                .disabled(isBusy)
                .accessibilityLabel(field.title.isEmpty ? String(localized: "Your answer") : field.title)
                .accessibilityIdentifier("question-\(question.id)-\(field.id)-editor")
        } else if question.kind == .input {
            TextField(field.placeholder ?? String(localized: "Your answer"), text: binding)
                .textFieldStyle(.roundedBorder).disabled(isBusy)
                .accessibilityLabel(field.title.isEmpty ? String(localized: "Your answer") : field.title)
                .accessibilityIdentifier("question-\(question.id)-\(field.id)-input")
        } else {
            TextField(field.placeholder ?? String(localized: "Your answer"), text: binding, axis: .vertical)
                .textFieldStyle(.roundedBorder).lineLimit(2...8).disabled(isBusy)
                .accessibilityLabel(field.title.isEmpty ? String(localized: "Your answer") : field.title)
                .accessibilityIdentifier("question-\(question.id)-\(field.id)-custom-input")
        }
    }

    @ViewBuilder private var actions: some View {
        if question.canCancel {
            actionButton(.cancel, title: question.kind == .form ? String(localized: "Stop task") : String(localized: "Cancel")) {
                onIntent(.cancelQuestion(questionID: question.id))
            }.buttonStyle(.bordered)
        }
        if question.canSubmit {
            if question.kind == .confirm {
                actionButton(.confirm(false), title: String(localized: "No")) { submit(.init(confirmed: false)) }
                    .buttonStyle(.bordered)
                actionButton(.confirm(true), title: String(localized: "Yes")) { submit(.init(confirmed: true)) }
                    .buttonStyle(.borderedProminent).tint(.primary)
            } else {
                actionButton(.answer, title: String(localized: "Send answer")) { submit(response) }
                    .buttonStyle(.borderedProminent).tint(.primary).disabled(validationError != nil)
            }
        }
    }

    private func actionButton(_ action: QuestionPresentation.Submission, title: String,
                              perform: @escaping () -> Void) -> some View {
        Button {
            guard !isBusy, question.resolvedLabel == nil else { return }
            perform()
        } label: {
            HStack(spacing: 8) {
                if question.submittingAction == action || question.submittingAction == nil && question.isSubmitting && action == .answer {
                    ProgressView().controlSize(.small)
                }
                Text(title).font(.subheadline.weight(.medium))
            }.frame(minHeight: 44)
        }.disabled(isBusy)
    }

    private func submit(_ response: QuestionResponse) {
        guard question.canSubmit, !isBusy, (try? QuestionResponseValidator.validate(response, for: question)) != nil else { return }
        onIntent(.answerQuestion(questionID: question.id, response: response))
    }
    private func allowsMultiple(_ field: QuestionField) -> Bool { question.kind == .form && field.allowsMultiple }
    private func answer(for field: QuestionField) -> QuestionFieldAnswer { response.fields[field.id] ?? .init() }
    private func setAnswer(_ answer: QuestionFieldAnswer, for field: QuestionField) {
        guard !isBusy, question.resolvedLabel == nil else { return }
        onReadingInteraction()
        var changed = response; changed.fields[field.id] = answer
        onIntent(.questionDraftChanged(questionID: question.id, response: changed))
    }
}
#endif
