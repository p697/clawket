import Foundation

public enum ProFeature: String, Sendable, CaseIterable {
    case gatewayConnections, agents, agentCreation, appIcons, configBackups, configManage
    case openclawDiagnostics, openclawPermissions, coreFileEditing, logs, modelManage, usage
    case messageHistory, archiveTools, documentVersions, sessionHistory
}

/// Community source builds have access without claiming store ownership.
public enum ProAccessMode: Sendable, Equatable { case community, store }
public enum ProAccessDecision: Sendable, Equatable { case allowed, requiresPro, unresolved }
public enum ProVerification: Sendable, Equatable { case verified, verifiedOnDevice, notRequested, failed }

/// Produced only from the active purchase SDK identity, never a deserialized app cache.
/// This value is intentionally not Codable; persisted display snapshots cannot grant access.
public struct ProCustomer: Sendable, Equatable {
    public struct Subscription: Sendable, Equatable {
        public let productID: String
        public let isActive: Bool
        public let willRenew: Bool
        public let familyShared: Bool
        public let store: String
        public init(productID: String, isActive: Bool, willRenew: Bool, familyShared: Bool, store: String) {
            self.productID = productID; self.isActive = isActive; self.willRenew = willRenew
            self.familyShared = familyShared; self.store = store
        }
    }
    public let active: Bool
    public let verification: ProVerification
    public let productID: String?
    public let expirationMs: Double?
    public let originalPurchaseMs: Double?
    public let latestPurchaseMs: Double?
    public let requestMs: Double
    public let store: String?
    public let subscriptions: [Subscription]
    public init(active: Bool, verification: ProVerification, productID: String?, expirationMs: Double?,
                originalPurchaseMs: Double?, latestPurchaseMs: Double?, requestMs: Double, store: String?,
                subscriptions: [Subscription] = []) {
        self.active = active; self.verification = verification; self.productID = productID
        self.expirationMs = expirationMs; self.originalPurchaseMs = originalPurchaseMs
        self.latestPurchaseMs = latestPurchaseMs; self.requestMs = requestMs; self.store = store
        self.subscriptions = subscriptions
    }
    public func isActive(at now: Double) -> Bool {
        guard active, verification == .verified || verification == .verifiedOnDevice,
              now.isFinite, now >= 0, now <= 9_007_199_254_740_991,
              requestMs.isFinite, requestMs >= 0, requestMs <= 9_007_199_254_740_991,
              [originalPurchaseMs, latestPurchaseMs, expirationMs].compactMap({ $0 }).allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= 9_007_199_254_740_991 }),
              let productID, !productID.isEmpty, productID.utf8.count <= 1_024 else { return false }
        guard let expirationMs else { return true }
        return expirationMs.isFinite && expirationMs > max(now, requestMs)
    }
    public func isLifetime(at now: Double) -> Bool { isActive(at: now) && expirationMs == nil }
    public func isGrandfathered(at now: Double) -> Bool {
        guard isActive(at: now), let originalPurchaseMs = originalPurchaseMs ?? latestPurchaseMs,
              originalPurchaseMs.isFinite, originalPurchaseMs >= 0,
              originalPurchaseMs < 1_776_495_600_000 else { return false } // 2026-04-18T07:00:00Z
        let ids = subscriptions.filter { $0.isActive }.map(\.productID)
        return (ids.isEmpty ? [productID ?? ""] : ids).contains {
            let id = $0.lowercased(); return id.contains("year") || id.contains("annual")
        }
    }
    public var hasRenewingSubscription: Bool { subscriptions.contains { $0.isActive && $0.willRenew && !$0.familyShared } }
}

public struct ProAccess: Sendable {
    public let mode: ProAccessMode
    public let customer: ProCustomer?
    public let allowance: ProAllowance?
    public let resolved: Bool
    public init(mode: ProAccessMode, customer: ProCustomer? = nil, allowance: ProAllowance? = nil, resolved: Bool = false) {
        self.mode = mode; self.customer = customer; self.allowance = allowance; self.resolved = resolved
    }
    public func hasPaidAccess(at now: Double) -> Bool { customer?.isActive(at: now) == true }
    public func allFeatures(at now: Double) -> Bool { mode == .community || hasPaidAccess(at: now) }
    public func hasGrace(at now: Double) -> Bool {
        guard now.isFinite, now >= 0, let value = allowance, let until = value.graceUntil else { return false }
        return now < Double(until)
    }
    public func connection(_ id: String, at now: Double) -> ProAccessDecision {
        if allFeatures(at: now) { return .allowed }
        guard let allowance else { return .unresolved }
        if allowance.freeConnectionId.map({ $0.utf8.elementsEqual(id.utf8) }) == true || hasGrace(at: now) { return .allowed }
        return resolved ? .requiresPro : .unresolved
    }
    public func agent(connectionID: String, isMain: Bool?, at now: Double) -> ProAccessDecision {
        let connection = connection(connectionID, at: now)
        guard connection == .allowed else { return connection }
        if allFeatures(at: now) || isMain == true || hasGrace(at: now) { return .allowed }
        return resolved ? .requiresPro : .unresolved
    }
    public func addingConnection(count: Int, at now: Double) -> ProAccessDecision {
        if count < 1 || allFeatures(at: now) { return .allowed }
        return resolved ? .requiresPro : .unresolved
    }
    public func feature(_ feature: ProFeature, at now: Double) -> ProAccessDecision {
        if allFeatures(at: now) { return .allowed }
        return resolved ? .requiresPro : .unresolved
    }
}
