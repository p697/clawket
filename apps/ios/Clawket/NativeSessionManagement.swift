import ClawketRuntime
import ClawketUI
import Foundation

protocol NativeSessionRuntime: Sendable {
    func sessionManagement(sessionKey: String) async throws -> RuntimeSessionManagement
    func listArchivedSessions() async throws -> [RuntimeSession]
    func renameSession(reference: RuntimeSessionReference, title: String) async throws -> RuntimeSessionMutationReceipt
    func resetSession(reference: RuntimeSessionReference) async throws -> RuntimeSessionMutationReceipt
    func deleteSession(reference: RuntimeSessionReference) async throws -> RuntimeSessionMutationReceipt
    func archiveSession(reference: RuntimeSessionReference, archived: Bool) async throws -> RuntimeSessionMutationReceipt
    func branchSession(reference: RuntimeSessionReference, title: String?) async throws -> RuntimeSession
    func refreshRoster() async throws -> RuntimeRoster
}
extension RuntimeCoordinator: NativeSessionRuntime {}

struct NativeSessionHostContext: Equatable, Sendable {
    let activation: UUID
    let wire: UUID
    let selection: UUID
    func sameConnection(as other: Self) -> Bool { activation == other.activation && wire == other.wire }
}

/// Ephemeral callback context. Never persist a reference or use it as a diagnostic ID.
struct NativeSessionMutationTarget: Sendable {
    let id: UUID
    let route: ConversationID
    let previousSessionID: String?
    let action: SessionLifecycleAction
    let reference: RuntimeSessionReference
    let host: NativeSessionHostContext
}

enum NativeSessionMutationOutcome: Sendable {
    case acknowledged(NativeSessionMutationTarget, roster: RuntimeRoster?, created: RuntimeSession?)
    case notDispatched(NativeSessionMutationTarget)
    case uncertain(NativeSessionMutationTarget)
}

/// Owns a selected row's current authority. Views only retain opaque review/confirmation IDs.
@MainActor
final class NativeSessionManagement {
    private struct Authority {
        let id: UUID
        let route: ConversationID
        let value: RuntimeSessionManagement
        let host: NativeSessionHostContext
        let scope: UUID
    }
    private struct Confirmation {
        let id: UUID
        let authority: Authority
        let action: SessionLifecycleAction
    }
    private let presentation: ClientPresentation
    private let runtime: any NativeSessionRuntime
    private let context: @MainActor () -> NativeSessionHostContext
    private let prepare: @MainActor (NativeSessionMutationTarget) async throws -> Void
    private let outcome: @MainActor (NativeSessionMutationOutcome) -> Void
    private let onChange: @MainActor () -> Void
    private var connectionID: String?
    private var backend: BackendKind?
    private var ready = false
    private var scope = UUID()
    private var authority: Authority?
    private var confirmation: Confirmation?
    private var operations: [ConversationID: UUID] = [:]
    private var operationActions: [ConversationID: SessionLifecycleAction] = [:]
    private var blocked: Set<ConversationID> = []
    private var blockedInput: Set<ConversationID> = []
    private var awaitingFresh: [ConversationID: (NativeSessionMutationTarget, RuntimeSession?)] = [:]

    init(presentation: ClientPresentation, runtime: any NativeSessionRuntime,
         context: @escaping @MainActor () -> NativeSessionHostContext,
         prepare: @escaping @MainActor (NativeSessionMutationTarget) async throws -> Void,
         outcome: @escaping @MainActor (NativeSessionMutationOutcome) -> Void,
         onChange: @escaping @MainActor () -> Void) {
        self.presentation = presentation; self.runtime = runtime; self.context = context
        self.prepare = prepare; self.outcome = outcome; self.onChange = onChange
    }

    func invalidate() {
        ready = false; scope = UUID(); authority = nil; confirmation = nil
        // Operations already submitted are never replayed. Their captured scope cannot publish late UI.
        operations = [:]; operationActions = [:]; blocked = []; blockedInput = []; awaitingFresh = [:]
        if var review = presentation.sessionManagement {
            review.phase = .unavailable; review.actions = []; review.submittingAction = nil
            review.confirmation = nil; review.error = String(localized: "Reconnect and reopen conversation actions.")
            presentation.sessionManagement = review
        }
    }

    func update(_ state: RuntimeConnectionState) {
        if connectionID != state.connectionID || ready && state.phase != .ready { invalidate() }
        connectionID = state.connectionID; backend = state.backendKind; ready = state.phase == .ready
    }

    func permitsInput(_ route: ConversationID) -> Bool {
        operationActions[route].map(Self.blocksInput) != true && !blockedInput.contains(route)
    }
    func isMutating(_ route: ConversationID) -> Bool { operations[route] != nil }

    func catalogChanged(sessionKey: String? = nil) {
        guard let current = authority, operations[current.route] == nil,
              sessionKey == nil || sessionKey == current.route.sessionID else { return }
        failReview(current.id, text: String(localized: "Conversation details changed. Close this sheet and review them again."))
    }

    /// Only a read initiated after these ACKs can complete their deferred display effects.
    /// An arbitrary roster event may have returned before the write and arrived late on MainActor.
    func refreshAcknowledged() {
        guard ready, !awaitingFresh.isEmpty else { return }
        let captured = scope, host = context(), pending = awaitingFresh
        Task {
            guard isCurrent(captured, host: host) else { return }
            guard let roster = try? await runtime.refreshRoster(), isCurrent(captured, host: host),
                  roster.connectionID == connectionID else { return }
            for (route, value) in pending where awaitingFresh[route]?.0.id == value.0.id {
                awaitingFresh.removeValue(forKey: route); blocked.remove(route); blockedInput.remove(route)
                outcome(.acknowledged(value.0, roster: roster, created: value.1))
            }
            onChange()
        }
    }

    func open(_ route: ConversationID, id: UUID) {
        guard ready, route.isConcrete, route.connectionID == connectionID else { return }
        authority = nil; confirmation = nil
        presentation.sessionManagement = .init(id: id, route: route, title: String(localized: "Conversation"))
        let captured = scope, host = context()
        Task {
            guard isCurrent(captured, host: host), presentation.sessionManagement?.id == id else { return }
            do {
                let value = try await runtime.sessionManagement(sessionKey: route.sessionID)
                guard isCurrent(captured, host: host), presentation.sessionManagement?.id == id,
                      value.session.connectionID == route.connectionID, value.session.agentID == route.agentID,
                      value.session.key == route.sessionID else { return }
                let current = Authority(id: id, route: route, value: value, host: host, scope: captured)
                authority = current
                let actions = Set(value.allowedActions.map(Self.presentationAction))
                let waitingForRead = awaitingFresh[route] != nil
                let uncertain = value.writeState == .uncertain || (blocked.contains(route) && !waitingForRead)
                let errorText: String?
                if waitingForRead { errorText = String(localized: "Change confirmed. Refresh conversations to see the latest state.") }
                else if uncertain { errorText = String(localized: "The change could not be confirmed. Reconnect and review this conversation.") }
                else { errorText = nil }
                let titleLimit: Int? = (backend == .codex || backend == .pi) ? 200 : backend == .claudeCode ? 300 : nil
                presentation.sessionManagement = .init(id: id, route: route, title: value.session.title,
                    phase: waitingForRead ? .unavailable : .ready, actions: waitingForRead ? [] : actions, isUncertain: uncertain,
                    error: errorText, maximumTitleUTF16: titleLimit)
            } catch {
                guard isCurrent(captured, host: host), presentation.sessionManagement?.id == id else { return }
                failReview(id, text: awaitingFresh[route] != nil
                    ? String(localized: "Change confirmed. Refresh conversations to see the latest state.")
                    : String(localized: "Conversation actions could not be loaded. Close this sheet and try again."))
            }
        }
    }

    func dismiss(_ id: UUID) {
        guard presentation.sessionManagement?.id == id else { return }
        presentation.sessionManagement = nil
        if authority?.id == id { authority = nil }; confirmation = nil
    }

    func request(_ id: UUID, action: SessionLifecycleAction) {
        guard let current = actionable(id, action: action), action != .rename else { return }
        if action.requiresConfirmation {
            let frozen = Confirmation(id: UUID(), authority: current, action: action)
            confirmation = frozen
            presentation.sessionManagement?.confirmation = .init(id: frozen.id, reviewID: id, action: action)
        } else { submit(current, action: action, title: nil) }
    }

    func rename(_ id: UUID, title: String) {
        guard let current = actionable(id, action: .rename),
              let title = presentation.sessionManagement?.validatedTitle(title) else { return }
        submit(current, action: .rename, title: title)
    }

    func confirm(_ id: UUID) {
        guard let frozen = confirmation, frozen.id == id,
              let current = actionable(frozen.authority.id, action: frozen.action),
              current.value.reference == frozen.authority.value.reference else { return }
        // Consume synchronously before any Task; a following dismissal cannot retarget or cancel this decision.
        confirmation = nil; presentation.sessionManagement?.confirmation = nil
        submit(frozen.authority, action: frozen.action, title: nil)
    }

    func dismissConfirmation(_ id: UUID) {
        guard confirmation?.id == id else { return }
        confirmation = nil; presentation.sessionManagement?.confirmation = nil
    }

    private func actionable(_ id: UUID, action: SessionLifecycleAction) -> Authority? {
        guard let value = authority, value.id == id, isCurrent(value.scope, host: value.host),
              presentation.sessionManagement?.id == id, presentation.sessionManagement?.permits(action) == true,
              value.value.writeState == .available, value.value.allowedActions.contains(Self.runtimeAction(action)),
              operations[value.route] == nil, !blocked.contains(value.route) else { return nil }
        return value
    }

    private func submit(_ value: Authority, action: SessionLifecycleAction, title: String?) {
        guard actionable(value.id, action: action) != nil else { return }
        let target = NativeSessionMutationTarget(id: UUID(), route: value.route,
            previousSessionID: value.value.session.sessionID, action: action,
            reference: value.value.reference, host: value.host)
        operations[target.route] = target.id
        operationActions[target.route] = action
        presentation.sessionManagement?.submittingAction = action
        confirmation = nil; presentation.sessionManagement?.confirmation = nil
        onChange()
        Task {
            var acknowledged = false
            var wireEntered = false
            do {
                guard isCurrent(value.scope, host: value.host), operations[target.route] == target.id else { return }
                try await prepare(target)
                guard isCurrent(value.scope, host: value.host), operations[target.route] == target.id else { return }
                let created: RuntimeSession?
                wireEntered = true
                if action == .branch {
                    created = try await runtime.branchSession(reference: target.reference, title: nil)
                    guard let created, !created.key.isEmpty, created.key != target.route.sessionID,
                          created.connectionID == target.route.connectionID, created.agentID == target.route.agentID,
                          created.source == "bridge", created.archived != true else {
                        throw RuntimeFailure(.invalidResponse, delivery: .responseReceived)
                    }
                } else {
                    let receipt: RuntimeSessionMutationReceipt
                    switch action {
                    case .rename: receipt = try await runtime.renameSession(reference: target.reference, title: title!)
                    case .reset: receipt = try await runtime.resetSession(reference: target.reference)
                    case .delete: receipt = try await runtime.deleteSession(reference: target.reference)
                    case .archive, .restore: receipt = try await runtime.archiveSession(reference: target.reference, archived: action == .archive)
                    case .branch: return
                    }
                    guard receipt.reference == target.reference, receipt.connectionID == target.route.connectionID,
                          receipt.sessionKey == target.route.sessionID, receipt.sessionID == target.previousSessionID,
                          receipt.action == Self.runtimeAction(action) else {
                        throw RuntimeFailure(.invalidResponse, delivery: .responseReceived)
                    }
                    created = nil
                }
                acknowledged = true
                guard isCurrent(value.scope, host: value.host), operations[target.route] == target.id else { return }
                let roster: RuntimeRoster?
                do { roster = try await runtime.refreshRoster() } catch { roster = nil }
                guard isCurrent(value.scope, host: value.host), operations[target.route] == target.id else { return }
                operations.removeValue(forKey: target.route)
                operationActions.removeValue(forKey: target.route)
                if roster == nil {
                    blocked.insert(target.route); awaitingFresh[target.route] = (target, created)
                    if Self.blocksInput(action) { blockedInput.insert(target.route) }
                }
                outcome(.acknowledged(target, roster: roster, created: created))
                if presentation.sessionManagement?.id == value.id {
                    if roster != nil { dismiss(value.id) }
                    else { failReview(value.id, text: String(localized: "Change confirmed. Refresh conversations to see the latest state.")) }
                }
            } catch {
                guard isCurrent(value.scope, host: value.host), operations[target.route] == target.id else { return }
                operations.removeValue(forKey: target.route)
                operationActions.removeValue(forKey: target.route)
                let delivery = (error as? RuntimeFailure)?.delivery
                let uncertain = acknowledged || delivery == .uncertain || delivery == .responseReceived || (wireEntered && delivery == nil)
                if uncertain {
                    blocked.insert(target.route)
                    if Self.blocksInput(action) { blockedInput.insert(target.route) }
                    outcome(.uncertain(target))
                }
                else { outcome(.notDispatched(target)) }
                if presentation.sessionManagement?.id == value.id {
                    failReview(value.id, text: uncertain
                        ? String(localized: "The change could not be confirmed. Reconnect and review this conversation.")
                        : String(localized: "The conversation could not be changed. Close this sheet and try again."), uncertain: uncertain)
                }
            }
            onChange()
        }
    }

    private func failReview(_ id: UUID, text: String, uncertain: Bool = false) {
        guard presentation.sessionManagement?.id == id else { return }
        authority = nil; confirmation = nil
        presentation.sessionManagement?.phase = .unavailable
        presentation.sessionManagement?.actions = []; presentation.sessionManagement?.submittingAction = nil
        presentation.sessionManagement?.confirmation = nil; presentation.sessionManagement?.error = text
        presentation.sessionManagement?.isUncertain = uncertain
    }

    private func isCurrent(_ captured: UUID, host: NativeSessionHostContext) -> Bool {
        ready && scope == captured && host.sameConnection(as: context())
    }
    nonisolated private static func blocksInput(_ action: SessionLifecycleAction) -> Bool {
        [.reset, .delete, .archive, .restore].contains(action)
    }
    nonisolated private static func runtimeAction(_ action: SessionLifecycleAction) -> RuntimeSessionAction {
        switch action {
        case .rename: .rename
        case .reset: .reset
        case .delete: .delete
        case .archive: .archive
        case .restore: .unarchive
        case .branch: .branch
        }
    }
    nonisolated private static func presentationAction(_ action: RuntimeSessionAction) -> SessionLifecycleAction {
        switch action {
        case .rename: .rename
        case .reset: .reset
        case .delete: .delete
        case .archive: .archive
        case .unarchive: .restore
        case .branch: .branch
        }
    }
}

extension NativeConversation {
    /// A destructive remote update never consumes the composer's draft or dispatches the outbox.
    mutating func holdForSessionMutation() throws -> Bool {
        guard !messages.contains(where: { $0.delivery == .sending }) else { throw RuntimeFailure(.requestBusy) }
        var changed = false
        for index in messages.indices where messages[index].local && messages[index].delivery == .queued {
            messages[index].delivery = .held; changed = true
        }
        if changed { revision += 1 }
        return changed
    }
}
