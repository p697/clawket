import Foundation
import Testing
@testable import ClawketUI

@Suite(.serialized)
struct RosterIdentityTests {
    @Test @MainActor func actualDraftCatalogAndReadingConsumersKeepEveryOpaqueUTF8ComponentDistinct() {
        let composed = "\u{00e9}", decomposed = "e\u{0301}"
        #expect(composed == decomposed) // Swift display equivalence must not become route identity.
        for component in 0...2 {
            var first = ["connection", "agent", "session"], second = first
            first[component] = composed; second[component] = decomposed
            let a = ConversationID(connectionID: first[0], agentID: first[1], sessionID: first[2])
            let b = ConversationID(connectionID: second[0], agentID: second[1], sessionID: second[2])
            #expect(a != b); #expect(Set([a, b]).count == 2)
            let model = ClientPresentation(selectedConversation: a)
            model.draft(for: a).text = "first"
            model.draft(for: b).text = "second"
            #expect(model.draft(for: a).text == "first"); #expect(model.draft(for: b).text == "second")
            model.conversations[a] = .init(id: a, agentName: "First", sessionTitle: "First")
            model.conversations[b] = .init(id: b, agentName: "Second", sessionTitle: "Second")
            #expect(model.conversations.count == 2)
            let readA = ConversationReadingPresentation(), readB = ConversationReadingPresentation()
            model.readingContexts = [a: readA, b: readB]
            #expect(model.acceptsReadingContext(for: a, scopeID: readA.id))
            #expect(!model.acceptsReadingContext(for: b, scopeID: readA.id))
            let roundTrip = try? JSONDecoder().decode(ConversationID.self, from: JSONEncoder().encode(b))
            #expect(roundTrip == b); #expect(roundTrip != a)
        }
        for component in 0...1 {
            let a = AgentCatalogID(connectionID: component == 0 ? composed : "c", agentID: component == 1 ? composed : "a")
            let b = AgentCatalogID(connectionID: component == 0 ? decomposed : "c", agentID: component == 1 ? decomposed : "a")
            let model = ClientPresentation(catalogs: [a: .init(id: a, title: "First"), b: .init(id: b, title: "Second")])
            #expect(model.catalogs.count == 2); #expect(model.catalogs[a]?.title == "First"); #expect(model.catalogs[b]?.title == "Second")
        }
    }

    @Test func sidebarFallbackCannotCrossCanonicalEquivalentAgentOrConnection() {
        let a = ConversationID(connectionID: "c", agentID: "\u{00e9}", sessionID: "main")
        let b = ConversationID(connectionID: "c", agentID: "e\u{0301}", sessionID: "secondary")
        let rows = [AgentPresentation(id: "a", route: a, name: "Display text stays unchanged")]
        #expect(RosterSelectionPolicy.row(for: b, agents: rows) == b)
        #expect(RosterSelectionPolicy.explicitConversation(proposedRow: b, previousRow: nil, agents: rows) == nil)
    }

    @Test func absentCapabilitiesStayHiddenAndUnreadIsIndependentOfAttention() {
        let row = AgentPresentation(id: "a", entryMode: .catalog(.init(connectionID: "c", agentID: "a")), name: "A", unread: true, attention: .approval)
        #expect(row.unread && row.attention == .approval)
        #expect(!row.localActions.pin.isVisible && !row.localActions.markRead.isVisible)
        let session = SessionPresentation(id: "s", route: .init(connectionID: "c", agentID: "a", sessionID: "s"), title: "S")
        #expect(!session.homeAction.isVisible && !session.markReadAction.isVisible)
    }
}
