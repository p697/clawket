import ClawketMedia
import ClawketPersistence
import ClawketRuntime
import ClawketUI
import Foundation

enum NativeMediaIssue: Error, Equatable { case textOnly, modelChanging }

/// Fixed product copy only; provider/runtime error descriptions may contain private paths.
func nativeMediaFailureLabel(_ error: any Error) -> String? {
    let failure = error as? RuntimeFailure
    if error as? MediaFailure == .tooLarge || (failure?.code == .capacity && failure?.delivery == .rejectedBeforeDispatch) {
        return String(localized: "Choose smaller attachments before sending.")
    }
    if failure?.code == .unsupported { return String(localized: "This agent does not support this attachment.") }
    if error as? NativeMediaIssue == .textOnly { return String(localized: "This model accepts text only.") }
    if error as? NativeMediaIssue == .modelChanging { return String(localized: "Preparing attachments…") }
    if error as? MediaFailure == .unsupported { return String(localized: "Attachment could not be added. Try again.") }
    return nil
}

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
    /// Picker-provided layout hint only; inspected bytes still decide accepted media type.
    var displayKind: AttachmentPresentation.Kind = .file
}

/// Ephemeral order and view correlation only. These IDs never grant resource ownership.
struct NativeDraftMediaOrder {
    private struct Slot {
        var resource: UUID
        let display: UUID
    }
    private var slots: [Slot] = []

    mutating func complete(importID: UUID, resourceID: UUID) {
        guard let index = slots.firstIndex(where: { $0.resource == importID }),
              !slots.contains(where: { $0.resource == resourceID }) else { return }
        slots[index].resource = resourceID
    }

    mutating func project(_ values: [AttachmentPresentation]) -> [AttachmentPresentation] {
        let live = Set(values.compactMap { UUID(uuidString: $0.id) })
        slots.removeAll { !live.contains($0.resource) }
        for value in values {
            guard let id = UUID(uuidString: value.id), !slots.contains(where: { $0.resource == id }), slots.count < 6 else { continue }
            slots.append(.init(resource: id, display: id))
        }
        return values.enumerated().sorted {
            let left = rank($0.element.id), right = rank($1.element.id)
            return left == right ? $0.offset < $1.offset : left < right
        }.map { item in
            var value = item.element
            if let id = UUID(uuidString: value.id), let slot = slots.first(where: { $0.resource == id }) {
                value.presentationID = slot.display.uuidString.lowercased()
            }
            return value
        }
    }

    func orderedResources(_ values: [UUID]) -> [UUID] {
        values.enumerated().sorted {
            let left = rank($0.element.uuidString), right = rank($1.element.uuidString)
            return left == right ? $0.offset < $1.offset : left < right
        }.map(\.element)
    }

    private func rank(_ value: String) -> Int {
        guard let id = UUID(uuidString: value) else { return .max }
        return slots.firstIndex { $0.resource == id } ?? .max
    }
}

struct NativeMediaPickerRequest: Identifiable {
    let id = UUID()
    let scope: NativeMediaScope
    let source: AttachmentSource
    let remaining: Int
    let allowsFiles: Bool
}

/// UIKit may dismiss a document picker before delivering its selection.
/// Presentation binding lifetime must not decide whether that result is current.
struct NativeMediaPickerLifetime {
    private var pending: NativeMediaPickerRequest?
    mutating func present(_ request: NativeMediaPickerRequest) { pending = request }
    mutating func consume(_ request: NativeMediaPickerRequest) -> Bool {
        guard pending?.id == request.id, pending?.scope == request.scope else { return false }
        pending = nil; return true
    }
    mutating func retire() { pending = nil }
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
        case providedID, idSource, attribution, transcriptPosition, transcriptBoundary, historyEpoch, sourceRevisionHash
        case turnID, inputMessageID, inputMessageKey, liveSnapshotState
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
            media: try values.decodeIfPresent([NativeMediaReference].self, forKey: .media) ?? [],
            providedID: try values.decodeIfPresent(String.self, forKey: .providedID),
            idSource: try values.decodeIfPresent(RuntimeMessageIDSource.self, forKey: .idSource),
            attribution: try values.decodeIfPresent(RuntimeMessageAttribution.self, forKey: .attribution),
            transcriptPosition: try values.decodeIfPresent(RuntimeTranscriptPosition.self, forKey: .transcriptPosition),
            transcriptBoundary: try values.decodeIfPresent(RuntimeTranscriptBoundary.self, forKey: .transcriptBoundary),
            historyEpoch: try values.decodeIfPresent(UUID.self, forKey: .historyEpoch),
            sourceRevisionHash: try values.decodeIfPresent(String.self, forKey: .sourceRevisionHash),
            turnID: try values.decodeIfPresent(String.self, forKey: .turnID),
            inputMessageID: try values.decodeIfPresent(String.self, forKey: .inputMessageID),
            inputMessageKey: try values.decodeIfPresent(String.self, forKey: .inputMessageKey),
            liveSnapshotState: try values.decodeIfPresent(NativeLiveSnapshotState.self, forKey: .liveSnapshotState))
    }
}

extension NativeConversation {
    enum CodingKeys: String, CodingKey {
        case version, revision, draft, messages, nextCursor, historyLimit, hasMore, draftResourceIDs, historyEpoch, physicalSessionID, physicalMutationUnconfirmed
        case sourceAmbiguity, retiredTerminalSources
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
            physicalSessionID: try values.decodeIfPresent(String.self, forKey: .physicalSessionID),
            physicalMutationUnconfirmed: try values.decodeIfPresent(Bool.self, forKey: .physicalMutationUnconfirmed),
            sourceAmbiguity: try values.decodeIfPresent(NativeSourceAmbiguity.self, forKey: .sourceAmbiguity),
            retiredTerminalSources: try values.decodeIfPresent(NativeRetiredTerminalSources.self, forKey: .retiredTerminalSources))
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
              sourceAmbiguity?.isValid != false, retiredTerminalSources?.isValid != false,
              Set(messages.map(\.id)).count == messages.count else { throw StoreFailure.invalidDocument }
        for message in messages {
            if let digest = message.sourceRevisionHash {
                guard digest.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw StoreFailure.invalidDocument }
            }
            guard message.media.count <= (message.isOwnedUser ? 6 : 64),
                  Set(message.media.map(\.id)).count == message.media.count else { throw StoreFailure.invalidDocument }
            for reference in message.media { try reference.validate() }
            if message.isOwnedUser,
               [.queued, .held, .sending, .uncertain, .failed].contains(message.delivery) {
                guard message.media.allSatisfy({ $0.resourceID != nil && $0.artifactID == nil }) else { throw StoreFailure.invalidDocument }
            }
        }
    }
}
