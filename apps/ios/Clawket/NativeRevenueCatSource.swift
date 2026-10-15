import ClawketCommerce
import Foundation
import RevenueCat

/// SDK objects and opaque offering references never escape this adapter or enter app persistence.
@MainActor
final class NativeRevenueCatSource: ProStoreSource {
    private let sdk: Purchases
    private let config: NativeProConfiguration
    private let identity: String
    private var packages: [UUID: RevenueCat.Package] = [:]
    private var offeringRevision = UUID()
    private var receiptTask: Task<Void, Never>?
    private var current: ProCustomer?
    private var reading = 0
    private var purchasing = false
    private let stream: AsyncStream<ProCustomer>
    private let continuation: AsyncStream<ProCustomer>.Continuation
    var updates: AsyncStream<ProCustomer> { stream }

    init(config: NativeProConfiguration, identity: NativePurchaseIdentity) throws {
        guard config.isConfigured, let key = config.sdkKey, !Purchases.isConfigured else { throw ProStoreFailure.unavailable }
        self.config = config
        // SDK strings can include customer/receipt/native error data. They are never product diagnostics.
        Purchases.logLevel = .error
        Purchases.logHandler = { _, _ in }
        let configuration = Configuration.Builder(withAPIKey: key).with(appUserID: identity.appUserID)
            .with(entitlementVerificationMode: .informational).with(networkTimeout: 15)
            .with(automaticDeviceIdentifierCollectionEnabled: false).build()
        sdk = Purchases.configure(with: configuration)
        self.identity = sdk.appUserID
        if let expected = identity.appUserID, !expected.utf8.elementsEqual(self.identity.utf8) { throw ProStoreFailure.changed }
        let pair = AsyncStream<ProCustomer>.makeStream(bufferingPolicy: .bufferingNewest(8))
        stream = pair.stream; continuation = pair.continuation
        let sdk = sdk
        receiptTask = Task { [weak self] in
            for await info in sdk.customerInfoStream {
                guard !Task.isCancelled, let self else { return }
                // Initial SDK cache delivery alone cannot bootstrap paid access.
                // SDK reads also emit this stream; suppress the current read's own event.
                guard self.reading == 0, self.current != nil,
                      let value = try? Self.project(info, entitlement: config.entitlementID ?? ""),
                      value != self.current else { continue }
                do { let fresh = try await self.customer(); self.continuation.yield(fresh) }
                catch { /* Preserve last verified evidence until its own expiry. */ }
            }
        }
    }
    deinit { receiptTask?.cancel(); continuation.finish() }

    func customer() async throws -> ProCustomer {
        try checkIdentity(); try Task.checkCancellation(); reading += 1; defer { reading -= 1 }
        do {
            let info = try await sdk.customerInfo(fetchPolicy: .fetchCurrent)
            try checkIdentity(); try Task.checkCancellation()
            let value = try Self.project(info, entitlement: config.entitlementID ?? "")
            if current == nil || value.requestMs >= current!.requestMs { current = value }
            return value
        } catch { throw Self.failure(error) }
    }
    func offerings() async throws -> (packages: [ProPackage], defaultKind: ProPlanKind) {
        try checkIdentity(); guard !purchasing else { throw ProStoreFailure.pending }
        let revision = UUID(); offeringRevision = revision
        let offerings: Offerings
        do { offerings = try await sdk.offerings() } catch { throw Self.failure(error) }
        try checkIdentity(); try Task.checkCancellation()
        guard offeringRevision == revision, !purchasing else { throw ProStoreFailure.changed }
        let explicit = config.offeringID.flatMap { ["default", "pro"].contains($0) ? nil : offerings.all[$0] }
        guard let offering = explicit ?? offerings.current ?? offerings.all["pro"] ?? config.offeringID.flatMap({ offerings.all[$0] }) else {
            packages = [:]; throw ProStoreFailure.unavailable
        }
        guard offering.availablePackages.count <= 64 else { throw ProStoreFailure.invalid }
        let candidates = [offering.annual, offering.lifetime, offering.monthly].compactMap { $0 } + offering.availablePackages
        var seen: Set<Data> = [], unique: [RevenueCat.Package] = []
        for item in candidates where seen.insert(Data(item.identifier.utf8)).inserted { unique.append(item) }
        let primary = unique.filter { [.annual, .lifetime, .monthly].contains($0.packageType) }
        let fallback = config.packageID.flatMap { key in unique.first { $0.identifier.utf8.elementsEqual(key.utf8) } }
        let chosen: [RevenueCat.Package] = !primary.isEmpty ? primary : fallback.map { [$0] } ?? Array(unique.prefix(1))
        guard chosen.count <= 32 else { throw ProStoreFailure.invalid }
        var next: [UUID: RevenueCat.Package] = [:], values: [ProPackage] = []
        for item in chosen {
            let product = item.storeProduct
            guard !product.productIdentifier.isEmpty, product.productIdentifier.utf8.count <= 1_024,
                  product.localizedPriceString.utf8.count <= 256, !product.localizedPriceString.isEmpty,
                  product.price >= 0, NSDecimalNumber(decimal: product.price).doubleValue.isFinite else { throw ProStoreFailure.invalid }
            let token = UUID(); next[token] = item
            let kind: ProPlanKind = switch item.packageType { case .annual: .annual; case .monthly: .monthly; case .lifetime: .lifetime; default: .other }
            values.append(.init(id: token, offeringID: offering.identifier, packageID: item.identifier, productID: product.productIdentifier,
                kind: kind, title: product.localizedTitle, price: product.price, priceString: product.localizedPriceString,
                monthlyPriceString: product.localizedPricePerMonth))
        }
        packages = next
        let metadata = offering.metadata["default_package"] as? String
        return (values, metadata?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "monthly" ? .monthly : .annual)
    }
    func purchase(_ token: UUID) async throws -> (customer: ProCustomer, productID: String?) {
        try checkIdentity(); guard config.canPurchase, !purchasing, let package = packages[token], Purchases.canMakePayments() else { throw ProStoreFailure.unavailable }
        purchasing = true; offeringRevision = UUID(); defer { purchasing = false }
        do {
            let result = try await sdk.purchase(package: package)
            try checkIdentity()
            if result.userCancelled { throw ProStoreFailure.cancelled }
            let value = try Self.project(result.customerInfo, entitlement: config.entitlementID ?? "")
            current = value
            return (value, result.transaction?.productIdentifier)
        } catch { throw Self.failure(error) }
    }
    func restore() async throws -> ProCustomer {
        try checkIdentity(); guard !purchasing else { throw ProStoreFailure.pending }
        purchasing = true; offeringRevision = UUID(); defer { purchasing = false }
        do {
            let info = try await sdk.restorePurchases(); try checkIdentity()
            let value = try Self.project(info, entitlement: config.entitlementID ?? ""); current = value; return value
        } catch { throw Self.failure(error) }
    }
    func presentRedemption() throws { try checkIdentity(); guard !purchasing else { throw ProStoreFailure.pending }; sdk.presentCodeRedemptionSheet() }
    func manageSubscription() async throws { try checkIdentity(); do { try await sdk.showManageSubscriptions() } catch { throw Self.failure(error) } }
    private func checkIdentity() throws {
        guard sdk.appUserID.utf8.elementsEqual(identity.utf8) else { throw ProStoreFailure.changed }
    }
    private static func project(_ info: CustomerInfo, entitlement: String) throws -> ProCustomer {
        guard info.subscriptionsByProductIdentifier.count <= 64, info.requestDate.timeIntervalSince1970.isFinite else { throw ProStoreFailure.invalid }
        let item = info.entitlements.active[entitlement] ?? info.entitlements.all[entitlement]
        let verification: ProVerification
        switch item?.verification ?? info.entitlements.verification {
        case .verified: verification = .verified
        case .verifiedOnDevice: verification = .verifiedOnDevice
        case .failed: verification = .failed
        default: verification = .notRequested
        }
        let subscriptions = info.subscriptionsByProductIdentifier.values.map {
            ProCustomer.Subscription(productID: $0.productIdentifier, isActive: $0.isActive,
                willRenew: $0.willRenew, familyShared: $0.ownershipType == .familyShared, store: storeName($0.store))
        }.sorted { $0.productID.utf8.lexicographicallyPrecedes($1.productID.utf8) }
        return .init(active: item?.isActive == true, verification: verification, productID: item?.productIdentifier,
            expirationMs: item?.expirationDate.map { $0.timeIntervalSince1970 * 1_000 },
            originalPurchaseMs: (item?.originalPurchaseDate ?? info.originalPurchaseDate).map { $0.timeIntervalSince1970 * 1_000 },
            latestPurchaseMs: item?.latestPurchaseDate.map { $0.timeIntervalSince1970 * 1_000 },
            requestMs: info.requestDate.timeIntervalSince1970 * 1_000, store: item.map { storeName($0.store) }, subscriptions: subscriptions)
    }
    private static func storeName(_ value: Store) -> String {
        switch value { case .appStore: "APP_STORE"; case .macAppStore: "MAC_APP_STORE"; case .playStore: "PLAY_STORE"; case .testStore: "TEST_STORE"; default: "OTHER" }
    }
    private static func failure(_ error: Error) -> ProStoreFailure {
        if let failure = error as? ProStoreFailure { return failure }
        guard let nativeCode = error as? ErrorCode else { return .failed }
        let code = nativeCode.rawValue
        if code == ErrorCode.purchaseCancelledError.rawValue { return .cancelled }
        if code == ErrorCode.paymentPendingError.rawValue { return .pending }
        if code == ErrorCode.productNotAvailableForPurchaseError.rawValue || code == ErrorCode.configurationError.rawValue { return .unavailable }
        return .failed
    }
}
