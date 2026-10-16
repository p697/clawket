import ClawketRuntime
import Foundation

/// The current host route supplies its epoch. Run/segment pairs identify
/// display segments only; this reducer grants no wire or outbox authority.
enum NativeLiveMessages {
    enum TextReduction: Equatable { case accepted, sourceAmbiguityChanged, rejected }

    static func text(_ update: RuntimeTextUpdate, in document: inout NativeConversation, epoch: UUID?,
                     newID: () -> String = { UUID().uuidString }) -> Bool {
        reduceText(update, in: &document, epoch: epoch, newID: newID) == .accepted
    }

    /// A negative identity observation must be saved without treating the
    /// rejected body as accepted text, run activity or current-wire evidence.
    static func reduceText(_ update: RuntimeTextUpdate, in document: inout NativeConversation, epoch: UUID?,
                           allowAcceptedText: Bool = true,
                           newID: () -> String = { UUID().uuidString }) -> TextReduction {
        if let metadata = update.snapshotMetadata {
            guard update.mode == .snapshot else { return .rejected }
            return snapshot(update, metadata: metadata, in: &document, epoch: epoch,
                allowAcceptedText: allowAcceptedText, newID: newID)
        }
        guard allowAcceptedText else { return .rejected }
        return legacyText(update, in: &document, epoch: epoch, newID: newID) ? .accepted : .rejected
    }

    private static func legacyText(_ update: RuntimeTextUpdate, in document: inout NativeConversation, epoch: UUID?,
                                   newID: () -> String) -> Bool {
        let matches = segment(update.runID, update.segmentID, in: document, epoch: epoch)
        guard matches.count <= 1 else { return false }
        if let index = matches.first {
            guard document.messages[index].liveSnapshotState != .terminal,
                  compatible(document.messages[index].turnID, update.turnID),
                  compatible(document.messages[index].inputMessageID, update.inputMessageID),
                  compatible(document.messages[index].inputMessageKey, update.inputMessageKey) else { return false }
            if update.mode == .delta { document.messages[index].text += update.text }
            else { document.messages[index].text = update.text }
            document.messages[index].sourceRevisionHash = nil
            document.messages[index].turnID = update.turnID ?? document.messages[index].turnID
            document.messages[index].inputMessageID = update.inputMessageID ?? document.messages[index].inputMessageID
            document.messages[index].inputMessageKey = update.inputMessageKey ?? document.messages[index].inputMessageKey
        } else {
            guard !document.messages.contains(where: {
                $0.historyEpoch == epoch && $0.role == .assistant && !$0.local && $0.liveSnapshotState != nil
                    && equal($0.runID, update.runID) && equal($0.segmentID, update.segmentID)
            }) else { return false }
            guard let id = freshID(document, newID: newID) else { return false }
            document.messages.append(.init(id: id, role: .assistant, text: update.text, runID: update.runID,
                segmentID: update.segmentID, streaming: true, historyEpoch: epoch,
                turnID: update.turnID, inputMessageID: update.inputMessageID, inputMessageKey: update.inputMessageKey))
        }
        return true
    }

    private static func snapshot(_ update: RuntimeTextUpdate, metadata: RuntimeFinalMessageMetadata,
                                 in document: inout NativeConversation, epoch: UUID?, allowAcceptedText: Bool,
                                 newID: () -> String) -> TextReduction {
        guard !metadata.hasConflictingLineage,
              let source = metadata.providedID, !source.isEmpty, source.utf8.count <= 4_096,
              compatible(metadata.turnID, update.turnID), compatible(metadata.inputMessageID, update.inputMessageID),
              compatible(metadata.inputMessageKey, update.inputMessageKey) else { return .rejected }
        if rememberSourceContradiction(source, role: metadata.role, runID: update.runID, metadata: metadata,
                                       in: &document, epoch: epoch) { return .sourceAmbiguityChanged }
        guard allowAcceptedText, metadata.role == .assistant,
              document.sourceAmbiguity?.scoped(to: epoch).rejects(source) != true,
              document.retiredTerminalSources?.scoped(to: epoch).rejects(source) != true else { return .rejected }
        let sources = document.messages.indices.filter {
            document.messages[$0].historyEpoch == epoch && equal(document.messages[$0].providedID, source)
        }
        let segments = document.messages.indices.filter {
            let row = document.messages[$0]
            return row.historyEpoch == epoch && row.role == .assistant && !row.local
                && equal(row.runID, update.runID) && equal(row.segmentID, update.segmentID)
        }
        guard sources.count <= 1, segments.count <= 1 else { return .rejected }
        if let source = sources.first, let segment = segments.first, source != segment { return .rejected }
        let index: Int
        if let existing = sources.first ?? segments.first {
            let row = document.messages[existing]
            guard row.role == .assistant, !row.local, row.idSource != .ambiguousProvided,
                  row.liveSnapshotState != .terminal,
                  row.streaming || row.liveSnapshotState == .active || row.liveSnapshotState == .historyActive,
                  compatible(row.runID, update.runID), compatible(row.segmentID, update.segmentID),
                  compatible(row.turnID, update.turnID), compatible(row.inputMessageID, update.inputMessageID),
                  compatible(row.inputMessageKey, update.inputMessageKey), compatible(row, metadata) else { return .rejected }
            if !sources.isEmpty, row.idSource != .provided { return .rejected }
            index = existing
        } else {
            guard let id = freshID(document, newID: newID) else { return .rejected }
            document.messages.append(.init(id: id, role: .assistant, text: "", streaming: true, historyEpoch: epoch))
            index = document.messages.count - 1
        }
        // Only this accepted current-wire snapshot promotes a history-active
        // row. The source match and a head activity flag alone do not do so.
        document.messages[index].text = update.text
        document.messages[index].runID = update.runID
        document.messages[index].segmentID = update.segmentID
        document.messages[index].turnID = update.turnID ?? document.messages[index].turnID
        document.messages[index].inputMessageID = update.inputMessageID ?? document.messages[index].inputMessageID
        document.messages[index].inputMessageKey = update.inputMessageKey ?? document.messages[index].inputMessageKey
        document.messages[index].sourceRevisionHash = nil
        document.messages[index].liveSnapshotState = .active
        document.messages[index].streaming = true
        apply(metadata, to: &document.messages[index])
        return .accepted
    }

    /// Returns the exact final assistant row for attachments. Never choose the
    /// last paragraph merely because it has the same run ID.
    static func finish(runID: String, segmentID: String, metadata: RuntimeFinalMessageMetadata?,
                       notice: RuntimeTerminalNotice?, hasAttachments: Bool, in document: inout NativeConversation,
                       epoch: UUID?, newID: () -> String = { UUID().uuidString }) -> String? {
        if let metadata, !metadata.hasConflictingLineage, let source = metadata.providedID,
           !source.isEmpty, source.utf8.count <= 4_096 {
            _ = rememberSourceContradiction(source, role: metadata.role, runID: runID, metadata: metadata, in: &document, epoch: epoch)
        }
        let matches = document.messages.indices.filter {
            let row = document.messages[$0]
            return row.historyEpoch == epoch && row.role == .assistant && !row.local
                && (row.streaming || row.liveSnapshotState == .active && row.idSource == .provided)
                && equal(row.runID, runID) && equal(row.segmentID, segmentID)
        }
        var assistantIndex: Int?
        let canBind = metadata.map { $0.role == .assistant && !$0.hasConflictingLineage } ?? true
        if canBind && matches.count == 1 { assistantIndex = matches[0] }
        else if canBind && matches.isEmpty, let metadata, let source = metadata.providedID {
            let sources = document.messages.indices.filter {
                let row = document.messages[$0]
                return row.historyEpoch == epoch && equal(row.providedID, source)
            }
            if sources.count == 1, let index = sources.first {
                let row = document.messages[index]
                if row.role == .assistant, !row.local, row.idSource == .provided,
                   compatible(row.runID, runID), compatible(row.segmentID, segmentID), compatible(row, metadata) {
                    assistantIndex = index
                }
            } else if sources.isEmpty, hasAttachments, let id = freshID(document, newID: newID) {
                document.messages.append(.init(id: id, role: .assistant, text: "", runID: runID, segmentID: segmentID, historyEpoch: epoch))
                assistantIndex = document.messages.count - 1
            }
        } else if canBind && matches.isEmpty && hasAttachments, let id = freshID(document, newID: newID) {
            document.messages.append(.init(id: id, role: .assistant, text: "", runID: runID, segmentID: segmentID, historyEpoch: epoch))
            assistantIndex = document.messages.count - 1
        }
        if let index = assistantIndex, let metadata, metadata.role == .assistant {
            if compatible(document.messages[index], metadata) {
                document.messages[index].runID = document.messages[index].runID ?? runID
                document.messages[index].segmentID = document.messages[index].segmentID ?? segmentID
                apply(metadata, to: &document.messages[index])
                if let id = document.messages[index].providedID {
                    markAmbiguous(id, in: &document, epoch: epoch)
                    if document.messages[index].idSource == .ambiguousProvided { assistantIndex = nil }
                }
            } else { assistantIndex = nil }
        }
        if let index = assistantIndex { document.messages[index].liveSnapshotState = .terminal }
        if let notice {
            let existing = notice.providedID.map { id in document.messages.indices.filter {
                let message = document.messages[$0]
                return message.historyEpoch == epoch && message.role == .system && !message.local && message.attribution == nil
                    && equal(message.providedID, id) && (message.runID == nil || equal(message.runID, runID))
            } } ?? []
            if existing.count == 1 {
                let index = existing[0]
                document.messages[index].text = notice.text; document.messages[index].runID = runID
                document.messages[index].timestampMs = notice.timestampMs ?? document.messages[index].timestampMs
            } else if let id = freshID(document, newID: newID) {
                document.messages.append(.init(id: id, remoteID: notice.providedID, role: .system, text: notice.text,
                    runID: runID, timestampMs: notice.timestampMs, providedID: notice.providedID,
                    idSource: notice.providedID == nil ? .synthetic : .provided, historyEpoch: epoch))
                if let source = notice.providedID { markAmbiguous(source, in: &document, epoch: epoch) }
            }
        }
        for index in document.messages.indices where document.messages[index].historyEpoch == epoch && equal(document.messages[index].runID, runID) {
            document.messages[index].streaming = false
            if document.messages[index].liveSnapshotState != nil { document.messages[index].liveSnapshotState = .terminal }
        }
        return assistantIndex.map { document.messages[$0].id }
    }

    private static func compatible(_ row: NativeMessage, _ metadata: RuntimeFinalMessageMetadata) -> Bool {
        compatible(row.providedID, metadata.providedID) && compatible(row.turnID, metadata.turnID)
            && compatible(row.inputMessageID, metadata.inputMessageID) && compatible(row.inputMessageKey, metadata.inputMessageKey)
            && (row.attribution == nil || metadata.attribution == nil || row.attribution == metadata.attribution)
            && (row.transcriptPosition == nil || metadata.transcriptPosition == nil || row.transcriptPosition == metadata.transcriptPosition)
    }

    private static func apply(_ metadata: RuntimeFinalMessageMetadata, to row: inout NativeMessage) {
        row.providedID = metadata.providedID ?? row.providedID
        if let id = row.providedID {
            row.remoteID = id
            if row.idSource != .ambiguousProvided { row.idSource = .provided }
        }
        row.timestampMs = metadata.timestampMs ?? row.timestampMs
        row.attribution = metadata.attribution ?? row.attribution
        row.transcriptPosition = metadata.transcriptPosition ?? row.transcriptPosition
        row.transcriptBoundary = metadata.transcriptBoundary ?? row.transcriptBoundary
        row.turnID = metadata.turnID ?? row.turnID
        row.inputMessageID = metadata.inputMessageID ?? row.inputMessageID
        row.inputMessageKey = metadata.inputMessageKey ?? row.inputMessageKey
    }

    private static func segment(_ run: String, _ segment: String, in document: NativeConversation, epoch: UUID?) -> [Int] {
        document.messages.indices.filter {
            let message = document.messages[$0]
            return message.historyEpoch == epoch && message.role == .assistant && !message.local && message.streaming
                && equal(message.runID, run) && equal(message.segmentID, segment)
        }
    }
    private static func markAmbiguous(_ id: String, in document: inout NativeConversation, epoch: UUID?) {
        let matches = document.messages.indices.filter { document.messages[$0].historyEpoch == epoch && equal(document.messages[$0].providedID, id) }
        var memory = document.sourceAmbiguity?.scoped(to: epoch) ?? .init(epoch: epoch)
        if matches.count > 1 { memory.remember(id) }
        if memory.rejects(id) {
            for index in matches { document.messages[index].idSource = .ambiguousProvided }
            document.sourceAmbiguity = memory
        }
    }

    @discardableResult
    private static func rememberSourceContradiction(_ source: String, role: RuntimeMessage.Role, runID: String,
                                                    metadata: RuntimeFinalMessageMetadata,
                                                    in document: inout NativeConversation, epoch: UUID?) -> Bool {
        let matches = document.messages.indices.filter {
            let row = document.messages[$0]
            return row.historyEpoch == epoch && equal(row.providedID, source)
                && (row.idSource == .provided || row.idSource == .ambiguousProvided)
        }
        let contradiction = matches.count > 1 || matches.contains { index in
            let row = document.messages[index]
            return row.idSource == .ambiguousProvided || row.role != role || different(row.runID, runID)
                || different(row.turnID, metadata.turnID) || different(row.inputMessageID, metadata.inputMessageID)
                || different(row.inputMessageKey, metadata.inputMessageKey)
                || (row.transcriptPosition != nil && metadata.transcriptPosition != nil && row.transcriptPosition != metadata.transcriptPosition)
                || attributionContradicts(row.attribution, metadata.attribution)
        }
        guard contradiction else { return false }
        var memory = document.sourceAmbiguity?.scoped(to: epoch) ?? .init(epoch: epoch)
        memory.remember(source)
        var changed = document.sourceAmbiguity != memory
        document.sourceAmbiguity = memory
        for index in matches where document.messages[index].idSource != .ambiguousProvided {
            document.messages[index].idSource = .ambiguousProvided; changed = true
        }
        return changed
    }

    private static func attributionContradicts(_ left: RuntimeMessageAttribution?, _ right: RuntimeMessageAttribution?) -> Bool {
        guard let left, let right else { return false }
        return different(left.channel, right.channel) || different(left.accountID, right.accountID)
            || different(left.sender?.id, right.sender?.id)
    }
    private static func different(_ left: String?, _ right: String?) -> Bool { left != nil && right != nil && !equal(left, right) }
    private static func freshID(_ document: NativeConversation, newID: () -> String) -> String? {
        let id = newID()
        guard !id.isEmpty, id.utf8.count <= 1_024, !document.messages.contains(where: { $0.id == id }) else { return nil }
        return id
    }
    private static func compatible(_ left: String?, _ right: String?) -> Bool { left == nil || right == nil || equal(left, right) }
    private static func equal(_ left: String?, _ right: String?) -> Bool {
        switch (left, right) {
        case (nil, nil): true
        case let (left?, right?): left.utf8.elementsEqual(right.utf8)
        default: false
        }
    }
}
