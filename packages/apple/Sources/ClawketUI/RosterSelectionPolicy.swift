import Foundation

/// Sidebar selection is navigation state, not ownership of the selected conversation.
enum RosterSelectionPolicy {
    static func row(for selected: ConversationID?, agents: [AgentPresentation]) -> ConversationID? {
        guard let selected, selected.isConcrete else { return nil }
        let routes = agents.compactMap { agent -> (AgentPresentation.Kind, ConversationID)? in
            guard let route = agent.route, route.isConcrete else { return nil }
            return (agent.kind, route)
        }
        if routes.contains(where: { $0.1 == selected }) { return selected }
        let scope = routes.filter { $0.1.connectionID == selected.connectionID && $0.1.agentID == selected.agentID }
        if let main = scope.first(where: { $0.0 == .agent })?.1 { return main }
        if let row = scope.first?.1 { return row }
        // Catalog-only/temporarily missing rows must never destroy a concrete detail route.
        return selected
    }

    static func rowAfterRosterRefresh(currentRow: ConversationID?, selected: ConversationID?,
                                      agents: [AgentPresentation]) -> ConversationID? {
        // A native Back action may have returned to the sidebar. Refresh must not reopen it.
        guard currentRow != nil else { return nil }
        return row(for: selected, agents: agents)
    }

    static func explicitConversation(proposedRow: ConversationID?, previousRow: ConversationID?,
                                     agents: [AgentPresentation]) -> ConversationID? {
        // List can normalize/remove selection while rebuilding. Neither nil nor an unchanged
        // normalized main-row value is evidence of an explicit request to replace the detail.
        guard let proposedRow, proposedRow.isConcrete, proposedRow != previousRow,
              agents.contains(where: { $0.route == proposedRow && $0.availability.isEnabled }) else { return nil }
        return proposedRow
    }
}
