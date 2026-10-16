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
        let sourceAmbiguity: NativeSourceAmbiguity
        let retiredTerminalSources: NativeRetiredTerminalSources
    }

    static func prepare(_ history: RuntimeHistory, stored: [NativeMessage],
                        readSnapshot: [String: NativeMessage], epoch: UUID?, route: ConversationID,
                        earlier: Bool, sourceAmbiguity: NativeSourceAmbiguity? = nil,
                        retiredTerminalSources: NativeRetiredTerminalSources? = nil,
                        newID: () -> String = { UUID().uuidString }) throws -> Projection {
        var ambiguity = sourceAmbiguity?.scoped(to: epoch) ?? .init(epoch: epoch)
        var retired = retiredTerminalSources?.scoped(to: epoch) ?? .init(epoch: epoch)
        guard ambiguity.isValid, retired.isValid else { throw NativeHistoryReconciliation.Failure.invalidInput }
        let terminalSources = Set(retired.sources)
        for row in stored where row.historyEpoch == epoch && row.idSource == .ambiguousProvided {
            if let source = row.providedID { ambiguity.remember(source) }
        }
        for row in history.messages where row.idSource == .ambiguousProvided {
            if let source = row.providedID { ambiguity.remember(source) }
        }
        let incomingSources = Dictionary(grouping: history.messages.compactMap(\.providedID), by: { Data($0.utf8) })
        let storedSources = Dictionary(grouping: stored.filter { $0.historyEpoch == epoch }.compactMap(\.providedID), by: { Data($0.utf8) })
        for sources in Array(incomingSources.values) + Array(storedSources.values) where sources.count > 1 {
            if let source = sources.first { ambiguity.remember(source) }
        }
        let oldSources = Dictionary(grouping: stored.filter {
            $0.historyEpoch == epoch && $0.idSource == .provided && $0.providedID != nil
        }, by: { Data($0.providedID!.utf8) })
        var alreadyAmbiguous = Set(ambiguity.sources)
        for row in history.messages where row.idSource == .provided {
            if ambiguity.overflow { break }
            guard let source = row.providedID, let previous = oldSources[Data(source.utf8)] else { continue }
            guard !alreadyAmbiguous.contains(Data(source.utf8)) else { continue }
            if previous.contains(where: {
                !NativeHistoryIdentity.sourceCompatible(NativeHistoryIdentity.incoming(row, epoch: epoch), NativeHistoryIdentity.stored($0))
            }) { ambiguity.remember(source); alreadyAmbiguous.insert(Data(source.utf8)) }
        }
        let blockedSources = Set(ambiguity.sources), blockAllSources = ambiguity.overflow
        func sourceBlocked(_ source: String?) -> Bool {
            guard let source else { return false }
            return blockAllSources || blockedSources.contains(Data(source.utf8))
        }
        let prior = stored.map { message in
            var message = message
            if message.historyEpoch == epoch, sourceBlocked(message.providedID) { message.idSource = .ambiguousProvided }
            return message
        }
        let plan = try NativeHistoryReconciliation.plan(
            incoming: history.messages.map { NativeHistoryIdentity.incoming($0, epoch: epoch, sourceAmbiguous: sourceBlocked($0.providedID)) },
            stored: prior.enumerated().map { index, message in
                .init(id: message.id, identity: NativeHistoryIdentity.stored(message),
                      preserveWhenAbsent: message.streaming,
                      changedAfterRead: readSnapshot[message.id] != stored[index],
                      preserveMatchingContent: message.liveSnapshotState == .terminal && message.segmentID != nil
                        && history.activeRunEvidence != false)
            }, earlier: earlier && history.pagination == .cursor,
            retainOlderPrefix: history.hasMore == true, newID: newID)
        var messages = try plan.entries.map { entry -> NativeMessage in
            switch entry {
            case let .preserved(index, _): return prior[index]
            case let .history(index, previousIndex, id):
                let raw = history.messages[index]
                let previous = previousIndex.map { prior[$0] }
                let owned = previous.map { NativeHistoryIdentity.stored($0).locallyOwned } ?? false
                let digest = try revisionHash(raw)
                let compatibleRun: Bool
                if let incomingRun = raw.runID, let priorRun = previous?.runID {
                    compatibleRun = incomingRun.utf8.elementsEqual(priorRun.utf8)
                } else { compatibleRun = true }
                let keepLiveText = (previous?.streaming == true || previous?.liveSnapshotState == .active) && previous?.segmentID != nil
                    && compatibleRun && history.activeRunEvidence != false
                var snapshotState = previous?.liveSnapshotState
                if raw.role == .assistant, raw.idSource == .provided {
                    if history.activeRunEvidence == false || raw.providedID.map({ terminalSources.contains(Data($0.utf8)) }) == true {
                        snapshotState = .terminal
                    }
                    else if snapshotState != .terminal, history.activeRunEvidence == true,
                            let sourceRun = raw.runID, let activeRun = history.activeRunID,
                            sourceRun.utf8.elementsEqual(activeRun.utf8) {
                        if snapshotState != .active { snapshotState = .historyActive }
                    }
                }
                let provenance: RuntimeMessageIDSource? = sourceBlocked(raw.providedID)
                    || previous?.idSource == .ambiguousProvided && byteEqual(previous?.providedID, raw.providedID)
                    ? .ambiguousProvided : raw.idSource
                return NativeMessage(id: id, remoteID: raw.id, role: raw.role, local: owned,
                    text: keepLiveText ? previous!.text : raw.text, runID: raw.runID ?? previous?.runID,
                    segmentID: compatibleRun ? previous?.segmentID : nil,
                    idempotencyKey: raw.idempotencyKey ?? (owned ? previous?.idempotencyKey : nil),
                    timestampMs: raw.timestampMs ?? previous?.timestampMs, delivery: owned ? .delivered : nil,
                    streaming: previous?.streaming == true && keepLiveText,
                    isWork: raw.role == .tool,
                    media: try references(raw, id: id, previous: previous, owned: owned, digest: digest, route: route),
                    providedID: raw.providedID, idSource: provenance, attribution: raw.attribution,
                    transcriptPosition: raw.transcriptPosition, transcriptBoundary: raw.transcriptBoundary,
                    historyEpoch: epoch, sourceRevisionHash: digest,
                    turnID: raw.turnID ?? previous?.turnID,
                    inputMessageID: raw.inputMessageID ?? previous?.inputMessageID,
                    inputMessageKey: raw.inputMessageKey ?? previous?.inputMessageKey,
                    liveSnapshotState: snapshotState)
            }
        }
        // An overlapping active row and duplicate incoming source cannot leave
        // the older copy as unique authority. Never upgrade a prior ambiguity.
        let sources = Dictionary(grouping: messages.indices.filter { messages[$0].historyEpoch == epoch && messages[$0].providedID != nil },
                                 by: { Data(messages[$0].providedID!.utf8) })
        for indices in sources.values where indices.count > 1 {
            if let index = indices.first, let source = messages[index].providedID { ambiguity.remember(source) }
            for index in indices { messages[index].idSource = .ambiguousProvided }
        }
        let finalBlockedSources = Set(ambiguity.sources)
        for index in messages.indices where messages[index].historyEpoch == epoch {
            if let source = messages[index].providedID, ambiguity.overflow || finalBlockedSources.contains(Data(source.utf8)) {
                messages[index].idSource = .ambiguousProvided
            }
        }
        let retainedIDs = Set(messages.map(\.id))
        try retired.remember(prior.compactMap { row in
            guard row.historyEpoch == epoch, row.role == .assistant, !row.local, row.idSource == .provided,
                  row.liveSnapshotState == .terminal, !retainedIDs.contains(row.id) else { return nil }
            return row.providedID
        })
        return Projection(messages: messages, acceptedHistoryIDs: plan.acceptedHistoryIDs,
                          retiringResources: strongResources(stored).subtracting(strongResources(messages)), sourceAmbiguity: ambiguity,
                          retiredTerminalSources: retired)
    }

    private static func byteEqual(_ left: String?, _ right: String?) -> Bool {
        switch (left, right) {
        case (nil, nil): true
        case let (left?, right?): left.utf8.elementsEqual(right.utf8)
        default: false
        }
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
