import Foundation

/// History APIs supply a canonical sequence. Missing/skewed wall clocks never order work.
enum NativeHistoryWorkOrder {
    static func merge(document: inout NativeJournalDocument, scope: NativeJournalScope,
                      runs historyRuns: [String], steps historySteps: [String: [String]],
                      earlier: Bool, liveIDs: Set<String>, priorRunIDs: Set<String>) {
        func unique(_ values: [String]) -> [String] {
            var seen = Set<String>(); return values.filter { seen.insert($0).inserted }
        }
        let existing = document.runs.filter { $0.scope == scope }.sorted { $0.order < $1.order }
        let valid = Set(existing.map(\.id)), source = unique(historyRuns).filter { valid.contains($0) }
        guard !source.isEmpty else { return }
        let touched = Set(source), untouched = existing.map(\.id).filter { !touched.contains($0) }
        let ordered: [String]
        if earlier {
            let inserted = source.filter { !priorRunIDs.contains($0) }, newIDs = Set(inserted)
            ordered = inserted + existing.map(\.id).filter { !newIDs.contains($0) }
        }
        else {
            ordered = untouched.filter { !liveIDs.contains($0) } + source + untouched.filter { liveIDs.contains($0) }
        }
        var flattened: [String] = []
        for id in ordered {
            guard let run = existing.first(where: { $0.id == id }) else { continue }
            flattened.append(id)
            let old = run.steps.sorted { $0.order < $1.order }.map(\.id)
            let validSteps = Set(old), sourceSteps = unique(historySteps[id] ?? []).filter { validSteps.contains($0) }
            let touchedSteps = Set(sourceSteps), remaining = old.filter { !touchedSteps.contains($0) }
            if earlier { flattened += sourceSteps + remaining }
            else { flattened += remaining.filter { !liveIDs.contains($0) } + sourceSteps + remaining.filter { liveIDs.contains($0) } }
        }
        // Reindex only order values. All run/step render IDs and other scopes remain intact.
        let scopeIDs = Set(flattened)
        var all: [(String, Int64)] = document.reviews.map { ($0.id, $0.order) }
        for run in document.runs { all.append((run.id, run.order)); all += run.steps.map { ($0.id, $0.order) } }
        let prior = all.sorted { $0.1 < $1.1 }.map(\.0)
        var result: [String] = []; var inserted = false
        for id in prior {
            if scopeIDs.contains(id) {
                if !inserted { result += flattened; inserted = true }
            } else { result.append(id) }
        }
        guard Set(result).count == result.count else { return }
        let orders = Dictionary(uniqueKeysWithValues: result.enumerated().map { ($0.element, Int64($0.offset)) })
        for index in document.runs.indices {
            document.runs[index].order = orders[document.runs[index].id] ?? document.runs[index].order
            for step in document.runs[index].steps.indices {
                let id = document.runs[index].steps[step].id
                document.runs[index].steps[step].order = orders[id] ?? document.runs[index].steps[step].order
            }
        }
        for index in document.reviews.indices { document.reviews[index].order = orders[document.reviews[index].id] ?? document.reviews[index].order }
        document.nextOrder = Int64(result.count)
        document.runs.sort { $0.order < $1.order }
    }
}
