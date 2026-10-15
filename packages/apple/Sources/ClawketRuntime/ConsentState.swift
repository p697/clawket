import Foundation
import ClawketTransport

struct ConsentRegistry: Sendable {
    struct ListKey: Hashable, Sendable { let method: String; let sessionKey: String? }
    struct Record: Sendable {
        let key: ConsentKey
        var value: ConsentValue
        let scope: RuntimeCoordinator.Scope
        var revision: UInt64
        let deadline: Duration?
        let bytes: Int
    }
    struct Confirmation: Sendable {
        let reference: RuntimeRequestReference
        let deadline: Duration
    }
    var records: [UUID: Record] = [:]
    var keys: [ConsentKey: UUID] = [:]
    var tombstones: [ConsentKey: UInt64] = [:]
    var confirmations: [UUID: Confirmation] = [:]
    var evidence: Set<String> = []
    var unavailableReads: Set<String> = []
    var revision: UInt64 = 0
    var listCount = 0
    var listReads: [ListKey: UUID] = [:]
}

extension RuntimeCoordinator {
    func resetConsents() {
        consentExpiryTask?.cancel(); consentExpiryTask = nil
        if let connection, !consents.records.isEmpty {
            emit(.pendingRequests(.init(connectionID: connection.id, approvals: [], questions: [])))
        }
        consents = ConsentRegistry()
    }

    func pendingSnapshot() -> RuntimePendingRequests {
        let sorted = consents.records.values.sorted { $0.revision < $1.revision }
        return RuntimePendingRequests(connectionID: connection?.id ?? "",
            approvals: sorted.compactMap { if case .approval(let value) = $0.value { value } else { nil } },
            questions: sorted.compactMap { if case .question(let value) = $0.value { value } else { nil } })
    }

    func publishPending() {
        let snapshot = pendingSnapshot()
        emit(.pendingRequests(snapshot), weight: consents.records.values.reduce(128) { $0 + $1.bytes })
        scheduleConsentExpiry()
    }

    func applyConsent(_ key: ConsentKey, value: ConsentValue, scope: Scope, listRevision: UInt64? = nil) throws {
        try assertCurrent(scope)
        if let removed = consents.tombstones[key] {
            if listRevision == nil || removed > listRevision! { return }
            // A settled ID cannot become a fresh actionable request on the same authentication.
            return
        }
        if let id = consents.keys[key], let old = consents.records[id] {
            if let listRevision, old.revision > listRevision { return }
            guard old.value.reference.sessionKey == value.reference.sessionKey else { throw RuntimeFailure(.invalidResponse) }
            // Rewording or list metadata cannot turn an in-flight/unknown write into another action.
            guard old.value.state == .pending else { return }
            if old.value.raw == value.raw { return }
            // A changed review invalidates both an open confirmation and the old opaque reference.
            consents.records.removeValue(forKey: id)
            consents.confirmations = consents.confirmations.filter { $0.value.reference.id != id }
        }
        let bytes = try FrameCodec.encode(value.raw).utf8.count
        guard consents.records.count < 256, consents.records.values.reduce(bytes, { $0 + $1.bytes }) <= 8 * 1_024 * 1_024 else { throw RuntimeFailure(.capacity) }
        consents.revision += 1
        let deadline = value.expiresAtMs.map {
            clock.now() + .milliseconds(max(0, $0 - Self.wallMilliseconds()))
        }
        let record = ConsentRegistry.Record(key: key, value: value, scope: scope, revision: consents.revision, deadline: deadline, bytes: bytes)
        consents.records[value.reference.id] = record; consents.keys[key] = value.reference.id
        switch value {
        case .approval(let approval):
            if !approval.decisions.isEmpty {
                if approval.kind == .execution { consents.evidence.insert("execution") }
                if approval.kind == .pairing { consents.evidence.insert("pairing") }
            }
        case .question(let question): if question.canAnswer { consents.evidence.insert("questions") }
        }
        if expired(record) { try settleConsent(key, resolution: .expired) }
    }

    func settleConsent(_ key: ConsentKey, resolution: RuntimeRequestResolution, listRevision: UInt64? = nil) throws {
        if let id = consents.keys[key], let record = consents.records[id],
           let listRevision, record.revision > listRevision { return }
        guard consents.tombstones[key] != nil || consents.tombstones.count < 1_024 else { throw RuntimeFailure(.capacity) }
        consents.revision += 1; consents.tombstones[key] = consents.revision
        guard let id = consents.keys.removeValue(forKey: key), let record = consents.records.removeValue(forKey: id) else { return }
        consents.confirmations = consents.confirmations.filter { $0.value.reference.id != id }
        emit(.requestResolved(connectionID: record.value.reference.connectionID, reference: record.value.reference, resolution: resolution))
    }

    func expired(_ record: ConsentRegistry.Record) -> Bool {
        if let deadline = record.deadline, clock.now() >= deadline { return true }
        if let expiry = record.value.expiresAtMs, Self.wallMilliseconds() >= expiry { return true }
        return false
    }

    func checkedConsent(_ reference: RuntimeRequestReference) throws -> ConsentRegistry.Record {
        guard let record = consents.records[reference.id], record.value.reference == reference,
              reference.connectionID == connection?.id, isCurrent(record.scope) else { throw RuntimeFailure(.requestUnavailable) }
        if expired(record) {
            try settleConsent(record.key, resolution: .expired); publishPending()
            throw RuntimeFailure(.requestExpired)
        }
        guard record.value.state == .pending else { throw RuntimeFailure(.requestBusy) }
        return record
    }

    func scheduleConsentExpiry() {
        consentExpiryTask?.cancel(); consentExpiryTask = nil
        guard let deadline = consents.records.values.compactMap(\.deadline).min(), let scope = try? scope() else { return }
        let clock = clock
        consentExpiryTask = Task { [weak self] in
            do { try await clock.sleep(for: max(.zero, deadline - clock.now())) } catch { return }
            await self?.expireConsents(scope: scope)
        }
    }

    func expireConsents(scope: Scope) {
        guard isCurrent(scope) else { return }
        do {
            for record in consents.records.values where expired(record) { try settleConsent(record.key, resolution: .expired) }
            publishPending()
        } catch { attemptFailed(runtimeFailure(error), epoch: scope.epoch, attempt: scope.attempt) }
    }

    func updateConsentCapabilities() {
        guard let connection else { return }
        if [.codex, .claudeCode, .pi].contains(connection.backendKind), supportedMethods.contains("questions.list") && supportedMethods.contains("questions.respond") { consents.evidence.insert("questions") }
        if (connection.backendKind == .openclaw && supportedMethods.contains("exec.approval.resolve")) ||
            ([.codex, .claudeCode].contains(connection.backendKind) && supportedMethods.contains("approvals.resolve")) { consents.evidence.insert("execution") }
        if ["device", "node"].contains(where: { supportedMethods.contains("\($0).pair.list") && supportedMethods.contains("\($0).pair.approve") && supportedMethods.contains("\($0).pair.reject") }) { consents.evidence.insert("pairing") }
        if connection.backendKind == .hermes, bridgeCapabilities.contains("hermes.run-approval.v1") { consents.evidence.insert("execution") }
    }

    func receiveConsent(_ frame: JSONValue, scope: Scope) throws -> Bool {
        guard let connection, frame["type"]?.stringValue == "event", let event = frame["event"]?.stringValue else { return false }
        let payload = frame["payload"] ?? .null
        var canonical = payload
        if event == "exec.approval.requested", [.openclaw, .hermes].contains(connection.backendKind) {
            guard let request = payload["request"]?.object else { throw RuntimeFailure(.invalidResponse) }
            var approval = request
            approval["kind"] = .string("exec"); approval["id"] = payload["id"]
            approval["expiresAtMs"] = payload["expiresAtMs"] ?? .null
            canonical = .object(["type": .string("approval_requested"), "approval": .object(approval), "sessionKey": request["sessionKey"] ?? .null])
        } else if event == "exec.approval.resolved", [.openclaw, .hermes].contains(connection.backendKind) {
            canonical = .object(["type": .string("approval_resolved"), "approvalId": payload["id"] ?? .null,
                                 "kind": .string("exec"), "decision": payload["decision"] ?? .null])
        } else if ["device.pair.requested", "node.pair.requested"].contains(event), connection.backendKind == .openclaw {
            var approval = payload.object ?? [:]
            approval["kind"] = .string("pair"); approval["target"] = .string(event.hasPrefix("device") ? "device" : "node")
            approval["id"] = payload["requestId"]; approval["receivedAtMs"] = payload["ts"] ?? .number(Double(Self.wallMilliseconds()))
            canonical = .object(["type": .string("approval_requested"), "approval": .object(approval)])
        } else if ["device.pair.resolved", "node.pair.resolved"].contains(event), connection.backendKind == .openclaw {
            canonical = .object(["type": .string("approval_resolved"), "approvalId": payload["requestId"] ?? .null,
                "kind": .string("pair"), "target": .string(event.hasPrefix("device") ? "device" : "node"), "decision": payload["decision"] ?? .null])
        } else if event != BackendProfile.profile(for: connection.backendKind).updateEvent { return false }
        switch canonical["type"]?.stringValue {
        case "question_requested":
            let session = try ConsentWire.required(canonical["sessionKey"], max: 1_024)
            let parsed: (ConsentKey, ConsentValue)
            do { parsed = try ConsentWire.question(canonical["question"] ?? .null, sessionKey: session, connection: connection) }
            catch let failure as RuntimeFailure where failure.code == .unsupported { return false }
            let (key, value) = parsed
            try applyConsent(key, value: value, scope: scope)
        case "question_resolved":
            let session = try ConsentWire.required(canonical["sessionKey"], max: 1_024)
            let id = try ConsentWire.required(canonical["questionId"], max: 512)
            try settleConsent(.init(kind: .question, wireID: id, sessionKey: session), resolution: .answered)
        case "approval_requested":
            let session = try ConsentWire.string(canonical["sessionKey"], max: 1_024)
            let parsed: (ConsentKey, ConsentValue)
            do { parsed = try ConsentWire.approval(canonical["approval"] ?? .null, sessionKey: session, connection: connection) }
            catch let failure as RuntimeFailure where failure.code == .unsupported { return false }
            let (key, value) = parsed
            try applyConsent(key, value: value, scope: scope)
        case "approval_resolved":
            let id = try ConsentWire.required(canonical["approvalId"], max: 512)
            let kind = canonical["kind"]?.stringValue
            let keyKind: ConsentKey.Kind
            if kind == "pair" {
                guard let target = canonical["target"]?.stringValue, ["device", "node"].contains(target) else { throw RuntimeFailure(.invalidResponse) }
                keyKind = target == "device" ? .device : .node
            } else if kind == "plugin" { keyKind = .plugin }
            else { keyKind = .execution }
            let decision = canonical["decision"]?.stringValue
            let resolution: RuntimeRequestResolution = decision == "expired" ? .expired
                : decision.flatMap(RuntimeApprovalDecision.init(rawValue:)).map(RuntimeRequestResolution.decision) ?? .resolved
            try settleConsent(.init(kind: keyKind, wireID: id, sessionKey: nil), resolution: resolution)
        default: return false
        }
        updateConsentCapabilities(); publishState(.ready); publishPending()
        return true
    }

    static func wallMilliseconds() -> Int64 { Int64(Date().timeIntervalSince1970 * 1_000) }
}
