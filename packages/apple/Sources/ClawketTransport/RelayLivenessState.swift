import Foundation

struct RelayLivenessState: Sendable {
    struct Probe: Sendable {
        let id: UUID
        let nonce: String
        let deadline: Duration
        let transferGeneration: UInt64
    }
    var clientPingNegotiated = false
    var transferHintNegotiated = false
    var transfer = RelayTransferLease()
    var pingTimer: Task<Void, Never>?
    var pingTimerID: UUID?
    var pingIsTransfer = false
    var pongTimer: Task<Void, Never>?
    var pendingProbe: Probe?
    var lastPingAt: Duration?
    var dispatches: [UUID: Task<Void, Never>] = [:]

    mutating func pause() {
        pingTimer?.cancel(); pingTimer = nil
        pingTimerID = nil
        pingIsTransfer = false
        pongTimer?.cancel(); pongTimer = nil
        pendingProbe = nil
    }

    mutating func retire() {
        pause()
        for task in dispatches.values { task.cancel() }
        dispatches.removeAll()
    }
}
