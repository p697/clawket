import Foundation
import ClawketTransport

extension RuntimeCoordinator {
    /// Current in-memory requests, without a network probe. Not a persisted authority.
    public func pendingRequests() throws -> RuntimePendingRequests {
        _ = try scope()
        for record in consents.records.values where expired(record) { try settleConsent(record.key, resolution: .expired) }
        return pendingSnapshot()
    }

    /// Refreshes safe read-only routes for the selected session and connection-wide pairing.
    /// The result also includes unresolved requests observed in other sessions on this connection.
    public func listPending(sessionKey: String? = nil) async throws -> RuntimePendingRequests {
        let scope = try scope()
        guard let connection else { throw RuntimeFailure(.notConnected) }
        _ = try ConsentWire.optionalSession(sessionKey)
        let sessionRevision = try sessionKey.map { try consentSessionRevision($0) }
        guard consents.listCount < 2 else { throw RuntimeFailure(.capacity) }
        consents.listCount += 1
        defer { if isCurrent(scope) { consents.listCount -= 1 } }
        if let sessionKey, let sessionRevision, consentSessionCurrent(sessionKey, revision: sessionRevision) {
            let params: JSONValue = .object(["sessionKey": .string(sessionKey)])
            if [.codex, .claudeCode, .pi].contains(connection.backendKind) {
                try await refreshConsentList("questions.list", params: params, kind: .question, sessionKey: sessionKey, scope: scope)
            }
            if consentSessionCurrent(sessionKey, revision: sessionRevision),
               [.codex, .claudeCode].contains(connection.backendKind) ||
                (connection.backendKind == .hermes && consents.evidence.contains("execution")) {
                try await refreshConsentList(connection.backendKind == .hermes ? "exec.approval.list" : "approvals.list",
                    params: params, kind: .execution, sessionKey: sessionKey, scope: scope)
            }
        }
        if connection.backendKind == .openclaw {
            try await refreshConsentList("device.pair.list", kind: .device, scope: scope)
            try await refreshConsentList("node.pair.list", kind: .node, scope: scope)
        }
        try assertCurrent(scope)
        for record in consents.records.values where expired(record) { try settleConsent(record.key, resolution: .expired) }
        publishState(.ready); publishPending()
        return pendingSnapshot()
    }

    public func prepareApprovalConfirmation(_ reference: RuntimeRequestReference) throws -> RuntimeApprovalConfirmation {
        let record = try checkedConsent(reference)
        guard case .approval(let approval) = record.value, approval.decisions.contains(.allowAlways) else { throw RuntimeFailure(.unsupported) }
        consents.confirmations = consents.confirmations.filter { $0.value.deadline > clock.now() && $0.value.reference != reference }
        guard consents.confirmations.count < 64 else { throw RuntimeFailure(.capacity) }
        let value = RuntimeApprovalConfirmation(id: UUID(), reference: reference)
        consents.confirmations[value.id] = .init(reference: reference, deadline: clock.now() + .seconds(30))
        return value
    }

    public func resolve(_ reference: RuntimeRequestReference, decision: RuntimeApprovalDecision,
                        confirmation: RuntimeApprovalConfirmation? = nil) async throws {
        let record = try checkedConsent(reference)
        guard case .approval(let approval) = record.value, approval.decisions.contains(decision), let connection else { throw RuntimeFailure(.unsupported) }
        guard approval.kind == .execution ? state.capabilities.executionApprovals :
                approval.kind == .pairing && state.capabilities.pairingApprovals else { throw RuntimeFailure(.unsupported) }
        if decision == .allowAlways {
            guard let confirmation, confirmation.reference == reference,
                  let saved = consents.confirmations.removeValue(forKey: confirmation.id), saved.reference == reference,
                  saved.deadline > clock.now() else { throw RuntimeFailure(.confirmationRequired) }
        } else if confirmation != nil { throw RuntimeFailure(.invalidAnswer) }
        let method: String
        let params: JSONValue
        switch approval.kind {
        case .execution:
            guard [.openclaw, .hermes, .codex, .claudeCode].contains(connection.backendKind) else { throw RuntimeFailure(.unsupported) }
            method = [.openclaw, .hermes].contains(connection.backendKind) ? "exec.approval.resolve" : "approvals.resolve"
            params = .object(["id": .string(record.key.wireID), "decision": .string(decision.rawValue)])
        case .pairing:
            guard connection.backendKind == .openclaw, let target = approval.pairingTarget,
                  [.approve, .reject].contains(decision) else { throw RuntimeFailure(.unsupported) }
            method = "\(target.rawValue).pair.\(decision == .approve ? "approve" : "reject")"
            params = .object(["requestId": .string(record.key.wireID)])
        case .plugin: throw RuntimeFailure(.unsupported)
        }
        try await dispatchConsent(record, method: method, params: params, resolution: .decision(decision), verifyOK: approval.kind != .pairing)
    }

    public func answer(_ reference: RuntimeRequestReference, answer: RuntimeQuestionAnswer) async throws {
        let record = try checkedConsent(reference)
        guard case .question(let question) = record.value, let session = reference.sessionKey else { throw RuntimeFailure(.unsupported) }
        var params = try ConsentWire.answer(answer, question: question)
        params["sessionKey"] = .string(session); params["questionId"] = .string(record.key.wireID)
        try await dispatchConsent(record, method: "questions.respond", params: .object(params), resolution: .answered,
                                  waitForResolution: answer == .cancel)
    }

    func dispatchConsent(_ record: ConsentRegistry.Record, method: String, params: JSONValue,
                         resolution: RuntimeRequestResolution, waitForResolution: Bool = false, verifyOK: Bool = true) async throws {
        let reference = record.value.reference
        // No await between validation, locking and the sole dispatch. Later events can settle it.
        _ = try checkedConsent(reference)
        let sessionRevision = try reference.sessionKey.map { try consentSessionRevision($0) }
        consents.revision += 1
        let dispatchRevision = consents.revision
        consents.records[reference.id]?.value.state = .submitting
        consents.records[reference.id]?.revision = dispatchRevision
        publishPending()
        let dispatch = Task { [weak self] in
            guard !Task.isCancelled else { throw RuntimeFailure(.superseded) }
            guard let self else { throw RuntimeFailure(.superseded) }
            return try await self.rpc(method, params: params, timeout: .seconds(20), scope: record.scope)
        }
        consents.records[reference.id]?.dispatch = dispatch
        defer { consents.records[reference.id]?.dispatch = nil }
        do {
            let result = try await withTaskCancellationHandler { try await dispatch.value } onCancel: { dispatch.cancel() }
            if let session = reference.sessionKey, let sessionRevision,
               !consentSessionCurrent(session, revision: sessionRevision) {
                throw RuntimeFailure(.superseded, delivery: .responseReceived)
            }
            // Gateway exec resolution uses {ok:true}; device/node approval may return its record.
            guard !verifyOK || result["ok"]?.boolValue == true else { throw RuntimeFailure(.invalidResponse, delivery: .responseReceived) }
            if consents.records[reference.id] != nil {
                if waitForResolution {
                    // A cancel ACK may only mean interrupt accepted. Keep held until native resolution/list.
                    consents.records[reference.id]?.value.state = .uncertain
                    consents.revision += 1
                    let revision = consents.revision; consents.records[reference.id]?.revision = revision
                } else { try settleConsent(record.key, resolution: resolution) }
                publishPending()
            }
        } catch {
            var failure = runtimeFailure(error)
            if let session = reference.sessionKey, let sessionRevision,
               !consentSessionCurrent(session, revision: sessionRevision) {
                failure = RuntimeFailure(.superseded, delivery: failure.delivery)
            }
            if isCurrent(record.scope), consents.records[reference.id] != nil {
                // Only a local failure before dispatch is safe to offer again. A peer error can follow
                // an accepted native write, so even a malformed or rejected response stays held.
                consents.records[reference.id]?.value.state = failure.delivery == .notDispatched ? .pending : .uncertain
                consents.revision += 1
                let revision = consents.revision; consents.records[reference.id]?.revision = revision
                publishPending()
            }
            failure = RuntimeFailure(failure.code, delivery: failure.delivery, retryable: false)
            throw failure
        }
    }

    func refreshConsentList(_ method: String, params: JSONValue = .object([:]), kind: ConsentKey.Kind,
                            sessionKey: String? = nil, scope: Scope) async throws {
        guard !consents.unavailableReads.contains(method), let connection, let transport else { return }
        try assertCurrent(scope)
        let sessionRevision = try sessionKey.map { try consentSessionRevision($0) }
        if let sessionKey, let sessionRevision, !consentSessionCurrent(sessionKey, revision: sessionRevision) { return }
        let listKey = ConsentRegistry.ListKey(method: method, sessionKey: sessionKey)
        let listID = UUID()
        consents.listReads[listKey] = listID
        defer { if isCurrent(scope), consents.listReads[listKey] == listID { consents.listReads.removeValue(forKey: listKey) } }
        let revision = consents.revision
        let payload: JSONValue
        do {
            payload = try await transport.request(method: method, params: params, timeout: .seconds(8), generation: scope.generation)
            try assertCurrent(scope)
            guard consents.listReads[listKey] == listID else { return }
            if let sessionKey, let sessionRevision, !consentSessionCurrent(sessionKey, revision: sessionRevision) { return }
        } catch {
            try assertCurrent(scope)
            guard consents.listReads[listKey] == listID else { return }
            if let sessionKey, let sessionRevision, !consentSessionCurrent(sessionKey, revision: sessionRevision) { return }
            if let error = error as? RPCFailure, error.code == .remoteRejection, unsupportedConsentRead(error, method: method) {
                // Optional discovery is read-only. A rejected route is not evidence of support.
                consents.unavailableReads.insert(method); return
            }
            throw runtimeFailure(error)
        }
        try ConsentWire.bounded(payload, bytes: 1_024 * 1_024)
        let values: [JSONValue]
        if kind == .device || kind == .node {
            guard let pending = payload["pending"]?.array else { throw RuntimeFailure(.invalidResponse) }
            values = pending
        } else {
            guard let pending = payload.array else { throw RuntimeFailure(.invalidResponse) }
            values = pending
        }
        guard values.count <= 128 else { throw RuntimeFailure(.capacity) }
        // Parse the whole snapshot first. A corrupt entry must not partially replace valid state.
        var parsed: [(ConsentKey, ConsentValue)] = []
        var seen = Set<ConsentKey>()
        for raw in values {
            let item: (ConsentKey, ConsentValue)
            if kind == .question {
                guard let sessionKey else { throw RuntimeFailure(.invalidResponse) }
                item = try ConsentWire.question(raw, sessionKey: sessionKey, connection: connection)
            } else if kind == .execution {
                let approval = raw["approval"] ?? raw
                let actualSession = raw["approval"] == nil ? sessionKey : raw["sessionKey"]?.stringValue
                guard actualSession.map({ Data($0.utf8) }) == sessionKey.map({ Data($0.utf8) }),
                      approval["kind"]?.stringValue == "exec" else { throw RuntimeFailure(.invalidResponse) }
                item = try ConsentWire.approval(approval, sessionKey: actualSession, connection: connection)
            } else {
                var value = raw.object ?? [:]
                value["kind"] = .string("pair"); value["target"] = .string(kind == .device ? "device" : "node")
                value["id"] = raw["requestId"]; value["receivedAtMs"] = raw["ts"] ?? .number(Double(Self.wallMilliseconds()))
                item = try ConsentWire.approval(.object(value), sessionKey: nil, connection: connection)
            }
            guard seen.insert(item.0).inserted else { throw RuntimeFailure(.invalidResponse) }
            parsed.append(item)
        }
        // Preflight all capacity/ownership checks before emitting any removals from this snapshot.
        var prospective = Dictionary(uniqueKeysWithValues: consents.records.values.map { ($0.key, $0.bytes) })
        var settling = Set<ConsentKey>()
        for record in consents.records.values where record.key.kind == kind && record.revision <= revision &&
            (kind != .execution && kind != .question || record.value.reference.sessionKey.map { Data($0.utf8) } == sessionKey.map { Data($0.utf8) }) && !seen.contains(record.key) {
            prospective.removeValue(forKey: record.key); settling.insert(record.key)
        }
        for (key, value) in parsed where consents.tombstones[key] == nil {
            if let id = consents.keys[key], let old = consents.records[id] {
                if old.revision > revision { continue }
                guard old.value.reference.sessionKey.map({ Data($0.utf8) }) == value.reference.sessionKey.map({ Data($0.utf8) }) else {
                    throw RuntimeFailure(.invalidResponse)
                }
            }
            prospective[key] = try FrameCodec.encode(value.raw).utf8.count
            if let expiry = value.expiresAtMs, Self.wallMilliseconds() >= expiry { settling.insert(key) }
        }
        guard prospective.count <= 256, prospective.values.reduce(0, +) <= 8 * 1_024 * 1_024,
              Set(consents.tombstones.keys).union(settling).count <= 1_024 else { throw RuntimeFailure(.capacity) }
        for record in consents.records.values where record.key.kind == kind &&
            (kind != .execution && kind != .question || record.value.reference.sessionKey.map { Data($0.utf8) } == sessionKey.map { Data($0.utf8) }) && !seen.contains(record.key) {
            try settleConsent(record.key, resolution: .resolved, listRevision: revision)
        }
        for (key, value) in parsed { try applyConsent(key, value: value, scope: scope, listRevision: revision) }
        consents.evidence.insert(kind == .question ? "questions" : kind == .execution ? "execution" : "pairing")
    }

    func unsupportedConsentRead(_ error: RPCFailure, method: String) -> Bool {
        let code = error.remoteError?["code"]?.stringValue?.uppercased() ?? ""
        if ["METHOD_NOT_FOUND", "UNKNOWN_METHOD", "UNSUPPORTED_METHOD", "NOT_IMPLEMENTED"].contains(code) { return true }
        // Closed SDK messages preserve compatibility with Bridges that use backend error codes.
        let message = error.remoteError?["message"]?.stringValue ?? ""
        return ["Unsupported Claude method", "Unsupported Pi operation", "Unsupported Codex operation",
                "Unsupported Hermes bridge method: \(method)"].contains(message)
    }
}
