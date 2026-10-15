import Foundation
import Testing
@testable import ClawketUI

struct AppearancePresentationTests {
    @Test func freeDefaultsAndFontBoundsMatchActualMobilePreferences() {
        let value = ClientAppearancePresentation()
        #expect(value.theme == .system); #expect(value.accent == .iceBlue)
        #expect(value.chatFontSize == 17); #expect(!value.showAgentAvatar)
        #expect(ClientAppearancePresentation(chatFontSize: 12).isValid)
        #expect(ClientAppearancePresentation(chatFontSize: 20).isValid)
        #expect(!ClientAppearancePresentation(chatFontSize: 11).isValid)
        #expect(!ClientAppearancePresentation(chatFontSize: 21).isValid)
        #expect(ClientAppearancePresentation.Accent.allCases.count == 6)
        #expect(value.accent.hex(dark: false) == 0x1F5EFF)
        #expect(value.accent.hex(dark: true) == 0x6B95FF)
    }
    @Test func readingContextRejectsUnboundedOrMissingAnchorsAndScopeIsEphemeral() {
        #expect(ConversationReadingContext().isValid)
        #expect(ConversationReadingContext(followsBottom: false, messageID: "exact-row", offset: -125).isValid)
        for value in [ConversationReadingContext(followsBottom: false), .init(offset: .nan), .init(offset: .infinity),
                      .init(offset: 10_000_001), .init(messageID: ""), .init(messageID: String(repeating: "x", count: 1_025))] {
            #expect(!value.isValid)
            #expect(ConversationReadingPresentation(restoration: value).restoration == nil)
        }
        #expect(ConversationReadingPresentation().id != ConversationReadingPresentation().id)
    }
    @Test @MainActor func lateReadingCallbacksCannotCrossAnOpenOrAtoBtoARouteChange() {
        let a = ConversationID(connectionID: "c", agentID: "a", sessionID: "secondary")
        let b = ConversationID(connectionID: "c", agentID: "a", sessionID: "other")
        let first = ConversationReadingPresentation(), second = ConversationReadingPresentation()
        let model = ClientPresentation(selectedConversation: a, readingContexts: [a: first])
        #expect(model.acceptsReadingContext(for: a, scopeID: first.id))
        model.selectedConversation = b
        #expect(!model.acceptsReadingContext(for: a, scopeID: first.id))
        model.readingContexts[a] = second; model.selectedConversation = a
        #expect(!model.acceptsReadingContext(for: a, scopeID: first.id))
        #expect(model.acceptsReadingContext(for: a, scopeID: second.id))
    }
}
