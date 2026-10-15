import ClawketPersistence
import ClawketRuntime
import ClawketUI
import CryptoKit
import Foundation

/// Applies only a successfully planned read. Its raw-content hash checks cached
/// attachment freshness; neither that hash nor a synthetic wire ID identifies a message.
enum NativeHistoryApplication {
    struct Projection {
        let messages: [NativeMessage]
        let acceptedHistoryIDs: [Int: String]
        let retiringResources: Set<UUID>
    }

    static func prepare(_ history: RuntimeHistory, stored: [NativeMessage],
                        readSnapshot: [String: NativeMessage], epoch: UUID?, route: ConversationID,
                        earlier: Bool, newID: () -> String = { UUID().uuidString }) throws -> Projection {
        let plan = try NativeHistoryReconciliation.plan(
            incoming: history.messages.map { NativeHistoryIdentity.incoming($0, epoch: epoch) },
            stored: stored.map { message in
                .init(id: message.id, identity: NativeHistoryIdentity.stored(message),
                      preserveWhenAbsent: message.streaming,
                      changedAfterRead: readSnapshot[message.id] != message)
            }, earlier: earlier && history.pagination == .cursor,
            retainOlderPrefix: history.hasMore == true, newID: newID)
        let messages = try plan.entries.map { entry -> NativeMessage in
            switch entry {
            case let .preserved(index, _): return stored[index]
            case let .history(index, previousIndex, id):
                let raw = history.messages[index]
                let previous = previousIndex.map { stored[$0] }
                let owned = previous.map { NativeHistoryIdentity.stored($0).locallyOwned } ?? false
                let digest = try revisionHash(raw)
                let sameRun: Bool
                if let incomingRun = raw.runID, let priorRun = previous?.runID {
                    sameRun = incomingRun.utf8.elementsEqual(priorRun.utf8)
                } else { sameRun = raw.runID == nil && previous?.runID == nil }
                return NativeMessage(id: id, remoteID: raw.id, role: raw.role, local: owned,
                    text: raw.text, runID: raw.runID ?? previous?.runID,
                    segmentID: sameRun ? previous?.segmentID : nil,
                    idempotencyKey: raw.idempotencyKey ?? (owned ? previous?.idempotencyKey : nil),
                    timestampMs: raw.timestampMs ?? previous?.timestampMs, delivery: owned ? .delivered : nil,
                    streaming: previous?.streaming == true && history.hasActiveRun && sameRun,
                    isWork: raw.role == .tool,
                    media: try references(raw, id: id, previous: previous, owned: owned, digest: digest, route: route),
                    providedID: raw.providedID, idSource: raw.idSource, attribution: raw.attribution,
                    transcriptPosition: raw.transcriptPosition, transcriptBoundary: raw.transcriptBoundary,
                    historyEpoch: epoch, sourceRevisionHash: digest)
            }
        }
        return Projection(messages: messages, acceptedHistoryIDs: plan.acceptedHistoryIDs,
                          retiringResources: strongResources(stored).subtracting(strongResources(messages)))
    }

    private static func revisionHash(_ message: RuntimeMessage) throws -> String {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return SHA256.hash(data: try encoder.encode(message.raw)).map { String(format: "%02x", $0) }.joined()
    }

    private static func references(_ message: RuntimeMessage, id: String, previous: NativeMessage?, owned: Bool,
                                   digest: String, route: ConversationID) throws -> [NativeMediaReference] {
        // A proven local echo keeps the exact original input files despite backend re-encoding/omission.
        if owned, message.role == .user, let media = previous?.media, !media.isEmpty { return media }
        return try message.attachments.enumerated().map { index, attachment in
            let referenceID = try DocumentStore.scopedKey(namespace: "attachment", parts:
                [route.connectionID, route.agentID, route.sessionID, id, String(index), attachment.artifactID ?? "inline"])
            var value = NativeMediaReference(id: referenceID, attachment: attachment)
            if previous?.sourceRevisionHash == digest,
               let old = previous?.media.first(where: { $0.id == referenceID }),
               old.kind == value.kind, old.mimeType == value.mimeType, old.artifactID == value.artifactID {
                value.resourceID = old.resourceID
            }
            return value
        }
    }

    private static func strongResources(_ messages: [NativeMessage]) -> Set<UUID> {
        Set(messages.flatMap { $0.media.filter { $0.artifactID == nil }.compactMap(\.resourceID) })
    }
}
