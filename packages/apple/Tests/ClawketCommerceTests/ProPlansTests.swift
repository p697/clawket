import Foundation
import Testing
@testable import ClawketCommerce

private let now: Double = 1_790_000_000_000
private func package(_ kind: ProPlanKind) -> ProPackage {
    .init(id: UUID(), offeringID: "default", packageID: kind.rawValue, productID: "pro." + kind.rawValue,
          kind: kind, title: kind.rawValue, price: 10, priceString: "10 €")
}
private func member(_ id: String, expiry: Double? = now + 10_000, active: Bool = true,
                    store: String = "APP_STORE", subscriptions: [ProCustomer.Subscription] = [], original: Double? = nil) -> ProCustomer {
    .init(active: active, verification: .verified, productID: id, expirationMs: expiry,
          originalPurchaseMs: original, latestPurchaseMs: nil, requestMs: now, store: store, subscriptions: subscriptions)
}
struct ProPlansTests {
    @Test func metadataDefaultAndOwnedAlternativePreserveActualPriceAndReference() throws {
        let annual = package(.annual), lifetime = package(.lifetime), monthly = package(.monthly), all = [annual, lifetime, monthly]
        #expect(ProPlans.preferred(all)?.id == annual.id)
        #expect(ProPlans.preferred(all, defaultKind: .monthly)?.id == monthly.id)
        #expect(ProPlans.preferred([lifetime], defaultKind: .monthly)?.id == lifetime.id)
        #expect(ProPlans.displayed(all, customer: member(annual.productID), now: now)?.id == annual.id)
        #expect(annual.priceString == "10 €")
    }
    @Test func activeLifetimeAndLegacyAnnualCannotBeRepurchasedButRefundHistoryNeverGrantsOwnership() {
        let all = [package(.annual), package(.lifetime), package(.monthly)]
        let lifetime = member("pro.lifetime", expiry: nil)
        for item in all { #expect(ProPlans.locked(item, packages: all, customer: lifetime, now: now)) }
        let legacy = member("pro.annual", original: 1_776_495_599_999)
        #expect(legacy.isGrandfathered(at: now)); #expect(ProPlans.displayed(all, customer: legacy, now: now)?.kind == .lifetime)
        #expect(!member("pro.annual", original: 1_776_495_600_000).isGrandfathered(at: now))
        #expect(!ProPlans.locked(all[1], packages: all, customer: member("pro.lifetime", expiry: nil, active: false), now: now))
    }
    @Test func foreignStoreFamilySharedAndUnknownRecurringIdentityNeverChangeAnExistingSubscription() {
        let annual = package(.annual), lifetime = package(.lifetime), monthly = package(.monthly), all = [annual, lifetime, monthly]
        #expect(ProPlans.locked(annual, packages: all, customer: member(monthly.productID, store: "PLAY_STORE"), now: now))
        let family = member(monthly.productID, subscriptions: [.init(productID: monthly.productID, isActive: true, willRenew: true, familyShared: true, store: "APP_STORE")])
        #expect(ProPlans.locked(annual, packages: all, customer: family, now: now))
        #expect(!ProPlans.locked(lifetime, packages: all, customer: family, now: now))
        #expect(ProPlans.locked(annual, packages: all, customer: member("unknown"), now: now))
        #expect(ProPlans.locked(monthly, packages: all, customer: member(monthly.productID), now: now))
    }
    @Test func storeSubmissionPendingAndScheduledPlanAreNotNewEntitlement() {
        let monthly = package(.monthly), annual = package(.annual), lifetime = package(.lifetime)
        let before = member(monthly.productID)
        #expect(ProPlans.outcome(target: annual, before: before, after: before, purchasedProductID: annual.productID, now: now) == .scheduled)
        #expect(ProPlans.outcome(target: lifetime, before: before, after: before, purchasedProductID: lifetime.productID, now: now) == .unconfirmed)
        #expect(ProPlans.outcome(target: lifetime, before: before, after: member(lifetime.productID), purchasedProductID: lifetime.productID, now: now) == .unconfirmed)
        #expect(ProPlans.outcome(target: lifetime, before: before, after: member(lifetime.productID, expiry: nil), purchasedProductID: lifetime.productID, now: now) == .activated)
    }
    @Test func redemptionPresentationOrExistingMembershipDoesNotCountAsNewAccessAndLifetimeRetainsRenewalWarning() {
        let active = member("pro.monthly")
        #expect(!ProPlans.redemptionChanged(before: active, after: active, now: now))
        #expect(!ProPlans.redemptionChanged(before: active, after: member("pro.lifetime", expiry: nil, active: false), now: now))
        let lifetime = member("pro.lifetime", expiry: nil, subscriptions: [.init(productID: "pro.monthly", isActive: true, willRenew: true, familyShared: false, store: "APP_STORE")])
        #expect(ProPlans.redemptionChanged(before: active, after: lifetime, now: now)); #expect(lifetime.hasRenewingSubscription)
    }
}
