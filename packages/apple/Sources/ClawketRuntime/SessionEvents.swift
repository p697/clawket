import Foundation
import ClawketTransport

/// State is bounded and owned by one authenticated backend revision, not a screen.
struct SessionEvents: Sendable {
    struct Run: Sendable {
        let sessionKey: String
        var segment = 0
        var hasText = false
        var toolIDs: Set<Data> = []
        var terminal = false
    }
    var runs: [Data: Run] = [:]
    var order: [Data] = []
    var openClawArtifacts = false
    var artifactsEnabled = false

    mutating func register(runID: String, sessionKey: String) throws {
        guard !runID.isEmpty, runID.utf8.count <= 256, !sessionKey.isEmpty, sessionKey.utf8.count <= 1_024 else {
            throw RuntimeFailure(.invalidResponse)
        }
        if let run = runs[Data(runID.utf8)] {
            guard run.sessionKey.utf8.elementsEqual(sessionKey.utf8) else { throw RuntimeFailure(.invalidResponse) }
            return
        }
        if runs.count >= 256 {
            guard let retired = order.first(where: { runs[$0]?.terminal == true }) else { throw RuntimeFailure(.capacity) }
            runs.removeValue(forKey: retired); order.removeAll { $0 == retired }
        }
        runs[Data(runID.utf8)] = Run(sessionKey: sessionKey); order.append(Data(runID.utf8))
    }

    mutating func map(_ frame: JSONValue, connection: BackendConnection, artifactsEnabled: Bool = false) throws -> [RuntimeSessionUpdate] {
        self.artifactsEnabled = artifactsEnabled
        openClawArtifacts = connection.backendKind == .openclaw && artifactsEnabled
        guard frame["type"]?.stringValue == "event", let event = frame["event"]?.stringValue else { return [] }
        let payload = frame["payload"] ?? .null
        if event == BackendProfile.profile(for: connection.backendKind).updateEvent {
            return try canonical(payload, connection: connection)
        }
        if event == "chat" { return try chat(payload) }
        if event == "agent" { return try agent(payload) }
        if event == "sessions.changed" { return [.other(frame)] }
        return [.other(frame)]
    }

    private mutating func canonical(_ payload: JSONValue, connection: BackendConnection) throws -> [RuntimeSessionUpdate] {
        guard let type = payload["type"]?.stringValue else { throw RuntimeFailure(.invalidResponse) }
        if type == "session_info_update", let session = payload["session"], session["agentId"] != nil,
           session["title"]?.stringValue != nil, session["allowedActions"]?.object != nil {
            return [.sessionMetadata(try WireModels.session(session, connection: connection, legacyActivity: true))]
        }
        if let work = try WorkEvents.canonical(payload) {
            if let runID = work.runID, let sessionKey = work.sessionKey {
                try register(runID: runID, sessionKey: sessionKey)
                if work.kind == .toolCall { try boundary(runID: runID, toolID: work.itemID) }
            }
            if work.kind == .runStart, let session = work.sessionKey, let run = work.runID {
                return [.runStarted(sessionKey: session, runID: run), .work(work)]
            }
            return [.work(work)]
        }
        guard let runID = payload["runId"]?.nonemptyString,
              let sessionKey = payload["sessionKey"]?.nonemptyString else { return [.other(payload)] }
        try register(runID: runID, sessionKey: sessionKey)
        switch type {
        case "run_started": return [.runStarted(sessionKey: sessionKey, runID: runID)]
        case "agent_message_chunk":
            guard let text = payload["text"]?.stringValue else { throw RuntimeFailure(.invalidResponse) }
            return textEvent(text, runID: runID, mode: payload["textMode"]?.stringValue == "delta" ? .delta : .snapshot, raw: payload)
        case "agent_thought_chunk":
            return [.thought(sessionKey: sessionKey, runID: runID, text: payload["text"]?.stringValue ?? "")]
        case "run_finished": return complete(runID: runID, reason: payload["stopReason"]?.stringValue ?? "end_turn", raw: payload)
        default: return [.other(payload)]
        }
    }

    private mutating func chat(_ payload: JSONValue) throws -> [RuntimeSessionUpdate] {
        guard let runID = payload["runId"]?.nonemptyString,
              let key = payload["sessionKey"]?.nonemptyString else { throw RuntimeFailure(.invalidResponse) }
        try register(runID: runID, sessionKey: key)
        switch payload["state"]?.stringValue {
        case "delta": return textEvent(protocolText(payload["message"]?["content"]), runID: runID, mode: .snapshot, raw: payload)
        case "final": return complete(runID: runID, reason: "end_turn", raw: payload)
        case "aborted": return finish(runID: runID, reason: "cancelled", raw: payload)
        case "error": return finish(runID: runID, reason: "error", raw: payload)
        default: return [.other(payload)]
        }
    }

    private mutating func agent(_ payload: JSONValue) throws -> [RuntimeSessionUpdate] {
        guard let runID = payload["runId"]?.nonemptyString else { return [.other(payload)] }
        guard let key = payload["sessionKey"]?.nonemptyString ?? runs[Data(runID.utf8)]?.sessionKey else { return [.other(payload)] }
        try register(runID: runID, sessionKey: key)
        let stream = payload["stream"]?.stringValue
        let data = payload["data"] ?? .null
        if stream == "lifecycle", data["phase"]?.stringValue == "start" { return [.runStarted(sessionKey: key, runID: runID)] }
        if stream == "tool" {
            if data["phase"]?.stringValue == "start" { try boundary(runID: runID, toolID: data["toolCallId"]?.nonemptyString) }
            var result: [RuntimeSessionUpdate] = [.tool(sessionKey: key, runID: runID, payload: payload)]
            if let work = try WorkEvents.gateway(payload, session: key, run: runID) { result.append(.work(work)) }
            return result
        }
        // Main conversations settle only from chat finals, never lifecycle silence/end.
        if key.contains(":subagent:"), stream == "assistant" {
            return textEvent(data["text"]?.stringValue ?? "", runID: runID, mode: .snapshot, raw: payload)
        }
        if key.contains(":subagent:"), stream == "lifecycle", ["end", "error"].contains(data["phase"]?.stringValue ?? "") {
            return finish(runID: runID, reason: data["phase"]?.stringValue == "error" ? "error" : data["aborted"]?.boolValue == true ? "cancelled" : "end_turn", raw: payload)
        }
        return [.other(payload)]
    }

    private mutating func textEvent(_ text: String, runID: String, mode: RuntimeTextUpdate.Mode, raw: JSONValue) -> [RuntimeSessionUpdate] {
        let text = openClawArtifacts ? RuntimeAttachmentProjection.stripMediaDirectives(text) : text
        guard var run = runs[Data(runID.utf8)], !run.terminal, !text.isEmpty, !silentPrefix(text) else { return [] }
        run.hasText = true; runs[Data(runID.utf8)] = run
        return [.text(RuntimeTextUpdate(sessionKey: run.sessionKey, runID: runID, segmentID: "\(runID):reply:\(run.segment)",
                                       text: text, mode: mode, turnID: raw["turnId"]?.stringValue,
                                       inputMessageID: raw["inputMessageId"]?.stringValue, inputMessageKey: raw["inputMessageKey"]?.stringValue))]
    }

    private mutating func boundary(runID: String, toolID: String?) throws {
        guard var run = runs[Data(runID.utf8)], !run.terminal else { return }
        // Unidentified tool updates are preserved, but cannot safely invent repeated boundaries.
        guard let toolID, !run.toolIDs.contains(Data(toolID.utf8)) else { return }
        guard toolID.utf8.count <= 512 else { throw RuntimeFailure(.capacity) }
        guard run.toolIDs.count < 128 else { throw RuntimeFailure(.capacity) }
        run.toolIDs.insert(Data(toolID.utf8))
        if run.hasText { run.segment += 1; run.hasText = false }
        runs[Data(runID.utf8)] = run
    }

    private mutating func finish(runID: String, reason: String, raw: JSONValue) -> [RuntimeSessionUpdate] {
        guard var run = runs[Data(runID.utf8)], !run.terminal else { return [] }
        run.terminal = true; runs[Data(runID.utf8)] = run
        return [.runFinished(sessionKey: run.sessionKey, runID: runID, reason: reason,
                             segmentID: "\(runID):reply:\(run.segment)", raw: raw)]
    }

    private mutating func complete(runID: String, reason: String, raw: JSONValue) -> [RuntimeSessionUpdate] {
        if FinalMessageWire.hasConflictingLineage(raw, message: raw["message"] ?? .null) {
            return finish(runID: runID, reason: reason, raw: raw)
        }
        if let terminal = FinalMessageWire.terminal(raw, reason: reason),
           protocolText(raw["message"]?["content"]).utf8.elementsEqual(terminal.text.utf8) {
            // The Bridge sends this assistant copy for old clients. Its real
            // terminalMessage is a system row; never overwrite a partial reply.
            return finish(runID: runID, reason: reason, raw: raw)
        }
        let text = RuntimeAttachmentProjection.displayText(raw["message"] ?? .null, fallback: protocolText(raw["message"]?["content"]), enabled: artifactsEnabled)
        return textEvent(text, runID: runID, mode: .snapshot, raw: raw) + finish(runID: runID, reason: reason, raw: raw)
    }

    private func silentPrefix(_ value: String) -> Bool {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return text == text.uppercased() && text.count >= 2 && "NO_REPLY".hasPrefix(text) && (text.contains("_") || text == "NO")
    }
}
