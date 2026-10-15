import Foundation
import Testing
@testable import ClawketTransport

@Suite(.serialized)
struct RelayDeadlineTests {
    @Test func ordinaryDeadlineAndDelayedCallbacksRemainAbsolute() {
        var deadline = ResponseDeadline(startedAt: .seconds(10), timeout: .seconds(5))
        #expect(deadline.remaining(at: .seconds(14)) == .seconds(1))
        #expect(deadline.remaining(at: .seconds(15)) == .zero)
        #expect(deadline.remaining(at: .seconds(12), transferGrace: .seconds(70)) == .zero)
    }

    @Test func observedTransferAllowsOneResponseWindowWithinOriginalCap() {
        var deadline = ResponseDeadline(startedAt: .zero, timeout: .seconds(5))
        #expect(deadline.remaining(at: .seconds(5), transferGrace: .seconds(85)) == .seconds(1))
        #expect(deadline.remaining(at: .seconds(30), transferGrace: .seconds(60)) == .seconds(1))
        #expect(deadline.remaining(at: .seconds(31)) == .seconds(5))
        #expect(deadline.remaining(at: .seconds(36)) == .zero)
        var nearCap = ResponseDeadline(startedAt: .zero, timeout: .seconds(20))
        _ = nearCap.remaining(at: .seconds(20), transferGrace: .seconds(70))
        #expect(nearCap.remaining(at: .seconds(89)) == .seconds(1))
        #expect(nearCap.remaining(at: .seconds(90), transferGrace: .seconds(90)) == .zero)
    }

    @Test func longOperationsKeepTheirExistingCeiling() {
        var deadline = ResponseDeadline(startedAt: .zero, timeout: .seconds(190))
        #expect(deadline.remaining(at: .seconds(90)) == .seconds(100))
        #expect(deadline.remaining(at: .seconds(190), transferGrace: .seconds(70)) == .zero)
        var invalid = ResponseDeadline(startedAt: .zero, timeout: .zero)
        #expect(invalid.remaining(at: .zero, transferGrace: .seconds(90)) == .zero)
    }

    @Test(arguments: [RelayTransferLease.minimumBytes, RelayTransferLease.maximumBytes])
    func transferBoundsUseActualBytesAndFailedReservationDoesNotGrantGrace(_ bytes: Int) {
        var lease = RelayTransferLease()
        let token = lease.beginOutgoing(bytes: bytes, at: .seconds(2))!
        #expect(lease.grace(at: .seconds(2)) == .seconds(90))
        lease.finishOutgoing(token, accepted: false)
        #expect(!lease.hasWindow)
        #expect(lease.grace(at: .seconds(3)) == .zero)
        #expect(lease.beginOutgoing(bytes: RelayTransferLease.minimumBytes - 1, at: .seconds(3)) == nil)
        #expect(lease.beginIncoming(bytes: RelayTransferLease.maximumBytes + 1, at: .seconds(3)) == false)
    }

    @Test func latestGenerationAndBothDirectionsAreRequiredForConfirmation() {
        var lease = RelayTransferLease()
        let upload = lease.beginOutgoing(bytes: 200_000, at: .zero)!
        let early = lease.generation
        #expect(lease.confirmProbe(generation: early, at: .seconds(1)) == false)
        lease.finishOutgoing(upload, accepted: true)
        #expect(lease.beginIncoming(bytes: 300_000, at: .seconds(2)) == true)
        #expect(lease.completeIncoming(bytes: 299_999) == false)
        #expect(lease.confirmProbe(generation: lease.generation, at: .seconds(2)) == false)
        #expect(lease.completeIncoming(bytes: 300_000) == true)
        #expect(lease.grace(at: .seconds(3)) == .seconds(87))
        #expect(lease.confirmProbe(generation: early, at: .seconds(3)) == false)
        #expect(lease.confirmProbe(generation: lease.generation, at: .seconds(3)) == true)
        #expect(!lease.hasWindow)
    }

    @Test func completionKeepsBudgetLockAndRepeatedTrafficCannotRenewIt() {
        var lease = RelayTransferLease()
        #expect(lease.beginIncoming(bytes: 200_000, at: .zero) == true)
        #expect(lease.completeIncoming(bytes: 200_000) == true)
        #expect(lease.grace(at: .seconds(5)) == .zero)
        #expect(lease.hasWindow)
        let old = lease.generation
        #expect(lease.beginIncoming(bytes: 400_000, at: .seconds(89)) == true)
        #expect(lease.remaining(at: .seconds(89)) == .seconds(1))
        #expect(lease.remaining(at: .seconds(90)) == .zero)
        #expect(lease.remaining(at: .seconds(50)) == .zero)
        #expect(lease.beginIncoming(bytes: 400_000, at: .seconds(91)) == true)
        #expect(lease.remaining(at: .seconds(91)) == .zero)
        #expect(lease.completeIncoming(bytes: 400_000) == true)
        #expect(lease.confirmProbe(generation: old, at: .seconds(91)) == false)
        #expect(lease.confirmProbe(generation: lease.generation, at: .seconds(91)) == true)
        #expect(lease.beginIncoming(bytes: 200_000, at: .seconds(92)) == true)
        #expect(lease.remaining(at: .seconds(92)) == .seconds(90))
    }
}
