import Foundation

/// Wire-authored identity is separate from a unique presentation identifier.
public enum RuntimeMessageIDSource: String, Codable, Sendable {
    case provided, synthetic, ambiguousProvided
}

public struct RuntimeMessageAttribution: Codable, Sendable, Equatable {
    public struct Sender: Codable, Sendable, Equatable {
        public enum Kind: String, Codable, Sendable { case human, bot, unknown }
        public let id: String?
        public let name: String?
        public let username: String?
        public let avatarURL: URL?
        public let kind: Kind?
        public init(id: String? = nil, name: String? = nil, username: String? = nil, avatarURL: URL? = nil, kind: Kind? = nil) {
            self.id = id; self.name = name; self.username = username; self.avatarURL = avatarURL; self.kind = kind
        }
    }
    public let channel: String
    public let accountID: String?
    public let conversationID: String?
    public let threadID: String?
    public let messageID: String?
    public let sender: Sender?
    public init(channel: String, accountID: String? = nil, conversationID: String? = nil, threadID: String? = nil,
                messageID: String? = nil, sender: Sender? = nil) {
        self.channel = channel; self.accountID = accountID; self.conversationID = conversationID
        self.threadID = threadID; self.messageID = messageID; self.sender = sender
    }
}

/// Transcript-local ordering evidence, never a connection or diagnostic identity.
public struct RuntimeTranscriptPosition: Codable, Sendable, Equatable {
    public let source: String
    public let rawSequence: Int64
    public init(source: String, rawSequence: Int64) { self.source = source; self.rawSequence = rawSequence }
}

public enum RuntimeTranscriptBoundary: String, Codable, Sendable { case reset, compaction }
