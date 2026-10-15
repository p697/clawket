import ClawketCommerce
import Foundation
import RevenueCat
import XCTest
@testable import Clawket

@MainActor
final class NativeRevenueCatSourceTests: XCTestCase {
    private func customer(active: Bool = true, verification: VerificationResult = .verified,
                          expiry: Date? = Date(timeIntervalSince1970: 1_000), family: Bool = false,
                          product: String = "fixture-year", entitlement: String = "pro") -> CustomerInfo {
        let item = EntitlementInfo(identifier: entitlement, isActive: active, willRenew: true, periodType: .normal,
            latestPurchaseDate: Date(timeIntervalSince1970: 80), originalPurchaseDate: Date(timeIntervalSince1970: 70),
            expirationDate: expiry, store: .appStore, productIdentifier: product, isSandbox: true,
            ownershipType: family ? .familyShared : .purchased, verification: verification)
        return CustomerInfo(entitlements: .init(entitlements: [entitlement: item], verification: verification),
            requestDate: Date(timeIntervalSince1970: 100), firstSeen: Date(timeIntervalSince1970: 60), originalAppUserId: "synthetic-sdk-identity")
    }
    func testRealSDKCustomerProjectionUsesVerificationAndPreservesLegacyRenewalFallback() throws {
        let value = try NativeRevenueCatSource.project(customer(), entitlement: "pro")
        XCTAssertTrue(value.isActive(at: 100_000)); XCTAssertEqual(value.productID, "fixture-year")
        XCTAssertTrue(value.hasRenewingSubscription); XCTAssertEqual(value.subscriptions.count, 1)
        let shared = try NativeRevenueCatSource.project(customer(family: true), entitlement: "pro")
        XCTAssertFalse(shared.hasRenewingSubscription); XCTAssertTrue(shared.subscriptions[0].familyShared)
    }
    func testUnverifiedHistoricalAndMissingSDKEntitlementsCannotGrantPaidAccess() throws {
        let verifications: [VerificationResult] = [.notRequested, .failed]
        for verification in verifications {
            let value = try NativeRevenueCatSource.project(customer(verification: verification), entitlement: "pro")
            XCTAssertFalse(value.isActive(at: 100_000))
        }
        let revoked = try NativeRevenueCatSource.project(customer(active: false, expiry: nil), entitlement: "pro")
        XCTAssertFalse(revoked.isLifetime(at: 100_000))
        let missing = try NativeRevenueCatSource.project(customer(), entitlement: "other")
        XCTAssertFalse(missing.isActive(at: 100_000)); XCTAssertNil(missing.productID)
    }
    func testSDKEntitlementLookupAndBoundsNeverAliasDisplayEquivalentIDs() throws {
        let info = customer(entitlement: "caf\u{e9}")
        let other = try NativeRevenueCatSource.project(info, entitlement: "cafe\u{301}")
        XCTAssertFalse(other.isActive(at: 100_000)); XCTAssertNil(other.productID)
        XCTAssertThrowsError(try NativeRevenueCatSource.project(customer(product: String(repeating: "x", count: 1_025)), entitlement: "pro"))
        XCTAssertThrowsError(try NativeRevenueCatSource.project(customer(expiry: Date(timeIntervalSince1970: -1)), entitlement: "pro"))
    }
    func testOnlyRealSDKErrorDomainMayClassifyCancellationPendingAndUnavailable() {
        XCTAssertEqual(NativeRevenueCatSource.failure(NSError(domain: "unrelated", code: 1)), .failed)
        XCTAssertEqual(NativeRevenueCatSource.failure(ErrorCode.purchaseCancelledError), .cancelled)
        XCTAssertEqual(NativeRevenueCatSource.failure(ErrorCode.paymentPendingError), .pending)
        XCTAssertEqual(NativeRevenueCatSource.failure(ErrorCode.configurationError), .unavailable)
        XCTAssertEqual(NativeRevenueCatSource.failure(CancellationError()), .failed)
    }
}
