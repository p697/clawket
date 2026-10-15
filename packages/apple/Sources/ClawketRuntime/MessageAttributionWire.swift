import Foundation
import ClawketTransport

/// Mirrors Mobile's participant projection; body mentions and ownership claims are never inputs.
enum MessageAttributionWire {
    static func read(_ value: JSONValue, key: String, backend: BackendKind, role: RuntimeMessage.Role) -> RuntimeMessageAttribution? {
        guard role == .user else { return nil }
        if let explicit = normalize(value["attribution"]) { return explicit }
        guard backend == .openclaw || backend == .hermes else { return nil }
        let meta = value["__openclaw"], identity = meta?["senderIdentity"], transport = meta?["transport"]
        let channel = text(transport?["channel"], maximum: 64) ?? text(identity?["pluginId"], maximum: 64)
        let fallback = session(key)
        let name = text(meta?["senderName"]) ?? text(value["senderLabel"])
        let sender: [String: JSONValue] = ["id": meta?["senderId"] ?? .null,
            "name": name.map(JSONValue.string) ?? .null, "username": meta?["senderUsername"] ?? .null,
            "avatarUrl": nilish(meta?["senderAvatarUrl"]) ?? meta?["senderProfileAvatarUrl"] ?? .null,
            "kind": identity?["senderKind"] ?? .null]
        if let channel, ["webchat", "cli", "gateway", "internal"].contains(channel.lowercased()) {
            guard truthy(meta?["senderId"]) || truthy(meta?["senderName"]) || truthy(value["senderLabel"]) else { return nil }
            return normalize(.object(["channel": .string("webchat"), "sender": .object(sender)]))
        }
        guard channel != nil || fallback != nil || truthy(meta?["senderId"]) || name != nil || truthy(meta?["senderUsername"]) else { return nil }
        var raw: [String: JSONValue] = ["channel": .string(channel ?? fallback?.channel ?? "webchat")]
        raw["accountId"] = nilish(identity?["accountId"]) ?? transport?["accountId"] ?? .null
        if let value = nilish(transport?["conversationRef"]) { raw["conversationId"] = value }
        else if let value = fallback?.conversationID { raw["conversationId"] = .string(value) }
        if let value = nilish(transport?["threadId"]) { raw["threadId"] = value }
        else if let value = fallback?.threadID { raw["threadId"] = .string(value) }
        raw["messageId"] = transport?["messageId"] ?? .null
        raw["sender"] = .object(sender)
        return normalize(.object(raw))
    }

    static func normalize(_ value: JSONValue?) -> RuntimeMessageAttribution? {
        guard let value, value.object != nil, let channel = text(value["channel"], maximum: 64), validChannel(channel) else { return nil }
        let sender = value["sender"]
        let kind = sender?["kind"]?.stringValue.flatMap(RuntimeMessageAttribution.Sender.Kind.init(rawValue:))
        let id = identifier(sender?["id"]), name = text(sender?["name"]), username = text(sender?["username"])
        let avatar = avatar(sender?["avatarUrl"])
        let normalizedSender: RuntimeMessageAttribution.Sender? = id != nil || name != nil || username != nil || avatar != nil || kind != nil
            ? .init(id: id, name: name, username: username, avatarURL: avatar, kind: kind) : nil
        return .init(channel: channel.lowercased(), accountID: identifier(value["accountId"]),
            conversationID: identifier(value["conversationId"]), threadID: identifier(value["threadId"]),
            messageID: identifier(value["messageId"]), sender: normalizedSender)
    }

    static func identifier(_ value: JSONValue?, maximum: Int = 512) -> String? {
        guard let value = value?.stringValue, !value.isEmpty, value.utf16.count <= maximum,
              value.trimmingCharacters(in: .whitespacesAndNewlines) == value,
              !value.unicodeScalars.contains(where: prohibited) else { return nil }
        return value
    }

    static func text(_ value: JSONValue?, maximum: Int = 200) -> String? {
        guard let value = value?.stringValue, value.utf16.count <= maximum else { return nil }
        let clean = String(String.UnicodeScalarView(value.unicodeScalars.filter { !prohibited($0) }))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return clean.isEmpty ? nil : clean
    }

    static func session(_ key: String) -> RuntimeMessageAttribution? {
        guard key.utf8.count <= 4_096 else { return nil }
        var parts = key.components(separatedBy: ":")
        if parts.first == "agent", parts.count >= 3, !parts[1].isEmpty { parts.removeFirst(2) }
        if parts.count == 2, parts[0].lowercased() == "linear", UUID(uuidString: parts[1]) != nil,
           parts[1].utf8.count == 36 {
            return normalize(.object(["channel": .string("linear"), "conversationId": .string(parts[1])]))
        }
        guard parts.count >= 3, validChannel(parts[0]), !["cron", "subagent", "hook"].contains(parts[0].lowercased()),
              ["channel", "group", "direct", "dm", "issue", "comment"].contains(parts[1].lowercased()) else { return nil }
        let tail = parts.dropFirst(2).joined(separator: ":").components(separatedBy: ":thread:")
        guard !tail[0].isEmpty else { return nil }
        var raw: [String: JSONValue] = ["channel": .string(parts[0]), "conversationId": .string(tail[0])]
        if tail.count > 1 { raw["threadId"] = .string(tail[1]) }
        return normalize(.object(raw))
    }

    static func avatar(_ value: JSONValue?) -> URL? {
        guard let raw = value?.stringValue, raw.utf16.count <= 2_048,
              let parts = URLComponents(string: raw), parts.scheme?.lowercased() == "https",
              parts.user == nil, parts.password == nil, parts.fragment == nil,
              let host = parts.host?.lowercased(), !host.isEmpty,
              !(parts.queryItems ?? []).contains(where: { item in
                  let name = (item.name.removingPercentEncoding ?? item.name).lowercased()
                  return name.contains("%") || ["token", "secret", "key", "signature", "credential", "auth"].contains { name.contains($0) }
              }), !localHost(host), let url = parts.url else { return nil }
        return url
    }

    private static func localHost(_ raw: String) -> Bool {
        let host = (raw.removingPercentEncoding ?? raw).trimmingCharacters(in: CharacterSet(charactersIn: "."))
        if host.contains("%") || !host.contains(".") { return true }
        if host.hasPrefix("localhost") || host.contains(":") || host.contains("[") || host.hasSuffix(".local") { return true }
        if ["127.", "0.", "10.", "192.168.", "169.254."].contains(where: host.hasPrefix) { return true }
        let pieces = host.split(separator: ".", omittingEmptySubsequences: false)
        if pieces.count > 1, pieces[0] == "172", let second = Int(pieces[1]), (16...31).contains(second) { return true }
        if pieces.count > 1, pieces[0] == "100", let second = Int(pieces[1]), (64...127).contains(second) { return true }
        if let first = pieces.first.flatMap({ Int($0) }), first >= 224 { return true }
        // WHATWG normalizes legacy integer/octal/hex IPv4 forms. Foundation may
        // retain their spelling, so ambiguous numeric hosts must not bypass the guard.
        if pieces.contains(where: { $0.lowercased().hasPrefix("0x") }) { return true }
        if pieces.allSatisfy({ !$0.isEmpty && $0.utf8.allSatisfy { (48...57).contains($0) } }) {
            return pieces.count != 4 || pieces.contains { ($0.count > 1 && $0.first == "0") || Int($0).map { $0 > 255 } != false }
        }
        return false
    }

    private static func validChannel(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        func letter(_ byte: UInt8) -> Bool { (65...90).contains(byte) || (97...122).contains(byte) }
        return bytes.first.map(letter) == true && bytes.dropFirst().allSatisfy { letter($0) || (48...57).contains($0) || $0 == 95 || $0 == 45 }
    }
    private static func prohibited(_ scalar: Unicode.Scalar) -> Bool {
        scalar.value <= 31 || scalar.value == 127 || (0x202a...0x202e).contains(scalar.value) || (0x2066...0x2069).contains(scalar.value)
    }
    private static func nilish(_ value: JSONValue?) -> JSONValue? { value == .null ? nil : value }
    private static func truthy(_ value: JSONValue?) -> Bool {
        switch value {
        case nil, .null: false
        case .string(let value): !value.isEmpty
        case .bool(let value): value
        case .number(let value): value != 0
        case .array, .object: true
        }
    }
}
