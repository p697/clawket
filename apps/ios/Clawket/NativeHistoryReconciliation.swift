import Foundation

/// Plans source order and stable display IDs without changing message content or dispatch authority.
enum NativeHistoryReconciliation {
    enum Failure: Error { case invalidInput }
    struct Stored {
        let id: String
        let identity: NativeHistoryIdentity.Row
        let preserveWhenAbsent: Bool
        let changedAfterRead: Bool
        var preserveMatchingContent = false
    }
    enum Entry: Equatable {
        case history(index: Int, previous: Int?, id: String)
        case preserved(index: Int, id: String)
        var id: String {
            switch self { case let .history(_, _, id), let .preserved(_, id): id }
        }
    }
    struct Plan {
        let entries: [Entry]
        /// Maps only accepted history records to their actual display row, including duplicate producer IDs.
        let acceptedHistoryIDs: [Int: String]
    }

    static func plan(incoming: [NativeHistoryIdentity.Row], stored: [Stored], earlier: Bool,
                     retainOlderPrefix: Bool, newID: () -> String = { UUID().uuidString }) throws -> Plan {
        guard incoming.count <= 10_000, stored.count <= 10_000,
              !incoming.contains(where: \.locallyOwned),
              stored.allSatisfy({ !$0.id.isEmpty && $0.id.utf8.count <= 256 }),
              Set(stored.map(\.id)).count == stored.count else { throw Failure.invalidInput }
        let matches = NativeHistoryIdentity.matches(incoming: incoming, stored: stored.map(\.identity))
        let anchors = incoming.indices.compactMap { matches[$0]?.storedIndex }
        let ordered = zip(anchors, anchors.dropFirst()).allSatisfy { pair in pair.0 < pair.1 }
        if earlier && !ordered { throw Failure.invalidInput }
        var allocated = Set(stored.map(\.id)), accepted: [Int: String] = [:], base: [Entry] = []
        for position in incoming.indices {
            if let previous = matches[position]?.storedIndex {
                if earlier { continue }
                let old = stored[previous]
                if old.changedAfterRead || old.preserveMatchingContent { base.append(.preserved(index: previous, id: old.id)) }
                else {
                    base.append(.history(index: position, previous: previous, id: old.id))
                    accepted[position] = old.id
                }
            } else {
                let id = newID()
                guard !id.isEmpty, id.utf8.count <= 256, allocated.insert(id).inserted else { throw Failure.invalidInput }
                base.append(.history(index: position, previous: nil, id: id)); accepted[position] = id
            }
        }
        if earlier {
            return Plan(entries: try weaveEarlier(base, incomingCount: incoming.count, matches: matches, stored: stored),
                acceptedHistoryIDs: accepted)
        }

        // Only an explicit partial head and consistent source anchors retain an older loaded prefix.
        // The caller additionally verifies the same physical session/epoch.
        let prefixEnd = retainOlderPrefix && ordered ? anchors.first : nil
        let baseIDs = Set(base.map(\.id))
        var nextAnchors = [String?](repeating: nil, count: stored.count), next: String?
        for position in stored.indices.reversed() {
            nextAnchors[position] = next
            if baseIDs.contains(stored[position].id) { next = stored[position].id }
        }
        var before: [String: [Entry]] = [:], after: [String: [Entry]] = [:], trailing: [Entry] = []
        var preceding: String?
        for (position, old) in stored.enumerated() {
            if baseIDs.contains(old.id) { preceding = old.id; continue }
            guard old.identity.locallyOwned || old.preserveWhenAbsent || old.changedAfterRead
                    || prefixEnd.map({ position < $0 }) == true else { continue }
            let entry = Entry.preserved(index: position, id: old.id)
            if let preceding { after[preceding, default: []].append(entry) }
            else if let next = nextAnchors[position] { before[next, default: []].append(entry) }
            else { trailing.append(entry) }
        }
        var result: [Entry] = []
        result.reserveCapacity(base.count + stored.count)
        for entry in base {
            result += before[entry.id] ?? []; result.append(entry); result += after[entry.id] ?? []
        }
        result += trailing
        return Plan(entries: result, acceptedHistoryIDs: accepted)
    }

    private static func weaveEarlier(_ additions: [Entry], incomingCount: Int,
                                     matches: [Int: NativeHistoryIdentity.Match], stored: [Stored]) throws -> [Entry] {
        var nextAnchors = [String?](repeating: nil, count: incomingCount), next: String?
        for position in (0..<incomingCount).reversed() {
            nextAnchors[position] = next
            if let previous = matches[position]?.storedIndex { next = stored[previous].id }
        }
        var before: [String: [Entry]] = [:], after: [String: [Entry]] = [:], prefix: [Entry] = []
        let additionsByPosition = Dictionary(uniqueKeysWithValues: additions.compactMap { entry -> (Int, Entry)? in
            if case let .history(index, _, _) = entry { return (index, entry) }
            return nil
        })
        var preceding: String?
        for position in 0..<incomingCount {
            if let previous = matches[position]?.storedIndex { preceding = stored[previous].id; continue }
            guard let entry = additionsByPosition[position] else { throw Failure.invalidInput }
            if let preceding { after[preceding, default: []].append(entry) }
            else if let next = nextAnchors[position] { before[next, default: []].append(entry) }
            else { prefix.append(entry) }
        }
        var result = prefix
        for (position, old) in stored.enumerated() {
            result += before[old.id] ?? []; result.append(.preserved(index: position, id: old.id))
            result += after[old.id] ?? []
        }
        return result
    }
}
