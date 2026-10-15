import ClawketRuntime
import Foundation

/// The current host route supplies its epoch. Run/segment pairs identify
/// display segments only; this reducer grants no wire or outbox authority.
enum NativeLiveMessages {
    static func text(_ update: RuntimeTextUpdate, in document: inout NativeConversation, epoch: UUID?,
                     newID: () -> String = { UUID().uuidString }) -> Bool {
        let matches = segment(update.runID, update.segmentID, in: document, epoch: epoch)
        guard matches.count <= 1 else { return false }
        if let index = matches.first {
            guard compatible(document.messages[index].turnID, update.turnID),
                  compatible(document.messages[index].inputMessageID, update.inputMessageID),
                  compatible(document.messages[index].inputMessageKey, update.inputMessageKey) else { return false }
            if update.mode == .delta { document.messages[index].text += update.text }
            else { document.messages[index].text = update.text }
            document.messages[index].sourceRevisionHash = nil
            document.messages[index].turnID = update.turnID ?? document.messages[index].turnID
            document.messages[index].inputMessageID = update.inputMessageID ?? document.messages[index].inputMessageID
            document.messages[index].inputMessageKey = update.inputMessageKey ?? document.messages[index].inputMessageKey
        } else {
            guard let id = freshID(document, newID: newID) else { return false }
            document.messages.append(.init(id: id, role: .assistant, text: update.text, runID: update.runID,
                segmentID: update.segmentID, streaming: true, historyEpoch: epoch,
                turnID: update.turnID, inputMessageID: update.inputMessageID, inputMessageKey: update.inputMessageKey))
        }
        return true
    }

    /// Returns the exact final assistant row for attachments. Never choose the
    /// last paragraph merely because it has the same run ID.
    static func finish(runID: String, segmentID: String, metadata: RuntimeFinalMessageMetadata?,
                       notice: RuntimeTerminalNotice?, hasAttachments: Bool, in document: inout NativeConversation,
                       epoch: UUID?, newID: () -> String = { UUID().uuidString }) -> String? {
        let matches = segment(runID, segmentID, in: document, epoch: epoch)
        var assistantIndex: Int?
        if matches.count == 1 { assistantIndex = matches[0] }
        else if matches.isEmpty && hasAttachments, let id = freshID(document, newID: newID) {
            document.messages.append(.init(id: id, role: .assistant, text: "", runID: runID, segmentID: segmentID, historyEpoch: epoch))
            assistantIndex = document.messages.count - 1
        }
        if let metadata, metadata.role != .assistant { assistantIndex = nil }
        if let index = assistantIndex, let metadata, metadata.role == .assistant {
            if compatible(document.messages[index].providedID, metadata.providedID),
               compatible(document.messages[index].turnID, metadata.turnID),
               compatible(document.messages[index].inputMessageID, metadata.inputMessageID),
               compatible(document.messages[index].inputMessageKey, metadata.inputMessageKey),
               document.messages[index].attribution == nil || metadata.attribution == nil
                 || document.messages[index].attribution == metadata.attribution,
               document.messages[index].transcriptPosition == nil || metadata.transcriptPosition == nil
                 || document.messages[index].transcriptPosition == metadata.transcriptPosition {
                document.messages[index].providedID = metadata.providedID ?? document.messages[index].providedID
                if let id = document.messages[index].providedID {
                    document.messages[index].remoteID = id; document.messages[index].idSource = .provided
                    markAmbiguous(id, in: &document, epoch: epoch)
                }
                document.messages[index].timestampMs = metadata.timestampMs ?? document.messages[index].timestampMs
                document.messages[index].attribution = metadata.attribution ?? document.messages[index].attribution
                document.messages[index].transcriptPosition = metadata.transcriptPosition ?? document.messages[index].transcriptPosition
                document.messages[index].transcriptBoundary = metadata.transcriptBoundary ?? document.messages[index].transcriptBoundary
                document.messages[index].turnID = metadata.turnID ?? document.messages[index].turnID
                document.messages[index].inputMessageID = metadata.inputMessageID ?? document.messages[index].inputMessageID
                document.messages[index].inputMessageKey = metadata.inputMessageKey ?? document.messages[index].inputMessageKey
            } else { assistantIndex = nil }
        }
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
        }
        return assistantIndex.map { document.messages[$0].id }
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
        if matches.count > 1 { for index in matches { document.messages[index].idSource = .ambiguousProvided } }
    }
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
