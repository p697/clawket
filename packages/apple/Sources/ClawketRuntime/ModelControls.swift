import Foundation
import ClawketTransport

extension RuntimeCoordinator {
    /// `sessionKey` always records the concrete caller route. Hermes/local-model settings stay global.
    public func modelControls(sessionKey: String? = nil) async throws -> RuntimeModelControls {
        let scope = try scope()
        let key = try modelControlKey(sessionKey)
        guard modelControlsState.reads.count < 2 else { throw RuntimeFailure(.capacity) }
        let revision = try modelControlsState.admit(key), readID = UUID()
        let session = modelSessionIdentity(sessionKey)
        modelControlsState.reads.insert(readID); modelControlsState.latestRead[key] = readID
        defer {
            modelControlsState.reads.remove(readID)
            if modelControlsState.latestRead[key] == readID { modelControlsState.latestRead.removeValue(forKey: key) }
        }
        var values = try await readModelControls(key: key, sessionKey: sessionKey, scope: scope)
        try assertCurrent(scope)
        guard !Task.isCancelled, modelControlsState.reads.contains(readID), modelControlsState.latestRead[key] == readID,
              modelControlsState.contexts[key] == revision, sameModelControlTarget(modelSessionIdentity(sessionKey), session) else {
            throw RuntimeFailure(.superseded)
        }
        let latestSession = modelSessionIdentity(sessionKey)
        if latestSession != session, let latestSession {
            // A newer model-only event must not discard independent effective speed/permissions.
            values.currentModel = latestSession.model; values.currentProvider = latestSession.provider
            values.models = ModelControlsWire.selecting(values.models, current: latestSession.model, provider: latestSession.provider)
            // Speed availability depends on the particular native model/provider.
            // A pre-change response cannot grant it to the newer model.
            if values.fastMode != nil { values.fastMode = .init(enabled: nil, available: false) }
            if values.thinking != nil {
                let levels = values.models.first(where: \.selected)?.reasoningLevels ?? []
                values.thinking = .init(current: nil, levels: levels, writePath: nil)
            }
        }
        try modelControlsState.observeRead(values, key: key, permissionsSupported: modelPermissionsSupported)
        let entry = try modelControlsState.issue(key: key, sessionKey: sessionKey, scope: scope, session: latestSession, values: values)
        return modelControlsSnapshot(entry)
    }

    /// Prepares only; the host persists this exact caller route in its ordinary outbox.
    public func prepareThinkingCommand(reference: RuntimeModelControlsReference, level: String) throws -> RuntimeSettingCommand {
        let entry = try modelControlEntry(reference, action: .prepareThinkingCommand)
        guard let sessionKey = entry.sessionKey, entry.values.thinking?.levels.contains(level) == true else { throw RuntimeFailure(.invalidAnswer) }
        try validateNativeSessionInput(sessionKey, scope: entry.scope)
        // The existing Mobile path sends this as a normal command message. No
        // settings RPC, prompt dispatch or claimed application occurs here.
        return RuntimeSettingCommand(connectionID: entry.key.connectionID, sessionKey: sessionKey,
            settingsScope: entry.key.scope, text: "/think \(level)", thinkingLevel: nil)
    }

    func readModelControls(key: ModelControlKey, sessionKey: String?, scope: Scope) async throws -> ModelControlValues {
        try assertCurrent(scope)
        guard let connection else { throw RuntimeFailure(.superseded) }
        let backend = connection.backendKind
        let sdk = [.codex, .claudeCode, .pi].contains(backend)
        let params: JSONValue = sdk && sessionKey != nil ? .object(["sessionKey": .string(sessionKey!)]) : .object([:])
        let catalog = try await rpc("models.list", params: params, timeout: backend == .claudeCode ? .seconds(60) : .seconds(20), scope: scope)
        var values = try ModelControlsWire.parse(filteredModelControlPayload(catalog), backend: backend, scope: key.scope, unencrypted: modelTransportUnencrypted)
        if backend == .hermes {
            // Full selection/provider metadata is additive; the initial catalog
            // remains valid when a selection reply intentionally omits its rows.
            let selection = try await rpc("model.get", scope: scope)
            guard var merged = selection.object else { throw RuntimeFailure(.invalidResponse) }
            if merged["models"]?.array?.isEmpty != false { merged["models"] = catalog["models"] }
            values = try ModelControlsWire.parse(filteredModelControlPayload(.object(merged)), backend: backend, scope: key.scope, unencrypted: modelTransportUnencrypted)
        } else if backend == .openclaw {
            if let sessionKey {
                let session = try await readSessions(scope: scope).first { $0.key == sessionKey }
                values.currentModel = try ModelControlsWire.string(session?.raw["model"], maximum: 1_024)
                values.currentProvider = try ModelControlsWire.string(session?.raw["modelProvider"], maximum: 256)
                let raw = session?.raw ?? .null
                values.thinking = ModelControlsWire.openClawThinking(raw)
                values.reportsThinking = ModelControlsWire.hasOpenClawThinking(raw)
            } else {
                let result = try await rpc("config.get", scope: scope)
                let raw = result["config"]?["agents"]?["defaults"]?["model"]
                let model = raw?.stringValue != nil ? raw : raw?["primary"]
                values.currentModel = try ModelControlsWire.string(model, maximum: 1_024)
                values.configuredDefault = values.currentModel
                values.configHash = try ModelControlsWire.string(result["hash"], maximum: 256)
            }
            if let current = values.currentModel, let slash = current.firstIndex(of: "/") {
                values.currentProvider = values.currentProvider ?? String(current[..<slash])
                values.currentModel = String(current[current.index(after: slash)...])
            }
            values.models = ModelControlsWire.selecting(values.models, current: values.currentModel, provider: values.currentProvider)
        }
        if let history = modelControlsState.historyThinking[key], history.scope == scope,
           let thinking = values.thinking, thinking.current == nil {
            values.thinking = .init(current: history.level, levels: thinking.levels, writePath: nil)
        }
        if key.scope == .catalog {
            values.currentModel = nil; values.currentProvider = nil
            values.models = ModelControlsWire.selecting(values.models, current: nil, provider: nil)
        }
        if !modelPermissionsSupported { values.permissions = nil; values.permissionConfirmation = nil }
        if !modelFastSupported { values.fastMode = nil }
        try assertCurrent(scope)
        return values
    }

    func filteredModelControlPayload(_ payload: JSONValue) -> JSONValue {
        guard var object = payload.object else { return payload }
        if !modelFastSupported { object.removeValue(forKey: "fastMode") }
        if !modelPermissionsSupported { object.removeValue(forKey: "permissions") }
        return .object(object)
    }

    func modelControlKey(_ sessionKey: String?) throws -> ModelControlKey {
        guard let connection else { throw RuntimeFailure(.notConnected) }
        if let sessionKey { guard !sessionKey.isEmpty, sessionKey.utf8.count <= 1_024 else { throw RuntimeFailure(.invalidConnection) } }
        let scope: RuntimeModelControlScope
        switch connection.backendKind {
        case .hermes: scope = .global
        case .localModel:
            guard sessionKey == nil || sessionKey == "main" else { throw RuntimeFailure(.unsupported) }
            scope = .global
        case .openclaw: scope = sessionKey.map(RuntimeModelControlScope.session) ?? .global
        case .codex, .claudeCode, .pi: scope = sessionKey.map(RuntimeModelControlScope.session) ?? .catalog
        }
        return ModelControlKey(connectionID: connection.id, scope: scope)
    }

    var modelPermissionsSupported: Bool { connection?.backendKind == .codex && backendHealth["sessionPermissions"]?.boolValue == true }
    var modelFastSupported: Bool { connection?.backendKind == .codex && backendHealth["fastMode"]?.boolValue == true }
    var modelNativeBarrier: Bool { modelPermissionsSupported || modelFastSupported }
    var modelTransportUnencrypted: Bool { ["ws", "http"].contains(connection?.url.scheme?.lowercased() ?? "") }

    func modelSessionIdentity(_ sessionKey: String?) -> ModelControlSessionIdentity? {
        guard let sessionKey, let session = catalog.first(where: { $0.key == sessionKey }) else { return nil }
        return ModelControlSessionIdentity(session)
    }

    /// Retires display/reference authority for a changed physical route, never unresolved permission holds.
    func retireModelControls(sessionKey: String) {
        guard let key = try? modelControlKey(sessionKey) else { return }
        modelControlsState.invalidate(key)
        modelControlsState.historyThinking.removeValue(forKey: key)
    }

    func sameModelControlTarget(_ left: ModelControlSessionIdentity?, _ right: ModelControlSessionIdentity?) -> Bool {
        switch (left, right) {
        case (nil, nil): true
        case (.some(let left), .some(let right)): left.sameTarget(as: right)
        default: false
        }
    }

    func modelControlEntry(_ reference: RuntimeModelControlsReference, action: RuntimeModelControlAction) throws -> ModelControlsState.Entry {
        let scope = try scope()
        guard let entry = modelControlsState.entries[reference.token], entry.scope == scope,
              modelControlsState.contexts[entry.key] == entry.revision,
              modelSessionIdentity(entry.sessionKey) == entry.session else { throw RuntimeFailure(.requestUnavailable) }
        guard modelControlsSnapshot(entry).allowedActions.contains(action) else { throw RuntimeFailure(.unsupported) }
        return entry
    }

    func modelControlsSnapshot(_ entry: ModelControlsState.Entry) -> RuntimeModelControls {
        let hold = modelControlsState.holds[entry.key]
        let writeState: RuntimeModelControlWriteState = hold.map { $0.phase == .pending ? .pending : .uncertain } ?? .available
        var values = entry.values
        var permissions = values.permissions
        if let native = permissions {
            permissions = .init(mode: native.mode, available: modelPermissionsSupported && native.available,
                availableModes: modelPermissionsSupported ? native.availableModes : [],
                requiresConfirmation: native.requiresConfirmation || hold?.permissionsRequired == true,
                unencryptedTransport: modelTransportUnencrypted)
        }
        let actions = modelControlActions(entry, pending: writeState == .pending)
        if let thinking = values.thinking {
            let path: RuntimeModelThinking.WritePath? = actions.contains(.setThinkingLevel) ? .native
                : actions.contains(.prepareThinkingCommand) ? .command : nil
            values.thinking = .init(current: thinking.current, levels: thinking.levels, writePath: path)
        }
        let canSend = hold?.nativeBarrier != true
        return RuntimeModelControls(connectionID: entry.key.connectionID, backendKind: connection!.backendKind,
            generation: entry.scope.generation, sessionKey: entry.sessionKey, scope: entry.key.scope,
            reference: entry.reference, models: values.models, currentModel: values.currentModel, currentProvider: values.currentProvider,
            configuredDefaultModel: values.configuredDefault, thinking: values.thinking, fastMode: modelFastSupported ? values.fastMode : nil,
            permissions: permissions, allowedActions: actions, writeState: writeState, canSend: canSend, usesNativeSendBarrier: modelNativeBarrier)
    }

    func modelControlActions(_ entry: ModelControlsState.Entry, pending: Bool) -> Set<RuntimeModelControlAction> {
        guard !pending, state.phase == .ready, let connection, entry.key.scope != .catalog else { return [] }
        let backend = connection.backendKind
        if let key = entry.sessionKey, sessionManagementState.writes[key] != nil { return [] }
        var actions = Set<RuntimeModelControlAction>()
        let methodsPermit: (String) -> Bool = { self.supportedMethods.contains($0) || !self.sessionMethodsAdvertised }
        var writable = true
        if case .session(let key) = entry.key.scope {
            let row = catalog.first { $0.key == key }
            if [.codex, .claudeCode, .pi].contains(backend) {
                let active = row?.hasActiveRun == true || sessionEvents.runs.values.contains { $0.sessionKey == key && !$0.terminal }
                writable = !active && row?.archived != true && row?.project?.available != false
                if row?.source == "native" {
                    writable = writable && backend != .pi && sessionManagementState.liveScope == entry.scope && row?.canContinue == true
                }
            }
        }
        if writable, !entry.values.models.isEmpty,
           backend != .openclaw || (entry.key.scope == .global ? methodsPermit("config.patch") && entry.values.configHash != nil : methodsPermit("sessions.patch")) {
            actions.insert(.selectModel)
        }
        if let thinking = entry.values.thinking, !thinking.levels.isEmpty, let sessionKey = entry.sessionKey {
            if writable && (backend == .codex || (backend == .openclaw && entry.values.reportsThinking && methodsPermit("sessions.patch"))) {
                actions.insert(.setThinkingLevel)
            } else if [.openclaw, .hermes, .pi].contains(backend),
                      (try? validateNativeSessionInput(sessionKey, scope: entry.scope)) != nil {
                actions.insert(.prepareThinkingCommand)
            }
        }
        if writable, modelFastSupported, entry.values.fastMode?.available == true { actions.insert(.setFastMode) }
        if writable, modelPermissionsSupported, entry.values.permissions?.available == true,
           entry.values.permissions?.availableModes.isEmpty == false { actions.insert(.setPermissions) }
        return actions
    }
}
