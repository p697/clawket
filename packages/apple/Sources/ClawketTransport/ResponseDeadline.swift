import Foundation

/// An ordinary response window, extended only by an observed same-socket transfer.
/// This value contains no socket authority and never establishes peer health.
struct ResponseDeadline: Sendable, Equatable {
    private let ordinaryDeadline: Duration
    private let absoluteDeadline: Duration
    private let timeout: Duration
    private var latestNow: Duration
    private var deferred = false
    private var responseDeadline: Duration?
    private var expired = false

    init(startedAt: Duration, timeout: Duration) {
        self.timeout = max(.zero, timeout)
        ordinaryDeadline = startedAt + max(.zero, timeout)
        absoluteDeadline = startedAt + max(.seconds(90), timeout)
        latestNow = startedAt
        expired = timeout <= .zero
    }

    /// Recheck at delivery as well as in a timer: suspension can delay callbacks.
    /// Once expired, a clock rollback or a later transfer cannot revive this wait.
    mutating func remaining(at now: Duration, transferGrace: Duration = .zero) -> Duration {
        latestNow = max(latestNow, now)
        guard !expired else { return .zero }
        let now = latestNow
        if !deferred, now < ordinaryDeadline { return ordinaryDeadline - now }
        let cap = absoluteDeadline - now
        guard cap > .zero else { expired = true; return .zero }
        if transferGrace > .zero {
            deferred = true
            return min(.seconds(1), min(transferGrace, cap))
        }
        if deferred {
            if responseDeadline == nil { responseDeadline = min(absoluteDeadline, now + timeout) }
            let remaining = min(absoluteDeadline, responseDeadline!) - now
            if remaining > .zero { return remaining }
        }
        expired = true
        return .zero
    }
}
