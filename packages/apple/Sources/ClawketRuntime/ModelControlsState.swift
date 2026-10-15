import Foundation

struct ModelControlKey: Sendable, Equatable, Hashable {
    let connectionID: String
    let scope: RuntimeModelControlScope
}

struct ModelControlSessionIdentity: Sendable, Equatable {
    let sessionID: String?
    let model: String?
    let provider: String?
    let source: String?
    let canContinue: Bool?
    let archived: Bool?
    let project: RuntimeProject?

    func sameTarget(as other: Self) -> Bool {
        sessionID == other.sessionID && source == other.source && canContinue == other.canContinue
            && archived == other.archived && project == other.project
    }

    init(_ session: RuntimeSession) {
        sessionID = session.sessionID; model = session.model; provider = session.modelProvider
        source = session.source; canContinue = session.canContinue; archived = session.archived; project = session.project
    }
}

/// Settings holds survive socket/authentication retirement; references and pending reads do not.
struct ModelControlsState: Sendable {
    struct Entry: Sendable {
        let reference: RuntimeModelControlsReference
        let key: ModelControlKey
        let sessionKey: String?
        let scope: RuntimeCoordinator.Scope
        let revision: UUID
        let session: ModelControlSessionIdentity?
        let values: ModelControlValues
    }
    struct Hold: Sendable {
        enum Phase: Sendable, Equatable { case pending, uncertain }
        let id: UUID
        var phase: Phase
        var nativeBarrier: Bool
        var permissionsRequired: Bool
    }
    struct Confirmation: Sendable {
        let value: RuntimeModelPermissionConfirmation
        let deadline: Duration
    }
    var confirmations: [UUID: Confirmation] = [:]
    var entries: [UUID: Entry] = [:]
    var entryOrder: [UUID] = []
    var contexts: [ModelControlKey: UUID] = [:]
    var contextOrder: [ModelControlKey] = []
    var holds: [ModelControlKey: Hold] = [:]
    var latestThinkingRead: [ModelControlKey: UUID] = [:]
    var historyThinking: [ModelControlKey: (scope: RuntimeCoordinator.Scope, level: String)] = [:]
    var reads: Set<UUID> = []
    var latestRead: [ModelControlKey: UUID] = [:]

    mutating func admit(_ key: ModelControlKey) throws -> UUID {
        if let revision = contexts[key] { return revision }
        if contexts.count >= 128 {
            guard let oldest = contextOrder.first(where: { holds[$0] == nil && latestRead[$0] == nil }) else { throw RuntimeFailure(.capacity) }
            invalidate(oldest); historyThinking.removeValue(forKey: oldest); contexts.removeValue(forKey: oldest); contextOrder.removeAll { $0 == oldest }
        }
        let revision = UUID(); contexts[key] = revision; contextOrder.append(key)
        return revision
    }

    mutating func invalidate(_ key: ModelControlKey) {
        let tokens = Set(entries.filter { $0.value.key == key }.map(\.key))
        for token in tokens { entries.removeValue(forKey: token) }
        entryOrder.removeAll(where: tokens.contains)
        confirmations = confirmations.filter { !tokens.contains($0.value.value.reference.token) }
        if contexts[key] != nil { contexts[key] = UUID() }
        latestRead.removeValue(forKey: key)
        latestThinkingRead.removeValue(forKey: key)
    }

    mutating func issue(key: ModelControlKey, sessionKey: String?, scope: RuntimeCoordinator.Scope,
                        session: ModelControlSessionIdentity?, values: ModelControlValues) throws -> Entry {
        let revision = try admit(key)
        let tokens = Set(entries.filter { $0.value.key == key }.map(\.key))
        for token in tokens { entries.removeValue(forKey: token) }
        entryOrder.removeAll(where: tokens.contains)
        confirmations = confirmations.filter { !tokens.contains($0.value.value.reference.token) }
        while entries.count >= 32 || entries.values.reduce(values.weight, { $0 + $1.values.weight }) > 16 * 1_024 * 1_024 {
            guard let oldest = entryOrder.first else { throw RuntimeFailure(.capacity) }
            entries.removeValue(forKey: oldest); entryOrder.removeFirst()
        }
        let reference = RuntimeModelControlsReference(token: UUID())
        let entry = Entry(reference: reference, key: key, sessionKey: sessionKey, scope: scope,
            revision: revision, session: session, values: values)
        entries[reference.token] = entry; entryOrder.append(reference.token)
        return entry
    }

    mutating func begin(key: ModelControlKey, nativeBarrier: Bool) throws -> UUID {
        _ = try admit(key)
        if holds[key]?.phase == .pending { throw RuntimeFailure(.requestBusy) }
        guard holds.values.filter({ $0.phase == .pending }).count < 32 else { throw RuntimeFailure(.capacity) }
        let required = holds[key]?.permissionsRequired == true
        let id = UUID(); invalidate(key)
        holds[key] = Hold(id: id, phase: .pending, nativeBarrier: nativeBarrier, permissionsRequired: required)
        return id
    }

    mutating func requirePermissions(_ key: ModelControlKey) throws {
        _ = try admit(key)
        let pending = holds[key]?.phase == .pending
        if var hold = holds[key] {
            hold.nativeBarrier = true; hold.permissionsRequired = true; holds[key] = hold
        } else {
            holds[key] = Hold(id: UUID(), phase: .uncertain, nativeBarrier: true, permissionsRequired: true)
        }
        if !pending { invalidate(key) }
    }

    mutating func observeRead(_ values: ModelControlValues, key: ModelControlKey, permissionsSupported: Bool) throws {
        if values.permissionConfirmation == true { try requirePermissions(key); return }
        guard let hold = holds[key], hold.phase != .pending else { return }
        let known = !hold.nativeBarrier || !permissionsSupported || values.permissions?.mode != nil
        if known && (!hold.permissionsRequired || values.permissionConfirmation == false) { holds.removeValue(forKey: key) }
    }

    mutating func retire() {
        entries = [:]; entryOrder = []; confirmations = [:]; latestThinkingRead = [:]; historyThinking = [:]; reads = []; latestRead = [:]
        for (key, var hold) in holds where hold.phase == .pending {
            hold.phase = .uncertain; holds[key] = hold
        }
        // Keep bounded unresolved scopes, not stale catalog/identity authority.
        contexts = contexts.filter { holds[$0.key] != nil }
        contextOrder.removeAll { contexts[$0] == nil }
        for key in contexts.keys { contexts[key] = UUID() }
    }
}
