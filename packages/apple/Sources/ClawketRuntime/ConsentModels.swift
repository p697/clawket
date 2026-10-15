import Foundation
import ClawketTransport

/// Valid only in the coordinator/authentication revision that issued it. Never persist a reference.
public struct RuntimeRequestReference: Hashable, Sendable {
    public let id: UUID
    public let connectionID: String
    public let sessionKey: String?
    init(connectionID: String, sessionKey: String?) {
        id = UUID(); self.connectionID = connectionID; self.sessionKey = sessionKey
    }
}

public enum RuntimeRequestState: String, Sendable, Equatable {
    case pending, submitting, uncertain
}

public enum RuntimeApprovalDecision: String, Sendable, Equatable, CaseIterable {
    case allowOnce = "allow-once", allowAlways = "allow-always", deny, approve, reject
}

public struct RuntimeApproval: Sendable, Equatable, Identifiable {
    public enum Kind: String, Sendable { case execution, plugin, pairing }
    public enum PairingTarget: String, Sendable { case device, node }
    public var id: UUID { reference.id }
    public let reference: RuntimeRequestReference
    /// Stable local review correlation only. Never authorize, serialize an action or diagnose with this key.
    public let reviewKey: String
    public let kind: Kind
    public let pairingTarget: PairingTarget?
    public let command: String?
    public let category: String?
    public let reason: String?
    public let title: String?
    public let pluginID: String?
    public let cwd: String?
    public let host: String?
    public let displayName: String?
    public let platform: String?
    public let receivedAtMs: Int64?
    public let expiresAtMs: Int64?
    /// Only options advertised by the request and implemented by this adapter.
    public let decisions: [RuntimeApprovalDecision]
    public internal(set) var state: RuntimeRequestState
    /// Application data, including review content; never use it for diagnostics.
    public let raw: JSONValue
}

public struct RuntimeQuestionOption: Sendable, Equatable {
    public let label: String
    public let description: String?
}

public struct RuntimeQuestionField: Sendable, Equatable {
    public let id: String
    public let title: String
    public let header: String?
    public let options: [RuntimeQuestionOption]
    public let allowsCustom: Bool
    public let allowsMultiple: Bool
}

public struct RuntimeQuestion: Sendable, Equatable, Identifiable {
    public enum Kind: String, Sendable { case select, confirm, input, editor, form }
    public var id: UUID { reference.id }
    public let reference: RuntimeRequestReference
    /// Stable, scoped local draft key. It grants no authority and is never a diagnostic identity.
    public let draftKey: String
    public let kind: Kind
    public let title: String
    public let message: String?
    public let options: [String]
    public let fields: [RuntimeQuestionField]
    public let placeholder: String?
    public let prefill: String?
    public let expiresAtMs: Int64?
    public let canAnswer: Bool
    public internal(set) var state: RuntimeRequestState
    public let raw: JSONValue
}

/// Cancellation is an explicit user action. Closing a sheet must not send it.
public enum RuntimeQuestionAnswer: Sendable, Equatable {
    case value(String), confirmed(Bool), form([String: [String]]), cancel
}

/// Obtain before presenting an Always confirmation, then pass it after the user confirms.
public struct RuntimeApprovalConfirmation: Sendable, Equatable {
    let id: UUID
    let reference: RuntimeRequestReference
}

public struct RuntimePendingRequests: Sendable, Equatable {
    public let connectionID: String
    public let approvals: [RuntimeApproval]
    public let questions: [RuntimeQuestion]
}

public enum RuntimeRequestResolution: Sendable, Equatable {
    case decision(RuntimeApprovalDecision), answered, expired, resolved
}

/// Canonical work metadata keeps lineage, review inputs and producer clocks intact.
public struct RuntimeWorkUpdate: Sendable, Equatable {
    public enum Kind: String, Sendable { case toolCall, toolUpdate, commentary, compaction, usage, system, error, activity }
    public enum Status: String, Sendable { case running, success, error, unknown }
    public let kind: Kind
    public let sessionKey: String?
    public let runID: String?
    public let itemID: String?
    public let turnID: String?
    public let inputMessageID: String?
    public let inputMessageKey: String?
    public let title: String?
    public let text: String?
    public let status: Status?
    public let startedAtMs: Int64?
    public let finishedAtMs: Int64?
    public let durationMs: Int64?
    public let rawInput: JSONValue?
    public let rawOutput: JSONValue?
    public let raw: JSONValue
}
