import Foundation
import Testing
@testable import ClawketUI

struct ConnectionActionTests {
    @Test func approvalStatusOpensTheExactReviewRatherThanReconnectingBlindly() {
        let id = UUID(), status = ConnectionPresentation(phase: .approvalRequired, connectionID: "a", action: .available, approvalReviewID: id)
        guard case let .reviewDeviceApproval(connectionID, contextID) = status.primaryIntent else { Issue.record("Missing exact approval intent"); return }
        #expect(connectionID == "a"); #expect(contextID == id)
    }
    @Test func missingReviewOrUnavailableCapabilityNeverBecomesAReconnectAction() {
        for status in [ConnectionPresentation(phase: .approvalRequired, connectionID: "a", action: .available),
            .init(phase: .approvalRequired, connectionID: "", action: .available, approvalReviewID: UUID()),
            .init(phase: .approvalRequired, connectionID: "a", approvalReviewID: UUID()),
            .init(phase: .approvalRequired, connectionID: "a", action: .temporarilyUnavailable("Unavailable"), approvalReviewID: UUID())] {
            #expect(status.primaryIntent == nil)
        }
    }
    @Test func ordinaryReconnectKeepsTheExistingOptionalConnectionScope() {
        for connection in [String?.none, "a"] {
            let status = ConnectionPresentation(phase: .unavailable, connectionID: connection, action: .available)
            guard case let .reconnect(id) = status.primaryIntent else { Issue.record("Ordinary reconnect changed"); return }
            #expect(id == connection)
        }
    }
}
