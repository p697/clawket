import Foundation
import ClawketTransport

enum ModelControlChange: Sendable {
    case model(String, String?), thinking(String), fast(Bool), permissions(RuntimeSessionPermissionMode)
    var action: RuntimeModelControlAction {
        switch self {
        case .model: .selectModel
        case .thinking: .setThinkingLevel
        case .fast: .setFastMode
        case .permissions: .setPermissions
        }
    }
}

extension RuntimeCoordinator {
    public func selectModel(reference: RuntimeModelControlsReference, modelID: String,
                            provider: String? = nil) async throws -> RuntimeModelControlReceipt {
        try await changeModelControl(reference: reference, change: .model(modelID, provider))
    }

    public func setThinkingLevel(reference: RuntimeModelControlsReference, level: String) async throws -> RuntimeModelControlReceipt {
        try await changeModelControl(reference: reference, change: .thinking(level))
    }

    public func setFastMode(reference: RuntimeModelControlsReference, enabled: Bool) async throws -> RuntimeModelControlReceipt {
        try await changeModelControl(reference: reference, change: .fast(enabled))
    }

    public func preparePermissions(reference: RuntimeModelControlsReference, mode: RuntimeSessionPermissionMode) throws -> RuntimeModelPermissionConfirmation {
        let entry = try modelControlEntry(reference, action: .setPermissions)
        guard entry.values.permissions?.availableModes.contains(mode) == true else { throw RuntimeFailure(.invalidAnswer) }
        modelControlsState.confirmations = modelControlsState.confirmations.filter { $0.value.deadline > clock.now() }
        guard modelControlsState.confirmations.count < 32 else { throw RuntimeFailure(.capacity) }
        let value = RuntimeModelPermissionConfirmation(token: UUID(), reference: reference, mode: mode)
        modelControlsState.confirmations[value.token] = .init(value: value, deadline: clock.now() + .seconds(30))
        return value
    }

    public func setPermissions(confirmation: RuntimeModelPermissionConfirmation) async throws -> RuntimeModelControlReceipt {
        guard let saved = modelControlsState.confirmations[confirmation.token], saved.value == confirmation else {
            throw RuntimeFailure(.confirmationRequired)
        }
        guard saved.deadline > clock.now() else {
            modelControlsState.confirmations.removeValue(forKey: confirmation.token)
            throw RuntimeFailure(.requestExpired)
        }
        // Strict local validation precedes consumption. No await separates them.
        let entry = try modelControlEntry(confirmation.reference, action: .setPermissions)
        try validateModelChange(.permissions(confirmation.mode), entry: entry)
        modelControlsState.confirmations.removeValue(forKey: confirmation.token)
        return try await performModelChange(.permissions(confirmation.mode), key: entry.key,
            sessionKey: entry.sessionKey, scope: entry.scope, entry: entry)
    }

    /// Only settings barriers are reported here; readiness and native ownership are separate.
    public func modelSendBarrier(sessionKey: String) -> RuntimeModelSendBarrier? {
        guard let key = try? modelControlKey(sessionKey), let hold = modelControlsState.holds[key], hold.nativeBarrier else { return nil }
        if hold.permissionsRequired { return .permissionsRequired }
        return hold.phase == .pending ? .pending : .unconfirmed
    }

    func changeModelControl(reference: RuntimeModelControlsReference, change: ModelControlChange) async throws -> RuntimeModelControlReceipt {
        let entry = try modelControlEntry(reference, action: change.action)
        try validateModelChange(change, entry: entry)
        let resolved: ModelControlChange
        if case .model(let id, let provider) = change {
            resolved = .model(id, provider ?? entry.values.models.first(where: { $0.id == id })?.provider)
        } else { resolved = change }
        return try await performModelChange(resolved, key: entry.key, sessionKey: entry.sessionKey, scope: entry.scope, entry: entry)
    }

    func validateModelChange(_ change: ModelControlChange, entry: ModelControlsState.Entry) throws {
        switch change {
        case .model(let id, let provider):
            guard !id.isEmpty, id.utf8.count <= 1_024, provider?.utf8.count ?? 0 <= 256 else { throw RuntimeFailure(.invalidAnswer) }
            let candidates = entry.values.models.filter { $0.id == id && (provider == nil || $0.provider == provider) }
            guard candidates.count == 1 else { throw RuntimeFailure(.invalidAnswer) }
        case .thinking(let level):
            guard entry.values.thinking?.levels.contains(level) == true else { throw RuntimeFailure(.invalidAnswer) }
        case .fast: guard entry.values.fastMode?.available == true else { throw RuntimeFailure(.unsupported) }
        case .permissions(let mode):
            guard entry.values.permissions?.availableModes.contains(mode) == true else { throw RuntimeFailure(.invalidAnswer) }
        }
    }

    /// Also used by the pre-existing selection API: it cannot bypass a pending setting or native ownership.
    func selectLegacyModel(id: String, provider: String?, sessionKey: String?) async throws {
        let scope = try scope(), key = try modelControlKey(sessionKey)
        guard !id.isEmpty, id.utf8.count <= 1_024, provider?.utf8.count ?? 0 <= 256,
              key.scope != .catalog else { throw RuntimeFailure(.invalidConnection) }
        try validateLegacyModelWrite(sessionKey: sessionKey, scope: scope, key: key)
        _ = try await performModelChange(.model(id, provider), key: key, sessionKey: sessionKey, scope: scope, entry: nil)
    }

    func validateLegacyModelWrite(sessionKey: String?, scope: Scope, key: ModelControlKey) throws {
        try assertCurrent(scope)
        guard let connection else { throw RuntimeFailure(.superseded) }
        if let sessionKey, sessionManagementState.writes[sessionKey] != nil { throw RuntimeFailure(.requestBusy) }
        if connection.backendKind == .openclaw, sessionMethodsAdvertised {
            guard supportedMethods.contains(key.scope == .global ? "config.patch" : "sessions.patch") else { throw RuntimeFailure(.unsupported) }
        }
        if [.codex, .claudeCode, .pi].contains(connection.backendKind), let sessionKey {
            try validateNativeSessionInput(sessionKey, scope: scope)
            let row = catalog.first { $0.key == sessionKey }
            guard row?.archived != true, row?.project?.available != false,
                  row?.hasActiveRun != true, !sessionEvents.runs.values.contains(where: { $0.sessionKey == sessionKey && !$0.terminal }) else {
                throw RuntimeFailure(.requestBusy)
            }
        }
    }

    func performModelChange(_ change: ModelControlChange, key: ModelControlKey, sessionKey: String?,
                            scope: Scope, entry: ModelControlsState.Entry?) async throws -> RuntimeModelControlReceipt {
        try assertCurrent(scope)
        guard let connection else { throw RuntimeFailure(.superseded) }
        let backend = connection.backendKind
        var hash: String?
        // Fresh optimistic-concurrency evidence precedes the mutation. A read failure did not dispatch the write.
        if backend == .openclaw, key.scope == .global {
            do {
                let current = try await rpc("config.get", scope: scope)
                hash = try ModelControlsWire.string(current["hash"], maximum: 256)
                guard hash != nil else { throw RuntimeFailure(.invalidResponse) }
                if let expected = entry?.values.configHash, expected != hash { throw RuntimeFailure(.requestUnavailable) }
            } catch {
                let failure = runtimeFailure(error)
                throw RuntimeFailure(failure.code, delivery: .notDispatched, retryable: failure.retryable)
            }
        }
        try assertCurrent(scope)
        if let entry {
            _ = try modelControlEntry(entry.reference, action: change.action)
            try validateModelChange(change, entry: entry)
        } else { try validateLegacyModelWrite(sessionKey: sessionKey, scope: scope, key: key) }
        guard !Task.isCancelled else { throw RuntimeFailure(.superseded) }
        let prior = modelControlsState.holds[key]
        let id = try modelControlsState.begin(key: key, nativeBarrier: modelNativeBarrier)
        let revision = modelControlsState.contexts[key]
        let reference = entry?.reference ?? RuntimeModelControlsReference(token: UUID())
        let identity = modelSessionIdentity(sessionKey)
        var received = false
        do {
            let (method, params) = try modelChangeRequest(change, backend: backend, sessionKey: sessionKey, hash: hash)
            let timeout: Duration = change.action == .selectModel
                ? ([.claudeCode, .pi, .localModel].contains(backend) ? .seconds(190) : .seconds(45)) : (backend == .codex ? .seconds(45) : .seconds(20))
            let payload = try await rpc(method, params: params, timeout: timeout, scope: scope)
            received = true
            try assertCurrent(scope)
            guard modelControlsState.holds[key]?.id == id, modelControlsState.contexts[key] == revision, sameModelControlTarget(modelSessionIdentity(sessionKey), identity) else {
                throw RuntimeFailure(.superseded, delivery: .responseReceived)
            }
            // The older Gateway sessions.patch contract may omit an explicit ok field.
            let gatewayPatch = backend == .openclaw && method == "sessions.patch"
            guard payload.object != nil, payload["ok"]?.boolValue == true || (gatewayPatch && payload["ok"] == nil) else {
                throw RuntimeFailure(.invalidResponse, delivery: .responseReceived)
            }
            if let replyScope = payload["scope"]?.stringValue {
                let expected = key.scope == .global ? "global" : "session"
                guard replyScope == expected else { throw RuntimeFailure(.invalidResponse, delivery: .responseReceived) }
            }
            // Confirmed ACK is retained even if effective metadata is absent/malformed.
            var values: ModelControlValues?
            if payload["models"]?.array != nil {
                values = try? ModelControlsWire.parse(filteredModelControlPayload(payload), backend: backend,
                    scope: key.scope, unencrypted: modelTransportUnencrypted)
            }
            if backend == .localModel {
                // A fresh probe started after selection; never join a pre-selection health request.
                let health = try await rpc("health", timeout: .seconds(5), scope: scope)
                try validateHealth(health)
                await markReady(health: health, scope: scope)
                try assertCurrent(scope)
            }
            guard modelControlsState.holds[key]?.id == id, modelControlsState.contexts[key] == revision else { throw RuntimeFailure(.superseded, delivery: .responseReceived) }
            modelControlsState.holds[key]?.phase = .uncertain
            if let values { try modelControlsState.observeRead(values, key: key, permissionsSupported: modelPermissionsSupported) }
            else if modelControlsState.holds[key]?.nativeBarrier != true, modelControlsState.holds[key]?.permissionsRequired != true {
                modelControlsState.holds.removeValue(forKey: key)
            }
            modelControlsState.invalidate(key)
            var state: RuntimeModelControls?
            if let values {
                let fresh = try modelControlsState.issue(key: key, sessionKey: sessionKey, scope: scope, session: modelSessionIdentity(sessionKey), values: values)
                state = modelControlsSnapshot(fresh)
            }
            return RuntimeModelControlReceipt(reference: reference, connectionID: key.connectionID,
                sessionKey: sessionKey, scope: key.scope, action: change.action, state: state)
        } catch {
            let rawFailure = runtimeFailure(error)
            let failure = received && rawFailure.delivery == .notDispatched
                ? RuntimeFailure(rawFailure.code, delivery: .responseReceived, retryable: rawFailure.retryable) : rawFailure
            if isCurrent(scope), modelControlsState.holds[key]?.id == id {
                if failure.delivery == .notDispatched || failure.delivery == .rejectedBeforeDispatch {
                    let newlyRequired = modelControlsState.holds[key]?.permissionsRequired == true
                    modelControlsState.holds[key] = prior
                    // A concurrently observed real requirement is independent of this rejected write.
                    if newlyRequired { try? modelControlsState.requirePermissions(key) }
                } else { modelControlsState.holds[key]?.phase = .uncertain }
            }
            throw failure
        }
    }

    func modelChangeRequest(_ change: ModelControlChange, backend: BackendKind, sessionKey: String?, hash: String?) throws -> (String, JSONValue) {
        switch change {
        case .model(let id, let provider):
            if backend == .openclaw {
                let model = id.contains("/") || provider?.isEmpty != false ? id : "\(provider!)/\(id)"
                if let sessionKey { return ("sessions.patch", .object(["key": .string(sessionKey), "model": .string(model)])) }
                guard let hash else { throw RuntimeFailure(.invalidResponse) }
                let raw: JSONValue = .object(["agents": .object(["defaults": .object(["model": .object(["primary": .string(model)])])])])
                return ("config.patch", .object(["raw": .string(try FrameCodec.encode(raw)), "baseHash": .string(hash)]))
            }
            var params: [String: JSONValue] = ["model": .string(id)]
            if let provider { params["provider"] = .string(provider) }
            if backend == .hermes { params["scope"] = .string("global") }
            else if backend != .localModel {
                params["scope"] = .string(sessionKey == nil ? "global" : "session")
                if let sessionKey { params["sessionKey"] = .string(sessionKey) }
            }
            return (backend == .hermes ? "model.set" : "models.select", .object(params))
        case .thinking(let level):
            guard let sessionKey else { throw RuntimeFailure(.unsupported) }
            return backend == .openclaw ? ("sessions.patch", .object(["key": .string(sessionKey), "thinkingLevel": .string(level)]))
                : ("models.thinking", .object(["sessionKey": .string(sessionKey), "level": .string(level)]))
        case .fast(let enabled):
            guard let sessionKey else { throw RuntimeFailure(.unsupported) }
            return ("models.fast", .object(["sessionKey": .string(sessionKey), "enabled": .bool(enabled)]))
        case .permissions(let mode):
            guard let sessionKey else { throw RuntimeFailure(.unsupported) }
            return ("models.permissions", .object(["sessionKey": .string(sessionKey), "mode": .string(mode.rawValue)]))
        }
    }
}
