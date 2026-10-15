import Foundation

/// Explicit producer state. Missing clocks, output or subsequent steps never imply success.
public enum WorkStatus: String, Hashable, Sendable {
    case unknown, running, waiting, succeeded, failed, stopped
}

/// Binding metadata, not user-facing labels or diagnostic identities. The host groups only
/// proven equal lineages; a reused run with another input/turn needs a distinct record ID.
public struct WorkLineage: Hashable, Sendable {
    public var runID: String?
    public var turnID: String?
    public var inputMessageID: String?
    public var inputMessageKey: String?

    public init(runID: String? = nil, turnID: String? = nil,
                inputMessageID: String? = nil, inputMessageKey: String? = nil) {
        self.runID = runID; self.turnID = turnID
        self.inputMessageID = inputMessageID; self.inputMessageKey = inputMessageKey
    }
}

/// Exact producer clocks. A clock does not establish status, and a duration is never
/// synthesized from the current time for a recovered or unknown record.
public struct WorkClockPresentation: Hashable, Sendable {
    public var startedAt: Date?
    public var finishedAt: Date?
    public var durationMilliseconds: Int64?

    public init(startedAt: Date? = nil, finishedAt: Date? = nil, durationMilliseconds: Int64? = nil) {
        self.startedAt = startedAt; self.finishedAt = finishedAt
        self.durationMilliseconds = durationMilliseconds
    }

    var validStartedAt: Date? { startedAt.flatMap { $0.timeIntervalSinceReferenceDate.isFinite ? $0 : nil } }
    var validFinishedAt: Date? { finishedAt.flatMap { $0.timeIntervalSinceReferenceDate.isFinite ? $0 : nil } }
}

public struct WorkContentSection: Identifiable, Hashable, Sendable {
    public enum Kind: String, Hashable, Sendable { case input, output, command, error, detail }
    public var id: String
    public var kind: Kind
    /// Optional backend-authored title remains verbatim; nil uses the native kind label.
    public var title: String?
    /// Bounded, already authorized text. UI neither parses commands nor expands raw JSON.
    public var text: String
    public var availability: ActionAvailability
    public var canSelectText: Bool
    /// A host-side resource bound must never masquerade as complete content.
    public var isComplete: Bool

    public init(id: String, kind: Kind, title: String? = nil, text: String,
                availability: ActionAvailability = .unsupported,
                canSelectText: Bool = false, isComplete: Bool = true) {
        self.id = id; self.kind = kind; self.title = title; self.text = text
        self.availability = availability; self.canSelectText = canSelectText; self.isComplete = isComplete
    }
}

public struct WorkStepPresentation: Identifiable, Hashable, Sendable {
    public enum Kind: String, Hashable, Sendable {
        case tool, commentary, compaction, usage, system, error, activity
    }
    /// Stable render identity across live/history reconciliation, independent of its title.
    public var id: String
    /// Host-owned canonical order; never derive chronology from a missing producer clock.
    public var order: Int64
    public var kind: Kind
    public var title: String
    public var detail: String?
    public var status: WorkStatus
    public var clock: WorkClockPresentation
    public var inspect: ActionAvailability
    public var isLoading: Bool
    public var content: [WorkContentSection]

    public init(id: String, order: Int64, kind: Kind = .tool, title: String, detail: String? = nil,
                status: WorkStatus = .unknown, clock: WorkClockPresentation = .init(),
                inspect: ActionAvailability = .unsupported, isLoading: Bool = false,
                content: [WorkContentSection] = []) {
        self.id = id; self.order = order; self.kind = kind; self.title = title; self.detail = detail
        self.status = status; self.clock = clock; self.inspect = inspect
        self.isLoading = isLoading; self.content = content
    }

    public var visibleContent: [WorkContentSection] { unambiguous(content).filter { $0.availability.isVisible } }
}

/// One proven run/turn/input grouping. All steps in this record belong to this exact lineage.
/// Missing attribution stays missing; the UI never joins nearby messages by time or prose.
public struct WorkRunPresentation: Identifiable, Hashable, Sendable {
    public var id: String
    public var order: Int64
    public var lineage: WorkLineage
    public var title: String?
    public var inputPreview: String?
    public var status: WorkStatus
    public var clock: WorkClockPresentation
    public var steps: [WorkStepPresentation]

    public init(id: String, order: Int64, lineage: WorkLineage = .init(), title: String? = nil,
                inputPreview: String? = nil, status: WorkStatus = .unknown,
                clock: WorkClockPresentation = .init(), steps: [WorkStepPresentation] = []) {
        self.id = id; self.order = order; self.lineage = lineage; self.title = title
        self.inputPreview = inputPreview; self.status = status; self.clock = clock; self.steps = steps
    }

    public var newestFirstSteps: [WorkStepPresentation] { newestFirst(unambiguous(steps), order: { $0.order }) }
}

public struct WorkDockPresentation: Identifiable, Hashable, Sendable {
    public var id: String
    public var title: String
    public var detail: String?
    public var status: WorkStatus
    public var clock: WorkClockPresentation
    public var inspect: ActionAvailability
    public var records: [WorkRunPresentation]

    public init(id: String, title: String, detail: String? = nil, status: WorkStatus = .unknown,
                clock: WorkClockPresentation = .init(), inspect: ActionAvailability = .unsupported,
                records: [WorkRunPresentation] = []) {
        self.id = id; self.title = title; self.detail = detail; self.status = status
        self.clock = clock; self.inspect = inspect; self.records = records
    }

    public var newestFirstRecords: [WorkRunPresentation] { newestFirst(unambiguous(records), order: { $0.order }) }

    public func step(recordID: String, stepID: String) -> WorkStepPresentation? {
        // Ambiguous IDs cannot silently choose a different execution record.
        guard !recordID.isEmpty, !stepID.isEmpty else { return nil }
        let matchingRecords = records.filter { $0.id == recordID }
        guard matchingRecords.count == 1 else { return nil }
        let matchingSteps = matchingRecords[0].steps.filter { $0.id == stepID }
        return matchingSteps.count == 1 ? matchingSteps[0] : nil
    }

    func openIntent(conversationID: ConversationID) -> ClientIntent? {
        guard !id.isEmpty, inspect.isEnabled, conversationID.isConcrete else { return nil }
        return .workInspectorOpened(conversationID, workID: id)
    }

    func stepOpenIntent(conversationID: ConversationID, recordID: String, stepID: String) -> ClientIntent? {
        guard !id.isEmpty, inspect.isEnabled, conversationID.isConcrete,
              let step = step(recordID: recordID, stepID: stepID), step.inspect.isEnabled else { return nil }
        return .workStepOpened(conversationID, workID: id, recordID: recordID, stepID: stepID)
    }
}

private func unambiguous<Value: Identifiable>(_ values: [Value]) -> [Value] where Value.ID == String {
    let counts = Dictionary(grouping: values, by: \.id).mapValues(\.count)
    return values.filter { !$0.id.isEmpty && counts[$0.id] == 1 }
}

private func newestFirst<Value>(_ values: [Value], order: (Value) -> Int64) -> [Value] {
    values.enumerated().sorted {
        let left = order($0.element), right = order($1.element)
        return left == right ? $0.offset < $1.offset : left > right
    }.map(\.element)
}
