import Foundation

/// Local display choices. These values never change backend capabilities.
public struct ClientAppearancePresentation: Hashable, Codable, Sendable {
    public enum Theme: String, CaseIterable, Codable, Sendable { case system, light, dark }
    public enum Accent: String, CaseIterable, Codable, Sendable {
        case iceBlue, jadeGreen, oceanTeal, sunsetOrange, rosePink, royalPurple
        /// Matches Mobile's actual light/dark accent500 values.
        public func hex(dark: Bool) -> UInt32 {
            switch self {
            case .iceBlue: dark ? 0x6B95FF : 0x1F5EFF
            case .jadeGreen: dark ? 0x52C49A : 0x147A5B
            case .oceanTeal: dark ? 0x55C2D0 : 0x0F7180
            case .sunsetOrange: dark ? 0xF1A45B : 0xA85312
            case .rosePink: dark ? 0xF0709F : 0xB12D62
            case .royalPurple: dark ? 0xA98BFF : 0x6C43C2
            }
        }
    }
    public var theme: Theme
    public var accent: Accent
    public var chatFontSize: Int
    public var showAgentAvatar: Bool
    public var isValid: Bool { (12...20).contains(chatFontSize) }
    public init(theme: Theme = .system, accent: Accent = .iceBlue, chatFontSize: Int = 17, showAgentAvatar: Bool = false) {
        self.theme = theme; self.accent = accent; self.chatFontSize = chatFontSize; self.showAgentAvatar = showAgentAvatar
    }
}

/// A position within already loaded render rows, not a backend cursor or dispatch authority.
public struct ConversationReadingContext: Hashable, Codable, Sendable {
    public var followsBottom: Bool
    public var messageID: String?
    public var offset: Double
    public var isValid: Bool {
        offset.isFinite && abs(offset) <= 10_000_000 &&
        (messageID.map { !$0.isEmpty && $0.utf8.count <= 1_024 } ?? true) &&
        (followsBottom || messageID != nil)
    }
    public init(followsBottom: Bool = true, messageID: String? = nil, offset: Double = 0) {
        self.followsBottom = followsBottom; self.messageID = messageID; self.offset = offset
    }
}

/// The host creates a new scope on every open, including A → B → A.
public struct ConversationReadingPresentation: Hashable, Sendable, Identifiable {
    public var id: UUID
    public var restoration: ConversationReadingContext?
    public init(id: UUID = UUID(), restoration: ConversationReadingContext? = nil) {
        self.id = id; self.restoration = restoration?.isValid == true ? restoration : nil
    }
}

#if os(iOS)
import SwiftUI
import UIKit

extension ClientAppearancePresentation {
    public var colorScheme: ColorScheme? {
        switch theme { case .system: nil; case .light: .light; case .dark: .dark }
    }
    public var accentColor: Color { Color(uiColor: accent.uiColor) }
}
extension ClientAppearancePresentation.Accent {
    public var uiColor: UIColor {
        UIColor { traits in
            let value = self.hex(dark: traits.userInterfaceStyle == .dark)
            return UIColor(red: CGFloat((value >> 16) & 255) / 255,
                           green: CGFloat((value >> 8) & 255) / 255, blue: CGFloat(value & 255) / 255, alpha: 1)
        }
    }
}
#endif
