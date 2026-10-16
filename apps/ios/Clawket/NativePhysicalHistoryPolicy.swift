import Foundation

/// Local persistence decisions require a current accepted head or a captured
/// reset/delete ACK. Titles, clocks, reset prose and cursor pages grant nothing.
enum NativePhysicalHistoryPolicy {
    enum Decision: Equatable {
        case unchanged
        case establish(String?)
        case bind(String)
        case rollover(String?)
    }

    static func head(_ physicalID: String?, current: NativeConversation, earlier: Bool) throws -> Decision {
        guard physicalID == nil || (!physicalID!.isEmpty && physicalID!.utf8.count <= 2_048) else {
            throw NativeHistoryFailure.invalid
        }
        guard !earlier else { return .unchanged }
        guard current.historyEpoch != nil else {
            return current.messages.isEmpty ? .establish(physicalID) : .rollover(physicalID)
        }
        guard let physicalID else { return .unchanged }
        if let previous = current.physicalSessionID {
            return historySame(previous, physicalID) ? .unchanged : .rollover(physicalID)
        }
        return current.messages.allSatisfy(isHeldInput) ? .bind(physicalID) : .rollover(physicalID)
    }

    static func isHeldInput(_ message: NativeMessage) -> Bool {
        message.isOwnedUser && !message.streaming && message.idempotencyKey?.isEmpty == false &&
            [.held, .uncertain, .failed].contains(message.delivery)
    }

    static func retainAcrossBoundary(_ message: NativeMessage) -> Bool {
        message.isOwnedUser && message.idempotencyKey?.isEmpty == false &&
            [.queued, .held, .sending, .uncertain, .failed].contains(message.delivery)
    }

    /// Retained input belongs to its original epoch until an explicit held-send
    /// action. A delayed old receipt cannot become a new physical session's ACK.
    static func hold(_ conversation: inout NativeConversation) {
        for index in conversation.messages.indices {
            if conversation.messages[index].isOwnedUser {
                if conversation.messages[index].delivery == .queued { conversation.messages[index].delivery = .held }
                if conversation.messages[index].delivery == .sending { conversation.messages[index].delivery = .uncertain }
            }
            conversation.messages[index].streaming = false
        }
    }
}

/// An epoch change cannot identify a same-socket late run from its clock or
/// arrival order. Actual new input/receipts and a current accepted head can.
struct NativePhysicalLiveEvidence {
    let epoch: UUID
    private var known: Set<Data> = []
    private var knownOrder: [Data] = []
    private let retired: Set<Data>
    private let overflow: Bool

    init(epoch: UUID, retiringRunIDs: [String]) {
        self.epoch = epoch
        let values = Set(retiringRunIDs.compactMap(Self.key))
        overflow = values.count > 128
        retired = Set(values.prefix(128))
    }

    mutating func admit(_ runID: String) {
        guard let key = Self.key(runID), !overflow, !retired.contains(key) else { return }
        knownOrder.removeAll { $0 == key }; knownOrder.append(key); known.insert(key)
        if knownOrder.count > 128 { known.remove(knownOrder.removeFirst()) }
    }

    mutating func accepts(runID: String?, inputKey: String?, current: NativeConversation) -> Bool {
        guard current.historyEpoch == epoch else { return false }
        let run = runID.flatMap(Self.key)
        if let inputKey {
            let matching = current.messages.filter {
                $0.role == .user && $0.historyEpoch == epoch && historySame($0.idempotencyKey, inputKey) &&
                    ($0.isOwnedUser ? [.sending, .sent, .delivered].contains($0.delivery)
                        : !$0.local && $0.remoteID?.isEmpty == false && $0.idSource != .ambiguousProvided)
            }
            guard matching.count == 1 else { return false }
            // Reused run strings may accompany an actual new input tuple, but
            // never enter the bare-run allowlist after retiring an old epoch.
            if let runID { admit(runID) }
            return true
        }
        guard let run, !overflow, !retired.contains(run) else { return false }
        return known.contains(run)
    }

    private static func key(_ value: String) -> Data? {
        guard !value.isEmpty, value.utf8.count <= 1_024 else { return nil }
        return Data(value.utf8)
    }
}
