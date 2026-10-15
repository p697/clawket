import Combine
import Foundation

public struct ProReview: Identifiable, Sendable {
    public let id: UUID
    public let presenterID: UUID
    public let feature: ProFeature?
    public init(id: UUID = UUID(), presenterID: UUID, feature: ProFeature? = nil) {
        self.id = id; self.presenterID = presenterID; self.feature = feature
    }
}
public enum ProPhase: Sendable, Equatable {
    case loading, ready, unavailable, purchasing, restoring, redeeming, success, scheduled, unconfirmed, manageRenewal
    public var isWorking: Bool { self == .purchasing || self == .restoring || self == .redeeming }
}

/// Single purchase coordinator. Closing a presentation never cancels or repeats a
/// native checkout; the returned genuine customer can reconcile without reviving its UI intent.
@MainActor
public final class ProController: ObservableObject {
    @Published public private(set) var review: ProReview?
    @Published public private(set) var phase: ProPhase = .loading
    @Published public private(set) var customer: ProCustomer?
    @Published public private(set) var allowance: ProAllowance?
    @Published public private(set) var packages: [ProPackage] = []
    @Published public private(set) var selectedID: UUID?
    @Published public private(set) var failure: ProStoreFailure?
    @Published public private(set) var accessRevision = UUID()
    public let mode: ProAccessMode
    public var onAccessChanged: (() -> Void)?
    public var onSuccessfulDismissal: ((ProReview) -> Void)?
    public var onClosed: ((UUID) -> Void)?
    private let source: (any ProStoreSource)?
    private let clock: () -> Double
    private let delay: @Sendable (Double) async throws -> Void
    private var operation: UUID?
    private var readRevision = UUID()
    private var offeringsRead: UUID?
    private var updateTask: Task<Void, Never>?
    private var expiryTask: Task<Void, Never>?
    private var expiryRevision = UUID()
    private var finishTask: Task<Void, Never>?
    private var customerResolved = false
    private var pendingSuccess: ProReview?
    public private(set) var foreground = true

    public init(mode: ProAccessMode, source: (any ProStoreSource)?,
                clock: @escaping () -> Double = { Date().timeIntervalSince1970 * 1_000 },
                delay: @escaping @Sendable (Double) async throws -> Void = { try await Task.sleep(for: .seconds($0)) }) {
        self.mode = mode; self.source = source; self.clock = clock; self.delay = delay
        if mode == .community { phase = .unavailable }
        if let source {
            updateTask = Task { [weak self] in
                for await value in source.updates {
                    guard !Task.isCancelled, let self else { return }
                    // A write owns its exact result. An independent event cannot complete its review.
                    guard self.operation == nil else { continue }
                    self.accept(value)
                }
            }
        }
    }
    deinit { updateTask?.cancel(); expiryTask?.cancel(); finishTask?.cancel() }
    public var access: ProAccess { .init(mode: mode, customer: customer, allowance: allowance, resolved: customerResolved) }
    public var now: Double { clock() }
    public var paid: Bool { access.hasPaidAccess(at: now) }
    public var allFeatures: Bool { access.allFeatures(at: now) }
    public var configured: Bool { source != nil && mode == .store }
    public var canCheckout: Bool {
        guard phase == .ready, operation == nil, let selected = selectedPackage else { return false }
        return !ProPlans.locked(selected, packages: packages, customer: customer, now: now)
    }
    public var selectedPackage: ProPackage? { packages.first { $0.id == selectedID } }
    public var ownedPackage: ProPackage? { ProPlans.displayed(packages, customer: customer, now: now) }
    public func updateAllowance(_ value: ProAllowance?) {
        allowance = value; changed(); scheduleExpiry()
    }
    public func setForeground(_ value: Bool) {
        foreground = value
        if value {
            changed()
            Task {
                if let id = self.review?.id, !self.phase.isWorking { await self.refresh(reviewID: id) }
                else { await self.refreshCustomer() }
            }
        }
    }
    @discardableResult public func open(presenterID: UUID, feature: ProFeature? = nil) -> ProReview? {
        guard review == nil, operation == nil else { return nil }
        finishTask?.cancel(); pendingSuccess = nil; failure = nil
        let value = ProReview(presenterID: presenterID, feature: feature)
        review = value; phase = configured ? .loading : .unavailable
        Task { await self.refresh(reviewID: value.id) }
        return value
    }
    public func close(_ id: UUID) {
        guard review?.id == id else { return }
        finishTask?.cancel(); pendingSuccess = nil; review = nil; onClosed?(id)
    }
    /// Called by the actual cover's onDismiss; a later review cannot inherit continuation.
    public func didDismiss(_ id: UUID) {
        guard let success = pendingSuccess, success.id == id else { return }
        pendingSuccess = nil
        guard review == nil else { return }
        onSuccessfulDismissal?(success); onClosed?(id)
    }
    public func select(_ id: UUID, reviewID: UUID) {
        guard review?.id == reviewID, phase == .ready, operation == nil,
              let value = packages.first(where: { $0.id == id }), !ProPlans.locked(value, packages: packages, customer: customer, now: now) else { return }
        selectedID = id
    }
    public func refresh(reviewID: UUID? = nil) async {
        guard operation == nil, let source else { if reviewID == review?.id { phase = .unavailable }; return }
        let revision = UUID(); readRevision = revision; offeringsRead = revision
        defer { if offeringsRead == revision { offeringsRead = nil } }
        do {
            let value = try await source.customer()
            guard readRevision == revision, operation == nil else { return }
            accept(value)
            let offering = try await source.offerings()
            guard readRevision == revision, operation == nil else { return }
            packages = offering.packages
            let owned = ownedPackage
            let preferred = ProPlans.preferred(packages, defaultKind: offering.defaultKind)
            let available = packages.first { !ProPlans.locked($0, packages: packages, customer: customer, now: now) }
            selectedID = (preferred.flatMap { ProPlans.locked($0, packages: packages, customer: customer, now: now) ? nil : $0 } ?? available ?? owned ?? preferred)?.id
            if reviewID == review?.id { phase = packages.isEmpty ? .unavailable : .ready; failure = nil }
        } catch {
            guard readRevision == revision, operation == nil else { return }
            if reviewID == review?.id { phase = .unavailable; failure = classify(error) }
        }
    }
    public func refreshCustomer() async {
        guard foreground, operation == nil, offeringsRead == nil, let source else { return }
        let revision = UUID(); readRevision = revision
        do { let value = try await source.customer(); if readRevision == revision, operation == nil { accept(value) } }
        catch { /* A failed read cannot grant or extend access, nor erase still-valid verified evidence. */ }
    }
    public func purchase(reviewID: UUID) {
        guard review?.id == reviewID, canCheckout, let target = selectedPackage, let source else { return }
        let id = reserve(.purchasing)
        Task {
            defer { release(id) }
            do {
                let before = try await source.customer(); accept(before)
                guard operation == id, review?.id == reviewID else { return }
                guard !ProPlans.locked(target, packages: packages, customer: before, now: now) else { phase = .ready; return }
                let result = try await source.purchase(target.id); accept(result.customer)
                guard operation == id, review?.id == reviewID else { return }
                switch ProPlans.outcome(target: target, before: before, after: result.customer, purchasedProductID: result.productID, now: now) {
                case .unconfirmed: phase = .unconfirmed
                case .scheduled: phase = .scheduled
                case .activated:
                    if target.kind == .lifetime && (before.hasRenewingSubscription || result.customer.hasRenewingSubscription) { phase = .manageRenewal }
                    else { finish(reviewID) }
                }
            } catch { show(error, reviewID: reviewID, operationID: id) }
        }
    }
    public func restore(reviewID: UUID) {
        guard review?.id == reviewID, operation == nil, let source else { return }
        let id = reserve(.restoring)
        Task {
            defer { release(id) }
            do {
                let value = try await source.restore(); accept(value)
                guard operation == id, review?.id == reviewID else { return }
                if value.isActive(at: now) { finish(reviewID) }
                else { phase = .ready; failure = .unconfirmed }
            } catch { show(error, reviewID: reviewID, operationID: id) }
        }
    }
    public func redeem(reviewID: UUID) {
        guard review?.id == reviewID, operation == nil, let source else { return }
        let id = reserve(.redeeming), delay = delay
        Task {
            defer { release(id) }
            do {
                let before = try await source.customer(); accept(before)
                guard operation == id, review?.id == reviewID else { return }
                try source.presentRedemption()
                for _ in 0..<12 {
                    try await delay(5)
                    guard operation == id, review?.id == reviewID else { return }
                    guard foreground else { continue }
                    guard let after = try? await source.customer() else { continue }
                    accept(after)
                    guard operation == id, review?.id == reviewID else { return }
                    if ProPlans.redemptionChanged(before: before, after: after, now: now) {
                        if after.isLifetime(at: now) && after.hasRenewingSubscription { phase = .manageRenewal }
                        else { finish(reviewID) }
                        return
                    }
                }
                if review?.id == reviewID { phase = .ready; failure = .unconfirmed }
            } catch { show(error, reviewID: reviewID, operationID: id) }
        }
    }
    public func manage(reviewID: UUID) async {
        guard review?.id == reviewID, operation == nil, let source else { return }
        do { try await source.manageSubscription(); await refreshCustomer() }
        catch { if review?.id == reviewID { failure = classify(error) } }
    }
    private func reserve(_ phase: ProPhase) -> UUID {
        let id = UUID(); operation = id; readRevision = UUID(); failure = nil; self.phase = phase; return id
    }
    private func release(_ id: UUID) { if operation == id { operation = nil } }
    private func accept(_ value: ProCustomer) {
        guard value.requestMs.isFinite, value.requestMs >= (customer?.requestMs ?? 0) else { return }
        customer = value; customerResolved = true; changed()
        scheduleExpiry()
    }
    private func scheduleExpiry() {
        expiryTask?.cancel()
        let revision = UUID(); expiryRevision = revision
        let delay = delay
        expiryTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let wait = self?.nextExpiryWait(revision) else { return }
                do { try await delay(wait) } catch { return }
                guard !Task.isCancelled, let owner = self, owner.expiryRevision == revision else { return }
                owner.changed()
                if owner.foreground { await owner.refreshCustomer() }
                // A failed or deferred network read cannot retire the remaining deadline.
            }
        }
    }
    private func nextExpiryWait(_ revision: UUID) -> Double? {
        guard expiryRevision == revision, now.isFinite else { return nil }
        let deadlines: [Double] = [customer?.expirationMs, allowance?.graceUntil.map(Double.init)].compactMap { $0 }
        guard let next = deadlines.filter({ $0.isFinite && $0 > now }).min() else { return nil }
        return max(0.001, min(86_400, (next - now) / 1_000))
    }
    private func changed() { accessRevision = UUID(); onAccessChanged?() }
    private func finish(_ id: UUID) {
        guard let current = review, current.id == id else { return }
        phase = .success; failure = nil; let delay = delay
        finishTask = Task { [weak self] in
            do { try await delay(2) } catch { return }
            guard !Task.isCancelled, let self, self.review?.id == id else { return }
            self.pendingSuccess = current; self.review = nil
        }
    }
    private func show(_ error: Error, reviewID: UUID, operationID: UUID) {
        guard operation == operationID, review?.id == reviewID else { return }
        let value = classify(error); failure = value == .cancelled ? nil : value
        phase = value == .cancelled ? .ready : value == .pending || value == .failed ? .unconfirmed : .ready
    }
    private func classify(_ error: Error) -> ProStoreFailure { error as? ProStoreFailure ?? .failed }
}
