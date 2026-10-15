import Foundation
import ClawketTransport

struct SessionManagementState: Sendable {
    struct Entry: Sendable {
        let reference: RuntimeSessionReference
        let scope: RuntimeCoordinator.Scope
        let revision: UUID
        let session: RuntimeSession
    }
    enum Write: Sendable { case pending(UUID), uncertain }
    var liveScope: RuntimeCoordinator.Scope?
    var archiveScope: RuntimeCoordinator.Scope?
    var liveRevision = UUID()
    var archiveRevision = UUID()
    var archives: [RuntimeSession] = []
    var entries: [UUID: Entry] = [:]
    var order: [UUID] = []
    var writes: [String: Write] = [:]
    var archiveRead: UUID?

    mutating func invalidateRows() {
        liveScope = nil; archiveScope = nil; liveRevision = UUID(); archiveRevision = UUID(); archives = []
        entries = [:]; order = []; archiveRead = nil
        // A new read is not proof that a previously dispatched write failed.
    }

    mutating func invalidate(_ key: String) {
        let tokens = entries.filter { $0.value.session.key == key }.map(\.key)
        for token in tokens { entries.removeValue(forKey: token) }
        order.removeAll { tokens.contains($0) }
    }

    mutating func issue(_ session: RuntimeSession, scope: RuntimeCoordinator.Scope, revision: UUID) -> RuntimeSessionReference {
        invalidate(session.key)
        if entries.count >= 256, let oldest = order.first {
            entries.removeValue(forKey: oldest); order.removeFirst()
        }
        let reference = RuntimeSessionReference(token: UUID())
        entries[reference.token] = Entry(reference: reference, scope: scope, revision: revision, session: session)
        order.append(reference.token)
        return reference
    }
}

enum SessionManagementPolicy {
    static func capabilities(_ backend: BackendKind, methods: Set<String>, health: JSONValue,
                             bridgeCapabilities: [String], legacyGatewayEvidence: Bool = false) -> RuntimeSessionManagementCapabilities {
        // These ceilings mirror agent-protocol's declared matrix. OpenClaw also
        // supplies method advertisement; Hermes explicitly negotiates multi-session.
        switch backend {
        case .openclaw:
            return .init(rename: methods.contains("sessions.patch") || legacyGatewayEvidence,
                         reset: methods.contains("sessions.reset") || legacyGatewayEvidence,
                         delete: methods.contains("sessions.delete") || legacyGatewayEvidence, archive: false, branch: false)
        case .hermes:
            let multi = bridgeCapabilities.contains("hermes.multi-session.v2")
            return .init(rename: multi, reset: multi, delete: multi, archive: false, branch: false)
        case .codex:
            return .init(rename: true, reset: true, delete: true, archive: health["sessionArchive"]?.boolValue == true, branch: true)
        case .claudeCode, .pi:
            return .init(rename: true, reset: true, delete: true, archive: false, branch: true)
        case .localModel:
            return .init(rename: false, reset: false, delete: false, archive: false, branch: false)
        }
    }

    static func actions(_ session: RuntimeSession, backend: BackendKind,
                        capabilities: RuntimeSessionManagementCapabilities, active: Bool) -> Set<RuntimeSessionAction> {
        guard let row = session.allowedActions else { return [] }
        let native = session.source == "native", archived = session.archived == true
        let sdk = [.codex, .claudeCode, .pi].contains(backend)
        if sdk, let source = session.source, !["native", "bridge"].contains(source) { return [] }
        var actions = Set<RuntimeSessionAction>()
        if !archived {
            if capabilities.rename && row.rename && !(backend == .pi && active)
                && (!native || backend == .codex) { actions.insert(.rename) }
            if capabilities.reset && row.reset && !(sdk && (native || active)) { actions.insert(.reset) }
            if capabilities.delete && row.delete && !(sdk && (native || active))
                && !(capabilities.archive && row.archive) { actions.insert(.delete) }
            // Copying never authorizes taking over the native thread or changing its project.
            if capabilities.branch && native && session.canContinue != true
                && session.project?.available != false && session.continuationBlockedReason != "project_unavailable"
                && (!active || backend == .claudeCode) { actions.insert(.branch) }
        }
        if capabilities.archive && row.archive && !active { actions.insert(archived ? .unarchive : .archive) }
        return actions
    }
}
