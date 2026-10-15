import ClawketTransport
import Foundation

extension WorkEvents {
    static func history(_ message: RuntimeMessage, sessionKey: String) -> [RuntimeWorkUpdate] {
        var values: [(JSONValue, Bool, Int)] = []
        if message.role == .tool {
            // The shared SDK ChatMessage contract nests the tool beside text.
            // Gateway toolResult rows retain their existing top-level fields.
            let tool = message.raw["tool"].flatMap { $0.object != nil ? $0 : nil } ?? message.raw
            values.append((tool, true, 0))
        }
        else if case let .array(blocks) = message.raw["content"] {
            for (index, block) in blocks.enumerated() {
                switch block["type"]?.stringValue?.lowercased() {
                case "toolcall", "tool_call", "tool_use": values.append((block, false, index))
                case "tool_result", "toolresult": values.append((block, true, index))
                default: break
                }
            }
        }
        return values.compactMap { value, isResult, blockIndex in
            let source = message.id + ":" + String(blockIndex)
            var raw: [String: JSONValue] = ["type": .string(isResult ? "tool_call_update" : "tool_call"),
                "sessionKey": .string(sessionKey)]
            raw["toolCallId"] = value["callId"] ?? value["toolCallId"] ?? value["tool_call_id"] ?? value["tool_use_id"]
                ?? (!isResult ? value["id"] : nil) ?? .string("history-item:" + source)
            raw["title"] = value["toolName"] ?? value["name"] ?? value["tool"]
            raw["kind"] = raw["title"]
            raw["text"] = value["summary"]
            raw["runId"] = message.runID.map(JSONValue.string)
            raw["turnId"] = message.turnID.map(JSONValue.string)
            raw["inputMessageId"] = message.raw["inputMessageId"]
            raw["inputMessageKey"] = message.raw["inputMessageKey"]
            raw["rawInput"] = value["toolArgs"] ?? value["arguments"] ?? value["args"] ?? value["input"]
            if isResult { raw["rawOutput"] = value["output"] ?? value["result"] ?? value["toolOutput"] ?? value["content"] }
            raw["status"] = value["status"]
            if value["isError"]?.boolValue == true || value["is_error"]?.boolValue == true { raw["status"] = .string("error") }
            raw["startedAtMs"] = value["startedAtMs"] ?? value["toolStartedAt"]
            raw["finishedAtMs"] = value["finishedAtMs"] ?? value["toolFinishedAt"]
            raw["durationMs"] = value["durationMs"] ?? value["toolDurationMs"]
            raw["inputIsComplete"] = value["inputIsComplete"]
            raw["outputIsComplete"] = value["outputIsComplete"]
            // A malformed optional item cannot suppress the rest of the usable transcript.
            return try? canonical(.object(raw), historyMessageID: source)
        }
    }
}
