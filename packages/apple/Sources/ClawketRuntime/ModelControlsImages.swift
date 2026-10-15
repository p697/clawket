import Foundation

extension RuntimeCoordinator {
    func modelImagesInFlight(_ key: ModelControlKey) -> Bool {
        modelControlsState.imageDispatches.contains { item in
            item.key.connectionID == key.connectionID && !item.value.isEmpty && (key.scope == .global || item.key == key)
        }
    }

    func observeModelImageEvidence(_ values: ModelControlValues, key: ModelControlKey, scope: Scope, sessionKey: String?) {
        guard values.currentModel != nil else { return }
        let selected = values.models.filter(\.selected)
        let global = ModelControlKey(connectionID: key.connectionID, scope: .global)
        let globalChange = connection?.backendKind == .openclaw && key.scope != .global && modelControlsState.holds[global]?.changesModel == true
        let pending = modelControlsState.holds[key].map { $0.phase == .pending && $0.changesModel } ?? false
        let sessionPending = sessionKey.map { sessionManagementState.writes[$0] != nil && modelControlsState.sessionModelChanges.contains(key) } ?? false
        if !sessionPending { modelControlsState.sessionModelChanges.remove(key) }
        modelControlsState.imageEvidence[key] = .init(scope: scope,
            session: key.scope == .global ? nil : modelSessionIdentity(sessionKey),
            support: selected.count == 1 ? selected[0].supportsImages : nil, stale: pending || globalChange || sessionPending)
    }

    func validateModelImages(sessionKey: String, scope: Scope) throws {
        try assertCurrent(scope)
        let key = try modelControlKey(sessionKey)
        let global = ModelControlKey(connectionID: key.connectionID, scope: .global)
        guard modelControlsState.holds[key]?.changesModel != true,
              !(connection?.backendKind == .openclaw && modelControlsState.holds[global]?.changesModel == true),
              sessionManagementState.writes[sessionKey] == nil, !modelControlsState.sessionModelChanges.contains(key) else { throw RuntimeFailure(.requestBusy) }
        if let evidence = modelControlsState.imageEvidence[key], evidence.scope == scope {
            let session = key.scope == .global ? nil : modelSessionIdentity(sessionKey)
            guard !evidence.stale, evidence.session == session else { throw RuntimeFailure(.requestBusy) }
            guard evidence.support != false else { throw RuntimeFailure(.unsupported) }
        }
        // Missing initial input metadata remains unknown, matching Mobile. It
        // cannot bypass an observed text-only model or a pending/unknown change.
    }

    func reserveModelImages(sessionKey: String, scope: Scope) throws -> (ModelControlKey, UUID) {
        try validateModelImages(sessionKey: sessionKey, scope: scope)
        guard modelControlsState.imageDispatches.values.reduce(0, { $0 + $1.count }) < 128 else { throw RuntimeFailure(.capacity) }
        let key = try modelControlKey(sessionKey), token = UUID()
        modelControlsState.imageDispatches[key, default: []].insert(token)
        return (key, token)
    }

    func releaseModelImages(_ reservation: (ModelControlKey, UUID)?) {
        guard let (key, token) = reservation else { return }
        modelControlsState.imageDispatches[key]?.remove(token)
        if modelControlsState.imageDispatches[key]?.isEmpty == true { modelControlsState.imageDispatches.removeValue(forKey: key) }
    }
}
