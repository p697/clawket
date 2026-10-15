import ClawketPersistence
import ClawketRuntime
import ClawketUI
import Foundation

@MainActor
final class NativeRosterState {
    private(set) var document = NativeRosterDocument()
    private var desired = NativeRosterDocument()
    private(set) var canSave = false
    private var store: NativeRosterStore?
    private var pending: NativeRosterDocument?
    private var saveTask: Task<Void, Never>?
    var onChange: (@MainActor () -> Void)?
    var onFailure: (@MainActor () -> Void)?
    init(store: NativeRosterStore? = nil) { self.store = store }
    func load() async {
        do {
            let store = try store ?? NativeRosterStore(); self.store = store
            document = try await store.read(); desired = document; canSave = true
        } catch { canSave = false; onFailure?() }
    }
    func setAgentPinned(_ scope: AgentCatalogID, pinned: Bool) {
        mutate { value in
            var preference = value.preference(scope); preference.pinned = pinned
            value.preferences.removeAll { $0.scope == scope }; value.preferences.append(preference)
        }
    }
    func setSessionOnHome(_ route: ConversationID, visible: Bool) {
        mutate { value in
            let scope = AgentCatalogID(connectionID: route.connectionID, agentID: route.agentID)
            var preference = value.preference(scope)
            preference.homeSessions.removeAll { $0.utf8.elementsEqual(route.sessionID.utf8) }
            if visible { preference.homeSessions.insert(route.sessionID, at: 0) }
            value.preferences.removeAll { $0.scope == scope }; value.preferences.append(preference)
        }
    }
    func seedIfUnset(connectionID: String, sessions: [RuntimeSession]) {
        guard canSave, !desired.hasBaseline(connectionID) else { return }
        mutate { value in
            value.baselines.append(connectionID)
            for session in sessions where session.connectionID.utf8.elementsEqual(connectionID.utf8) {
                if let time = NativeRosterProjection.activity(session) { value.mark(NativeRosterProjection.route(session), through: time) }
            }
        }
    }
    /// Uses only actual human-activity clocks. A missing/null clock never manufactures Now.
    func markRead(_ sessions: [RuntimeSession]) {
        let entries = sessions.compactMap { session -> (ConversationID, Int64)? in
            guard let time = NativeRosterProjection.activity(session) else { return nil }
            let route = NativeRosterProjection.route(session)
            return time > desired.watermark(route) ? (route, time) : nil
        }
        guard !entries.isEmpty else { return }
        mutate { value in for (route, time) in entries { value.mark(route, through: time) } }
    }
    func flush() async { if let saveTask { await saveTask.value } }
    private func mutate(_ change: (inout NativeRosterDocument) -> Void) {
        guard canSave else { return }
        do {
            var next = desired; change(&next); try next.advance(); try next.validate()
            desired = next; pending = next; startSaving()
        } catch { canSave = false; onFailure?(); onChange?() }
    }
    private func startSaving() {
        guard saveTask == nil, let store else { return }
        saveTask = Task { [weak self] in
            guard let self else { return }
            defer { self.saveTask = nil }
            while let value = self.pending {
                self.pending = nil
                do { try await store.write(value); self.document = value; self.onChange?() }
                catch { self.pending = nil; self.canSave = false; self.onFailure?(); self.onChange?(); return }
            }
        }
    }
}

/// Presence is separate from a persisted selection and fenced by the current transcript open.
struct NativeRosterReadingVisibility {
    private var visible: (route: ConversationID, scope: UUID)?
    mutating func update(_ route: ConversationID, scope: UUID, visible: Bool) {
        if visible { self.visible = (route, scope) }
        else if self.visible?.route == route && self.visible?.scope == scope { self.visible = nil }
    }
    func contains(_ route: ConversationID, scope: UUID?) -> Bool { visible?.route == route && visible?.scope == scope }
    func permitsRead(_ route: ConversationID, scope: UUID?, foreground: Bool, live: Bool,
                     historyReady: Bool, obscured: Bool, held: Bool) -> Bool {
        foreground && live && historyReady && !obscured && !held && contains(route, scope: scope)
    }
}

struct NativeRosterHistoryRead: Equatable {
    let wire: UUID
    let readingScope: UUID
    static func accepted(wire: UUID, readingScope: UUID?, earlier: Bool) -> Self? {
        guard !earlier, let readingScope else { return nil }
        return .init(wire: wire, readingScope: readingScope)
    }
    func isCurrent(wire: UUID, readingScope: UUID?) -> Bool { self.wire == wire && self.readingScope == readingScope }
}
