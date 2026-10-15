import Foundation
import Testing
@testable import ClawketUI

struct ModelControlsPresentationTests {
    private var route: ConversationID { .init(connectionID: "c", agentID: "a", sessionID: "s") }

    @Test @MainActor func missingCapabilitiesAndNonConcreteRoutesStayInert() {
        let client = ClientPresentation()
        #expect(client.modelControls == nil)
        #expect(!ConversationPresentation(id: route, agentName: "Agent", sessionTitle: "Chat").availability(.modelControls).isVisible)
        var value = ModelControlsPresentation(id: UUID(), route: route,
            phase: .ready, models: [.init(id: "m", title: "Model")])
        #expect(!value.permits(.model("m")))
        value.modelSelection = .available
        #expect(value.permits(.model("m")))
        #expect(!value.permits(.model("foreign")))
        value.route.sessionID = ""
        #expect(!value.permits(.model("m")))
    }

    @Test func settingsRequireExactAdvertisedChoicesAndUnknownValuesRemainUnknown() {
        var value = ModelControlsPresentation(id: UUID(), route: route, phase: .ready,
            thinking: .init(current: nil, levels: [.init(id: "low", title: "Low")], availability: .available),
            fastMode: .init(enabled: nil, availability: .available),
            permissions: .init(current: nil, modes: [.workspace], availability: .available, requiresConfirmation: true))
        #expect(value.permits(.thinking("low")))
        #expect(!value.permits(.thinking("high")))
        #expect(value.permits(.fastMode(true)))
        #expect(value.fastMode?.enabled == nil)
        #expect(value.permissions?.current == nil)
        #expect(value.permits(.permissions(.workspace)))
        #expect(!value.permits(.permissions(.fullAccess)))
        value.isUncertain = true
        #expect(value.permits(.permissions(.workspace)))
        #expect(!value.permits(.fastMode(true)))
        #expect(!value.permits(.thinking("low")))
        value.permissions?.availability = .unsupported
        #expect(!value.permits(.permissions(.workspace)))
        value.permissions?.availability = .available; value.isUncertain = false
        value.thinking?.current = "high"; value.thinking?.currentTitle = "Known current level"
        #expect(value.thinking?.currentDisplayTitle == "Known current level")
        #expect(!value.permits(.thinking("high")))
        value.thinking?.levels = [.init(id: "low", title: "Low"), .init(id: "low", title: "Replacement"), .init(id: "", title: "Empty")]
        #expect(value.thinkingLevels.isEmpty)
        #expect(!value.permits(.thinking("low")))
    }

    @Test func busyUnknownAndUnavailableNeverOfferASecondWrite() {
        var value = ModelControlsPresentation(id: UUID(), route: route, phase: .ready,
            models: [.init(id: "m", title: "Model")], modelSelection: .available,
            fastMode: .init(enabled: false, availability: .available))
        value.submitting = .model("m")
        #expect(value.submitting == .model("m"))
        #expect(!value.permits(.model("m")))
        #expect(!value.permits(.fastMode(true)))
        value.submitting = nil; value.isUncertain = true
        #expect(value.submitting == nil)
        #expect(!value.permits(.model("m")))
        value.isUncertain = false; value.phase = .loading
        #expect(!value.permits(.fastMode(true)))
        value.phase = .unavailable
        #expect(!value.permits(.model("m")))
    }

    @Test func corruptIdentitiesCannotSelectAnotherModelAndSearchRetainsExactWriteID() {
        let rows: [ModelPresentation] = [
            .init(id: "", title: "Empty"), .init(id: "duplicate", title: "First"),
            .init(id: "duplicate", title: "Second"), .init(id: "hidden", title: "Hidden", availability: .unsupported),
            .init(id: "opaque-provider-a", title: "Vision", subtitle: "Provider A", searchTerms: ["vision-alias"]),
            .init(id: "opaque-provider-b", title: "Vision", subtitle: "Provider B")
        ]
        #expect(Set(ModelCatalogPresentation.ordered(rows).map(\.id)) == ["opaque-provider-a", "opaque-provider-b"])
        #expect(ModelCatalogPresentation.ordered(rows, query: "  VISION-ALIAS  ").map(\.id) == ["opaque-provider-a"])
        #expect(ModelCatalogPresentation.ordered(rows, query: "provider b").map(\.id) == ["opaque-provider-b"])
        let value = ModelControlsPresentation(id: UUID(), route: route, phase: .ready, models: rows, modelSelection: .available)
        #expect(!value.permits(.model("duplicate")))
        #expect(!value.permits(.model("hidden")))
    }

    @Test func catalogRecommendationOrderAndFeaturedPriorityPreserveStableRows() {
        let rows: [ModelPresentation] = [
            .init(id: "z", title: "Zulu", catalogOrder: 0),
            .init(id: "c", title: "Current", isSelected: true, catalogOrder: 4),
            .init(id: "r", title: "Recent", catalogOrder: 3),
            .init(id: "d", title: "Default", catalogOrder: 2, isConfiguredDefault: true),
            .init(id: "n", title: "Not ranked", catalogOrder: .nan)
        ]
        #expect(ModelCatalogPresentation.ordered(rows).map(\.id) == ["z", "d", "r", "c", "n"])
        #expect(ModelCatalogPresentation.featured(models: rows, recentIDs: ["missing", "r", "r"]).map(\.id) == ["c", "r", "d"])
        var review = ModelControlsPresentation(id: UUID(), route: route, phase: .ready, models: rows, featuredIDs: ["c", "r", "d"])
        review.models = review.models.map { var row = $0; row.isSelected = row.id == "r"; return row }
        #expect(review.featuredModels.map(\.id) == ["c", "r", "d"])
        #expect(ModelCatalogPresentation.featured(models: Array(rows.prefix(4))).map(\.id) == ["z", "d", "r", "c"])
    }

    @Test func permissionConfirmationContainsOnlyFrozenPresentationIdentity() {
        let reviewID = UUID(), confirmationID = UUID()
        let frozen = ModelPermissionConfirmationPresentation(id: confirmationID, reviewID: reviewID, mode: .fullAccess)
        var value = ModelControlsPresentation(id: reviewID, route: route, phase: .ready, confirmation: frozen)
        value.permissions = .init(current: .computerSettings, modes: [.readOnly], availability: .available)
        #expect(value.confirmation?.id == confirmationID)
        #expect(value.confirmation?.reviewID == reviewID)
        #expect(value.confirmation?.mode == .fullAccess)
        #expect(!value.permits(.permissions(.fullAccess)))
        #expect(value.permits(.permissions(.readOnly)))
    }
}
