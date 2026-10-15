import ClawketMedia
import ClawketPersistence
import ClawketRuntime
import ClawketUI
import Foundation

enum NativeMediaIssue: Error, Equatable { case textOnly, modelChanging }

/// Display/storage metadata only. Remote references never carry live authority or URLs.
struct NativeMediaReference: Codable, Sendable, Equatable, Identifiable {
    var id: String
    var resourceID: UUID?
    var artifactID: String?
    var kind: RuntimePromptAttachment.Kind
    var mimeType: String
    var name: String

    init(resource: MediaResource, isImage: Bool) {
        id = resource.id.uuidString.lowercased(); resourceID = resource.id
        kind = isImage ? .image : .file; mimeType = resource.mimeType; name = resource.name
    }

    init(id: String, attachment: RuntimeMessageAttachment) {
        self.id = id; artifactID = attachment.artifactID; kind = attachment.type
        mimeType = attachment.mimeType; name = attachment.name ?? String(localized: "Attachment")
    }

    func validate() throws {
        guard !id.isEmpty, id.utf8.count <= 256, !name.isEmpty, name.utf8.count <= 1_024,
              mimeType.utf8.count <= 255,
              mimeType.range(of: "^[a-z0-9.+-]+/[a-z0-9.+-]+$", options: .regularExpression) != nil,
              artifactID == nil || (!artifactID!.isEmpty && artifactID!.utf8.count <= 512) else {
            throw StoreFailure.invalidDocument
        }
    }
}

struct NativeMediaScope: Equatable, Sendable {
    let route: ConversationID
    let activation: UUID
    let selection: UUID
    let draft: UUID
}

struct NativeMediaImport: Identifiable, Sendable {
    let id: UUID
    let scope: NativeMediaScope
    let name: String
}

struct NativeMediaPickerRequest: Identifiable {
    let id = UUID()
    let scope: NativeMediaScope
    let source: AttachmentSource
    let remaining: Int
    let allowsFiles: Bool
}

struct NativePendingMediaImport: Codable, Sendable, Identifiable {
    let resource: MediaResource
    let connectionID: String
    let agentID: String
    let sessionID: String
    var messageID: String?
    var referenceID: String?
    var id: UUID { resource.id }
    var route: ConversationID { .init(connectionID: connectionID, agentID: agentID, sessionID: sessionID) }
}

struct NativeMediaJournal: Codable, Sendable {
    var version = 1
    var pending: [NativePendingMediaImport] = []
    var releases: Set<UUID> = []
}

extension NativeMessage {
    enum CodingKeys: String, CodingKey {
        case id, remoteID, role, local, text, runID, segmentID, idempotencyKey, timestampMs
        case delivery, streaming, isWork, media
    }

    init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(id: try values.decode(String.self, forKey: .id),
            remoteID: try values.decodeIfPresent(String.self, forKey: .remoteID),
            role: try values.decode(RuntimeMessage.Role.self, forKey: .role),
            local: try values.decodeIfPresent(Bool.self, forKey: .local) ?? false,
            text: try values.decode(String.self, forKey: .text),
            runID: try values.decodeIfPresent(String.self, forKey: .runID),
            segmentID: try values.decodeIfPresent(String.self, forKey: .segmentID),
            idempotencyKey: try values.decodeIfPresent(String.self, forKey: .idempotencyKey),
            timestampMs: try values.decodeIfPresent(Int64.self, forKey: .timestampMs),
            delivery: try values.decodeIfPresent(NativeDelivery.self, forKey: .delivery),
            streaming: try values.decodeIfPresent(Bool.self, forKey: .streaming) ?? false,
            isWork: try values.decodeIfPresent(Bool.self, forKey: .isWork) ?? false,
            media: try values.decodeIfPresent([NativeMediaReference].self, forKey: .media) ?? [])
    }
}

extension NativeConversation {
    enum CodingKeys: String, CodingKey {
        case version, revision, draft, messages, nextCursor, historyLimit, hasMore, draftResourceIDs, historyEpoch, physicalSessionID
    }

    init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(version: try values.decode(Int.self, forKey: .version),
            revision: try values.decode(Int64.self, forKey: .revision),
            draft: try values.decode(String.self, forKey: .draft),
            messages: try values.decode([NativeMessage].self, forKey: .messages),
            nextCursor: try values.decodeIfPresent(String.self, forKey: .nextCursor),
            historyLimit: try values.decode(Int.self, forKey: .historyLimit),
            hasMore: try values.decode(Bool.self, forKey: .hasMore),
            draftResourceIDs: try values.decodeIfPresent([UUID].self, forKey: .draftResourceIDs) ?? [],
            historyEpoch: try values.decodeIfPresent(UUID.self, forKey: .historyEpoch),
            physicalSessionID: try values.decodeIfPresent(String.self, forKey: .physicalSessionID))
        try validateMedia()
    }

    var mediaResourceIDs: Set<UUID> {
        Set(draftResourceIDs).union(messages.flatMap { message in
            message.media.filter { $0.artifactID == nil }.compactMap(\.resourceID)
        })
    }

    func validateMedia() throws {
        guard version == 1, revision >= 0, revision < 9_007_199_254_740_991, draftResourceIDs.count <= 6,
              Set(draftResourceIDs).count == draftResourceIDs.count,
              physicalSessionID == nil || (!physicalSessionID!.isEmpty && physicalSessionID!.utf8.count <= 2_048),
              Set(messages.map(\.id)).count == messages.count else { throw StoreFailure.invalidDocument }
        for message in messages {
            guard message.media.count <= (message.local && message.role == .user ? 6 : 64),
                  Set(message.media.map(\.id)).count == message.media.count else { throw StoreFailure.invalidDocument }
            for reference in message.media { try reference.validate() }
            if message.local, message.role == .user,
               [.queued, .held, .sending, .uncertain, .failed].contains(message.delivery) {
                guard message.media.allSatisfy({ $0.resourceID != nil && $0.artifactID == nil }) else { throw StoreFailure.invalidDocument }
            }
        }
    }
}
