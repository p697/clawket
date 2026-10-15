import Foundation
import ClawketTransport

enum WorkEvents {
    static func completion(_ raw: JSONValue) throws -> RuntimeWorkCompletion {
        .init(turnID: try ConsentWire.string(raw["turnId"], max: 512),
              inputMessageID: try ConsentWire.string(raw["inputMessageId"], max: 512),
              inputMessageKey: try ConsentWire.string(raw["inputMessageKey"], max: 512),
              startedAtMs: try ConsentWire.expiry(raw["startedAtMs"]),
              finishedAtMs: try ConsentWire.expiry(raw["finishedAtMs"]), durationMs: try ConsentWire.expiry(raw["durationMs"]))
    }
    static func canonical(_ raw: JSONValue, historyMessageID: String? = nil) throws -> RuntimeWorkUpdate? {
        let kind: RuntimeWorkUpdate.Kind
        switch raw["type"]?.stringValue {
        case "run_started": kind = .runStart
        case "tool_call": kind = .toolCall
        case "tool_call_update": kind = .toolUpdate
        case "agent_commentary_chunk": kind = .commentary
        case "compaction": kind = .compaction
        case "usage_update": kind = .usage
        case "system_event": kind = .system
        case "session_activity_update": kind = .activity
        case "error": kind = .error
        default: return nil
        }
        let session = try ConsentWire.string(raw["sessionKey"] ?? raw["activity"]?["key"], max: 1_024)
        let run = try ConsentWire.string(raw["runId"], max: 256)
        let item = try ConsentWire.string(raw["toolCallId"] ?? raw["itemId"], max: 512)
        _ = try ConsentWire.string(raw["kind"], max: 8_000)
        if [.runStart, .toolCall, .toolUpdate, .commentary].contains(kind), (session == nil || run == nil && historyMessageID == nil) { throw RuntimeFailure(.invalidResponse) }
        if [.toolCall, .toolUpdate, .commentary].contains(kind), item == nil { throw RuntimeFailure(.invalidResponse) }
        let status: RuntimeWorkUpdate.Status?
        if let value = raw["status"]?.stringValue { status = RuntimeWorkUpdate.Status(rawValue: value) ?? .unknown }
        else { status = historyMessageID == nil && [.toolCall, .runStart].contains(kind) ? .running : nil }
        var result = RuntimeWorkUpdate(kind: kind, sessionKey: session, runID: run, itemID: item,
            turnID: try ConsentWire.string(raw["turnId"], max: 512),
            inputMessageID: try ConsentWire.string(raw["inputMessageId"], max: 512),
            inputMessageKey: try ConsentWire.string(raw["inputMessageKey"], max: 512),
            title: try ConsentWire.string(raw["title"], max: 8_000),
            text: try ConsentWire.string(raw["text"] ?? raw["message"], max: 1_024 * 1_024), status: status,
            startedAtMs: try ConsentWire.expiry(raw["startedAtMs"]), finishedAtMs: try ConsentWire.expiry(raw["finishedAtMs"]),
            durationMs: try ConsentWire.expiry(raw["durationMs"]), rawInput: raw["rawInput"], rawOutput: raw["rawOutput"], raw: raw)
        result.historyMessageID = historyMessageID
        return result
    }

    /// The existing Gateway agent-tool event, normalized at the adapter boundary.
    static func gateway(_ payload: JSONValue, session: String, run: String) throws -> RuntimeWorkUpdate? {
        let data = payload["data"] ?? .null
        guard let item = data["toolCallId"]?.nonemptyString else { return nil }
        let start = data["phase"]?.stringValue == "start"
        var raw: [String: JSONValue] = ["type": .string(start ? "tool_call" : "tool_call_update"),
            "sessionKey": .string(session), "runId": .string(run), "toolCallId": .string(item)]
        if let name = data["name"] { raw["title"] = name; raw["kind"] = name }
        if let input = data["args"] { raw["rawInput"] = input }
        if let output = data["output"] ?? data["result"] ?? data["partialResult"] { raw["rawOutput"] = output }
        for field in ["status", "startedAtMs", "finishedAtMs", "durationMs", "inputIsComplete", "outputIsComplete"] {
            raw[field] = data[field]
        }
        if raw["status"] == nil {
            switch data["phase"]?.stringValue {
            case "start", "update": raw["status"] = .string("running")
            case "result":
                // Gateway's explicit terminal phase is its existing adapter contract, not a guess from output.
                let failed = data["isError"]?.boolValue == true || data["error"].map { $0 != .null && $0 != .bool(false) && $0 != .string("") } == true
                raw["status"] = .string(failed ? "error" : "success")
            default: break
            }
        }
        for field in ["turnId", "inputMessageId", "inputMessageKey"] { raw[field] = payload[field] }
        // Unknown/new phases and arbitrary output alone do not prove success.
        return try canonical(.object(raw))
    }
}
