import ClawketRuntime
import ClawketUI
import Foundation

/// Backend-normalized clocks and permissions enter here; display order never follows unread/attention.
enum NativeRosterProjection {
    static let humanKinds: Set<String> = ["main", "channel", "direct", "group", "other"]
    struct Summary {
        var agent: RuntimeAgent
        var sessions: [RuntimeSession]
        var home: [RuntimeSession]
        var recent: RuntimeSession?
        var lastActivityAtMs: Int64?
        var unread: Bool
        var attention: AgentPresentation.Attention
        var pinned: Bool
        var previewSession: RuntimeSession? { recent ?? sessions.first { $0.key.utf8.elementsEqual(agent.mainSessionKey.utf8) } }
    }
    static func route(_ session: RuntimeSession) -> ConversationID {
        .init(connectionID: session.connectionID, agentID: session.agentID, sessionID: session.key)
    }
    static func scope(_ agent: RuntimeAgent) -> AgentCatalogID { .init(connectionID: agent.connectionID, agentID: agent.agentID) }
    static func activity(_ session: RuntimeSession) -> Int64? {
        guard humanKinds.contains(session.kind), let value = session.lastActivityAtMs, value >= 0,
              value <= 9_007_199_254_740_991 else { return nil }
        return value
    }
    static func unread(_ session: RuntimeSession, document: NativeRosterDocument, live: Bool) -> Bool {
        unread(session, index: .init(document), live: live)
    }
    static func unread(_ session: RuntimeSession, index: NativeRosterIndex, live: Bool) -> Bool {
        guard live, index.isValid, index.hasBaseline(session.connectionID), let time = activity(session) else { return false }
        return time > index.watermarks[route(session), default: 0]
    }
    static func attention(_ session: RuntimeSession) -> AgentPresentation.Attention {
        switch session.raw["attention"]?.stringValue {
        case "input": .input
        case "approval": .approval
        case "cron_failed": .scheduledFailure
        case "error": .error
        default: .none
        }
    }
    static func stronger(_ first: AgentPresentation.Attention, _ second: AgentPresentation.Attention) -> AgentPresentation.Attention {
        func rank(_ value: AgentPresentation.Attention) -> Int {
            switch value { case .none: 0; case .error: 1; case .scheduledFailure: 2; case .input, .approval: 3 }
        }
        return rank(second) > rank(first) ? second : first
    }
    static func summaries(agents: [RuntimeAgent], sessions: [RuntimeSession], document: NativeRosterDocument,
                          connectionID: String, live: Bool) -> [Summary] {
        let index = NativeRosterIndex(document)
        guard index.isValid else { return [] }
        let sessionsByScope = Dictionary(grouping: sessions.filter { $0.connectionID.utf8.elementsEqual(connectionID.utf8) },
            by: { AgentCatalogID(connectionID: $0.connectionID, agentID: $0.agentID) })
        let matching = agents.filter { $0.connectionID.utf8.elementsEqual(connectionID.utf8) }
        let counts = Dictionary(grouping: matching, by: { scope($0) }).mapValues(\.count)
        return matching.filter { counts[scope($0)] == 1 }.map { agent in
            let scope = scope(agent), preference = index.preference(scope)
            let owned = sessionsByScope[scope] ?? []
            let recent = owned.filter { activity($0) != nil }.sorted {
                if activity($0) != activity($1) { return (activity($0) ?? -1) > (activity($1) ?? -1) }
                let firstMain = $0.key.utf8.elementsEqual(agent.mainSessionKey.utf8)
                let secondMain = $1.key.utf8.elementsEqual(agent.mainSessionKey.utf8)
                if firstMain != secondMain { return firstMain }
                return $0.key.utf8.lexicographicallyPrecedes($1.key.utf8)
            }.first
            let byKey = Dictionary(grouping: owned, by: { Data($0.key.utf8) })
            let home = preference.homeSessions.compactMap { key -> RuntimeSession? in
                guard let matches = byKey[Data(key.utf8)], matches.count == 1, let session = matches.first,
                      session.archived != true, session.allowedActions?.pin == true else { return nil }
                return session
            }
            let unread = owned.contains { $0.key.utf8.elementsEqual(agent.mainSessionKey.utf8) && Self.unread($0, index: index, live: live) }
            let attention = live ? owned.reduce(AgentPresentation.Attention.none) { stronger($0, Self.attention($1)) } : .none
            return Summary(agent: agent, sessions: owned, home: home, recent: recent,
                lastActivityAtMs: recent.flatMap(activity), unread: unread, attention: attention, pinned: preference.pinned)
        }.sorted {
            if $0.pinned != $1.pinned { return $0.pinned }
            if $0.lastActivityAtMs != $1.lastActivityAtMs { return ($0.lastActivityAtMs ?? -1) > ($1.lastActivityAtMs ?? -1) }
            return $0.agent.agentID.utf8.lexicographicallyPrecedes($1.agent.agentID.utf8)
        }
    }
    /// Pinning has no separate paywall. It inherits actual Agent access; no fabricated Pro or grace.
    static func canUseLocalActions(_ agent: RuntimeAgent, freeConnectionID: String?, explicitAccess: Set<AgentCatalogID> = []) -> Bool {
        explicitAccess.contains(scope(agent)) || (agent.isMain == true && freeConnectionID.map { $0.utf8.elementsEqual(agent.connectionID.utf8) } == true)
    }
    static func renderID(_ scope: AgentCatalogID, sessionID: String? = nil) -> String {
        // Length-independent UTF-8 encoding avoids both delimiter and Unicode aliases in SwiftUI IDs.
        let parts = [scope.connectionID, scope.agentID] + (sessionID.map { [$0] } ?? [])
        return parts.map { Data($0.utf8).base64EncodedString() }.joined(separator: ":")
    }
}
