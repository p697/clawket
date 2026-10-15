import Foundation
import Testing
@testable import ClawketCommerce

private final class ProDelay: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Double = 0
    private var waits: [UUID: (Double, CheckedContinuation<Void, any Error>)] = [:]
    func sleep(_ seconds: Double) async throws {
        let id = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
                lock.lock()
                if Task.isCancelled { lock.unlock(); continuation.resume(throwing: CancellationError()) }
                else { waits[id] = (value + seconds, continuation); lock.unlock() }
            }
        } onCancel: { self.cancel(id) }
    }
    private func cancel(_ id: UUID) {
        lock.lock(); let wait = waits.removeValue(forKey: id); lock.unlock()
        wait?.1.resume(throwing: CancellationError())
    }
    func advance(_ seconds: Double) {
        lock.lock(); value += seconds
        let due = waits.filter { $0.value.0 <= value }
        for id in due.keys { waits.removeValue(forKey: id) }; lock.unlock()
        due.values.forEach { $0.1.resume() }
    }
    var count: Int { lock.lock(); defer { lock.unlock() }; return waits.count }
}

@MainActor private final class ProPeer: ProStoreSource {
    var value = customer(false)
    let annual = ProPackage(id: UUID(), offeringID: "fixture", packageID: "annual", productID: "year", kind: .annual, title: "Annual", price: 24, priceString: "£24.00")
    let monthly = ProPackage(id: UUID(), offeringID: "fixture", packageID: "monthly", productID: "month", kind: .monthly, title: "Monthly", price: 3, priceString: "£3.00")
    var packages: [ProPackage] { [annual, monthly] }
    var reads = 0, purchases = 0, restores = 0, redemptions = 0
    var readFailure = false
    var nextCustomer: CheckedContinuation<ProCustomer, any Error>?
    var pauseRead = false
    var nextPurchase: CheckedContinuation<(customer: ProCustomer, productID: String?), any Error>?
    var purchaseError: ProStoreFailure?
    let updates: AsyncStream<ProCustomer>
    let continuation: AsyncStream<ProCustomer>.Continuation
    init() { (updates, continuation) = AsyncStream.makeStream(bufferingPolicy: .bufferingNewest(8)) }
    func customer() async throws -> ProCustomer {
        reads += 1
        if readFailure { throw ProStoreFailure.failed }
        if pauseRead { pauseRead = false; return try await withCheckedThrowingContinuation { nextCustomer = $0 } }
        return value
    }
    func offerings() -> (packages: [ProPackage], defaultKind: ProPlanKind) { (packages, .annual) }
    func purchase(_ id: UUID) async throws -> (customer: ProCustomer, productID: String?) {
        purchases += 1
        if let purchaseError { throw purchaseError }
        return try await withCheckedThrowingContinuation { nextPurchase = $0 }
    }
    func restore() -> ProCustomer { restores += 1; return value }
    func presentRedemption() { redemptions += 1 }
    func manageSubscription() {}
    static func customer(_ active: Bool, product: String = "year", request: Double = 100) -> ProCustomer {
        .init(active: active, verification: .verified, productID: active ? product : nil,
              expirationMs: active ? 1_000_000 : nil, originalPurchaseMs: 1_800_000_000_000,
              latestPurchaseMs: 90, requestMs: request, store: "APP_STORE")
    }
}

@MainActor private func settled(_ condition: () -> Bool) async {
    for _ in 0..<2_000 { if condition() { return }; await Task.yield() }
    #expect(condition())
}

@MainActor struct ProControllerTests {
    @Test func successContinuesOnlyAfterActualMatchingDismissAndNeverRepeatsCheckout() async throws {
        let peer = ProPeer(), timer = ProDelay()
        let controller = ProController(mode: .store, source: peer, clock: { 100 }, delay: { try await timer.sleep($0) })
        var completed: [UUID] = []; controller.onSuccessfulDismissal = { completed.append($0.id) }
        let review = try #require(controller.open(presenterID: UUID(), feature: .archiveTools))
        await settled { controller.phase == .ready }
        controller.purchase(reviewID: review.id); controller.purchase(reviewID: review.id)
        await settled { peer.nextPurchase != nil }
        #expect(peer.purchases == 1); #expect(peer.reads == 2)
        peer.nextPurchase?.resume(returning: (ProPeer.customer(true), "year")); peer.nextPurchase = nil
        await settled { controller.phase == .success && timer.count >= 1 }
        #expect(controller.paid); #expect(completed.isEmpty)
        peer.value = ProPeer.customer(true)
        await controller.refresh(reviewID: review.id)
        #expect(controller.phase == .success); #expect(!controller.canCheckout)
        controller.restore(reviewID: review.id); controller.redeem(reviewID: review.id)
        #expect(peer.restores == 0); #expect(peer.redemptions == 0)
        timer.advance(2); await settled { controller.review == nil }
        controller.didDismiss(UUID()); #expect(completed.isEmpty)
        controller.didDismiss(review.id); controller.didDismiss(review.id)
        #expect(completed == [review.id]); #expect(peer.purchases == 1)
    }
    @Test func revokedAccessBeforeActualDismissalCannotContinueOldPurchaseIntent() async throws {
        let peer = ProPeer(), timer = ProDelay()
        let controller = ProController(mode: .store, source: peer, clock: { 100 }, delay: { try await timer.sleep($0) })
        var completed = false, closed = false
        controller.onSuccessfulDismissal = { _ in completed = true }
        controller.onClosed = { _ in closed = true }
        let review = try #require(controller.open(presenterID: UUID()))
        await settled { controller.phase == .ready }
        controller.purchase(reviewID: review.id); await settled { peer.nextPurchase != nil }
        peer.nextPurchase?.resume(returning: (ProPeer.customer(true), "year")); peer.nextPurchase = nil
        await settled { controller.phase == .success && timer.count >= 1 }
        timer.advance(2); await settled { controller.review == nil }
        peer.value = ProPeer.customer(false, request: 110)
        await controller.refreshCustomer(); #expect(!controller.paid)
        controller.didDismiss(review.id)
        #expect(!completed); #expect(closed)
    }
    @Test func closingDuringBaselineCannotStartCheckoutAndLateTransactionOnlyReconcilesAccess() async throws {
        let peer = ProPeer(), controller = ProController(mode: .store, source: peer, clock: { 100 })
        let first = try #require(controller.open(presenterID: UUID()))
        await settled { controller.phase == .ready }
        peer.pauseRead = true; controller.purchase(reviewID: first.id)
        await settled { peer.nextCustomer != nil }; controller.close(first.id)
        peer.nextCustomer?.resume(returning: ProPeer.customer(false)); peer.nextCustomer = nil
        await settled { controller.open(presenterID: UUID()) != nil }
        #expect(peer.purchases == 0)
        let second = try #require(controller.review)
        await settled { controller.phase == .ready }
        controller.purchase(reviewID: second.id); await settled { peer.nextPurchase != nil }
        controller.close(second.id)
        var completed = false; controller.onSuccessfulDismissal = { _ in completed = true }
        peer.nextPurchase?.resume(returning: (ProPeer.customer(true), "year")); peer.nextPurchase = nil
        await settled { controller.paid }
        controller.didDismiss(second.id); #expect(!completed); #expect(controller.review == nil)
    }
    @Test func pendingAndScheduledWritesCannotContinueOrReplayFromUpdates() async throws {
        let peer = ProPeer(), controller = ProController(mode: .store, source: peer, clock: { 100 })
        let review = try #require(controller.open(presenterID: UUID()))
        await settled { controller.phase == .ready }
        peer.purchaseError = .pending; controller.purchase(reviewID: review.id)
        await settled { controller.phase == .unconfirmed }
        controller.purchase(reviewID: review.id); #expect(peer.purchases == 1)
        await controller.refresh(reviewID: review.id)
        #expect(controller.phase == .unconfirmed); #expect(!controller.canCheckout)
        peer.readFailure = true; await controller.refresh(reviewID: review.id); peer.readFailure = false
        #expect(controller.phase == .unconfirmed)
        peer.continuation.yield(ProPeer.customer(true, request: 110))
        await settled { controller.paid }; #expect(controller.phase == .unconfirmed); #expect(controller.review?.id == review.id)
        controller.close(review.id)
        peer.purchaseError = nil; peer.value = ProPeer.customer(true, product: "month", request: 120)
        let next = try #require(controller.open(presenterID: UUID()))
        await settled { controller.phase == .ready }; controller.purchase(reviewID: next.id)
        await settled { peer.nextPurchase != nil }
        peer.nextPurchase?.resume(returning: (peer.value, "year")); peer.nextPurchase = nil
        await settled { controller.phase == .scheduled }
        #expect(controller.review?.id == next.id); #expect(peer.purchases == 2)
        await controller.refresh(reviewID: next.id)
        #expect(controller.phase == .scheduled); #expect(!controller.canCheckout)
    }
    @Test func redemptionPresentationIsNotSuccessAndPollsAreBoundedRetiredAndForegroundOnly() async throws {
        let peer = ProPeer(), timer = ProDelay()
        let controller = ProController(mode: .store, source: peer, clock: { 100 }, delay: { try await timer.sleep($0) })
        let review = try #require(controller.open(presenterID: UUID()))
        await settled { controller.phase == .ready }; controller.redeem(reviewID: review.id)
        await settled { peer.redemptions == 1 && timer.count == 1 }
        let baseline = peer.reads; controller.setForeground(false)
        timer.advance(5); await settled { timer.count == 1 }; #expect(peer.reads == baseline)
        controller.setForeground(true)
        for _ in 0..<11 { timer.advance(5); await settled { timer.count == 1 || controller.phase == .ready } }
        await settled { controller.phase == .ready }
        #expect(controller.failure == .unconfirmed); #expect(!controller.paid); #expect(peer.reads <= baseline + 11)
        controller.redeem(reviewID: review.id); await settled { timer.count == 1 }
        controller.close(review.id); let reads = peer.reads
        timer.advance(5); await Task.yield(); #expect(peer.reads == reads); #expect(peer.redemptions == 2)
    }
    @Test func multiDayExpiryAndGraceStillNotifyAfterIntermediateNetworkReadFails() async throws {
        final class Time { var value = 100.0 }
        let time = Time(), peer = ProPeer(), timer = ProDelay()
        let expires = 100.0 + 2 * 86_400_000
        peer.value = .init(active: true, verification: .verified, productID: "year", expirationMs: expires,
            originalPurchaseMs: nil, latestPurchaseMs: nil, requestMs: 100, store: "APP_STORE")
        let controller = ProController(mode: .store, source: peer, clock: { time.value }, delay: { try await timer.sleep($0) })
        var changes = 0; controller.onAccessChanged = { changes += 1 }
        await controller.refreshCustomer(); await settled { timer.count == 1 }
        peer.readFailure = true; time.value += 86_400_000; timer.advance(86_400)
        await settled { peer.reads == 2 && timer.count == 1 }; #expect(controller.paid)
        let before = changes; time.value = expires; timer.advance(86_400)
        await settled { changes > before }; #expect(!controller.paid)
        controller.updateAllowance(.init(freeConnectionId: "a", graceEvaluatedAt: Int64(expires), graceUntil: Int64(expires + 5_000)))
        await settled { timer.count == 1 }; let graceChanges = changes
        time.value += 5_000; timer.advance(5)
        await settled { changes > graceChanges }; #expect(!controller.access.hasGrace(at: time.value))
    }
    @Test func expiryCannotBeExtendedByFailedReadAndOlderEvidenceCannotReplaceNewer() async throws {
        final class Time { var value = 100.0 }
        let time = Time(), peer = ProPeer(), timer = ProDelay()
        peer.value = ProPeer.customer(true)
        let controller = ProController(mode: .store, source: peer, clock: { time.value }, delay: { try await timer.sleep($0) })
        await controller.refreshCustomer(); #expect(controller.paid)
        peer.continuation.yield(ProPeer.customer(false, request: 99)); await Task.yield(); #expect(controller.paid)
        controller.setForeground(false); time.value = 1_000_000; timer.advance(1_000)
        await settled { !controller.paid }; #expect(!controller.allFeatures)
    }
}
