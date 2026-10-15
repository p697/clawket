import Foundation

/// Display-only fallbacks. Original names, messages and protocol identities remain unchanged.
enum NativeTranscriptPresentation {
    static func title(_ title: String?, key: String, nativeSessionID: String?, preview: String?,
                      messages: [NativeMessage]) -> String {
        let identities = Set([key, nativeSessionID].compactMap { $0 }.filter { !$0.isEmpty })
        if let title, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           !identities.contains(title) { return title }
        for message in messages where message.role == .user {
            if let text = snippet(message.text, excluding: identities) { return text }
        }
        if let preview, let text = snippet(preview, excluding: identities) { return text }
        return String(localized: "New conversation")
    }

    static func isVisible(_ message: NativeMessage) -> Bool {
        message.role != .tool || !message.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !message.media.isEmpty
    }

    private static func snippet(_ value: String, excluding identities: Set<String>) -> String? {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !identities.contains(text) else { return nil }
        let prefix = text.prefix(160)
        // A single grapheme may contain arbitrarily many combining marks.
        guard prefix.utf8.count <= 4_096 else { return nil }
        return String(prefix)
    }
}
