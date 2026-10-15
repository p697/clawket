import Foundation
import CryptoKit
import ClawketTransport

struct ConsentKey: Hashable, Sendable {
    enum Kind: String, Sendable { case execution, plugin, device, node, question }
    let kind: Kind
    let wireID: String
    let sessionKey: String?
}

enum ConsentValue: Sendable {
    case approval(RuntimeApproval), question(RuntimeQuestion)
    var reference: RuntimeRequestReference {
        switch self { case .approval(let value): value.reference; case .question(let value): value.reference }
    }
    var raw: JSONValue {
        switch self { case .approval(let value): value.raw; case .question(let value): value.raw }
    }
    var expiresAtMs: Int64? {
        switch self { case .approval(let value): value.expiresAtMs; case .question(let value): value.expiresAtMs }
    }
    var state: RuntimeRequestState {
        get { switch self { case .approval(let value): value.state; case .question(let value): value.state } }
        set {
            switch self {
            case .approval(var value): value.state = newValue; self = .approval(value)
            case .question(var value): value.state = newValue; self = .question(value)
            }
        }
    }
}

enum ConsentWire {
    static func approval(_ raw: JSONValue, sessionKey: String?, connection: BackendConnection) throws -> (ConsentKey, ConsentValue) {
        try bounded(raw, bytes: 256 * 1_024)
        let id = try required(raw["id"], max: 512)
        let kind = try required(raw["kind"], max: 32)
        let session = try optionalSession(sessionKey)
        let reference = RuntimeRequestReference(connectionID: connection.id, sessionKey: session)
        let expires = try expiry(raw["expiresAtMs"])
        var decisions: [RuntimeApprovalDecision] = []
        var keyKind: ConsentKey.Kind
        var approvalKind: RuntimeApproval.Kind
        var target: RuntimeApproval.PairingTarget?
        switch kind {
        case "exec":
            keyKind = .execution; approvalKind = .execution
            _ = try string(raw["command"], max: 128_000, required: true, nonempty: false)
            var advertised = raw["decisions"]
            if connection.backendKind == .openclaw, let allowed = raw["allowedDecisions"] {
                guard advertised == nil || advertised == allowed else { throw RuntimeFailure(.invalidResponse) }
                advertised = allowed
            }
            if let advertised {
                guard let values = advertised.array, values.count <= 3 else { throw RuntimeFailure(.invalidResponse) }
                var seen = Set<String>()
                for value in values {
                    let name = try required(value, max: 32)
                    guard seen.insert(name).inserted else { throw RuntimeFailure(.invalidResponse) }
                    guard let decision = RuntimeApprovalDecision(rawValue: name), [.allowOnce, .allowAlways, .deny].contains(decision) else { continue }
                    if [.openclaw, .hermes].contains(connection.backendKind) ||
                        ([.codex, .claudeCode].contains(connection.backendKind) && decision != .allowAlways) { decisions.append(decision) }
                }
            }
        case "plugin": keyKind = .plugin; approvalKind = .plugin
        case "pair":
            guard let value = raw["target"]?.stringValue.flatMap(RuntimeApproval.PairingTarget.init(rawValue:)) else { throw RuntimeFailure(.invalidResponse) }
            target = value; keyKind = value == .device ? .device : .node; approvalKind = .pairing
            if connection.backendKind == .openclaw { decisions = [.approve, .reject] }
        default: throw RuntimeFailure(.unsupported)
        }
        let value = RuntimeApproval(reference: reference, kind: approvalKind, pairingTarget: target,
            command: try string(raw["command"], max: 128_000), category: try string(raw["category"], max: 64),
            reason: try string(raw["reason"], max: 16_000), title: try string(raw["title"], max: 8_000),
            pluginID: try string(raw["pluginId"], max: 512), cwd: try string(raw["cwd"], max: 8_192),
            host: try string(raw["host"], max: 1_024), displayName: try string(raw["displayName"], max: 1_024),
            platform: try string(raw["platform"], max: 128), receivedAtMs: try expiry(raw["receivedAtMs"]),
            expiresAtMs: expires, decisions: decisions, state: .pending, raw: raw)
        return (ConsentKey(kind: keyKind, wireID: id, sessionKey: nil), .approval(value))
    }

    static func question(_ raw: JSONValue, sessionKey: String, connection: BackendConnection) throws -> (ConsentKey, ConsentValue) {
        try bounded(raw, bytes: 128 * 1_024)
        let id = try required(raw["id"], max: 512)
        let session = try optionalSession(sessionKey)!
        guard let name = raw["kind"]?.stringValue, let kind = RuntimeQuestion.Kind(rawValue: name) else { throw RuntimeFailure(.unsupported) }
        var options: [String] = []
        if let values = raw["options"] {
            guard let values = values.array, values.count <= 200 else { throw RuntimeFailure(.invalidResponse) }
            options = try values.map { try required($0, max: 8_000) }
            guard Set(options).count == options.count else { throw RuntimeFailure(.invalidResponse) }
        }
        var fields: [RuntimeQuestionField] = []
        if kind == .form {
            guard let values = raw["fields"]?.array, !values.isEmpty, values.count <= 10 else { throw RuntimeFailure(.invalidResponse) }
            var ids = Set<String>()
            fields = try values.map { field in
                let fieldID = try required(field["id"], max: 512)
                guard !["__proto__", "constructor", "prototype"].contains(fieldID), ids.insert(fieldID).inserted,
                      let custom = field["allowCustom"]?.boolValue,
                      field["multiSelect"] == nil || field["multiSelect"]?.boolValue != nil,
                      let options = field["options"]?.array, options.count <= 20 else { throw RuntimeFailure(.invalidResponse) }
                var labels = Set<String>()
                let parsed = try options.map { option in
                    let label = try required(option["label"], max: 8_000)
                    guard labels.insert(label).inserted else { throw RuntimeFailure(.invalidResponse) }
                    return RuntimeQuestionOption(label: label, description: try string(option["description"], max: 8_000))
                }
                return RuntimeQuestionField(id: fieldID, title: try required(field["title"], max: 8_000),
                    header: try string(field["header"], max: 1_000), options: parsed, allowsCustom: custom,
                    allowsMultiple: field["multiSelect"]?.boolValue == true && connection.backendKind == .claudeCode)
            }
        }
        let answerable: Bool = switch connection.backendKind {
        case .pi: kind != .form && (kind != .select || !options.isEmpty)
        case .claudeCode: kind == .form
        case .codex: kind != .confirm
        default: false
        }
        let value = RuntimeQuestion(reference: .init(connectionID: connection.id, sessionKey: session),
            draftKey: draftKey(backend: connection.backendKind.rawValue, connection: connection.id, session: session, request: id), kind: kind,
            title: try required(raw["title"], max: 8_000), message: try string(raw["message"], max: 16_000),
            options: options, fields: fields, placeholder: try string(raw["placeholder"], max: 8_000),
            prefill: try string(raw["prefill"], max: 64_000), expiresAtMs: try expiry(raw["expiresAtMs"]),
            canAnswer: answerable, state: .pending, raw: raw)
        return (ConsentKey(kind: .question, wireID: id, sessionKey: session), .question(value))
    }

    static func answer(_ answer: RuntimeQuestionAnswer, question: RuntimeQuestion) throws -> [String: JSONValue] {
        guard question.canAnswer else { throw RuntimeFailure(.unsupported) }
        switch answer {
        case .cancel: return ["cancelled": .bool(true)]
        case .confirmed(let value):
            guard question.kind == .confirm else { throw RuntimeFailure(.invalidAnswer) }
            return ["confirmed": .bool(value)]
        case .value(let value):
            guard [.input, .editor, .select].contains(question.kind), value.utf16.count <= 64_000,
                  question.kind != .select || question.options.contains(value) else { throw RuntimeFailure(.invalidAnswer) }
            return ["value": .string(value)]
        case .form(let answers):
            guard question.kind == .form, answers.count == question.fields.count else { throw RuntimeFailure(.invalidAnswer) }
            var result: [String: JSONValue] = [:]
            for field in question.fields {
                guard let values = answers[field.id], !values.isEmpty,
                      Set(values).count == values.count,
                      values.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.utf16.count <= 64_000 }) else { throw RuntimeFailure(.invalidAnswer) }
                let allListed = values.allSatisfy { value in field.options.contains { $0.label == value } }
                guard allListed ? values.count <= (field.allowsMultiple ? field.options.count : 1)
                    : values.count == 1 && field.allowsCustom else { throw RuntimeFailure(.invalidAnswer) }
                result[field.id] = .array(values.map(JSONValue.string))
            }
            return ["answers": .object(result)]
        }
    }

    static func bounded(_ value: JSONValue, bytes: Int) throws {
        guard value.object != nil || value.array != nil, try FrameCodec.encode(value).utf8.count <= bytes else { throw RuntimeFailure(.capacity) }
    }
    static func required(_ value: JSONValue?, max: Int) throws -> String {
        try string(value, max: max, required: true, nonempty: true)!
    }
    static func string(_ value: JSONValue?, max: Int, required: Bool = false, nonempty: Bool = false) throws -> String? {
        if value == nil || value == .null {
            if required { throw RuntimeFailure(.invalidResponse) }; return nil
        }
        guard let text = value?.stringValue, text.utf16.count <= max,
              !nonempty || !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw RuntimeFailure(.invalidResponse) }
        return text
    }
    static func optionalSession(_ value: String?) throws -> String? {
        guard let value else { return nil }
        guard !value.isEmpty, value.utf8.count <= 1_024 else { throw RuntimeFailure(.invalidResponse) }
        return value
    }
    static func expiry(_ value: JSONValue?) throws -> Int64? {
        if value == nil || value == .null { return nil }
        guard let time = value?.safeInteger else { throw RuntimeFailure(.invalidResponse) }
        return time
    }

    static func draftKey(backend: String, connection: String, session: String, request: String) -> String {
        var bytes = Data()
        for value in ["question-v1", backend, connection, session, request] {
            let data = Data(value.utf8)
            bytes.append(contentsOf: "\(data.count):".utf8); bytes.append(data)
        }
        return SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }
}
