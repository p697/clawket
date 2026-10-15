import Foundation
import Testing
@testable import ClawketCommerce

private let now: Double = 1_790_000_000_000
private func customer(_ active: Bool = true, verification: ProVerification = .verified, expiry: Double? = now + 10_000) -> ProCustomer {
    .init(active: active, verification: verification, productID: "pro", expirationMs: expiry,
          originalPurchaseMs: nil, latestPurchaseMs: nil, requestMs: now, store: "APP_STORE")
}

struct ProAccessTests {
    @Test func communityAccessNeverClaimsPaidOwnershipOrRequiresVendorConfiguration() {
        let access = ProAccess(mode: .community)
        #expect(!access.hasPaidAccess(at: now)); #expect(access.connection("other", at: now) == .allowed)
        #expect(access.agent(connectionID: "other", isMain: nil, at: now) == .allowed)
        for feature in ProFeature.allCases { #expect(access.feature(feature, at: now) == .allowed) }
    }
    @Test(arguments: [ProVerification.failed, .notRequested])
    func unverifiedActiveCustomerCannotGrantPaidAccess(verification: ProVerification) {
        let access = ProAccess(mode: .store, customer: customer(verification: verification), resolved: true)
        #expect(!access.hasPaidAccess(at: now)); #expect(access.feature(.archiveTools, at: now) == .requiresPro)
    }
    @Test func expiredPendingMissingAndClockRollbackEvidenceNeverInventAccess() {
        #expect(!customer(expiry: now).isActive(at: now))
        #expect(!customer(false).isActive(at: now)); #expect(!customer().isActive(at: .nan))
        let future = ProCustomer(active: true, verification: .verified, productID: "pro", expirationMs: now + 1,
            originalPurchaseMs: nil, latestPurchaseMs: nil, requestMs: now + 2, store: "APP_STORE")
        #expect(!future.isActive(at: now - 10_000))
        let unresolved = ProAccess(mode: .store)
        #expect(unresolved.connection("c", at: now) == .unresolved)
        #expect(unresolved.addingConnection(count: 0, at: now) == .allowed)
        #expect(unresolved.addingConnection(count: 1, at: now) == .unresolved)
    }
    @Test func freeSlotAndActualMainAreRequiredWhileGraceNeverPermitsCreating() {
        let allowance = ProAllowance(freeConnectionId: "free", graceEvaluatedAt: 1, graceUntil: nil)
        let free = ProAccess(mode: .store, allowance: allowance, resolved: true)
        #expect(free.agent(connectionID: "free", isMain: true, at: now) == .allowed)
        #expect(free.agent(connectionID: "free", isMain: nil, at: now) == .requiresPro)
        #expect(free.agent(connectionID: "free", isMain: false, at: now) == .requiresPro)
        #expect(free.agent(connectionID: "other", isMain: true, at: now) == .requiresPro)
        let grace = ProAccess(mode: .store, allowance: .init(freeConnectionId: "free", graceEvaluatedAt: 1, graceUntil: Int64(now + 100)), resolved: true)
        #expect(grace.agent(connectionID: "other", isMain: false, at: now) == .allowed)
        #expect(grace.addingConnection(count: 1, at: now) == .requiresPro)
        #expect(grace.feature(.agentCreation, at: now) == .requiresPro)
        #expect(grace.agent(connectionID: "other", isMain: false, at: now + 100) == .requiresPro)
    }
    @Test func opaqueFreeConnectionIDsRetainTheirOriginalUTF8() {
        let free = ProAccess(mode: .store, allowance: .init(freeConnectionId: "caf\u{e9}", graceEvaluatedAt: 1, graceUntil: nil), resolved: true)
        #expect(free.connection("cafe\u{301}", at: now) == .requiresPro)
    }
    @Test func actualNonexpiringLifetimeRequiresAnActiveVerifiedEntitlement() {
        #expect(customer(expiry: nil).isLifetime(at: now))
        #expect(!customer(false, expiry: nil).isLifetime(at: now))
        #expect(!customer(verification: .failed, expiry: nil).isLifetime(at: now))
        #expect(customer(verification: .verifiedOnDevice, expiry: nil).isLifetime(at: now))
    }
}
