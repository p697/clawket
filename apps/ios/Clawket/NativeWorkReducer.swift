import ClawketRuntime
import ClawketTransport
import Foundation

/// Deterministic reduction of producer evidence. No network, timer or view owns these identities.
enum NativeWorkReducer {
    static func index(_ document: inout NativeJournalDocument, scope: NativeJournalScope,
                      lineage: NativeWorkLineage, historyAnchor: String? = nil,
                      freshStart: Bool = false, allowPartialBucket: Bool = true) -> Int? {
        guard lineage.runID != nil || lineage.turnID != nil || lineage.inputMessageID != nil ||
                lineage.inputMessageKey != nil || historyAnchor != nil else { return nil }
        let strongPairs: (NativeWorkLineage) -> [(String?, String?)] = { prior in
            [(prior.turnID, lineage.turnID), (prior.inputMessageID, lineage.inputMessageID), (prior.inputMessageKey, lineage.inputMessageKey)]
        }
        let hasStrong = lineage.turnID != nil || lineage.inputMessageID != nil || lineage.inputMessageKey != nil
        let reusedRun = lineage.runID != nil && document.runs.contains {
            $0.scope == scope && $0.lineage.runID == lineage.runID && $0.lineage.conflicts(with: lineage)
        }
        let candidates = document.runs.indices.filter {
            let run = document.runs[$0]
            guard run.scope == scope, !run.lineage.conflicts(with: lineage) else { return false }
            if reusedRun && hasStrong && !strongPairs(run.lineage).contains(where: { $0.0 != nil && $0.0 == $0.1 }) {
                return false // Earlier partial events cannot be retroactively assigned to this reused input.
            }
            if let historyAnchor, run.historyAnchor == historyAnchor { return true }
            return [(run.lineage.runID, lineage.runID), (run.lineage.turnID, lineage.turnID),
                    (run.lineage.inputMessageID, lineage.inputMessageID),
                    (run.lineage.inputMessageKey, lineage.inputMessageKey)].contains { a, b in a != nil && a == b }
        }
        let exact = candidates.filter { document.runs[$0].lineage == lineage }
        let isPartial = lineage.turnID == nil && lineage.inputMessageID == nil && lineage.inputMessageKey == nil
        if isPartial, freshStart, !candidates.isEmpty, candidates.allSatisfy({ document.runs[$0].status.isTerminal }) {
            // A new start with a reused wire run cannot be attributed to an older known input.
        } else if candidates.count == 1 {
            let found = candidates[0]; document.runs[found].lineage.enrich(with: lineage)
            return found
        } else if allowPartialBucket, exact.count == 1 {
            return exact[0] // Explicitly unattributed bucket; never pick a richer input by recency.
        } else if !candidates.isEmpty { return nil }
        // A partial late event matching two executions cannot mutate either of them.
        guard let order = document.allocateOrder() else { return nil }
        document.runs.append(.init(scope: scope, order: order, lineage: lineage, historyAnchor: historyAnchor))
        return document.runs.count - 1
    }

    @discardableResult static func apply(_ update: RuntimeWorkUpdate, scope: NativeJournalScope,
                                       document: inout NativeJournalDocument) -> String? {
        let lineage = NativeWorkLineage(runID: update.runID, turnID: update.turnID,
            inputMessageID: update.inputMessageID, inputMessageKey: update.inputMessageKey)
        let knownItem = document.runs.contains { run in
            run.scope == scope && !run.lineage.conflicts(with: lineage) &&
            run.steps.contains { $0.sourceItemID == update.itemID && update.itemID != nil }
        }
        let fresh = update.historyMessageID == nil && (update.kind == .runStart || !knownItem && [.toolCall, .toolUpdate].contains(update.kind))
        guard let index = index(&document, scope: scope, lineage: lineage, historyAnchor: update.historyMessageID,
                                freshStart: fresh) else { return nil }
        let runID = document.runs[index].id
        if update.kind == .runStart {
            if !document.runs[index].status.isTerminal { document.runs[index].status = .running }
            document.runs[index].clock.mergeProducer(start: update.startedAtMs, finish: update.finishedAtMs, duration: update.durationMs)
            return runID
        }
        let kind: NativeWorkStep.Kind = switch update.kind {
        case .toolCall, .toolUpdate: .tool
        case .commentary: .commentary
        case .compaction: .compaction
        case .usage: .usage
        case .system: .system
        case .error: .error
        case .activity: .activity
        case .runStart: .activity
        }
        let stepIndex: Int
        if let item = update.itemID, let existing = document.runs[index].steps.firstIndex(where: { $0.kind == kind && $0.sourceItemID == item }) {
            stepIndex = existing
        } else {
            guard let order = document.allocateOrder() else { return nil }
            document.runs[index].steps.append(.init(sourceItemID: update.itemID, order: order, kind: kind))
            stepIndex = document.runs[index].steps.count - 1
        }
        var step = document.runs[index].steps[stepIndex]
        if let title = update.title { step.title = title }
        if let name = update.toolName { step.toolName = name }
        if let text = update.text {
            step.text = boundedText(text, maximum: 256 * 1_024); step.textComplete = text.utf8.count <= 256 * 1_024
        }
        if let status = update.status {
            let mapped: NativeWorkStatus = switch status { case .running: .running; case .success: .succeeded; case .error: .failed; case .unknown: .unknown }
            // Late starts cannot revive an explicitly completed item.
            if !step.status.isTerminal || mapped.isTerminal { step.status = mapped }
        }
        step.clock.mergeProducer(start: update.startedAtMs, finish: update.finishedAtMs, duration: update.durationMs)
        if let input = update.rawInput {
            let bounded = boundedRaw(input); step.input = bounded.value
            step.inputComplete = bounded.complete && update.inputIsComplete == true
        }
        if let output = update.rawOutput {
            let bounded = boundedRaw(output); step.output = bounded.value
            step.outputComplete = bounded.complete && update.outputIsComplete == true
        }
        // Commentary is a cumulative item snapshot, never appended as another tool/text segment.
        document.runs[index].steps[stepIndex] = step
        return runID
    }

    static func finish(scope: NativeJournalScope, runID: String, reason: String,
                       document: inout NativeJournalDocument, completion: RuntimeWorkCompletion? = nil) -> String? {
        let lineage = NativeWorkLineage(runID: runID, turnID: completion?.turnID,
            inputMessageID: completion?.inputMessageID, inputMessageKey: completion?.inputMessageKey)
        guard let index = index(&document, scope: scope, lineage: lineage, allowPartialBucket: false) else { return nil }
        document.runs[index].clock.mergeProducer(start: completion?.startedAtMs, finish: completion?.finishedAtMs, duration: completion?.durationMs)
        document.runs[index].status = switch reason {
        case "end_turn": .succeeded
        case "cancelled": .stopped
        case "error": .failed
        default: .unknown
        }
        // A run final does not prove that every individual tool succeeded or completed.
        return document.runs[index].id
    }

    static func boundedText(_ value: String, maximum: Int) -> String {
        guard value.utf8.count > maximum else { return value }
        // Decode only a valid UTF-8 prefix; the caller separately exposes incompleteness.
        var bytes = Array(value.utf8.prefix(maximum))
        while !bytes.isEmpty, String(bytes: bytes, encoding: .utf8) == nil { bytes.removeLast() }
        return String(bytes: bytes, encoding: .utf8) ?? ""
    }

    static func boundedRaw(_ raw: JSONValue) -> (value: JSONValue, complete: Bool) {
        // Encode one wire-bounded value, then check it inside the journal's extra container depth.
        guard let encoded = try? FrameCodec.encode(raw) else { return (.string(""), false) }
        let preview = boundedText(encoded, maximum: 256 * 1_024)
        guard encoded.utf8.count <= 256 * 1_024,
              (try? FrameCodec.decode("{\"a\":[{\"b\":{\"c\":[{\"d\":{\"e\":" + encoded + "}}]}}]}")) != nil else {
            return (.string(preview), false)
        }
        return (raw, true)
    }
}
