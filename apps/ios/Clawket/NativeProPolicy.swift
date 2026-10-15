import ClawketCommerce
import ClawketRuntime
import ClawketUI
import Foundation

struct NativeProRoutePolicy {
    enum Access: Equatable { case full, preview, locked, unresolved }
    static func conversation(_ route: ConversationID, access: ProAccess, now: Double,
                             agentIsMain: Bool?, entryMode: RuntimeAgent.EntryMode?, mainSessionKey: String?,
                             sessionKind: String?, source: String?, manual: [NativeManualSession]) -> Access {
        switch access.agent(connectionID: route.connectionID, isMain: agentIsMain, at: now) {
        case .requiresPro: return .locked
        case .unresolved: return .unresolved
        case .allowed: break
        }
        if access.allFeatures(at: now) || access.hasGrace(at: now) || manual.contains(NativeManualSession(route)) { return .full }
        if entryMode == .sessions, source == "bridge" { return .full }
        if let kind = sessionKind, !kind.isEmpty, kind != "unknown", kind != "global" { return kind == "main" ? .full : .preview }
        if mainSessionKey.map({ $0.utf8.elementsEqual(route.sessionID.utf8) }) == true || route.sessionID == "main" { return .full }
        let parts = route.sessionID.split(separator: ":", omittingEmptySubsequences: false)
        return parts.count == 3 && parts[0] == "agent" && !parts[1].isEmpty && parts[2] == "main" ? .full : .preview
    }
}

struct NativeProContinuation {
    enum Action { case connection(String), addConnection, catalog(AgentCatalogID), conversation(ConversationID) }
    let action: Action
    let activation: UUID
    let wire: UUID
    let selection: UUID
    let route: ConversationID?
    let epoch: UUID?
    func matches(activation: UUID, wire: UUID, selection: UUID, route: ConversationID?, epoch: UUID?) -> Bool {
        self.activation == activation && self.wire == wire && self.selection == selection &&
        self.route.map(NativeHistoryScope.init) == route.map(NativeHistoryScope.init) && self.epoch == epoch
    }
}
