import Foundation
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

    static func session(_ value: JSONValue, connection: BackendConnection, legacyActivity: Bool,
                        archivedList: Bool = false) throws -> RuntimeSession {
        guard value.object != nil, let key = value["key"]?.nonemptyString, key.utf8.count <= 1_024 else {
            throw RuntimeFailure(.invalidResponse)
        }
        let gateway = connection.backendKind == .openclaw || connection.backendKind == .hermes
        if !gateway && connection.backendKind != .localModel {
            let kinds = ["main", "channel", "direct", "group", "subagent", "cron", "other"]
            guard value["agentId"]?.nonemptyString != nil, value["title"]?.stringValue != nil,
                  kinds.contains(value["kind"]?.stringValue ?? ""),
                  value["updatedAt"] == .null || timestamp(value["updatedAt"]) != nil,
                  value["hasActiveRun"]?.boolValue != nil || (archivedList && value["archived"]?.boolValue == true),
                  let actions = value["allowedActions"]?.object,
                  ["rename", "reset", "delete", "pin"].allSatisfy({ actions[$0]?.boolValue != nil }) else {
                throw RuntimeFailure(.invalidResponse)
            }
        }
        let pieces = key.split(separator: ":")
        let agentID = connection.backendKind == .hermes ? "hermes" : value["agentId"]?.nonemptyString
            ?? (pieces.first == "agent" && pieces.count > 1 ? String(pieces[1]) : "main")
        var kind = value["kind"]?.nonemptyString ?? (key == "main" || key.hasSuffix(":main") ? "main"
            : key.contains(":subagent:") ? "subagent" : key.contains(":cron:") ? "cron" : "other")
        if connection.backendKind == .openclaw {
            if key == "main" || (pieces.count == 3 && pieces.first == "agent" && pieces.last == "main") { kind = "main" }
            else if key.contains(":cron:") { kind = "cron" }
            else if key.contains(":subagent:") { kind = "subagent" }
            else if value["channel"]?.nonemptyString != nil { kind = "channel" }
            else { kind = ["direct", "group"].contains(value["kind"]?.stringValue ?? "") ? value["kind"]!.stringValue! : "other" }
        }
        let updatedAt = timestamp(value["updatedAt"])
        let actions = try sessionActions(value, backend: connection.backendKind, kind: kind)
        for field in ["source", "sessionId"] {
            if let raw = value[field], raw != .null {
                guard let text = raw.stringValue, !text.isEmpty, text.utf8.count <= 1_024 else { throw RuntimeFailure(.invalidResponse) }
            }
        }
        if let archived = value["archived"], archived != .null, archived.boolValue == nil { throw RuntimeFailure(.invalidResponse) }
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
                              source: value["source"]?.stringValue, sessionID: value["sessionId"]?.stringValue,
                              archived: value["archived"]?.boolValue, allowedActions: actions,
                              raw: value)
    }

    private static func sessionActions(_ value: JSONValue, backend: BackendKind, kind: String) throws -> RuntimeSessionAllowedActions? {
        let gateway = backend == .openclaw || backend == .hermes
        guard gateway || value["allowedActions"] != nil else { return nil }
        if let supplied = value["allowedActions"], supplied.object == nil { throw RuntimeFailure(.invalidResponse) }
        let row = value["allowedActions"]?.object ?? [:]
        for name in ["rename", "reset", "delete", "pin", "archive"] {
            if let raw = row[name], raw.boolValue == nil { throw RuntimeFailure(.invalidResponse) }
        }
        let nativeHermes = backend == .hermes && value["source"]?.stringValue == "native"
        return RuntimeSessionAllowedActions(
            rename: !nativeHermes && (row["rename"]?.boolValue ?? gateway),
            reset: !nativeHermes && (row["reset"]?.boolValue ?? gateway),
            delete: !nativeHermes && !(backend == .openclaw && ["main", "channel"].contains(kind)) && (row["delete"]?.boolValue ?? gateway),
            pin: row["pin"]?.boolValue ?? gateway, archive: row["archive"]?.boolValue == true)
    }

    static func history(_ payload: JSONValue, key: String, backend: BackendKind, artifactsEnabled: Bool = false) throws -> RuntimeHistory {
        guard payload.object != nil, let values = payload["messages"]?.array, values.count <= 10_000 else {
            throw RuntimeFailure(.invalidResponse)
        }
        var identity = HistoryMessageIdentity(values)
        let gateway = backend == .openclaw || backend == .hermes
        var messages = try values.compactMap { value -> RuntimeMessage? in
            if value.object == nil && gateway { return nil }
            let rawRole = value["role"]?.stringValue
            guard value.object != nil, let role = RuntimeMessage.Role(rawValue: rawRole == "toolResult" ? "tool" : rawRole ?? "") ?? (gateway ? .system : nil) else {
                throw RuntimeFailure(.invalidResponse)
            }
            let projection = try identity.project(value)
            var clock = timestamp(value["timestampMs"] ?? value["timestamp"] ?? value["ts"] ?? value["createdAt"])
            if gateway, let number = clock, number > 0, number < 10_000_000_000 { clock = number * 1_000 }
            var sendKey = value["idempotencyKey"]?.stringValue ?? value["__openclaw"]?["idempotencyKey"]?.stringValue
            if backend == .openclaw, role == .user, value["__openclaw"]?.object != nil, let raw = sendKey, raw.hasSuffix(":user") {
                let original = String(raw.dropLast(5))
                let knownLegacy = original.range(of: "^[0-9]{13}_[a-z0-9]{1,8}$", options: .regularExpression) != nil
                if knownLegacy || UUID(uuidString: original) != nil { sendKey = original }
            }
            let rawText = value["text"]?.stringValue ?? protocolText(value["content"])
            let text = role == .assistant ? RuntimeAttachmentProjection.displayText(value, fallback: rawText, enabled: artifactsEnabled) : rawText
            return RuntimeMessage(id: projection.id, role: role, text: text,
                                  timestampMs: clock,
                                  runID: value["runId"]?.stringValue, turnID: value["turnId"]?.stringValue,
                                  idempotencyKey: sendKey,
                                  sentLocally: false, raw: value, providedID: projection.providedID, idSource: projection.source,
                                  attribution: MessageAttributionWire.read(value, key: key, backend: backend, role: role),
                                  transcriptPosition: HistoryMessageIdentity.position(value, backend: backend),
                                  transcriptBoundary: HistoryMessageIdentity.boundary(value, backend: backend, role: role))
        }
        if backend == .openclaw && artifactsEnabled { messages = RuntimeAttachmentProjection.reconcileOpenClaw(messages) }
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
                              activeRun: payload["activeRun"] ?? payload["inFlightRun"],
                              thinkingLevel: payload["thinkingLevel"]?.stringValue.flatMap { ModelControlsWire.levels.contains($0) ? $0 : nil },
                              sessionID: MessageAttributionWire.identifier(payload["sessionId"], maximum: 1_024)
                                .flatMap { $0.utf8.count <= 1_024 ? $0 : nil })
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
