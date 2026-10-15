import Foundation

/// Fixed protocol notices only. Persist the original text so changing language
/// never changes source identity or turns backend/user prose into a resource key.
enum NativeSystemNotice {
    static func text(_ message: NativeMessage) -> String {
        guard message.role == .system else { return message.text }
        switch message.text {
        case "Model authentication failed. Sign in again on your computer.":
            return String(localized: "Model authentication failed. Sign in again on your computer.")
        case "The model account has insufficient credits or quota.":
            return String(localized: "The model account has insufficient credits or quota.")
        case "The model is rate limited. Try again shortly.":
            return String(localized: "The model is rate limited. Try again shortly.")
        case "This model is unavailable in the current Codex runtime. Choose another model or update Codex on your computer.":
            return String(localized: "This model is unavailable in the current Codex runtime. Choose another model or update Codex on your computer.")
        case "The agent couldn't complete this reply. Please try again.":
            return String(localized: "The agent couldn't complete this reply. Please try again.")
        default: return message.text
        }
    }
}
