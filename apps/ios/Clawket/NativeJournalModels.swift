import ClawketTransport
import ClawketUI
import Foundation

/// Local application data only. These values cannot reconstruct a runtime request or confirmation.
struct NativeJournalScope: Codable, Hashable, Sendable {
    let connectionID: String
    let agentID: String
    let sessionID: String
    var historyEpoch: UUID? = nil

    static func == (left: Self, right: Self) -> Bool {
        historySame(left.connectionID, right.connectionID) && historySame(left.agentID, right.agentID) &&
            historySame(left.sessionID, right.sessionID) && left.historyEpoch == right.historyEpoch
    }
    func hash(into hasher: inout Hasher) {
        hasher.combine(Data(connectionID.utf8)); hasher.combine(Data(agentID.utf8))
        hasher.combine(Data(sessionID.utf8)); hasher.combine(historyEpoch)
    }
    func sameRoute(as other: Self) -> Bool {
        historySame(connectionID, other.connectionID) && historySame(agentID, other.agentID) && historySame(sessionID, other.sessionID)
    }
}

enum NativeWorkStatus: String, Codable, Sendable {
    case unknown, running, waiting, succeeded, failed, stopped
    var isTerminal: Bool { [.succeeded, .failed, .stopped].contains(self) }
}

/// Equality is exact producer lineage. Never join different inputs by command, prose or proximity.
struct NativeWorkLineage: Codable, Equatable, Sendable {
    var runID: String?
    var turnID: String?
    var inputMessageID: String?
    var inputMessageKey: String?

    func conflicts(with other: Self) -> Bool {
        [(runID, other.runID), (turnID, other.turnID), (inputMessageID, other.inputMessageID),
         (inputMessageKey, other.inputMessageKey)].contains { left, right in
            left != nil && right != nil && !historySame(left, right)
        }
    }

    static func == (left: Self, right: Self) -> Bool {
        historySame(left.runID, right.runID) && historySame(left.turnID, right.turnID) &&
            historySame(left.inputMessageID, right.inputMessageID) && historySame(left.inputMessageKey, right.inputMessageKey)
    }

    mutating func enrich(with other: Self) {
        guard !conflicts(with: other) else { return }
        runID = runID ?? other.runID; turnID = turnID ?? other.turnID
        inputMessageID = inputMessageID ?? other.inputMessageID
        inputMessageKey = inputMessageKey ?? other.inputMessageKey
    }
}

struct NativeWorkClock: Codable, Equatable, Sendable {
    var startedAtMs: Int64?
    var finishedAtMs: Int64?
    var durationMs: Int64?
    /// Measured on this phone, kept separate from the backend's clocks.
    var observedStartedAtMs: Int64?
    var observedFinishedAtMs: Int64?
    var observedDurationMs: Int64?

    mutating func mergeProducer(start: Int64?, finish: Int64?, duration: Int64?) {
        if let start { startedAtMs = start }
        if let finish { finishedAtMs = finish }
        if let duration { durationMs = duration }
    }
}

struct NativeWorkStep: Codable, Identifiable, Sendable {
    enum Kind: String, Codable, Sendable { case tool, commentary, compaction, usage, system, error, activity }
    /// Independent persistent render identity; source IDs are binding metadata only.
    var id: String = UUID().uuidString
    var sourceItemID: String?
    var order: Int64
    var kind: Kind
    var title: String?
    var toolName: String?
    var text: String?
    var textComplete = true
    var status: NativeWorkStatus = .unknown
    var clock = NativeWorkClock()
    var input: JSONValue?
    var output: JSONValue?
    /// Retain explicit producer incompleteness and host bounds rather than inventing full output.
    var inputComplete: Bool?
    var outputComplete: Bool?
}

struct NativeWorkRun: Codable, Identifiable, Sendable {
    var id: String = UUID().uuidString
    var scope: NativeJournalScope
    var order: Int64
    var lineage: NativeWorkLineage
    /// Exact history record identity when no execution lineage was supplied.
    var historyAnchor: String?
    var inputPreview: String?
    var status: NativeWorkStatus = .unknown
    var clock = NativeWorkClock()
    var steps: [NativeWorkStep] = []
    /// An interrupted process preserves context but cannot prove an execution is still running.
    mutating func recover() {
        if !status.isTerminal { status = .unknown }
        for index in steps.indices where !steps[index].status.isTerminal { steps[index].status = .unknown }
    }
}

struct NativeApprovalReview: Codable, Sendable {
    enum Kind: String, Codable, Sendable { case execution, pairing, plugin }
    enum Outcome: String, Codable, Sendable { case allowed, denied, approved, rejected, expired }
    var kind: Kind
    var title: String?
    var reason: String?
    var command: String?
    var cwd: String?
    var host: String?
    var displayName: String?
    var platform: String?
    var pluginID: String?
    var isNode = false
    var expiresAtMs: Int64?
    var outcome: Outcome?
}

struct NativeQuestionReview: Codable, Sendable {
    enum Kind: String, Codable, Sendable { case select, confirm, input, editor, form }
    struct Option: Codable, Sendable { var value: String; var detail: String? }
    struct Field: Codable, Sendable {
        var id: String
        var title: String
        var header: String?
        var options: [Option]
        var allowsMultiple: Bool
        var allowsCustom: Bool
    }
    var kind: Kind
    var title: String
    var message: String?
    var options: [String]
    var fields: [Field]
    var placeholder: String?
    var response: QuestionResponse
    /// Only a locally submitted answer/confirm plus authoritative acknowledgement sets this.
    var responseIsAccepted = false
    var expired = false
}

struct NativeReviewRecord: Codable, Identifiable, Sendable {
    enum Content: Codable, Sendable { case approval(NativeApprovalReview), question(NativeQuestionReview) }
    /// A new journal ID, deliberately independent of the ephemeral runtime reference UUID.
    var id: String = UUID().uuidString
    /// Scoped correlation of display/editing copies only, never a wire request ID or permission.
    var correlationKey: String
    var connectionID: String
    var sessionID: String?
    var order: Int64
    var held: Bool
    var content: Content
    var historyEpoch: UUID? = nil
}

struct NativeJournalDocument: Codable, Sendable {
    static let maximumCounter: Int64 = 9_007_199_254_740_991
    var version = 1
    var revision: Int64 = 0
    var nextOrder: Int64 = 0
    var runs: [NativeWorkRun] = []
    var reviews: [NativeReviewRecord] = []

    mutating func allocateOrder() -> Int64? {
        guard nextOrder >= 0, nextOrder < Self.maximumCounter - 1 else { return nil }
        let value = nextOrder; nextOrder += 1; return value
    }

    mutating func recover() {
        for index in runs.indices { runs[index].recover() }
        // Reviews are always read-only after decode; live authority is kept in NativeTaskRequests.
    }
}
