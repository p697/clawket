import ClawketRuntime
import Foundation

/// Exact, scope-local display reconciliation. No text, clock or inferred participant identity enters a key.
enum NativeHistoryIdentity {
    enum Author: Equatable, Sendable {
        case direct
        case participant(channel: String, account: String?, senderID: String?)

        static func == (left: Self, right: Self) -> Bool {
            switch (left, right) {
            case (.direct, .direct): true
            case let (.participant(channel, account, sender), .participant(otherChannel, otherAccount, otherSender)):
                NativeHistoryIdentity.bytesEqual(channel, otherChannel) && NativeHistoryIdentity.bytesEqual(account, otherAccount) && NativeHistoryIdentity.bytesEqual(sender, otherSender)
            default: false
            }
        }
    }

    struct Row: Sendable {
        let role: RuntimeMessage.Role
        /// Actual producer identity, never the local synthetic history fallback.
        let sourceID: String?
        /// Actual producer position, never a synthetic page index or content digest.
        let position: RuntimeTranscriptPosition?
        let sendKey: String?
        let locallyOwned: Bool
        let author: Author
        let epoch: UUID?
    }

    static func incoming(_ message: RuntimeMessage, epoch: UUID?) -> Row {
        .init(role: message.role, sourceID: message.idSource == .provided ? message.providedID : nil,
              position: message.transcriptPosition,
              sendKey: message.idSource == .ambiguousProvided ? nil : message.idempotencyKey,
              locallyOwned: false, author: author(message.attribution, role: message.role), epoch: epoch)
    }

    static func stored(_ message: NativeMessage) -> Row {
        .init(role: message.role, sourceID: message.idSource == .provided ? message.providedID : nil,
              position: message.transcriptPosition,
              sendKey: message.idSource == .ambiguousProvided ? nil : message.idempotencyKey,
              locallyOwned: message.isOwnedUser,
              author: author(message.attribution, role: message.role), epoch: message.historyEpoch)
    }

    private static func author(_ value: RuntimeMessageAttribution?, role: RuntimeMessage.Role) -> Author {
        guard role == .user, let value else { return .direct }
        return .participant(channel: value.channel, account: value.accountID, senderID: value.sender?.id)
    }

    enum Kind: Equatable, Sendable { case remoteSource, transcriptPosition, localEcho, confirmedLocalSource }
    struct Match: Equatable, Sendable { let storedIndex: Int; let kind: Kind }
    private enum Evidence { case absent, unique(Int), conflict }
    private enum Namespace: Hashable { case provided, position, send }
    private struct Key: Hashable { let epoch: UUID?; let namespace: Namespace; let value: Data }

    static func matches(incoming: [Row], stored: [Row]) -> [Int: Match] {
        let oldSources = index(stored, key: sourceKey)
        let newSources = index(incoming, key: sourceKey)
        let oldSends = index(stored, key: sendKey)
        let newSends = index(incoming, key: sendKey)
        var candidates: [Int: Match] = [:]
        for (position, row) in incoming.enumerated() {
            let source = evidence(sourceKey(row), old: oldSources, new: newSources)
            let send = evidence(sendKey(row), old: oldSends, new: newSends)
            if case .conflict = source { continue }
            if case .conflict = send { continue }
            if case let .unique(sourceIndex) = source, case let .unique(sendIndex) = send,
               sourceIndex != sendIndex { continue }
            var choices = Set<Int>()
            var sourceKind: Kind?
            if case let .unique(previous) = source {
                let old = stored[previous]
                guard compatible(row, old, allowUnknownSender: !row.locallyOwned && !old.locallyOwned) else { continue }
                if old.locallyOwned {
                    // An old synthetic/unknown source key cannot prove local ownership.
                    if row.role == .user, row.author == .direct, let actual = row.sourceID, bytesEqual(actual, old.sourceID) {
                        choices.insert(previous); sourceKind = .confirmedLocalSource
                    }
                } else {
                    choices.insert(previous)
                    sourceKind = row.sourceID != nil && old.sourceID != nil ? .remoteSource : .transcriptPosition
                }
            }
            var echo: Int?
            if case let .unique(previous) = send {
                let old = stored[previous]
                guard compatible(row, old) else { continue }
                if old.locallyOwned, old.role == .user, row.author == .direct {
                    choices.insert(previous); echo = previous
                }
            }
            guard choices.count == 1, let previous = choices.first else { continue }
            let kind: Kind = echo == previous ? .localEcho : sourceKind ?? .transcriptPosition
            candidates[position] = Match(storedIndex: previous, kind: kind)
        }
        // Two different echoes cannot consume one stored row by choosing different keys.
        let consumers = Dictionary(grouping: candidates.values, by: \.storedIndex)
        return candidates.filter { consumers[$0.value.storedIndex]?.count == 1 }
    }

    private static func compatible(_ left: Row, _ right: Row, allowUnknownSender: Bool = false) -> Bool {
        guard left.role == right.role, left.epoch == right.epoch else { return false }
        // A missing index entry is absence, not permission to contradict known
        // producer/send evidence on the candidate itself.
        if left.sourceID != nil, right.sourceID != nil, !bytesEqual(left.sourceID, right.sourceID) { return false }
        if left.sendKey != nil, right.sendKey != nil, !bytesEqual(left.sendKey, right.sendKey) { return false }
        guard left.role == .user else { return true }
        switch (left.author, right.author) {
        case (.direct, .direct): return true
        case let (.participant(channel, account, sender), .participant(otherChannel, otherAccount, otherSender)):
            guard bytesEqual(channel, otherChannel), bytesEqual(account, otherAccount) else { return false }
            // Exact source identity can retain an inert unknown participant's display row.
            // It never establishes a person or allows send-key matching/local ownership.
            return sender != nil && bytesEqual(sender, otherSender)
                || allowUnknownSender && sender == nil && otherSender == nil
        default: return false
        }
    }

    private static func sourceKey(_ row: Row) -> Key? {
        if let source = row.sourceID {
            return bounded(source).map { Key(epoch: row.epoch, namespace: .provided, value: Data($0.utf8)) }
        }
        guard let position = row.position, let source = bounded(position.source),
              position.rawSequence >= 0, position.rawSequence <= 9_007_199_254_740_991 else { return nil }
        var value = Data(source.utf8)
        var sequence = position.rawSequence.bigEndian
        withUnsafeBytes(of: &sequence) { value.append(contentsOf: $0) }
        return Key(epoch: row.epoch, namespace: .position, value: value)
    }

    private static func sendKey(_ row: Row) -> Key? {
        guard row.role == .user else { return nil }
        return bounded(row.sendKey).map { Key(epoch: row.epoch, namespace: .send, value: Data($0.utf8)) }
    }

    private static func index(_ rows: [Row], key: (Row) -> Key?) -> [Key: [Int]] {
        var result: [Key: [Int]] = [:]
        for (position, row) in rows.enumerated() {
            if let value = key(row) { result[value, default: []].append(position) }
        }
        return result
    }

    private static func evidence(_ key: Key?, old: [Key: [Int]], new: [Key: [Int]]) -> Evidence {
        guard let key else { return .absent }
        guard let prior = old[key] else { return .absent }
        guard prior.count == 1, new[key]?.count == 1 else { return .conflict }
        return .unique(prior[0])
    }

    private static func bytesEqual(_ left: String?, _ right: String?) -> Bool {
        switch (left, right) {
        case (nil, nil): true
        case let (left?, right?): left.utf8.elementsEqual(right.utf8)
        default: false
        }
    }

    private static func bounded(_ value: String?) -> String? {
        guard let value, !value.isEmpty, value.utf8.count <= 4_096 else { return nil }
        return value
    }
}
