import Combine
import Testing
@testable import ClawketUI

@Suite(.serialized)
@MainActor
struct PresentationTests {
    @Test func readingDraftDuringRenderingRetainsInputOwnerWithoutPublishing() {
        let model = ClientPresentation()
        var changes = 0
        let observation = model.objectWillChange.sink { changes += 1 }
        let first = ConversationID(connectionID: "one", agentID: "agent", sessionID: "thread")
        let otherConnection = ConversationID(connectionID: "two", agentID: "agent", sessionID: "thread")
        let otherAgent = ConversationID(connectionID: "one", agentID: "other", sessionID: "thread")
        let otherSession = ConversationID(connectionID: "one", agentID: "agent", sessionID: "other")
        let draft = model.draft(for: first)
        draft.text = "正在输入的草稿"
        model.selectedConversation = otherSession
        changes = 0
        #expect(model.draft(for: first) === draft)
        #expect(model.draft(for: first).text == "正在输入的草稿")
        #expect(model.draft(for: otherConnection) !== draft)
        #expect(model.draft(for: otherAgent) !== draft)
        #expect(model.draft(for: otherSession) !== draft)
        #expect(changes == 0)
        withExtendedLifetime(observation) {}
    }

    @Test func persistedDraftTakesOverWithoutMutatingThePreviousConversation() {
        let route = ConversationID(connectionID: "one", agentID: "agent", sessionID: "thread")
        let model = ClientPresentation()
        let temporary = model.draft(for: route)
        temporary.text = "existing"
        let restored = ComposerDraft(conversationID: route, text: "restored")
        model.drafts[route] = restored
        #expect(model.draft(for: route) === restored)
        #expect(temporary.text == "existing")
    }

    @Test func sessionsFirstAgentDoesNotFabricateAMainConversation() {
        let catalogID = AgentCatalogID(connectionID: "connection", agentID: "agent")
        let agent = AgentPresentation(id: "agent", entryMode: .catalog(catalogID), name: "Agent")
        let real = ConversationID(connectionID: "connection", agentID: "agent", sessionID: "native-thread")
        let model = ClientPresentation(agents: [agent], catalogs: [catalogID: .init(id: catalogID, title: "Agent")])
        #expect(agent.route == nil)
        #expect(model.selectedConversation == nil)
        #expect(model.conversations.isEmpty)
        #expect(!ConversationID(connectionID: "connection", agentID: "agent", sessionID: "").isConcrete)
        model.selectedConversation = real
        #expect(model.selectedConversation?.isConcrete == true)
    }

    @Test func missingCapabilityNeverAdvertisesAnActionAndTemporaryFailureKeepsItsReason() {
        let route = ConversationID(connectionID: "one", agentID: "agent", sessionID: "thread")
        let conversation = ConversationPresentation(id: route, agentName: "Agent", sessionTitle: "Thread",
                                                   features: [.send: .temporarilyUnavailable("Reconnecting")])
        #expect(conversation.availability(.files) == .unsupported)
        #expect(!conversation.availability(.files).isVisible)
        #expect(conversation.availability(.send).isVisible)
        #expect(!conversation.availability(.send).isEnabled)
        #expect(conversation.availability(.send).explanation == "Reconnecting")
    }
}
