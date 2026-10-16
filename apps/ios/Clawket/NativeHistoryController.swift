import ClawketRuntime
import ClawketUI
import Foundation
import Combine

struct NativeHistoryAccess: Sendable {
    var search = false
    var bulkExport = false
}

struct NativeHistoryExportContext: Equatable, Sendable {
    let route: ConversationID
    let activation: UUID
    let wire: UUID
    let selection: UUID
    let epoch: UUID?
    static func == (lhs: Self, rhs: Self) -> Bool {
        NativeHistoryScope(lhs.route) == NativeHistoryScope(rhs.route) && lhs.activation == rhs.activation &&
            lhs.wire == rhs.wire && lhs.selection == rhs.selection && lhs.epoch == rhs.epoch
    }
}

struct NativeHistoryExportRequest: Identifiable, Sendable {
    let id = UUID()
    let context: NativeHistoryExportContext
    let title: String
}

@MainActor
final class NativeHistoryController: ObservableObject {
    @Published private(set) var accessRevision = UUID()
    var upgrade: (UUID) -> Void = { _ in }
    func accessChanged() { accessRevision = UUID() }
    let saved: NativeSavedConversations
    let conversations: NativeConversationStore
    let media: NativeMediaController?
    private let runtime: RuntimeCoordinator
    private let exports: any NativeHistoryExportPreparing
    private let current: (NativeHistoryExportContext) -> Bool
    /// The entitlement integration supplies verified features. A missing provider
    /// leaves Pro search/bulk export unavailable without inventing a purchase state.
    let access: () -> NativeHistoryAccess

    init(saved: NativeSavedConversations, conversations: NativeConversationStore, media: NativeMediaController?,
         runtime: RuntimeCoordinator, exports: any NativeHistoryExportPreparing,
         current: @escaping (NativeHistoryExportContext) -> Bool,
         access: @escaping () -> NativeHistoryAccess = { .init() }) {
        self.saved = saved; self.conversations = conversations; self.media = media
        self.runtime = runtime; self.exports = exports; self.current = current; self.access = access
    }

    func load(_ request: NativeHistoryExportRequest) async throws -> NativePublicTranscript {
        let runtime = runtime
        return try await NativeHistoryExportLoader.load(key: request.context.route.sessionID, title: request.title) { [weak self] key, limit, cursor in
            guard await self?.isCurrent(request.context) == true else { throw NativeHistoryExportFailure.changed }
            let value = try await runtime.exportHistorySnapshot(key: key, limit: limit, cursor: cursor)
            guard await self?.isCurrent(request.context) == true else { throw NativeHistoryExportFailure.changed }
            return value
        }
    }

    func save(_ value: NativePublicTranscript, request: NativeHistoryExportRequest) async throws -> NativeSavedConversation {
        guard isCurrent(request.context) else { throw NativeHistoryExportFailure.changed }
        do { return try await saved.save(scope: .init(request.context.route), transcript: value) }
        catch NativeHistoryFailure.full { throw NativeSavedHistoryFailure.full }
    }

    func share(_ value: NativePublicTranscript, format: NativeHistoryExportFormat, loadedOnly: Bool = false) async throws -> NativeMediaShare {
        let file = try await exports.prepare(value, format: format,
            userLabel: String(localized: "User"), assistantLabel: String(localized: "Assistant"),
            loadedOnlyLabel: loadedOnly ? String(localized: "This copy includes only history loaded on this device.") : nil)
        return .init(url: file.url, shareLease: file.lease)
    }

    func share(_ value: NativePublicTranscript, request: NativeHistoryExportRequest,
               format: NativeHistoryExportFormat) async throws -> NativeMediaShare {
        guard isCurrent(request.context) else { throw NativeHistoryExportFailure.changed }
        let prepared = try await share(value, format: format)
        guard isCurrent(request.context) else {
            await prepared.releaseIfUnpresented()
            throw NativeHistoryExportFailure.changed
        }
        return prepared
    }

    func sharePhysical(_ conversation: NativeConversation, title: String, format: NativeHistoryExportFormat) async throws -> NativeMediaShare {
        let file = try await exports.preparePhysical(conversation, title: title, format: format,
            userLabel: String(localized: "User"), assistantLabel: String(localized: "Assistant"),
            loadedOnlyLabel: String(localized: "This copy includes only history loaded on this device."))
        return .init(url: file.url, shareLease: file.lease)
    }

    func shareAll(_ ids: [String]) async throws -> NativeMediaShare {
        guard access().bulkExport else { throw NativeHistoryFailure.unavailable }
        let values = try await saved.conversations(ids)
        try Task.checkCancellation()
        guard access().bulkExport else { throw NativeHistoryFailure.unavailable }
        let file = try await exports.prepareBulk(values)
        let share = NativeMediaShare(url: file.url, shareLease: file.lease)
        guard !Task.isCancelled, access().bulkExport else {
            await share.releaseIfUnpresented(); throw NativeHistoryFailure.unavailable
        }
        return share
    }

    func cachedPreview(_ reference: NativeMediaReference, scope: NativeHistoryScope, historyEpoch: UUID? = nil) async throws -> NativeMediaPreview {
        guard let media else { throw NativeHistoryFailure.unavailable }
        // Persisted artifact/session IDs are display context, never wire authority.
        let resource = try await media.resolve(reference, route: scope.route, runtime: nil, historyEpoch: historyEpoch)
        try Task.checkCancellation()
        let display = try await media.display(resource.id, input: reference.artifactID == nil)
        try Task.checkCancellation()
        return try await NativeMediaPreview.create(display: display, library: media.library)
    }

    private func isCurrent(_ context: NativeHistoryExportContext) -> Bool { !Task.isCancelled && current(context) }

    static func failureText(_ error: Error) -> String {
        if error is NativeSavedHistoryFailure { return String(localized: "Saved conversations are full.") }
        if let failure = error as? NativeHistoryExportFailure {
            switch failure {
            case .changed: return String(localized: "Conversation changed. Try again.")
            case .running: return String(localized: "Wait until the task finishes.")
            case .tooLarge: return String(localized: "Conversation is too large to export.")
            case .timedOut: return String(localized: "The operation could not be completed. Please try again.")
            }
        }
        switch error as? NativeHistoryFailure {
        case .full: return String(localized: "History storage is full. Your current conversation has been kept.")
        case .commitUncertain: return String(localized: "The saved copy could not be confirmed. Reopen the app before trying again.")
        default: return String(localized: "Saved history could not be opened. Your stored data has been preserved.")
        }
    }
}
