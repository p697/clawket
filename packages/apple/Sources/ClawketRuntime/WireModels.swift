import Foundation
import CryptoKit
import ClawketTransport

enum WireModels {
    static func agents(_ payload: JSONValue, connection: BackendConnection) throws -> [RuntimeAgent] {
        if connection.backendKind == .hermes || connection.backendKind == .localModel {
            let id = connection.backendKind == .hermes ? "hermes" : "main"
            return [.init(agentID: id, connectionID: connection.id, name: connection.label, mainSessionKey: "main")]
        }
        let openclaw = connection.backendKind == .openclaw
        guard var values = openclaw ? payload["agents"]?.array : payload.array, values.count <= 1_000 else {
            throw RuntimeFailure(.invalidResponse)
        }
        let defaultID = payload["defaultId"]?.nonemptyString ?? "main"
        if openclaw && values.isEmpty { values = [.object(["id": .string(defaultID)])] }
        var ids = Set<String>()
        return try values.map { value in
            guard let id = value[openclaw ? "id" : "agentId"]?.nonemptyString, id.utf8.count <= 256,
                  ids.insert(id).inserted else { throw RuntimeFailure(.invalidResponse) }
            var mainKey = value["mainSessionKey"]?.stringValue ?? ""
            let sessionsFirst = !openclaw && value["entryMode"]?.stringValue == "sessions"
            if openclaw {
                let alias = payload["mainKey"]?.nonemptyString ?? "main"
                mainKey = alias.hasPrefix("agent:") ? (id == defaultID ? alias : "agent:\(id):main") : "agent:\(id):\(alias.lowercased())"
            }
            guard sessionsFirst || !mainKey.isEmpty else { throw RuntimeFailure(.invalidResponse) }
            let identity = value["identity"]
            let name = openclaw ? (identity?["name"]?.nonemptyString ?? value["name"]?.nonemptyString ?? id)
                : connection.backendKind == .pi ? (value["name"]?.nonemptyString ?? connection.label) : connection.label
            return RuntimeAgent(agentID: id, connectionID: connection.id, name: name,
                                emoji: identity?["emoji"]?.stringValue ?? value["emoji"]?.stringValue,
                                avatarURL: avatar(identity?["avatarUrl"] ?? identity?["avatar"] ?? value["avatarUrl"], base: connection.url),
                                mainSessionKey: mainKey, entryMode: sessionsFirst ? .sessions : .main)
        }
    }

    static func sessions(_ payload: JSONValue, connection: BackendConnection, legacyActivity: Bool) throws -> [RuntimeSession] {
        guard let values = payload.array ?? payload["sessions"]?.array, values.count <= 10_000 else {
            throw RuntimeFailure(.invalidResponse)
        }
        var keys = Set<String>()
        return try values.map { value in
            let session = try session(value, connection: connection, legacyActivity: legacyActivity)
            guard keys.insert(session.key).inserted else { throw RuntimeFailure(.invalidResponse) }
            return session
        }
    }

    static func session(_ value: JSONValue, connection: BackendConnection, legacyActivity: Bool) throws -> RuntimeSession {
        guard value.object != nil, let key = value["key"]?.nonemptyString, key.utf8.count <= 1_024 else {
            throw RuntimeFailure(.invalidResponse)
        }
        let gateway = connection.backendKind == .openclaw || connection.backendKind == .hermes
        if !gateway && connection.backendKind != .localModel {
            let kinds = ["main", "channel", "direct", "group", "subagent", "cron", "other"]
            guard value["agentId"]?.nonemptyString != nil, value["title"]?.stringValue != nil,
                  kinds.contains(value["kind"]?.stringValue ?? ""),
                  value["updatedAt"] == .null || timestamp(value["updatedAt"]) != nil,
                  value["hasActiveRun"]?.boolValue != nil,
                  let actions = value["allowedActions"]?.object,
                  ["rename", "reset", "delete", "pin"].allSatisfy({ actions[$0]?.boolValue != nil }) else {
                throw RuntimeFailure(.invalidResponse)
            }
        }
        let pieces = key.split(separator: ":")
        let agentID = connection.backendKind == .hermes ? "hermes" : value["agentId"]?.nonemptyString
            ?? (pieces.first == "agent" && pieces.count > 1 ? String(pieces[1]) : "main")
        let kind = value["kind"]?.nonemptyString ?? (key == "main" || key.hasSuffix(":main") ? "main"
            : key.contains(":subagent:") ? "subagent" : key.contains(":cron:") ? "cron" : "other")
        let updatedAt = timestamp(value["updatedAt"])
        let activity: Int64?
        if connection.backendKind == .openclaw {
            let clocks = [timestamp(value["lastInteractionAt"]), timestamp(value["lastActivityAt"])].compactMap { $0 }
            activity = clocks.max() ?? (legacyActivity ? updatedAt : nil)
        } else if value["lastActivityAt"] == .null { activity = nil }
        else { activity = timestamp(value["lastActivityAt"]) ?? updatedAt }
        var project: RuntimeProject?
        if let raw = value["project"] {
            guard let id = raw["id"]?.stringValue, let name = raw["name"]?.stringValue,
                  let path = raw["path"]?.stringValue, let available = raw["available"]?.boolValue else {
                throw RuntimeFailure(.invalidResponse)
            }
            project = RuntimeProject(id: id, name: name, path: path, available: available)
        }
        return RuntimeSession(key: key, connectionID: connection.id, agentID: agentID,
                              title: value["title"]?.nonemptyString ?? value["derivedTitle"]?.nonemptyString
                                ?? value["label"]?.nonemptyString ?? value["displayName"]?.nonemptyString ?? key,
                              kind: kind, preview: gateway ? value["lastMessagePreview"]?.stringValue : value["preview"]?.stringValue,
                              updatedAtMs: updatedAt, lastActivityAtMs: activity, model: value["model"]?.stringValue,
                              modelProvider: value["modelProvider"]?.stringValue,
                              hasActiveRun: value["hasActiveRun"]?.boolValue == true, project: project,
                              canContinue: value["canContinue"]?.boolValue, continuationBlockedReason: value["continuationBlockedReason"]?.stringValue,
                              raw: value)
    }

    static func history(_ payload: JSONValue, key: String, backend: BackendKind) throws -> RuntimeHistory {
        guard payload.object != nil, let values = payload["messages"]?.array, values.count <= 10_000 else {
            throw RuntimeFailure(.invalidResponse)
        }
        var syntheticCounts: [String: Int] = [:]
        let gateway = backend == .openclaw || backend == .hermes
        let messages = try values.compactMap { value -> RuntimeMessage? in
            if value.object == nil && gateway { return nil }
            let rawRole = value["role"]?.stringValue
            guard value.object != nil, let role = RuntimeMessage.Role(rawValue: rawRole == "toolResult" ? "tool" : rawRole ?? "") ?? (gateway ? .system : nil) else {
                throw RuntimeFailure(.invalidResponse)
            }
            let suppliedID = value["id"]?.nonemptyString ?? value["messageId"]?.nonemptyString ?? value["__openclaw"]?["id"]?.nonemptyString
            let id: String
            if let suppliedID { id = suppliedID }
            else {
                // Presentation fallback only. Never use synthetic IDs to reconcile send receipts.
                let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
                let digest = SHA256.hash(data: try encoder.encode(value)).map { String(format: "%02x", $0) }.joined()
                let count = syntheticCounts[digest, default: 0]; syntheticCounts[digest] = count + 1
                id = "native-history:\(digest):\(count)"
            }
            var clock = timestamp(value["timestampMs"] ?? value["timestamp"] ?? value["ts"] ?? value["createdAt"])
            if gateway, let number = clock, number > 0, number < 10_000_000_000 { clock = number * 1_000 }
            var sendKey = value["idempotencyKey"]?.stringValue ?? value["__openclaw"]?["idempotencyKey"]?.stringValue
            if backend == .openclaw, role == .user, value["__openclaw"]?.object != nil, let raw = sendKey, raw.hasSuffix(":user") {
                let original = String(raw.dropLast(5))
                let knownLegacy = original.range(of: "^[0-9]{13}_[a-z0-9]{1,8}$", options: .regularExpression) != nil
                if knownLegacy || UUID(uuidString: original) != nil { sendKey = original }
            }
            return RuntimeMessage(id: id, role: role, text: value["text"]?.stringValue ?? protocolText(value["content"]),
                                  timestampMs: clock,
                                  runID: value["runId"]?.stringValue, turnID: value["turnId"]?.stringValue,
                                  idempotencyKey: sendKey,
                                  sentLocally: false, raw: value)
        }
        let profile = BackendProfile.profile(for: backend)
        var nextCursor = payload["nextCursor"]?.nonemptyString
        if backend == .openclaw && payload["hasMore"]?.boolValue == true {
            guard let offset = payload["nextOffset"]?.safeInteger, offset > 0,
                  let sessionID = payload["sessionId"]?.nonemptyString else { throw RuntimeFailure(.invalidResponse) }
            nextCursor = "clawket:openclaw-offset:" + (try FrameCodec.encode(.object(["key": .string(key), "sessionId": .string(sessionID), "offset": .number(Double(offset))])))
        }
        return RuntimeHistory(key: key, messages: messages, nextCursor: nextCursor,
                              hasMore: payload["hasMore"]?.boolValue, pagination: profile.cursorHistory ? .cursor : .limit,
                              hasActiveRun: payload["sessionInfo"]?["hasActiveRun"]?.boolValue ?? payload["hasActiveRun"]?.boolValue ?? false,
                              activeRun: payload["activeRun"] ?? payload["inFlightRun"])
    }

    private static func avatar(_ value: JSONValue?, base: URL) -> URL? {
        guard let text = value?.nonemptyString else { return nil }
        if text.hasPrefix("/") {
            guard var parts = URLComponents(url: base, resolvingAgainstBaseURL: false) else { return nil }
            parts.scheme = parts.scheme == "wss" ? "https" : parts.scheme == "ws" ? "http" : parts.scheme
            parts.path = ""; parts.query = nil
            return parts.url.flatMap { URL(string: text, relativeTo: $0)?.absoluteURL }
        }
        guard let url = URL(string: text), ["http", "https", "data"].contains(url.scheme?.lowercased() ?? "") else { return nil }
        return url
    }
}
