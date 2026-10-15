import Foundation
import Testing
@testable import ClawketUI

struct SessionManagementPresentationTests {
    private var route: ConversationID { .init(connectionID: "c", agentID: "a", sessionID: "s") }
    @Test func missingCapabilityLoadingAndUnknownWritesCannotProduceActions() {
        var value = SessionManagementPresentation(id: UUID(), route: route, title: "Original")
        #expect(!value.permits(.delete))
        value.phase = .ready; value.actions = [.delete]
        #expect(value.permits(.delete))
        value.isUncertain = true; #expect(!value.permits(.delete))
        value.isUncertain = false; value.submittingAction = .delete
        #expect(value.actions.contains(.delete)); #expect(!value.permits(.delete))
        value.submittingAction = nil; value.route.sessionID = ""
        #expect(!value.permits(.delete))
    }
    @Test func titleValidationUsesUTF16AndUTF8WithoutTruncatingComposedText() {
        let value = SessionManagementPresentation(id: UUID(), route: route, title: "Original", maximumTitleUTF16: 200)
        #expect(value.validatedTitle(" Original \n") == nil)
        #expect(value.validatedTitle(" \n ") == nil)
        #expect(value.validatedTitle(String(repeating: "😀", count: 100)) != nil)
        #expect(value.validatedTitle(String(repeating: "😀", count: 101)) == nil)
        let gateway = SessionManagementPresentation(id: UUID(), route: route, title: "Original")
        #expect(gateway.validatedTitle(String(repeating: "界", count: 682)) != nil)
        #expect(gateway.validatedTitle(String(repeating: "界", count: 683)) == nil)
        #expect(value.validatedTitle("  New title  ") == "New title")
    }
    @Test func catalogAndRowDefaultsHideManagementAndArchivedRowsAreExplicit() {
        let row = SessionPresentation(id: "s", route: route, title: "Title")
        let catalog = AgentCatalogPresentation(id: .init(connectionID: "c", agentID: "a"), title: "Agent")
        #expect(!row.management.isVisible); #expect(!row.isArchived)
        #expect(!catalog.archive.isVisible); #expect(!catalog.showingArchived)
        #expect(SessionLifecycleAction.reset.requiresConfirmation)
        #expect(SessionLifecycleAction.delete.requiresConfirmation)
        #expect(!SessionLifecycleAction.branch.requiresConfirmation)
    }
}
