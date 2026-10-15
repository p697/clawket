import Foundation
import ClawketTransport

struct ModelControlValues: Sendable {
    var models: [RuntimeModel]
    var currentModel: String?
    var currentProvider: String?
    var configuredDefault: String?
    var thinking: RuntimeModelThinking?
    var fastMode: RuntimeModelFastMode?
    var permissions: RuntimeModelPermissions?
    var permissionConfirmation: Bool?
    var configHash: String?
    var reportsThinking = false
    var weight: Int
}

enum ModelControlsWire {
    static let levels = ["off", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "adaptive"]
    static let legacyLevels = ["off", "minimal", "low", "medium", "high", "xhigh"]

    static func parse(_ payload: JSONValue, backend: BackendKind, scope: RuntimeModelControlScope,
                      unencrypted: Bool) throws -> ModelControlValues {
        guard payload.object != nil, let rows = payload["models"]?.array, rows.count <= 5_000 else { throw RuntimeFailure(.invalidResponse) }
        guard let encoded = try? FrameCodec.encode(payload) else { throw RuntimeFailure(.invalidResponse) }
        let weight = encoded.utf8.count
        guard weight <= 8 * 1_024 * 1_024 else { throw RuntimeFailure(.capacity) }
        let current = try string(payload["currentModel"], maximum: 1_024)
        let currentProvider = try string(payload["currentProvider"], maximum: 256)
        var keys = Set<String>()
        let models = try rows.enumerated().map { index, row -> RuntimeModel in
            guard row.object != nil, let id = try string(row["id"], maximum: 1_024) else { throw RuntimeFailure(.invalidResponse) }
            let provider = try string(row["provider"], maximum: 256)
            // Length-prefixing preserves provider/model identity without ambiguous separators.
            let key = "\(provider?.utf8.count ?? 0):\(provider ?? "")\(id.utf8.count):\(id)"
            guard keys.insert(key).inserted else { throw RuntimeFailure(.invalidResponse) }
            let resolved = try string(row["resolvedModel"], maximum: 1_024)
            let input = try strings(row["input"], maximum: 16, bytes: 64)
            let reasoning = try thinkingLevels(row["reasoningLevels"])
            let order: Double?
            if [.codex, .claudeCode].contains(backend) { order = Double(index) }
            else if let value = row["sortOrder"], value != .null {
                guard let number = value.numberValue, number.isFinite, abs(number) <= 9_007_199_254_740_991 else { throw RuntimeFailure(.invalidResponse) }
                order = number
            } else { order = nil }
            return RuntimeModel(id: id, name: try string(row["name"], maximum: 1_024) ?? id,
                provider: provider, selected: selected(id: id, provider: provider, resolved: resolved,
                    current: current, currentProvider: currentProvider),
                input: input, sortOrder: order, resolvedModel: resolved, reasoningLevels: reasoning)
        }
        let reported = try thinkingLevels(payload["thinkingLevels"])
        let currentLevel = try string(payload["thinkingLevel"], maximum: 64).flatMap { levels.contains($0) ? $0 : nil }
        let currentReasoning = models.first(where: \.selected)?.reasoningLevels
        let offered = reported?.isEmpty == false ? reported! : currentReasoning?.isEmpty == false ? currentReasoning!
            : (backend == .pi || backend == .hermes ? legacyLevels : [])
        let thinking: RuntimeModelThinking? = [.codex, .pi, .hermes, .openclaw].contains(backend)
            ? .init(current: currentLevel, levels: offered, writePath: nil) : nil
        var fast: RuntimeModelFastMode?, permissions: RuntimeModelPermissions?, confirmation: Bool?
        if case .session = scope, backend == .codex {
            if let raw = payload["fastMode"], raw != .null {
                guard raw.object != nil, let available = raw["available"]?.boolValue else { throw RuntimeFailure(.invalidResponse) }
                if let enabled = raw["enabled"], enabled != .null, enabled.boolValue == nil { throw RuntimeFailure(.invalidResponse) }
                fast = .init(enabled: raw["enabled"]?.boolValue, available: available)
            }
            if let raw = payload["permissions"], raw != .null {
                guard raw.object != nil, raw["scope"]?.stringValue == "session",
                      let available = raw["available"]?.boolValue else { throw RuntimeFailure(.invalidResponse) }
                let mode: RuntimeEffectivePermissionMode?
                if let value = try string(raw["mode"], maximum: 64) {
                    if let known = RuntimeSessionPermissionMode(rawValue: value) { mode = .known(known) }
                    else if value == "custom" { mode = .custom }
                    else { throw RuntimeFailure(.invalidResponse) }
                } else { mode = nil }
                if let value = raw["requiresConfirmation"], value != .null, value.boolValue == nil { throw RuntimeFailure(.invalidResponse) }
                confirmation = raw["requiresConfirmation"]?.boolValue
                let modes: [RuntimeSessionPermissionMode]
                if let values = try strings(raw["availableModes"], maximum: 3, bytes: 32) {
                    modes = try values.map { guard let mode = RuntimeSessionPermissionMode(rawValue: $0) else { throw RuntimeFailure(.invalidResponse) }; return mode }
                } else { modes = RuntimeSessionPermissionMode.allCases }
                permissions = .init(mode: mode, available: available, availableModes: available ? modes : [],
                    requiresConfirmation: confirmation == true, unencryptedTransport: unencrypted)
            }
        }
        return ModelControlValues(models: models, currentModel: current, currentProvider: currentProvider,
            thinking: thinking, fastMode: fast, permissions: permissions, permissionConfirmation: confirmation,
            weight: weight)
    }

    static func openClawThinking(_ row: JSONValue) -> RuntimeModelThinking {
        let reported = row["thinkingLevels"]?.array ?? row["thinkingOptions"]?.array ?? []
        let supplied = Set(reported.compactMap { value -> String? in
            let value = value.stringValue ?? value["id"]?.stringValue
            return value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        })
        let offered = levels.filter(supplied.contains)
        let rawCurrent = row["effectiveThinkingLevel"] ?? row["thinkingLevel"] ?? row["thinkingDefault"]
        let current = rawCurrent?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return .init(current: current.flatMap { levels.contains($0) ? $0 : nil },
            levels: offered.isEmpty ? legacyLevels + ["adaptive"] : offered, writePath: nil)
    }

    static func hasOpenClawThinking(_ row: JSONValue) -> Bool {
        let values = row["thinkingLevels"]?.array ?? row["thinkingOptions"]?.array ?? []
        return values.contains { value in
            let raw = (value.stringValue ?? value["id"]?.stringValue)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            return raw.map(levels.contains) ?? false
        }
    }

    static func selecting(_ models: [RuntimeModel], current: String?, provider: String?) -> [RuntimeModel] {
        models.map { model in .init(id: model.id, name: model.name, provider: model.provider,
            selected: selected(id: model.id, provider: model.provider, resolved: model.resolvedModel, current: current, currentProvider: provider),
            input: model.input, sortOrder: model.sortOrder, resolvedModel: model.resolvedModel, reasoningLevels: model.reasoningLevels) }
    }

    static func selected(id: String, provider: String?, resolved: String?, current: String?, currentProvider: String?) -> Bool {
        guard let current, !current.isEmpty else { return false }
        if let currentProvider, provider?.lowercased() != currentProvider.lowercased() { return false }
        return [id, resolved, provider.map { "\($0)/\(id)" }].compactMap { $0 }.contains { $0.lowercased() == current.lowercased() }
    }

    static func string(_ value: JSONValue?, maximum: Int) throws -> String? {
        guard let value, value != .null else { return nil }
        guard let raw = value.stringValue, raw.utf8.count <= maximum else { throw RuntimeFailure(.invalidResponse) }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    static func strings(_ value: JSONValue?, maximum: Int, bytes: Int) throws -> [String]? {
        guard let value, value != .null else { return nil }
        guard let values = value.array, values.count <= maximum else { throw RuntimeFailure(.invalidResponse) }
        let result = try values.map { value -> String in
            guard let text = try string(value, maximum: bytes) else { throw RuntimeFailure(.invalidResponse) }; return text
        }
        guard Set(result).count == result.count else { throw RuntimeFailure(.invalidResponse) }
        return result
    }

    static func thinkingLevels(_ value: JSONValue?) throws -> [String]? {
        try strings(value, maximum: 32, bytes: 64)?.filter(levels.contains)
    }
}
