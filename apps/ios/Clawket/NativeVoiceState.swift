import ClawketSpeech
import ClawketUI
import Foundation

struct NativeVoiceContext: Sendable, Equatable {
    let route: ConversationID
    let activation: UUID
    let selection: UUID
    let draftRevision: UUID
    let text: String
    let attachments: [UUID]
    var scope: SpeechScope { get throws { try .init(connectionID: route.connectionID, agentID: route.agentID, sessionKey: route.sessionID) } }
}

struct NativeVoiceResult: Sendable, Identifiable {
    let id: UUID
    let context: NativeVoiceContext
    let recording: SpeechRecording
    let text: String
    let isRecovery: Bool
    let explicitlySend: Bool
}

struct NativeVoiceSheetRequest: Identifiable {
    let id = UUID()
    let context: NativeVoiceContext
    let attemptID: UUID?
    init(context: NativeVoiceContext, attemptID: UUID? = nil) { self.context = context; self.attemptID = attemptID }
}

struct NativeVoiceInsertion {
    let id: UUID
    let result: NativeVoiceResult
    let context: NativeVoiceContext
    let sendAfterCommit: Bool
}

/// Pure ownership checks, shared by host paths and regressions. Equal text after
/// A→B→A editing does not restore an earlier revision or send intent.
enum NativeVoicePolicy {
    static func matches(_ captured: NativeVoiceContext, current: NativeVoiceContext?) -> Bool {
        captured == current
    }
    static func canFinishAndSend(_ result: NativeVoiceResult, current: NativeVoiceContext?, uncertain: Bool) -> Bool {
        result.explicitlySend && !result.isRecovery && !uncertain && matches(result.context, current: current)
    }
    static func combined(_ prefix: String, transcript: String) -> String {
        let trimmedEnd = String(prefix.reversed().drop(while: { $0.isWhitespace }).reversed())
        return [trimmedEnd, transcript].filter { !$0.isEmpty }.joined(separator: " ")
    }
}
