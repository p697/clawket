import ClawketPersistence
import ClawketRuntime
import ClawketUI
import Foundation

/// Local review cache. Runtime references, confirmation tokens and wire dispatch never enter it.
@MainActor
final class NativeTaskJournal {
    private let store: NativeJournalStore
    private let onFailure: @MainActor () -> Void
    private(set) var document = NativeJournalDocument()
    private var writable = false
    private var saveTask: Task<Void, Never>?
    private var saveToken = UUID()
    private var observed: [String: ContinuousClock.Instant] = [:]
    private var liveIDs: Set<String> = []
    private var historyScopes: [NativeHistoryScope: UUID] = [:]

    init(store: NativeJournalStore, onFailure: @escaping @MainActor () -> Void) {
        self.store = store; self.onFailure = onFailure
    }

    func restore() async {
        do {
            if let saved = try await store.read() { document = saved.value; document.recover() }
            writable = true
        } catch { writable = false; onFailure() }
    }

    var reviews: [NativeReviewRecord] { document.reviews }

    func upsertReview(key: String, connectionID: String, sessionID: String?, held: Bool,
                      content: NativeReviewRecord.Content, historyEpoch: UUID? = nil) {
        if let index = document.reviews.firstIndex(where: { $0.correlationKey == key && historySame($0.connectionID, connectionID) && $0.historyEpoch == historyEpoch }) {
            document.reviews[index].held = held; document.reviews[index].content = content
        } else {
            guard let order = document.allocateOrder() else { writable = false; onFailure(); return }
            document.reviews.append(.init(correlationKey: key, connectionID: connectionID,
                sessionID: sessionID, order: order, held: held, content: content, historyEpoch: historyEpoch))
        }
        changed()
    }

    func bindHistoryScope(_ route: ConversationID, epoch: UUID?) {
        let old = scope(route)
        if let epoch { historyScopes[NativeHistoryScope(route)] = epoch }
        else { historyScopes.removeValue(forKey: NativeHistoryScope(route)) }
        guard old != scope(route) else { return }
        for index in document.runs.indices where document.runs[index].scope == old {
            document.runs[index].recover()
            for id in [document.runs[index].id] + document.runs[index].steps.map(\.id) {
                observed.removeValue(forKey: id); liveIDs.remove(id)
            }
        }
        changed(immediate: true)
    }

    func started(_ route: ConversationID, runID: String) {
        guard let index = NativeWorkReducer.index(&document, scope: scope(route), lineage: .init(runID: runID), freshStart: true) else { return }
        if !document.runs[index].status.isTerminal { document.runs[index].status = .running }
        observeRun(index, terminal: false); changed()
    }

    func record(_ update: RuntimeWorkUpdate, route: ConversationID) {
        guard let id = NativeWorkReducer.apply(update, scope: scope(route), document: &document),
              let index = document.runs.firstIndex(where: { $0.id == id }) else { return }
        liveIDs.insert(id)
        observeRun(index, terminal: false)
        if let item = update.itemID, let step = document.runs[index].steps.firstIndex(where: { historySame($0.sourceItemID, item) }) {
            let id = document.runs[index].steps[step].id
            liveIDs.insert(id)
            var clock = document.runs[index].steps[step].clock
            observe(id, clock: &clock, terminal: document.runs[index].steps[step].status.isTerminal)
            document.runs[index].steps[step].clock = clock
        }
        changed()
    }

    func text(_ update: RuntimeTextUpdate, route: ConversationID) {
        let before = document.runs.map { ($0.id, $0.lineage) }
        let lineage = NativeWorkLineage(runID: update.runID, turnID: update.turnID,
            inputMessageID: update.inputMessageID, inputMessageKey: update.inputMessageKey)
        guard let index = NativeWorkReducer.index(&document, scope: scope(route), lineage: lineage) else { return }
        guard !before.contains(where: { $0.0 == document.runs[index].id && $0.1 == document.runs[index].lineage }) else { return }
        observeRun(index, terminal: false); changed()
    }

    func receipt(_ receipt: RuntimeRunReceipt, route: ConversationID, input: String) {
        guard let index = NativeWorkReducer.index(&document, scope: scope(route),
            lineage: .init(runID: receipt.runID, inputMessageKey: receipt.idempotencyKey)) else { return }
        document.runs[index].inputPreview = NativeWorkReducer.boundedText(input, maximum: 8_192)
        // An accepted prompt is not an execution completion.
        observeRun(index, terminal: false); changed()
    }

    func finished(_ route: ConversationID, runID: String, reason: String, completion: RuntimeWorkCompletion? = nil) {
        guard let id = NativeWorkReducer.finish(scope: scope(route), runID: runID, reason: reason, document: &document, completion: completion),
              let index = document.runs.firstIndex(where: { $0.id == id }) else { return }
        observeRun(index, terminal: true); changed(immediate: true)
    }

    /// Only typed adapter history carries execution metadata; this host never parses raw tool JSON.
    func history(_ history: RuntimeHistory, route: ConversationID, earlier: Bool = false,
                 acceptedHistoryIDs: [Int: String]? = nil) {
        var runs: [String] = [], steps: [String: [String]] = [:]
        let priorRunIDs = Set(document.runs.map(\.id))
        for (position, message) in history.messages.enumerated() {
            if let acceptedHistoryIDs, acceptedHistoryIDs[position] == nil { continue }
            for work in message.workUpdates(sessionKey: route.sessionID,
                                            presentationMessageID: acceptedHistoryIDs?[position]) {
                guard let id = NativeWorkReducer.apply(work, scope: scope(route), document: &document),
                      let run = document.runs.first(where: { $0.id == id }) else { continue }
                runs.append(id)
                if let item = work.itemID, let step = run.steps.first(where: { $0.kind == .tool && historySame($0.sourceItemID, item) }) {
                    steps[id, default: []].append(step.id)
                }
            }
        }
        NativeHistoryWorkOrder.merge(document: &document, scope: scope(route), runs: runs,
            steps: steps, earlier: earlier, liveIDs: liveIDs, priorRunIDs: priorRunIDs)
        changed()
    }

    func work(for route: ConversationID) -> WorkDockPresentation? {
        let current = scope(route)
        let runs = document.runs.filter { $0.scope.sameRoute(as: current) }
        guard !runs.isEmpty else { return nil }
        let latest = runs.filter { $0.scope == current }.max(by: { $0.order < $1.order })
        return .init(id: "work-" + routeScopeID(route), title: String(localized: "Work record"),
            status: latest.flatMap { .init(rawValue: $0.status.rawValue) } ?? .unknown,
            clock: latest.map { NativeJournalProjection.clock($0.clock) } ?? .init(), inspect: .available,
            records: runs.map(NativeJournalProjection.run))
    }

    /// Only the actual run-finished reducer sets a run's terminal status.
    /// A tool/source terminal or a guessed history paragraph cannot do so.
    func hasFinishedRun(_ route: ConversationID, epoch: UUID?, runID: String) -> Bool {
        guard let epoch else { return false }
        let current = NativeJournalScope(connectionID: route.connectionID, agentID: route.agentID,
            sessionID: route.sessionID, historyEpoch: epoch)
        let matches = document.runs.filter { $0.scope == current && historySame($0.lineage.runID, runID) }
        guard matches.contains(where: { $0.status.isTerminal }) else { return false }
        var lineage = NativeWorkLineage(runID: runID)
        for record in matches {
            guard !lineage.conflicts(with: record.lineage) else { return false }
            lineage.enrich(with: record.lineage)
        }
        // Late work can add an unattributed display bucket. Its absent fields
        // do not contradict an actual finish; a different actual input does.
        return true
    }

    /// These intents only inspect the already-authorized local cache; no command or RPC is issued.
    func canInspect(_ route: ConversationID, workID: String, recordID: String? = nil, stepID: String? = nil) -> Bool {
        guard let work = work(for: route), work.id == workID, work.inspect.isEnabled else { return false }
        if let recordID, let stepID { return work.step(recordID: recordID, stepID: stepID)?.inspect.isEnabled == true }
        return recordID == nil && stepID == nil
    }

    func flush() { changed(immediate: true) }

    func hold(connectionID: String) {
        for index in document.runs.indices where document.runs[index].scope.connectionID == connectionID {
            document.runs[index].recover()
            observed.removeValue(forKey: document.runs[index].id)
            for step in document.runs[index].steps { observed.removeValue(forKey: step.id) }
        }
        changed(immediate: true)
    }

    private func changed(immediate: Bool = false) {
        guard document.revision < NativeJournalDocument.maximumCounter - 1 else { writable = false; onFailure(); return }
        document.revision += 1
        trim()
        guard writable else { return }
        saveTask?.cancel(); let token = UUID(); saveToken = token
        let snapshot = document
        saveTask = Task {
            defer { if token == saveToken { saveTask = nil } }
            do {
                if !immediate { try await Task.sleep(for: .milliseconds(300)) }
                try Task.checkCancellation(); try await store.write(snapshot)
            } catch is CancellationError { }
            catch {
                // A failed/unknown commit must not be overwritten with an empty or stale cache.
                writable = false; onFailure()
            }
        }
    }

    private func trim() {
        for index in document.runs.indices {
            if document.runs[index].steps.count > 1_024 { document.runs[index].steps.removeFirst(document.runs[index].steps.count - 1_024) }
        }
        while document.reviews.count > 32 { document.reviews.removeFirst() }
        while document.runs.count > 128 || document.runs.reduce(0, { $0 + $1.steps.count }) > 4_096 { document.runs.removeFirst() }
        // Includes aggregate encoded bytes, JSON nesting and token budgets, not just per-item caps.
        while (try? NativeJournalStore.validate(document)) == nil {
            if !document.runs.isEmpty { document.runs.removeFirst() }
            else if !document.reviews.isEmpty { document.reviews.removeFirst() }
            else { break }
        }
        let retained = Set(document.runs.flatMap { [$0.id] + $0.steps.map(\.id) })
        observed = observed.filter { retained.contains($0.key) }
        liveIDs.formIntersection(retained)
    }

    private func observeRun(_ index: Int, terminal: Bool) {
        liveIDs.insert(document.runs[index].id)
        var clock = document.runs[index].clock
        observe(document.runs[index].id, clock: &clock, terminal: terminal || document.runs[index].status.isTerminal)
        document.runs[index].clock = clock
    }
    private func observe(_ id: String, clock: inout NativeWorkClock, terminal: Bool) {
        let now = ContinuousClock.now
        if observed[id] == nil, !terminal, clock.observedStartedAtMs == nil {
            observed[id] = now; clock.observedStartedAtMs = Int64(Date().timeIntervalSince1970 * 1_000)
        }
        if terminal, let start = observed.removeValue(forKey: id) {
            let elapsed = start.duration(to: now).components
            clock.observedFinishedAtMs = Int64(Date().timeIntervalSince1970 * 1_000)
            clock.observedDurationMs = elapsed.seconds * 1_000 + elapsed.attoseconds / 1_000_000_000_000_000
        }
    }
    private func scope(_ route: ConversationID) -> NativeJournalScope {
        .init(connectionID: route.connectionID, agentID: route.agentID, sessionID: route.sessionID,
              historyEpoch: historyScopes[NativeHistoryScope(route)])
    }
    private func routeScopeID(_ route: ConversationID) -> String {
        (try? DocumentStore.scopedKey(namespace: "work", parts: [route.connectionID, route.agentID, route.sessionID])) ?? ""
    }
}
