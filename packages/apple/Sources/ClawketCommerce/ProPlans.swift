import Foundation

public enum ProPlanKind: String, Sendable, CaseIterable { case annual, lifetime, monthly, other }

/// Display and a current opaque vendor reference, never persisted purchase authority.
public struct ProPackage: Sendable, Equatable, Identifiable {
    public let id: UUID
    public let offeringID: String
    public let packageID: String
    public let productID: String
    public let kind: ProPlanKind
    public let title: String
    public let price: Decimal
    public let priceString: String
    public let monthlyPriceString: String?
    public init(id: UUID, offeringID: String, packageID: String, productID: String, kind: ProPlanKind,
                title: String, price: Decimal, priceString: String, monthlyPriceString: String? = nil) {
        self.id = id; self.offeringID = offeringID; self.packageID = packageID; self.productID = productID
        self.kind = kind; self.title = title; self.price = price; self.priceString = priceString
        self.monthlyPriceString = monthlyPriceString
    }
}

public enum ProPurchaseOutcome: Sendable, Equatable { case activated, scheduled, unconfirmed }
public enum ProStoreFailure: Error, Sendable, Equatable { case unavailable, invalid, cancelled, pending, unconfirmed, failed, changed }

public enum ProPlans {
    public static func preferred(_ packages: [ProPackage], defaultKind: ProPlanKind = .annual) -> ProPackage? {
        packages.first { $0.kind == defaultKind } ?? packages.first { $0.kind == .annual } ?? packages.first { $0.kind == .lifetime }
            ?? packages.first { $0.kind == .monthly } ?? packages.first
    }
    public static func displayed(_ packages: [ProPackage], customer: ProCustomer?, now: Double) -> ProPackage? {
        guard let customer, customer.isActive(at: now) else { return nil }
        if customer.isLifetime(at: now) || customer.isGrandfathered(at: now) { return packages.first { $0.kind == .lifetime } }
        return packages.first { $0.productID.utf8.elementsEqual((customer.productID ?? "").utf8) }
    }
    public static func locked(_ target: ProPackage, packages: [ProPackage], customer: ProCustomer?, now: Double) -> Bool {
        guard let customer, customer.isActive(at: now) else { return false }
        if customer.isLifetime(at: now) || customer.isGrandfathered(at: now) { return true }
        if target.productID.utf8.elementsEqual((customer.productID ?? "").utf8) { return true }
        guard let store = customer.store, ["APP_STORE", "MAC_APP_STORE", "TEST_STORE"].contains(store) else { return true }
        if target.kind == .lifetime { return false }
        guard target.kind == .monthly || target.kind == .annual else { return true }
        let recurring = packages.filter { $0.kind == .monthly || $0.kind == .annual }
        let known = recurring.contains { $0.productID.utf8.elementsEqual((customer.productID ?? "").utf8) }
        return !known || customer.subscriptions.contains { $0.isActive && $0.familyShared }
    }
    public static func outcome(target: ProPackage, before: ProCustomer, after: ProCustomer, purchasedProductID: String?, now: Double) -> ProPurchaseOutcome {
        let beforeActive = before.isActive(at: now), afterActive = after.isActive(at: now)
        if beforeActive && afterActive && before.expirationMs != nil && (target.kind == .monthly || target.kind == .annual),
           !target.productID.utf8.elementsEqual((before.productID ?? "").utf8),
           purchasedProductID.map({ $0.utf8.elementsEqual(target.productID.utf8) || $0.utf8.elementsEqual((before.productID ?? "").utf8) }) == true {
            return .scheduled
        }
        if afterActive && target.productID.utf8.elementsEqual((after.productID ?? "").utf8),
           target.kind != .lifetime || after.expirationMs == nil { return .activated }
        return .unconfirmed
    }
    public static func redemptionChanged(before: ProCustomer, after: ProCustomer, now: Double) -> Bool {
        guard after.isActive(at: now) else { return false }
        return !before.isActive(at: now) || before.productID.map { Data($0.utf8) } != after.productID.map { Data($0.utf8) }
            || before.expirationMs != after.expirationMs || before.latestPurchaseMs != after.latestPurchaseMs
    }
}

/// The iOS adapter owns vendor objects and SDK identity. No default implementation
/// can pretend that opening a sheet or a persisted snapshot is a transaction.
@MainActor public protocol ProStoreSource: AnyObject {
    func customer() async throws -> ProCustomer
    func offerings() async throws -> (packages: [ProPackage], defaultKind: ProPlanKind)
    func purchase(_ package: UUID) async throws -> (customer: ProCustomer, productID: String?)
    func restore() async throws -> ProCustomer
    func presentRedemption() throws
    func manageSubscription() async throws
    var updates: AsyncStream<ProCustomer> { get }
}
