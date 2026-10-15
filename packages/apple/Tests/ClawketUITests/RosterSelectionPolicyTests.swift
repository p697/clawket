import Testing
@testable import ClawketUI

@Suite(.serialized)
struct RosterSelectionPolicyTests {
    private let main = ConversationID(connectionID: "c", agentID: "agent", sessionID: "main")
    private let secondary = ConversationID(connectionID: "c", agentID: "agent", sessionID: "qa-secondary")
    private var agents: [AgentPresentation] { [.init(id: "agent", route: main, name: "Agent")] }

    @Test @MainActor func secondaryConversationSurvivesListNormalizationAndNilWriteback() {
        let draft = ComposerDraft(conversationID: secondary, text: "恢复中的草稿")
        let model = ClientPresentation(selectedConversation: secondary,
            conversations: [secondary: .init(id: secondary, agentName: "Agent", sessionTitle: "QA")], drafts: [secondary: draft])
        let row = RosterSelectionPolicy.row(for: model.selectedConversation, agents: agents)
        #expect(row == main)
        for proposed in [row, nil] {
            if let explicit = RosterSelectionPolicy.explicitConversation(proposedRow: proposed, previousRow: row, agents: agents) {
                model.selectedConversation = explicit
            }
            #expect(model.selectedConversation == secondary)
            #expect(model.conversations[secondary]?.sessionTitle == "QA")
            #expect(model.draft(for: secondary) === draft)
            #expect(draft.text == "恢复中的草稿")
        }
    }

    @Test func explicitRowSelectionKeepsConnectionAndAgentScopeAndRequiresAvailability() {
        let other = ConversationID(connectionID: "other", agentID: "agent", sessionID: "main")
        let rows = agents + [.init(id: "other", route: other, name: "Other")]
        #expect(RosterSelectionPolicy.explicitConversation(proposedRow: other, previousRow: main, agents: rows) == other)
        #expect(RosterSelectionPolicy.row(for: .init(connectionID: "other", agentID: "agent", sessionID: "secondary"), agents: rows) == other)
        var disabled = rows; disabled[1].availability = .temporarilyUnavailable("Unavailable")
        #expect(RosterSelectionPolicy.explicitConversation(proposedRow: other, previousRow: main, agents: disabled) == nil)
        #expect(RosterSelectionPolicy.explicitConversation(proposedRow: secondary, previousRow: nil, agents: rows) == nil)
    }

    @Test func nativeBackDoesNotReopenTheDetailOnRosterOrReadinessRefresh() {
        #expect(RosterSelectionPolicy.rowAfterRosterRefresh(currentRow: nil, selected: secondary, agents: agents) == nil)
        #expect(RosterSelectionPolicy.rowAfterRosterRefresh(currentRow: main, selected: secondary, agents: agents) == main)
        #expect(RosterSelectionPolicy.rowAfterRosterRefresh(currentRow: main, selected: nil, agents: agents) == nil)
    }

    @Test func missingOrCatalogOnlyRowsNeverInventAnEmptyConversationOrRewriteTheDetail() {
        let catalog = AgentPresentation(id: "agent", entryMode: .catalog(.init(connectionID: "c", agentID: "agent")), name: "Agent")
        #expect(RosterSelectionPolicy.row(for: secondary, agents: [catalog]) == secondary)
        #expect(RosterSelectionPolicy.row(for: secondary, agents: []) == secondary)
        #expect(RosterSelectionPolicy.explicitConversation(proposedRow: secondary, previousRow: nil, agents: [catalog]) == nil)
        #expect(RosterSelectionPolicy.row(for: .init(connectionID: "c", agentID: "agent", sessionID: ""), agents: agents) == nil)
    }

    @Test func exactPinnedSessionWinsOverAnAgentMainRowWithoutCrossingAgents() {
        let pinned = AgentPresentation(id: "pin", route: secondary, kind: .pinnedSession, name: "Pinned")
        #expect(RosterSelectionPolicy.row(for: secondary, agents: agents + [pinned]) == secondary)
        let anotherAgent = ConversationID(connectionID: "c", agentID: "different", sessionID: "secondary")
        #expect(RosterSelectionPolicy.row(for: anotherAgent, agents: agents) == anotherAgent)
    }
}
