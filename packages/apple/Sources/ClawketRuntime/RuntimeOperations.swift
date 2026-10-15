import Foundation
import ClawketTransport

extension RuntimeCoordinator {
    public func refreshRoster() async throws -> RuntimeRoster {
        let scope = try scope(), id: UUID, task: Task<RuntimeRoster, any Error>
        if let pending = catalogTask { id = catalogTaskID; task = pending }
        else {
            sessionManagementState.invalidateRows()
            id = UUID(); catalogTaskID = id
            task = Task { [weak self] in
                guard let self else { throw RuntimeFailure(.superseded) }
                return try await self.readRoster(scope: scope)
            }
            catalogTask = task
        }
        do {
            let value = try await task.value
            try assertCurrent(scope)
            guard catalogTaskID == id else { throw RuntimeFailure(.superseded) }
            if catalogTaskID == id { catalogTask = nil }
            catalog = value.sessions
            sessionManagementState.liveScope = scope; sessionManagementState.liveRevision = UUID()
            if connection?.backendKind == .openclaw, !sessionMethodsAdvertised,
               state.capabilities.sessionManagement?.rename != true { publishState(.ready) }
            emit(.roster(value), weight: value.sessions.reduce(128) { $0 + ((try? FrameCodec.encode($1.raw).utf8.count) ?? 128) })
            return value
        } catch {
            if catalogTaskID == id { catalogTask = nil }
            throw runtimeFailure(error)
        }
    }

    func readRoster(scope: Scope) async throws -> RuntimeRoster {
        try assertCurrent(scope)
        guard let connection else { throw RuntimeFailure(.superseded) }
        let agentPayload: JSONValue
        if connection.backendKind == .hermes || connection.backendKind == .localModel { agentPayload = .null }
        else { agentPayload = try await rpc("agents.list", scope: scope) }
        let agents = try WireModels.agents(agentPayload, connection: connection)
        let sessions = try await readSessions(scope: scope)
        try assertCurrent(scope)
        return RuntimeRoster(connectionID: connection.id, agents: agents, sessions: sessions)
    }

    func readSessions(scope: Scope) async throws -> [RuntimeSession] {
        try assertCurrent(scope)
        guard let connection else { throw RuntimeFailure(.superseded) }
        if connection.backendKind == .localModel || (connection.backendKind == .hermes && !state.capabilities.sessions) {
            let key = "main", agent = connection.backendKind == .hermes ? "hermes" : "main"
            return [try WireModels.session(.object(["key": .string(key), "agentId": .string(agent), "title": .string(connection.label),
                                                     "kind": .string("main"), "hasActiveRun": .bool(false)]), connection: connection, legacyActivity: true)]
        }
        if BackendProfile.profile(for: connection.backendKind).handshake == .bridgeHealth,
           backendHealth["sessionCatalogSync"]?.numberValue == 1 {
            return try await readFrozenCatalog(scope: scope)
        }
        let gateway = connection.backendKind == .openclaw || connection.backendKind == .hermes
        let payload = try await rpc("sessions.list", params: gateway ? .object(["limit": .number(200), "includeLastMessage": .bool(true), "includeDerivedTitles": .bool(true)]) : .object([:]), scope: scope)
        if connection.backendKind == .openclaw {
            hasHumanActivityClock = hasHumanActivityClock || (payload["sessions"]?.array ?? []).contains {
                $0["lastActivityAt"] != nil || $0["lastInteractionAt"] != nil
            }
        }
        return try WireModels.sessions(payload, connection: connection, legacyActivity: !hasHumanActivityClock)
    }

    /// A complete frozen snapshot, without advertising delta/page-index optimizations we do not implement.
    func readFrozenCatalog(scope: Scope) async throws -> [RuntimeSession] {
        guard let connection else { throw RuntimeFailure(.superseded) }
        let deadline = clock.now() + .seconds(90)
        var pages = 1
        var response = try await catalogPage(scope: scope, deadline: deadline)
        var restart = 0
        while true {
            guard response["kind"]?.stringValue == "full", response["offset"]?.safeInteger == 0,
                  let epoch = response["epoch"]?.stringValue, validRevision(epoch),
                  let revision = response["revision"]?.stringValue, validRevision(revision),
                  let total = response["total"]?.safeInteger, total <= 10_000 else { throw RuntimeFailure(.invalidResponse) }
            var sessions: [RuntimeSession] = [], keys = Set<String>(), bytes = 2
            while true {
                guard (try FrameCodec.encode(response)).utf8.count <= 64 * 1_024,
                      response["kind"]?.stringValue == "full", response["epoch"]?.stringValue == epoch,
                      response["revision"]?.stringValue == revision, response["total"]?.safeInteger == total,
                      response["offset"]?.safeInteger == Int64(sessions.count), let page = response["sessions"]?.array else {
                    throw RuntimeFailure(.invalidResponse)
                }
                for value in page {
                    let session = try WireModels.session(value, connection: connection, legacyActivity: true)
                    guard keys.insert(session.key).inserted, sessions.count < total else { throw RuntimeFailure(.invalidResponse) }
                    bytes += (try FrameCodec.encode(value)).utf8.count + 1
                    guard bytes <= 8 * 1_024 * 1_024 else { throw RuntimeFailure(.capacity) }
                    sessions.append(session)
                }
                if response["nextOffset"] == .null {
                    guard sessions.count == total else { throw RuntimeFailure(.invalidResponse) }
                    return sessions
                }
                guard !page.isEmpty, let offset = response["nextOffset"]?.safeInteger,
                      offset == Int64(sessions.count), offset < total else { throw RuntimeFailure(.invalidResponse) }
                pages += 1
                guard pages <= 512 else { throw RuntimeFailure(.capacity) }
                response = try await catalogPage(params: .object(["page": .object(["epoch": .string(epoch), "revision": .string(revision), "offset": .number(Double(offset))])]), scope: scope, deadline: deadline)
                if response["kind"]?.stringValue == "expired" {
                    guard restart == 0, let expiredEpoch = response["epoch"]?.stringValue, validRevision(expiredEpoch) else { throw RuntimeFailure(.invalidResponse) }
                    restart += 1; pages += 1
                    guard pages <= 512 else { throw RuntimeFailure(.capacity) }
                    response = try await catalogPage(scope: scope, deadline: deadline)
                    break
                }
            }
        }
    }

    private func catalogPage(params: JSONValue = .object([:]), scope: Scope, deadline: Duration) async throws -> JSONValue {
        let remaining = deadline - clock.now()
        guard remaining > .zero else { throw RuntimeFailure(.timeout, retryable: true) }
        let response = try await rpc("sessions.sync", params: params, timeout: min(.seconds(20), remaining), scope: scope)
        guard (try FrameCodec.encode(response)).utf8.count <= 64 * 1_024 else { throw RuntimeFailure(.invalidResponse) }
        return response
    }

    public func loadSession(key: String, limit: Int = 50, cursor: String? = nil) async throws -> RuntimeHistory {
        let scope = try scope()
        guard !key.isEmpty, key.utf8.count <= 1_024, (1...1_000).contains(limit), cursor?.utf8.count ?? 0 <= 4_096,
              historyPending < 128, historyTasks.count < 32 || historyTasks[key] != nil else { throw RuntimeFailure(.capacity) }
        let consentHeadRead = cursor == nil ? try beginConsentHistoryRead(key) : nil
        let modelKey = try? modelControlKey(key)
        let modelRevision = modelKey.flatMap { try? modelControlsState.admit($0) }
        let thinkingReadID = UUID()
        if cursor == nil, let modelKey, modelRevision != nil { modelControlsState.latestThinkingRead[modelKey] = thinkingReadID }
        let previous = historyTasks[key], id = UUID()
        let revision = historyRevisions[key] ?? UUID()
        historyRevisions[key] = revision
        historyPending += 1; historyTaskIDs[key] = id
        let task = Task { [weak self] in
            if let previous { _ = try? await previous.value }
            try Task.checkCancellation()
            guard let self else { throw RuntimeFailure(.superseded) }
            return try await self.readHistory(key: key, limit: limit, cursor: cursor, scope: scope)
        }
        historyTasks[key] = task
        defer {
            if isCurrent(scope) {
                historyPending = max(0, historyPending - 1)
                if historyTaskIDs[key] == id { historyTasks.removeValue(forKey: key); historyTaskIDs.removeValue(forKey: key) }
                if historyPending == 0 { historyRevisions = [:] }
            }
        }
        do {
            let result = try await task.value; try assertCurrent(scope)
            guard historyRevisions[key] == revision else { throw RuntimeFailure(.superseded, delivery: .responseReceived) }
            if let consentHeadRead { try acceptConsentHistory(result, headRead: consentHeadRead, scope: scope) }
            if cursor == nil, let level = result.thinkingLevel, let modelKey,
               modelControlsState.contexts[modelKey] == modelRevision, modelControlsState.latestThinkingRead[modelKey] == thinkingReadID,
               modelControlsState.holds[modelKey]?.phase != .pending {
                modelControlsState.historyThinking[modelKey] = (scope, level)
            }
            return result
        }
        catch { throw runtimeFailure(error) }
    }

    func readHistory(key: String, limit: Int, cursor: String?, scope: Scope) async throws -> RuntimeHistory {
        try assertCurrent(scope)
        guard let connection else { throw RuntimeFailure(.superseded) }
        if connection.backendKind == .localModel && key != "main" { throw RuntimeFailure(.unsupported) }
        var params: [String: JSONValue] = connection.backendKind == .localModel ? [:] : ["sessionKey": .string(key)]
        if connection.backendKind == .openclaw || connection.backendKind == .hermes { params["limit"] = .number(Double(limit)) }
        if let cursor {
            let prefix = "clawket:openclaw-offset:"
            if connection.backendKind == .openclaw && cursor.hasPrefix(prefix) {
                let page = try FrameCodec.decode(String(cursor.dropFirst(prefix.count)))
                guard page["key"]?.stringValue == key, let sessionID = page["sessionId"]?.nonemptyString,
                      let offset = page["offset"]?.safeInteger, offset > 0 else { throw RuntimeFailure(.invalidResponse) }
                params["sessionId"] = .string(sessionID); params["offset"] = .number(Double(offset))
            } else { params["cursor"] = .string(cursor) }
        }
        if connection.backendKind == .pi && state.capabilities.artifacts { params["artifacts"] = .bool(true) }
        let payload = try await rpc("chat.history", params: .object(params), scope: scope)
        return try WireModels.history(payload, key: key, backend: connection.backendKind, artifactsEnabled: state.capabilities.artifacts)
    }

    public func send(sessionKey: String, input: RuntimePrompt) async throws -> RuntimeRunReceipt {
        let scope = try scope()
        guard let connection else { throw RuntimeFailure(.superseded) }
        try validateNativeSessionInput(sessionKey, scope: scope)
        if let barrier = modelSendBarrier(sessionKey: sessionKey) {
            throw RuntimeFailure(barrier == .permissionsRequired ? .permissionsRequired : .requestBusy)
        }
        let gateway = connection.backendKind == .openclaw || connection.backendKind == .hermes
        let params = try promptParameters(sessionKey: sessionKey, input: input)
        let imageReservation = input.attachments.contains(where: { $0.type == .image }) ? try reserveModelImages(sessionKey: sessionKey, scope: scope) : nil
        defer { releaseModelImages(imageReservation) }
        do {
            let result = try await rpc("chat.send", params: params, scope: scope)
            let runID = result["runId"]?.nonemptyString ?? (gateway ? input.idempotencyKey : nil)
            guard let runID else { throw RuntimeFailure(.invalidResponse, delivery: .responseReceived) }
            try sessionEvents.register(runID: runID, sessionKey: sessionKey)
            return RuntimeRunReceipt(runID: runID, idempotencyKey: input.idempotencyKey)
        } catch {
            let failure = runtimeFailure(error, sending: true)
            if failure.code == .permissionsRequired, modelPermissionsSupported, isCurrent(scope),
               let key = try? modelControlKey(sessionKey) { try? modelControlsState.requirePermissions(key) }
            throw failure
        }
    }

    public func abort(sessionKey: String, runID: String? = nil) async throws {
        let scope = try scope()
        guard let connection, !sessionKey.isEmpty, sessionKey.utf8.count <= 1_024,
              runID?.utf8.count ?? 0 <= 256 else { throw RuntimeFailure(.invalidConnection) }
        if connection.backendKind == .localModel && sessionKey != "main" { throw RuntimeFailure(.unsupported) }
        var params: [String: JSONValue] = connection.backendKind == .localModel ? [:] : ["sessionKey": .string(sessionKey)]
        if let runID { params["runId"] = .string(runID) }
        _ = try await rpc("chat.abort", params: .object(params), scope: scope)
        // ACK never manufactures run completion; authoritative events/history own it.
    }

    public func projects() async throws -> [RuntimeProject] {
        let scope = try scope()
        guard state.capabilities.projects else { throw RuntimeFailure(.unsupported) }
        let payload = try await rpc("projects.list", scope: scope)
        guard let values = payload.array, values.count <= 1_000 else { throw RuntimeFailure(.invalidResponse) }
        var ids = Set<String>()
        return try values.map { value in
            guard let id = value["id"]?.nonemptyString, ids.insert(id).inserted,
                  let name = value["name"]?.stringValue, let path = value["path"]?.stringValue,
                  let available = value["available"]?.boolValue else { throw RuntimeFailure(.invalidResponse) }
            return RuntimeProject(id: id, name: name, path: path, available: available)
        }
    }

    public func createSession(agentID: String, title: String? = nil, projectID: String? = nil) async throws -> RuntimeSession {
        let scope = try scope()
        guard let connection, state.capabilities.sessionCreate else { throw RuntimeFailure(.unsupported) }
        guard !agentID.isEmpty, agentID.utf8.count <= 256, title?.utf8.count ?? 0 <= 2_048,
              projectID?.utf8.count ?? 0 <= 1_024 else { throw RuntimeFailure(.invalidConnection) }
        if projectID != nil && !state.capabilities.projects { throw RuntimeFailure(.unsupported) }
        var params: [String: JSONValue] = [:]
        if connection.backendKind == .openclaw { params["agentId"] = .string(agentID) }
        if let title { params["title"] = .string(title) }
        if let projectID { params["projectId"] = .string(projectID) }
        let payload = try await rpc("sessions.create", params: .object(params), scope: scope)
        var raw = (payload["session"] ?? payload).object
        guard raw?["key"]?.nonemptyString != nil else { throw RuntimeFailure(.invalidResponse, delivery: .responseReceived) }
        if raw?["agentId"] == nil { raw?["agentId"] = .string(agentID) }
        if raw?["title"] == nil, let title { raw?["title"] = .string(title) }
        let session = try WireModels.session(.object(raw!), connection: connection, legacyActivity: !hasHumanActivityClock)
        catalogTask?.cancel(); catalogTask = nil; catalogTaskID = UUID()
        sessionManagementState.invalidateRows()
        catalog.removeAll { $0.key == session.key }; catalog.insert(session, at: 0)
        emit(.update(connectionID: connection.id, .sessionMetadata(session)))
        return session
    }

    public func models(sessionKey: String? = nil) async throws -> [RuntimeModel] {
        _ = try scope()
        if sessionKey != nil && !state.capabilities.modelPerSession { throw RuntimeFailure(.unsupported) }
        return try await modelControls(sessionKey: sessionKey).models
    }

    public func selectModel(id: String, provider: String? = nil, sessionKey: String? = nil) async throws {
        try await selectLegacyModel(id: id, provider: provider, sessionKey: sessionKey)
    }

    func rpc(_ method: String, params: JSONValue = .object([:]), timeout: Duration = .seconds(20), scope: Scope) async throws -> JSONValue {
        try assertCurrent(scope)
        guard let transport else { throw RuntimeFailure(.notConnected) }
        // Preserve the typed transport failure until the public operation boundary.
        do {
            let result = try await transport.request(method: method, params: params, timeout: timeout, generation: scope.generation)
            guard isCurrent(scope) else { throw RuntimeFailure(.superseded, delivery: .responseReceived) }
            return result
        } catch { throw runtimeFailure(error, sending: method == "chat.send") }
    }

    private func validRevision(_ value: String) -> Bool {
        value.utf8.count == 32 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
}
