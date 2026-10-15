import Foundation
import ClawketTransport

enum WorkEvents {
    static func canonical(_ raw: JSONValue) throws -> RuntimeWorkUpdate? {
        let kind: RuntimeWorkUpdate.Kind
        switch raw["type"]?.stringValue {
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
        if [.toolCall, .toolUpdate, .commentary].contains(kind), (session == nil || run == nil || item == nil) { throw RuntimeFailure(.invalidResponse) }
        let status: RuntimeWorkUpdate.Status?
        if let value = raw["status"]?.stringValue { status = RuntimeWorkUpdate.Status(rawValue: value) ?? .unknown }
        else { status = kind == .toolCall ? .running : nil }
        return RuntimeWorkUpdate(kind: kind, sessionKey: session, runID: run, itemID: item,
            turnID: try ConsentWire.string(raw["turnId"], max: 512),
            inputMessageID: try ConsentWire.string(raw["inputMessageId"], max: 512),
            inputMessageKey: try ConsentWire.string(raw["inputMessageKey"], max: 512),
            title: try ConsentWire.string(raw["title"], max: 8_000),
            text: try ConsentWire.string(raw["text"] ?? raw["message"], max: 1_024 * 1_024), status: status,
            startedAtMs: try ConsentWire.expiry(raw["startedAtMs"]), finishedAtMs: try ConsentWire.expiry(raw["finishedAtMs"]),
            durationMs: try ConsentWire.expiry(raw["durationMs"]), rawInput: raw["rawInput"], rawOutput: raw["rawOutput"], raw: raw)
    }
}
