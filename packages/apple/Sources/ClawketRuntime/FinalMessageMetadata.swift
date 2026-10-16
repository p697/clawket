import Foundation
import ClawketTransport

/// Only metadata actually present in the final message or its event envelope.
/// A run, turn, segment or clock is never promoted to a message source ID.
public struct RuntimeFinalMessageMetadata: Sendable, Equatable {
    public let role: RuntimeMessage.Role
    public let providedID: String?
    public let timestampMs: Int64?
    public let attribution: RuntimeMessageAttribution?
    public let transcriptPosition: RuntimeTranscriptPosition?
    public let transcriptBoundary: RuntimeTranscriptBoundary?
    public let turnID: String?
    public let inputMessageID: String?
    public let inputMessageKey: String?
    /// Present envelope/message lineage disagrees; absence alone is not a conflict.
    public let hasConflictingLineage: Bool

    public init(role: RuntimeMessage.Role, providedID: String? = nil, timestampMs: Int64? = nil,
                attribution: RuntimeMessageAttribution? = nil, transcriptPosition: RuntimeTranscriptPosition? = nil,
                transcriptBoundary: RuntimeTranscriptBoundary? = nil, turnID: String? = nil,
                inputMessageID: String? = nil, inputMessageKey: String? = nil, hasConflictingLineage: Bool = false) {
        self.role = role; self.providedID = providedID; self.timestampMs = timestampMs; self.attribution = attribution
        self.transcriptPosition = transcriptPosition; self.transcriptBoundary = transcriptBoundary
        self.turnID = turnID; self.inputMessageID = inputMessageID; self.inputMessageKey = inputMessageKey
        self.hasConflictingLineage = hasConflictingLineage
    }

    public static func == (left: Self, right: Self) -> Bool {
        left.role == right.role && finalIdentityEqual(left.providedID, right.providedID)
            && left.timestampMs == right.timestampMs && left.attribution == right.attribution
            && left.transcriptPosition == right.transcriptPosition && left.transcriptBoundary == right.transcriptBoundary
            && finalIdentityEqual(left.turnID, right.turnID) && finalIdentityEqual(left.inputMessageID, right.inputMessageID)
            && finalIdentityEqual(left.inputMessageKey, right.inputMessageKey) && left.hasConflictingLineage == right.hasConflictingLineage
    }
}

public struct RuntimeTerminalNotice: Sendable, Equatable {
    /// Nil for the existing Codex legacy failure fallback: its render UUID is not source evidence.
    public let providedID: String?
    public let text: String
    public let timestampMs: Int64?

    public init(providedID: String? = nil, text: String, timestampMs: Int64? = nil) {
        self.providedID = providedID; self.text = text; self.timestampMs = timestampMs
    }

    public static func == (left: Self, right: Self) -> Bool {
        finalIdentityEqual(left.providedID, right.providedID) && finalIdentityEqual(left.text, right.text)
            && left.timestampMs == right.timestampMs
    }
}

extension RuntimeMessage {
    public var inputMessageID: String? { FinalMessageWire.lineage("inputMessageId", raw: .null, message: raw) }
    public var inputMessageKey: String? { FinalMessageWire.lineage("inputMessageKey", raw: .null, message: raw) }
}

extension RuntimeSessionUpdate {
    public func finalMessageMetadata(backend: BackendKind) -> RuntimeFinalMessageMetadata? {
        guard case let .runFinished(key, _, _, _, raw) = self,
              let message = raw["message"], message.object != nil,
              let role = message["role"]?.stringValue.flatMap(RuntimeMessage.Role.init(rawValue:)) else { return nil }
        var clock = timestamp(message["timestampMs"] ?? message["timestamp"] ?? message["ts"] ?? message["createdAt"])
        if backend == .openclaw || backend == .hermes, let value = clock, value > 0, value < 10_000_000_000 { clock = value * 1_000 }
        return .init(role: role, providedID: HistoryMessageIdentity.provided(message), timestampMs: clock,
            attribution: MessageAttributionWire.read(message, key: key, backend: backend, role: role),
            transcriptPosition: HistoryMessageIdentity.position(message, backend: backend),
            transcriptBoundary: HistoryMessageIdentity.boundary(message, backend: backend, role: role),
            turnID: FinalMessageWire.lineage("turnId", raw: raw, message: message),
            inputMessageID: FinalMessageWire.lineage("inputMessageId", raw: raw, message: message),
            inputMessageKey: FinalMessageWire.lineage("inputMessageKey", raw: raw, message: message),
            hasConflictingLineage: FinalMessageWire.hasConflictingLineage(raw, message: message))
    }

    public func terminalNotice(backend: BackendKind) -> RuntimeTerminalNotice? {
        guard case let .runFinished(_, _, reason, _, raw) = self else { return nil }
        if let notice = FinalMessageWire.terminal(raw, reason: reason) { return notice }
        // Mobile's older Codex compatibility path uses explicit failure only.
        // This fallback has no producer ID and cannot join a recovered history row.
        guard backend == .codex, reason == "error", raw["terminalMessage"] == nil || raw["terminalMessage"] == .null,
              protocolText(raw["message"]?["content"]).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              raw["message"]?["attachments"]?.array?.isEmpty != false else { return nil }
        return .init(providedID: nil, text: "The agent couldn't complete this reply. Please try again.", timestampMs: nil)
    }
}

enum FinalMessageWire {
    static func terminal(_ raw: JSONValue, reason: String) -> RuntimeTerminalNotice? {
        guard reason == "error", let message = raw["terminalMessage"], message["role"]?.stringValue == "system",
              let id = MessageAttributionWire.identifier(message["id"], maximum: 256), id.utf8.count <= 1_024,
              let text = message["text"]?.stringValue, text.utf16.count <= 65_536,
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return .init(providedID: id, text: text, timestampMs: timestamp(message["timestampMs"]))
    }

    static func hasConflictingLineage(_ raw: JSONValue, message: JSONValue) -> Bool {
        ["turnId", "inputMessageId", "inputMessageKey"].contains { key in
            guard let outer = identifier(raw[key]), let inner = identifier(message[key]) else { return false }
            return !finalIdentityEqual(outer, inner)
        }
    }

    private static func identifier(_ value: JSONValue?) -> String? {
        MessageAttributionWire.identifier(value, maximum: 4_096).flatMap { $0.utf8.count <= 4_096 ? $0 : nil }
    }

    static func lineage(_ key: String, raw: JSONValue, message: JSONValue) -> String? {
        let outer = identifier(raw[key]), inner = identifier(message[key])
        if let outer, let inner, !finalIdentityEqual(outer, inner) { return nil }
        return outer ?? inner
    }
}

private func finalIdentityEqual(_ left: String?, _ right: String?) -> Bool {
    switch (left, right) {
    case (nil, nil): true
    case let (left?, right?): left.utf8.elementsEqual(right.utf8)
    default: false
    }
}
