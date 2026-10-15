import Foundation

/// Same-socket transfer protection. Traffic cannot renew its absolute budget.
struct RelayTransferLease: Sendable {
    static let minimumBytes = 128 * 1_024
    static let maximumBytes = 8 * 1_024 * 1_024
    static let budget: Duration = .seconds(90)
    private(set) var generation: UInt64 = 0
    private(set) var incomingBytes: Int?
    private var deadline: Duration?
    private var expired = false
    private var latestNow: Duration = .zero
    private var outgoingAccepted = false
    private var dispatches: Set<UUID> = []
    private var committedWindow = false

    var hasWindow: Bool { deadline != nil }
    var canConfirm: Bool { incomingBytes == nil && dispatches.isEmpty }
    var pendingDispatchCount: Int { dispatches.count }

    mutating func remaining(at now: Duration) -> Duration {
        latestNow = max(latestNow, now)
        guard let deadline, !expired else { return .zero }
        let remaining = deadline - latestNow
        guard remaining > .zero else {
            expired = true
            generation &+= 1 // Pre-expiry probes cannot unlock a latched window.
            return .zero
        }
        return remaining
    }

    mutating func grace(at now: Duration) -> Duration {
        let remaining = remaining(at: now)
        return incomingBytes != nil || outgoingAccepted || !dispatches.isEmpty ? remaining : .zero
    }

    @discardableResult
    mutating func beginIncoming(bytes: Int, at now: Duration) -> Bool {
        guard Self.isLargeFrame(bytes) else { return false }
        begin(at: now)
        incomingBytes = bytes
        committedWindow = true
        return true
    }

    mutating func beginOutgoing(bytes: Int, at now: Duration) -> UUID? {
        guard Self.isLargeFrame(bytes) else { return nil }
        begin(at: now)
        let token = UUID()
        dispatches.insert(token)
        return token
    }

    mutating func finishOutgoing(_ token: UUID, accepted: Bool) {
        guard dispatches.remove(token) != nil else { return }
        if accepted { outgoingAccepted = true; committedWindow = true }
        // A rejected local send is not a transfer or a health observation. Drop
        // only its transient reservation; preserve earlier committed directions.
        if !committedWindow, dispatches.isEmpty {
            deadline = nil; expired = false
        }
    }

    @discardableResult
    mutating func completeIncoming(bytes: Int) -> Bool {
        guard incomingBytes == bytes else { return false }
        incomingBytes = nil
        return true
    }

    /// Only the actor's exact pending nonce may call this after a fresh round trip.
    mutating func confirmProbe(generation: UInt64, at now: Duration) -> Bool {
        _ = remaining(at: now)
        guard self.generation == generation, canConfirm else { return false }
        deadline = nil; expired = false; outgoingAccepted = false; committedWindow = false
        return true
    }

    private mutating func begin(at now: Duration) {
        _ = remaining(at: now)
        latestNow = max(latestNow, now)
        generation &+= 1
        if deadline == nil { deadline = latestNow + Self.budget }
    }

    private static func isLargeFrame(_ bytes: Int) -> Bool {
        (minimumBytes...maximumBytes).contains(bytes)
    }
}
