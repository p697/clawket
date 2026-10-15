import ClawketRuntime
import ClawketTransport
import Foundation

enum NativeHistoryExportFailure: Error, Equatable { case changed, running, tooLarge, timedOut }

struct NativeHistoryExportLoader {
    typealias Read = @Sendable (String, Int, String?) async throws -> RuntimeHistory
    private struct Fingerprint: Encodable {
        let id: String
        let role: RuntimeMessage.Role
        let text: String
        let raw: JSONValue
    }

    /// Never label an incomplete or changing history window as a complete portable snapshot.
    static func load(key: String, title: String, read: @escaping Read) async throws -> NativePublicTranscript {
        try await withThrowingTaskGroup(of: NativePublicTranscript.self) { group in
            group.addTask { try await pages(key: key, title: title, read: read) }
            group.addTask {
                try await Task.sleep(for: .seconds(90))
                throw NativeHistoryExportFailure.timedOut
            }
            defer { group.cancelAll() }
            guard let result = try await group.next() else { throw NativeHistoryExportFailure.changed }
            return result
        }
    }

    private static func pages(key: String, title: String, read: Read) async throws -> NativePublicTranscript {
        let deadline = ContinuousClock.now.advanced(by: .seconds(90))
        var cursor: String?, cursors: Set<Data> = [], seen: [Data: String] = [:]
        var messages: [NativePublicTranscript.Message] = [], physicalID: String?, firstHash = "", textUnits = 0, limit = 100
        for page in 0..<100 {
            try check(deadline)
            let snapshot = try await read(key, limit, cursor)
            try check(deadline)
            guard historySame(snapshot.key, key), page == 0 || historySame(snapshot.sessionID, physicalID) else { throw NativeHistoryExportFailure.changed }
            guard !snapshot.hasActiveRun else { throw NativeHistoryExportFailure.running }
            if page == 0 { physicalID = snapshot.sessionID; firstHash = try fingerprint(snapshot.messages) }
            let growingLimit = page > 0 && cursor == nil
            if growingLimit { seen = [:]; messages = []; textUnits = 0 }
            var additions: [NativePublicTranscript.Message] = []
            for message in snapshot.messages {
                let signature = try fingerprint([message])
                let identity = Data(message.id.utf8)
                if let prior = seen[identity] {
                    // Renderer fallbacks and ambiguous supplied IDs never become cross-page merge authority.
                    guard message.idSource == .provided, prior == signature else { throw NativeHistoryExportFailure.changed }
                    continue
                }
                seen[identity] = signature
                textUnits += message.text.utf16.count + message.attachments.reduce(0) { $0 + ($1.name?.utf16.count ?? 0) }
                guard seen.count <= 10_000, textUnits <= 2_000_000 else { throw NativeHistoryExportFailure.tooLarge }
                if let role = NativePublicTranscript.Role(rawValue: message.role.rawValue), message.raw["tool"] == nil || message.raw["tool"] == .null {
                    additions.append(.init(role: role, text: role == .user ? NativeHistoryUserText.sanitize(message.text) : message.text,
                        timestampMs: message.timestampMs.flatMap { $0 > 0 ? Double($0) : nil },
                        attachments: message.attachments.map { $0.name?.isEmpty == false ? $0.name! : $0.mimeType }))
                }
            }
            messages = additions + messages
            if let next = snapshot.nextCursor {
                guard cursors.insert(Data(next.utf8)).inserted else { throw NativeHistoryExportFailure.changed }
                cursor = next; continue
            }
            if snapshot.hasMore == true || snapshot.pagination == .limit && snapshot.hasMore == nil && snapshot.messages.count >= limit {
                guard snapshot.pagination == .limit, limit < 1_000 else { throw NativeHistoryExportFailure.tooLarge }
                limit += 100; cursor = nil; continue
            }
            let latest = try await read(key, 100, nil)
            try check(deadline)
            guard historySame(latest.key, key), historySame(latest.sessionID, physicalID), !latest.hasActiveRun,
                  try fingerprint(latest.messages) == firstHash else { throw NativeHistoryExportFailure.changed }
            let result = NativePublicTranscript(title: historyUTF16Prefix(title.trimmingCharacters(in: .whitespacesAndNewlines), maximum: 200), messages: messages)
            try result.validate(); return result
        }
        throw NativeHistoryExportFailure.tooLarge
    }

    private static func fingerprint(_ values: [RuntimeMessage]) throws -> String {
        historyHash(try historyEncode(values.map { Fingerprint(id: $0.id, role: $0.role, text: $0.text, raw: $0.raw) }))
    }
    private static func check(_ deadline: ContinuousClock.Instant) throws {
        try Task.checkCancellation()
        guard ContinuousClock.now < deadline else { throw NativeHistoryExportFailure.timedOut }
    }
}

enum NativeHistoryExportFormat: String, CaseIterable, Sendable { case markdown, json }

enum NativeHistoryExportFormatter {
    private struct Portable: Encodable {
        var version = 1
        let title: String
        let messages: [NativePublicTranscript.Message]
        let loadedOnDeviceOnly: Bool?
    }
    private struct Bulk: Encodable {
        var version = 1
        struct Entry: Encodable { let savedAt: Double; let pinned: Bool; let title: String; let messages: [NativePublicTranscript.Message] }
        let archives: [Entry]
    }
    static func format(_ value: NativePublicTranscript, format: NativeHistoryExportFormat,
                       userLabel: String, assistantLabel: String, loadedOnlyLabel: String? = nil) throws -> Data {
        try value.validate()
        guard value.textUnits <= 2_000_000 else { throw NativeHistoryExportFailure.tooLarge }
        if format == .json {
            return try bounded(historyEncode(Portable(title: value.title, messages: value.messages,
                loadedOnDeviceOnly: loadedOnlyLabel == nil ? nil : true)))
        }
        let title = value.title.replacingOccurrences(of: "\r", with: " ").replacingOccurrences(of: "\n", with: " ")
        let clock = ISO8601DateFormatter(); clock.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let lines = value.messages.map { message in
            let name = message.role == .user ? userLabel : assistantLabel
            let time: String
            if let ms = message.timestampMs, ms > 0, ms <= 253_402_300_799_999 {
                time = " · " + clock.string(from: Date(timeIntervalSince1970: ms / 1_000))
            } else { time = "" }
            return "## " + name + time + "\n\n" + message.text + (message.attachments.isEmpty ? "" : "\n\n" + message.attachments.joined(separator: "\n"))
        }
        let warning = loadedOnlyLabel.map { $0 + "\n\n" } ?? ""
        return try bounded(Data(("# " + title + "\n\n" + warning + lines.joined(separator: "\n\n---\n\n") + "\n").utf8))
    }
    static func localSnapshot(_ value: NativeConversation, title: String) throws -> NativePublicTranscript {
        let messages = value.messages.compactMap { message -> NativePublicTranscript.Message? in
            guard !message.isWork, let role = NativePublicTranscript.Role(rawValue: message.role.rawValue) else { return nil }
            return .init(role: role, text: role == .user ? NativeHistoryUserText.sanitize(message.text) : message.text,
                timestampMs: message.timestampMs.flatMap { $0 > 0 ? Double($0) : nil }, attachments: message.media.map(\.name))
        }
        let result = NativePublicTranscript(title: historyUTF16Prefix(title, maximum: 200), messages: messages)
        try result.validate(); return result
    }
    static func bulk(_ values: [NativeSavedConversation]) throws -> Data {
        guard values.count <= 100 else { throw NativeHistoryExportFailure.tooLarge }
        for value in values { try value.transcript.validate() }
        return try bounded(historyEncode(Bulk(archives: values.map { .init(savedAt: $0.savedAt, pinned: $0.pinned == true, title: $0.title, messages: $0.transcript.messages) })))
    }
    private static func bounded(_ data: Data) throws -> Data {
        guard data.count <= 16 * 1_024 * 1_024 else { throw NativeHistoryExportFailure.tooLarge }; return data
    }
}

/// Exact Mobile public-user projection, including safe document names and known injected envelopes.
/// It operates only on the already bounded export snapshot; no parsed value grants authority.
private enum NativeHistoryUserText {
    static func sanitize(_ value: String) -> String {
        var text = compactDocuments(value)
        let skill = #"\AUse the installed skill "([a-zA-Z0-9][a-zA-Z0-9._/-]{0,127})" for this request\. Read its instructions with skill_view before proceeding\.(?=\s|\z)"#
        if let expression = try? NSRegularExpression(pattern: skill),
           let match = expression.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
           let whole = Range(match.range, in: text), let name = Range(match.range(at: 1), in: text) {
            text = "$" + String(text[name]) + String(text[whole.upperBound...])
        }
        text = replace(text, #"\AOpenClaw resumed this CLI session after prompt content changed\.\s+Follow the current turn's instructions; changed=[a-z-]+(?:,[a-z-]+)*\.\r?\n\r?\n"#, "")
        while text.hasPrefix("System: ") {
            guard let newline = text.firstIndex(of: "\n") else { return "" }
            text = String(text[text.index(after: newline)...])
        }
        text = replace(text, #"\A\n+"#, "")
        text = replace(text, #"\A\[.{0,6}[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}[^\]]*\] "#, "")
        text = replace(text, #"(^|\r?\n)\[system:[\s\S]*?\](?=\r?\n|\z)"#, "$1", options: .caseInsensitive)
        text = replace(text, #"(\r?\n){3,}"#, "\n\n")
        text = replace(text, #"\A(?:[ \t]*\r?\n)+"#, "")
        return replace(text, #"(?:\r?\n[ \t]*)+\z"#, "")
    }
    private static func compactDocuments(_ value: String) -> String {
        let prefix = "\n\n<clawket-document-context>\n", suffix = "\n</clawket-document-context>"
        guard value.hasSuffix(suffix), let start = value.range(of: prefix, options: .backwards),
              value[start.lowerBound...].utf16.count <= 400_000 else { return value }
        let end = value.index(value.endIndex, offsetBy: -suffix.count)
        let raw = String(value[start.upperBound..<end])
        struct File: Decodable { let name: String; let text: String }
        guard let files = try? JSONDecoder().decode([File].self, from: Data(raw.utf8)), (1...6).contains(files.count),
              files.allSatisfy({ !$0.name.isEmpty && $0.name.utf16.count <= 200 }) else { return value }
        let leading = String(value[..<start.lowerBound]), names = files.map { "📎 " + $0.name }.joined(separator: "\n")
        return leading.isEmpty ? names : leading + "\n\n" + names
    }
    private static func replace(_ text: String, _ pattern: String, _ replacement: String,
                                options: NSRegularExpression.Options = []) -> String {
        guard let expression = try? NSRegularExpression(pattern: pattern, options: options) else { return text }
        return expression.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: replacement)
    }
}
