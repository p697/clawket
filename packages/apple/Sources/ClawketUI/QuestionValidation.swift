import Foundation

/// Semantic answer values, without transport JSON, authority or backend dependencies.
public enum ValidatedQuestionAnswer: Equatable, Sendable {
    case value(String)
    case confirmed(Bool)
    case form([String: [String]])
}

public enum QuestionValidationError: Error, Equatable, Sendable {
    case invalidDefinition, unknownField, unknownOption, duplicateSelection
    case multipleSelectionNotAllowed, customNotAllowed, mixedCustomAndSelection
    case requiredAnswerMissing, answerTooLong, incompatibleResponse
}

public enum QuestionResponseValidator {
    public static let maximumTextLength = 64_000

    /// This validates presentation semantics only. The host must still revalidate the captured
    /// pending runtime reference, generation, expiry and capabilities before performing an action.
    public static func validate(_ response: QuestionResponse, for question: QuestionPresentation) throws -> ValidatedQuestionAnswer {
        let fields = question.fields
        guard fields.count <= 32, Set(fields.map(\.id)).count == fields.count,
              fields.allSatisfy({ !$0.id.isEmpty && Set($0.options.map(\.id)).count == $0.options.count
                  && Set($0.options.map(\.label)).count == $0.options.count
                  && $0.options.allSatisfy({ !$0.id.isEmpty && !$0.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) }) else {
            throw QuestionValidationError.invalidDefinition
        }
        guard Set(response.fields.keys).isSubset(of: Set(fields.map(\.id))) else { throw QuestionValidationError.unknownField }
        if question.kind == .confirm {
            guard fields.isEmpty, response.fields.isEmpty, let confirmed = response.confirmed else {
                throw QuestionValidationError.incompatibleResponse
            }
            return .confirmed(confirmed)
        }
        guard response.confirmed == nil else { throw QuestionValidationError.incompatibleResponse }
        switch question.kind {
        case .confirm: throw QuestionValidationError.incompatibleResponse
        case .input, .editor:
            guard fields.count == 1, let field = fields.first, field.options.isEmpty else { throw QuestionValidationError.invalidDefinition }
            let answer = response.fields[field.id] ?? .init()
            guard answer.selectedOptionIDs.isEmpty else { throw QuestionValidationError.incompatibleResponse }
            try checkLength(answer.text)
            // Pi and non-form Codex input/editor accept the exact empty or whitespace value.
            return .value(answer.text)
        case .select:
            guard fields.count == 1, let field = fields.first, !field.options.isEmpty else { throw QuestionValidationError.invalidDefinition }
            let answer = response.fields[field.id] ?? .init()
            guard !answer.isCustom, answer.text.isEmpty else { throw QuestionValidationError.customNotAllowed }
            guard answer.selectedOptionIDs.count == 1 else {
                throw answer.selectedOptionIDs.isEmpty ? QuestionValidationError.requiredAnswerMissing : .multipleSelectionNotAllowed
            }
            guard let option = field.options.first(where: { $0.id == answer.selectedOptionIDs[0] }) else { throw QuestionValidationError.unknownOption }
            try checkLength(option.label)
            return .value(option.label)
        case .form:
            guard !fields.isEmpty else { throw QuestionValidationError.invalidDefinition }
            var result: [String: [String]] = [:]
            for field in fields {
                result[field.id] = try values(response.fields[field.id] ?? .init(), field: field)
            }
            return .form(result)
        }
    }

    private static func values(_ answer: QuestionFieldAnswer, field: QuestionField) throws -> [String] {
        guard Set(answer.selectedOptionIDs).count == answer.selectedOptionIDs.count else { throw QuestionValidationError.duplicateSelection }
        let known = Set(field.options.map(\.id))
        guard answer.selectedOptionIDs.allSatisfy(known.contains) else { throw QuestionValidationError.unknownOption }
        if answer.isCustom || field.options.isEmpty && !answer.text.isEmpty {
            guard field.allowsCustom else { throw QuestionValidationError.customNotAllowed }
            guard answer.selectedOptionIDs.isEmpty else { throw QuestionValidationError.mixedCustomAndSelection }
            try checkLength(answer.text)
            if answer.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                if field.isRequired { throw QuestionValidationError.requiredAnswerMissing }
                return []
            }
            return [answer.text]
        }
        guard answer.text.isEmpty else { throw QuestionValidationError.mixedCustomAndSelection }
        guard field.allowsMultiple || answer.selectedOptionIDs.count <= 1 else { throw QuestionValidationError.multipleSelectionNotAllowed }
        if answer.selectedOptionIDs.isEmpty && field.isRequired { throw QuestionValidationError.requiredAnswerMissing }
        return try answer.selectedOptionIDs.map { id in
            guard let option = field.options.first(where: { $0.id == id }) else { throw QuestionValidationError.unknownOption }
            try checkLength(option.label)
            return option.label
        }
    }

    private static func checkLength(_ text: String) throws {
        guard text.utf16.count <= maximumTextLength else { throw QuestionValidationError.answerTooLong }
    }
}
