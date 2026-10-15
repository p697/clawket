import Foundation

extension RuntimeCoordinator {
    // Original UTF-8 route identity: normalization must not retire a different opaque session.
    func consentSessionRevision(_ sessionKey: String) throws -> UUID {
        let key = Data(sessionKey.utf8)
        if let context = consents.sessions[key] { return context.revision }
        guard consents.sessions.count < 1_024 else { throw RuntimeFailure(.capacity) }
        let context = ConsentRegistry.SessionContext()
        consents.sessions[key] = context
        return context.revision
    }

    func consentSessionCurrent(_ sessionKey: String, revision: UUID) -> Bool {
        consents.sessions[Data(sessionKey.utf8)]?.revision == revision && !consentSessionHeld(sessionKey)
    }

    func consentSessionHeld(_ sessionKey: String) -> Bool {
        consents.sessionRetirements[Data(sessionKey.utf8)] != nil
    }

    /// Local reset/delete is a physical-context boundary before any possible backend dispatch.
    /// Retiring a review never asserts that the backend resolved, cancelled or accepted it.
    func retireSessionConsents(_ sessionKey: String, writeToken: UUID? = nil) throws {
        let route = Data(sessionKey.utf8)
        let retiring = consents.records.values.filter { $0.value.reference.sessionKey.map { Data($0.utf8) } == route }
        guard Set(consents.tombstones.keys).union(retiring.map(\.key)).count <= 1_024 else { throw RuntimeFailure(.capacity) }
        _ = try consentSessionRevision(sessionKey)
        consents.sessions[route]?.revision = UUID()
        consents.sessions[route]?.headRead = nil
        consents.listReads = consents.listReads.filter { $0.key.sessionKey.map { Data($0.utf8) } != route }
        var recoverable: [ConsentKey: UInt64] = [:]
        for record in retiring {
            record.dispatch?.cancel()
            consents.revision += 1
            consents.tombstones[record.key] = consents.revision
            if record.value.state == .pending { recoverable[record.key] = consents.revision }
            let id = record.value.reference.id
            consents.records.removeValue(forKey: id)
            consents.keys.removeValue(forKey: record.key)
            consents.confirmations = consents.confirmations.filter { $0.value.reference.id != id }
        }
        if let writeToken {
            consents.sessionRetirements[route] = .init(token: writeToken, recoverable: recoverable)
        }
        if !retiring.isEmpty { publishPending() }
    }

    func finishSessionConsentRetirement(_ sessionKey: String, token: UUID, notDispatched: Bool) {
        let route = Data(sessionKey.utf8)
        guard let retirement = consents.sessionRetirements[route], retirement.token == token else { return }
        if notDispatched {
            for (key, revision) in retirement.recoverable where consents.tombstones[key] == revision {
                consents.tombstones.removeValue(forKey: key)
            }
        }
        // The old UUID/Always token is never restored, including when a local preflight failed.
        // Only a later real event/list can produce a new review. Unknown writes never call this.
        consents.sessionRetirements.removeValue(forKey: route)
    }

    func beginConsentHistoryRead(_ sessionKey: String) throws -> UUID {
        _ = try consentSessionRevision(sessionKey)
        let id = UUID()
        consents.sessions[Data(sessionKey.utf8)]?.headRead = id
        return id
    }

    func acceptConsentHistory(_ history: RuntimeHistory, headRead: UUID, scope: Scope) throws {
        try assertCurrent(scope)
        let route = Data(history.key.utf8)
        guard consents.sessions[route]?.headRead == headRead, let physicalID = history.sessionID else { return }
        let actual = Data(physicalID.utf8)
        if let previous = consents.sessions[route]?.physicalID, previous != actual {
            do { try retireSessionConsents(history.key) }
            catch {
                // A known physical change cannot leave old authority live when a bound is full.
                attemptFailed(RuntimeFailure(.capacity), epoch: scope.epoch, attempt: scope.attempt)
                throw RuntimeFailure(.capacity)
            }
        }
        consents.sessions[route]?.physicalID = actual
    }
}
