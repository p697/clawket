import ClawketUI
import Foundation

/// Display-only fallbacks. Original names, messages and protocol identities remain unchanged.
enum NativeTranscriptPresentation {
    static func title(_ title: String?, key: String, nativeSessionID: String?, preview: String?,
                      messages: [NativeMessage]) -> String {
        let identities = Set([key, nativeSessionID].compactMap { $0 }.filter { !$0.isEmpty }.map { Data($0.utf8) })
        if let title, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           !identities.contains(Data(title.utf8)) { return title }
        for message in messages where message.role == .user {
            if let text = snippet(message.text, excluding: identities) { return text }
        }
        if let preview, let text = snippet(preview, excluding: identities) { return text }
        return String(localized: "New conversation")
    }

    static func isVisible(_ message: NativeMessage) -> Bool {
        guard message.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, message.media.isEmpty else { return true }
        switch message.role {
        case .tool: return false
        case .assistant: return message.streaming
        case .user, .system: return true
        }
    }

    static func textContent(_ message: NativeMessage) -> MessageContent {
        message.role == .tool ? .toolOutput(.init(text: message.text)) : .markdown(NativeSystemNotice.text(message))
    }

    static func author(_ message: NativeMessage, agentName: String, hasParticipants: Bool) -> MessageAuthor {
        if message.isOwnedUser { return .local }
        switch message.role {
        case .assistant: return .agent(name: agentName, label: hasParticipants ? String(localized: "Agent") : nil)
        case .user:
            guard let attribution = message.attribution else { return .directUser }
            let sender = attribution.sender
            let name = [sender?.name, sender?.username, sender?.id].compactMap { $0 }
                .first { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } ?? String(localized: "Participant")
            return .participant(name: name, channel: attribution.channel)
        case .system, .tool: return .system
        }
    }

    static func timeLabel(_ timestampMs: Int64?, locale: Locale = .autoupdatingCurrent,
                          timeZone: TimeZone = .autoupdatingCurrent) -> String? {
        // Display bounds do not rewrite the preserved producer clock or supply a missing timestamp.
        guard let timestampMs, (0...253_402_300_799_999).contains(timestampMs) else { return nil }
        var style = Date.FormatStyle(date: .omitted, time: .shortened)
        style.locale = locale; style.timeZone = timeZone
        return Date(timeIntervalSince1970: Double(timestampMs) / 1_000).formatted(style)
    }

    private static func snippet(_ value: String, excluding identities: Set<Data>) -> String? {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !identities.contains(Data(text.utf8)) else { return nil }
        let prefix = text.prefix(160)
        // A single grapheme may contain arbitrarily many combining marks.
        guard prefix.utf8.count <= 4_096 else { return nil }
        return String(prefix)
    }
}
