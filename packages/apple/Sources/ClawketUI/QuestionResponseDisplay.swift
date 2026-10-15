import Foundation

/// A read-only value projection. It neither validates a wire operation nor claims acceptance.
enum QuestionReadonlyResponse: Equatable, Sendable {
    case confirmation(Bool)
    case fields([QuestionReadonlyField])
}

struct QuestionReadonlyField: Equatable, Identifiable, Sendable {
    let id: String
    let title: String
    let header: String?
    let values: [String]
    init(id: String, title: String, header: String? = nil, values: [String]) {
        self.id = id; self.title = title; self.header = header; self.values = values
    }
}

extension QuestionPresentation {
    func readonlyResponse(_ response: QuestionResponse) -> QuestionReadonlyResponse? {
        if kind == .confirm { return response.confirmed.map(QuestionReadonlyResponse.confirmation) }
        let summaries: [QuestionReadonlyField] = fields.compactMap { field in
            guard let answer = response.fields[field.id] else {
                // An explicitly accepted empty input is valid; an untouched local draft is absent.
                if responseIsAccepted, [.input, .editor].contains(kind), fields.count == 1 {
                    return .init(id: field.id, title: field.title, header: field.header, values: [""])
                }
                return nil
            }
            let values: [String]
            if [.input, .editor].contains(kind) || answer.isCustom || field.options.isEmpty {
                values = [answer.text]
            } else {
                // Never print opaque or stale option IDs as if they were answer values.
                values = answer.selectedOptionIDs.compactMap { id in field.options.first { $0.id == id }?.label }
            }
            guard !values.isEmpty else { return nil }
            return .init(id: field.id, title: field.title, header: field.header, values: values)
        }
        return summaries.isEmpty ? nil : .fields(summaries)
    }
}
