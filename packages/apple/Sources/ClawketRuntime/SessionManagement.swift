import Foundation
import ClawketTransport

extension RuntimeCoordinator {
    func validateNativeSessionInput(_ key: String, scope: Scope) throws {
        guard let backend = connection?.backendKind, [.hermes, .codex, .claudeCode, .pi].contains(backend),
              let row = catalog.first(where: { $0.key == key }) ?? sessionManagementState.archives.first(where: { $0.key == key }),
              row.source == "native" else { return }
        guard backend != .hermes, sessionManagementState.liveScope == scope, row.canContinue == true,
              row.archived != true, row.project?.available != false else { throw RuntimeFailure(.unsupported) }
        // Opaque unknown and freshly created owned keys retain their backend's final enforcement.
    }

    /// Uses only a row read during the current authentication. Cached/forged descriptors grant nothing.
    public func sessionManagement(sessionKey: String) throws -> RuntimeSessionManagement {
        let scope = try scope()
        let (session, revision) = try managementRow(sessionKey, scope: scope)
        let reference = sessionManagementState.issue(session, scope: scope, revision: revision)
        let writeState: RuntimeSessionManagement.WriteState
        switch sessionManagementState.writes[sessionKey] {
        case .pending: writeState = .pending
        case .uncertain: writeState = .uncertain
        case nil: writeState = .available
        }
        return RuntimeSessionManagement(reference: reference, session: session,
            allowedActions: writeState == .available ? managementActions(session) : [], writeState: writeState)
    }

    /// Archived rows remain separate from the live catalog. Request an action reference only for the selected row.
    public func listArchivedSessions() async throws -> [RuntimeSession] {
        let scope = try scope()
        guard connection?.backendKind == .codex, state.capabilities.sessionManagement?.archive == true else {
            throw RuntimeFailure(.unsupported)
        }
        guard sessionManagementState.archiveRead == nil else { throw RuntimeFailure(.requestBusy) }
        let id = UUID()
        sessionManagementState.archiveRead = id; sessionManagementState.archiveScope = nil
        sessionManagementState.archives = []; sessionManagementState.entries = [:]; sessionManagementState.order = []
        defer { if sessionManagementState.archiveRead == id { sessionManagementState.archiveRead = nil } }
        let payload = try await rpc("sessions.archived", scope: scope)
        guard sessionManagementState.archiveRead == id, let connection,
              state.capabilities.sessionManagement?.archive == true else { throw RuntimeFailure(.superseded) }
        guard let rows = payload.array, rows.count <= 10_000 else { throw RuntimeFailure(.invalidResponse) }
        var keys = Set<String>()
        let sessions = try rows.map { row in
            guard row["archived"]?.boolValue == true else { throw RuntimeFailure(.invalidResponse) }
            let session = try WireModels.session(row, connection: connection, legacyActivity: true, archivedList: true)
            guard keys.insert(session.key).inserted else { throw RuntimeFailure(.invalidResponse) }
            return session
        }
        sessionManagementState.archives = sessions; sessionManagementState.archiveScope = scope
        sessionManagementState.archiveRevision = UUID()
        return sessions
    }

    public func renameSession(reference: RuntimeSessionReference, title: String) async throws -> RuntimeSessionMutationReceipt {
        let entry = try managementEntry(reference, action: .rename)
        let title = try managementTitle(title, backend: connection!.backendKind)
        guard title != entry.session.title else { throw RuntimeFailure(.invalidAnswer) }
        return try await mutateSession(entry, action: .rename, title: title)
    }

    public func resetSession(reference: RuntimeSessionReference) async throws -> RuntimeSessionMutationReceipt {
        try await mutateSession(managementEntry(reference, action: .reset), action: .reset)
    }

    public func deleteSession(reference: RuntimeSessionReference) async throws -> RuntimeSessionMutationReceipt {
        try await mutateSession(managementEntry(reference, action: .delete), action: .delete)
    }

    public func archiveSession(reference: RuntimeSessionReference, archived: Bool) async throws -> RuntimeSessionMutationReceipt {
        let action: RuntimeSessionAction = archived ? .archive : .unarchive
        return try await mutateSession(managementEntry(reference, action: action), action: action)
    }

    /// A native copy inherits its source project. There is deliberately no project/path override.
    public func branchSession(reference: RuntimeSessionReference, title: String? = nil) async throws -> RuntimeSession {
        let entry = try managementEntry(reference, action: .branch)
        let title = try title.map { try managementTitle($0, backend: connection!.backendKind) }
        let existingKeys = Set(catalog.map(\.key) + sessionManagementState.archives.map(\.key))
        try beginSessionWrite(entry, action: .branch)
        do {
            var params: [String: JSONValue] = ["fromSession": .string(entry.session.key)]
            if let title { params["title"] = .string(title) }
            let payload = try await rpc("sessions.create", params: .object(params), scope: entry.scope)
            guard let connection else { throw RuntimeFailure(.superseded, delivery: .responseReceived) }
            let session: RuntimeSession
            do {
                session = try WireModels.session(payload["session"] ?? payload, connection: connection, legacyActivity: !hasHumanActivityClock)
                guard !existingKeys.contains(session.key), session.source == "bridge", session.agentID == entry.session.agentID,
                      session.archived != true, session.project?.available != false,
                      entry.session.project == nil || (session.project?.id == entry.session.project?.id
                          && session.project?.path == entry.session.project?.path) else {
                    throw RuntimeFailure(.invalidResponse)
                }
            } catch { throw RuntimeFailure(.invalidResponse, delivery: .responseReceived) }
            try finishSessionWrite(entry, action: .branch)
            catalog.removeAll { $0.key == session.key }; catalog.insert(session, at: 0)
            emit(.update(connectionID: connection.id, .sessionMetadata(session)))
            return session
        } catch { throw failSessionWrite(entry, error: error) }
    }

    func managementRow(_ key: String, scope: Scope) throws -> (RuntimeSession, UUID) {
        let live = sessionManagementState.liveScope == scope ? catalog.first { $0.key == key } : nil
        let archived = sessionManagementState.archiveScope == scope ? sessionManagementState.archives.first { $0.key == key } : nil
        guard !(live != nil && archived != nil), let session = live ?? archived else { throw RuntimeFailure(.requestUnavailable) }
        return (session, live != nil ? sessionManagementState.liveRevision : sessionManagementState.archiveRevision)
    }

    func managementActions(_ session: RuntimeSession) -> Set<RuntimeSessionAction> {
        guard let connection, let capabilities = state.capabilities.sessionManagement else { return [] }
        let active = session.hasActiveRun || sessionEvents.runs.values.contains { $0.sessionKey == session.key && !$0.terminal }
        return SessionManagementPolicy.actions(session, backend: connection.backendKind, capabilities: capabilities, active: active)
    }

    private func managementEntry(_ reference: RuntimeSessionReference, action: RuntimeSessionAction) throws -> SessionManagementState.Entry {
        let scope = try scope()
        guard let entry = sessionManagementState.entries[reference.token], entry.scope == scope else { throw RuntimeFailure(.requestUnavailable) }
        let (session, revision) = try managementRow(entry.session.key, scope: scope)
        guard revision == entry.revision, session == entry.session else { throw RuntimeFailure(.requestUnavailable) }
        guard sessionManagementState.writes[session.key] == nil else { throw RuntimeFailure(.requestBusy) }
        guard managementActions(session).contains(action) else { throw RuntimeFailure(.unsupported) }
        return entry
    }

    private func beginSessionWrite(_ entry: SessionManagementState.Entry, action: RuntimeSessionAction) throws {
        try assertCurrent(entry.scope)
        _ = try managementEntry(entry.reference, action: action)
        guard !Task.isCancelled else { throw RuntimeFailure(.superseded) }
        guard sessionManagementState.writes.count < 256,
              sessionManagementState.writes.values.filter({ if case .pending = $0 { true } else { false } }).count < 32 else {
            throw RuntimeFailure(.capacity)
        }
        sessionManagementState.invalidate(entry.session.key)
        sessionManagementState.writes[entry.session.key] = .pending(entry.reference.token)
        retireModelControls(sessionKey: entry.session.key, modelMayChange: action == .reset || action == .delete)
        // Retire older read completions before the first possible write dispatch.
        catalogTask?.cancel(); catalogTask = nil; catalogTaskID = UUID()
        if historyTasks[entry.session.key] != nil { historyRevisions[entry.session.key] = UUID() }
        historyTasks[entry.session.key]?.cancel()
    }

    private func mutateSession(_ entry: SessionManagementState.Entry, action: RuntimeSessionAction,
                               title: String? = nil) async throws -> RuntimeSessionMutationReceipt {
        guard let connection else { throw RuntimeFailure(.notConnected) }
        let gateway = [.openclaw, .hermes].contains(connection.backendKind)
        var params: [String: JSONValue] = [gateway ? "key" : "sessionKey": .string(entry.session.key)]
        let method: String
        switch action {
        case .rename:
            method = gateway ? "sessions.patch" : "sessions.rename"
            params[connection.backendKind == .openclaw ? "label" : "title"] = .string(title!)
        case .reset:
            method = "sessions.reset"
            if connection.backendKind == .openclaw { params["reason"] = .string("reset") }
        case .delete: method = "sessions.delete"
        case .archive, .unarchive:
            method = "sessions.archive"; params["archived"] = .bool(action == .archive)
        case .branch: throw RuntimeFailure(.unsupported)
        }
        try beginSessionWrite(entry, action: action)
        do {
            let response = try await rpc(method, params: .object(params), scope: entry.scope)
            // Historical Gateway ACKs omit ok/key; explicit false and a different target always reject.
            guard response.object != nil, response["ok"]?.boolValue == true || (gateway && response["ok"] == nil),
                  response["key"] == nil || response["key"]?.stringValue == entry.session.key else {
                throw RuntimeFailure(.invalidResponse, delivery: .responseReceived)
            }
            try finishSessionWrite(entry, action: action)
            return RuntimeSessionMutationReceipt(reference: entry.reference, connectionID: connection.id,
                sessionKey: entry.session.key, sessionID: entry.session.sessionID, action: action)
        } catch { throw failSessionWrite(entry, error: error) }
    }

    private func finishSessionWrite(_ entry: SessionManagementState.Entry, action: RuntimeSessionAction) throws {
        guard isCurrent(entry.scope) else { throw RuntimeFailure(.superseded, delivery: .responseReceived) }
        guard case .pending(let token) = sessionManagementState.writes[entry.session.key], token == entry.reference.token else {
            throw RuntimeFailure(.superseded, delivery: .responseReceived)
        }
        sessionManagementState.writes.removeValue(forKey: entry.session.key)
        sessionManagementState.invalidateRows()
        // A catalog read started while the write was pending may still contain its old row.
        // The host's post-ACK refresh must start a new RPC, never join that earlier task.
        catalogTask?.cancel(); catalogTask = nil; catalogTaskID = UUID()
        // No synthetic renamed/reset/deleted row: a later explicit refresh owns the result.
    }

    private func failSessionWrite(_ entry: SessionManagementState.Entry, error: any Error) -> RuntimeFailure {
        let failure = runtimeFailure(error)
        guard isCurrent(entry.scope) else { return RuntimeFailure(.superseded, delivery: failure.delivery) }
        guard case .pending(let token) = sessionManagementState.writes[entry.session.key],
              token == entry.reference.token else { return failure }
        if failure.delivery == .notDispatched || failure.delivery == .rejectedBeforeDispatch {
            sessionManagementState.writes.removeValue(forKey: entry.session.key)
            if let key = try? modelControlKey(entry.session.key) { modelControlsState.sessionModelChanges.remove(key) }
        } else { sessionManagementState.writes[entry.session.key] = .uncertain }
        return failure
    }

    private func managementTitle(_ value: String, backend: BackendKind) throws -> String {
        let title = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let limit = backend == .claudeCode ? 300 : 200
        guard !title.isEmpty, title.utf8.count <= 2_048,
              ![.codex, .claudeCode, .pi].contains(backend) || title.utf16.count <= limit else {
            throw RuntimeFailure(.invalidAnswer)
        }
        return title
    }

    func observeSessionManagement(_ update: RuntimeSessionUpdate) {
        if case .sessionMetadata(let session) = update {
            sessionManagementState.invalidate(session.key)
            if sessionManagementState.liveScope == (try? scope()), let index = catalog.firstIndex(where: { $0.key == session.key }) {
                catalog[index] = session
            }
        } else if case .other(let frame) = update, frame["event"]?.stringValue == "sessions.changed" {
            sessionManagementState.invalidateRows()
        }
    }
}
