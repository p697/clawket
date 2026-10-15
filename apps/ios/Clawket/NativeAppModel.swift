import ClawketPairing
import ClawketPersistence
import ClawketRuntime
import ClawketTransport
import ClawketUI
import Network
import SwiftUI

enum AddConnectionRequest {
    case code(String, backend: PairingBackend)
    case payload(String, fallbackBackend: PairingBackend)
    case direct(address: String, backend: PairingBackend, label: String, token: String, password: String)
}

@MainActor
final class NativeAppModel: ObservableObject {
    enum Destination: Identifiable {
        case connect, connections, editPending(ConversationID, NativePendingEdit, activation: UUID)
        var id: String {
            switch self {
            case .connect: "connect"
            case .connections: "connections"
            case let .editPending(_, edit, _): edit.id.uuidString
            }
        }
    }
    let presentation = ClientPresentation(title: String(localized: "Agents"),
        emptyTitle: String(localized: "Your agents, within reach"),
        emptyDetail: String(localized: "Connect an agent to continue conversations and keep work moving."))
    @Published var destination: Destination?
    @Published var notice: String?
    @Published private(set) var connections: [BackendConnection] = []
    @Published private(set) var activeConnectionID: String?
    @Published private(set) var changingConnections = false
    private var registry = ConnectionRegistry()
    private var vault: NativeVault?
    private var cache: NativeConversationStore?
    private var catalogCache: NativeCatalogStore?
    private var catalogCacheRevision: Int64 = 0
    private var showingCachedRoster = false
    private var runtime: RuntimeCoordinator?
    private var taskRequests: NativeTaskRequests?
    private let pairing = PairingService()
    private var eventTask: Task<Void, Never>?
    private var activationTask: Task<Void, Never>?
    private var started = false
    private var selectionRevision = UUID()
    private var activationRevision = UUID()
    private var wireRevision = UUID()
    private var historyRevisions: [ConversationID: UUID] = [:]
    private var state = RuntimeConnectionState()
    private var agents: [RuntimeAgent] = []
    private var sessions: [RuntimeSession] = []
    private var projects: [String: [RuntimeProject]] = [:]
    private var creatingCatalogs: Set<AgentCatalogID> = []
    private var unconfirmedCreations: Set<AgentCatalogID> = []
    private var documents: [ConversationID: NativeConversation] = [:]
    private var modelChoices: [ConversationID: [String: RuntimeModel]] = [:]
    private let networkMonitor = NWPathMonitor()
    private var networkHintTask: Task<Void, Never>?
    private var lastNetworkHint: ContinuousClock.Instant?
    private var running: [ConversationID: String] = [:]
    private var saveTasks: [ConversationID: Task<Void, Never>] = [:]
    private var sendTasks: [ConversationID: Task<Void, Never>] = [:]
    private var finishedRuns: [ConversationID: [String]] = [:]
    private var liveRevisions: [ConversationID: Int64] = [:]
    /// A successful single-use claim is retained if saving fails; retry never claims it again.
    @Published private(set) var pendingPairing: PairingPayload?

    func start() async {
        guard !started else { return }; started = true
        presentation.features = [.addConnection: .available, .account: .available]
        do {
            let vault = try NativeVault()
            let runtime = try RuntimeCoordinator(credentials: vault,
                client: .init(version: "3.1.2", deviceFamily: UIDevice.current.userInterfaceIdiom == .pad ? "ipad" : "iphone"))
            self.vault = vault; self.runtime = runtime; self.cache = try NativeConversationStore()
            self.catalogCache = try NativeCatalogStore()
            self.taskRequests = NativeTaskRequests(presentation: presentation, runtime: runtime,
                drafts: try NativeQuestionDraftStore(), onChange: { [weak self] in self?.rebuildRoster() },
                onStorageFailure: { [weak self] in
                    self?.notice = String(localized: "This draft could not be saved. Keep Clawket open and try again.")
                })
            if let saved = try await vault.readRegistry() {
                registry = saved.value
                if saved.recoveredFromRollback { notice = String(localized: "Recovered your saved connections from the last verified copy.") }
            }
            connections = registry.records; activeConnectionID = registry.activeConnectionID
            eventTask = Task { [weak self, runtime] in
                do {
                    for try await event in runtime.events {
                        guard let self, !Task.isCancelled else { return }
                        self.receive(event)
                    }
                } catch { if !Task.isCancelled { self?.showFailure(error) } }
            }
            networkMonitor.pathUpdateHandler = { [weak self] _ in
                Task { @MainActor [weak self] in self?.networkPathHint() }
            }
            networkMonitor.start(queue: DispatchQueue(label: "ai.clawket.native.network-hints"))
            if !registry.paused, let id = registry.activeConnectionID { connectSaved(id) }
        } catch {
            presentation.connection = .init(phase: .unavailable, label: String(localized: "Storage unavailable"),
                detail: String(localized: "Unlock this device and reopen Clawket to access your saved connections."))
            presentation.features[.addConnection] = .temporarilyUnavailable(String(localized: "Secure storage is unavailable."))
            notice = String(localized: "Saved data could not be read safely. Reopen Clawket after unlocking this device.")
        }
    }

    func handle(_ intent: ClientIntent) {
        switch intent {
        case let .openDestination(destination, _):
            switch destination {
            case .addConnection: self.destination = .connect
            case .account, .connectionSettings: self.destination = .connections
            case .newSession:
                if case let .openDestination(_, route?) = intent {
                    createSession(.init(connectionID: route.connectionID, agentID: route.agentID), projectID: nil)
                }
            default: break // These features remain unsupported in the presentation capability map.
            }
        case let .reconnect(id): activate(id ?? activeConnectionID ?? "")
        case .refresh: refresh()
        case let .openConversation(route): open(route)
        case .closeConversation: selectionRevision = UUID()
        case let .openAgentCatalog(id), let .refreshCatalog(id): showCatalog(id)
        case let .selectCatalogProject(id, projectID):
            guard id.connectionID == activeConnectionID else { return }
            presentation.catalogs[id]?.selectedProjectID = projectID; updateCatalog(id)
        case let .createSession(id, projectID): createSession(id, projectID: projectID)
        case let .draftChanged(route, text):
            guard documents[route] != nil else { return }
            documents[route]?.draft = text; changed(route); scheduleSave(route)
        case let .send(route): send(route)
        case let .stop(route): stop(route)
        case let .selectModel(route, modelID): selectModel(route, id: modelID)
        case let .loadEarlier(route): loadEarlier(route)
        case let .messageAction(route, messageID, action): messageAction(route, messageID: messageID, action: action)
        case let .openURL(url):
            guard ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") else { return }
            UIApplication.shared.open(url)
        case let .resolveApproval(id, decision): taskRequests?.resolve(id: id, decision: decision)
        case let .prepareApprovalConfirmation(id): taskRequests?.prepareApproval(id: id)
        case let .confirmApproval(id): taskRequests?.confirmApproval(id: id)
        case let .dismissApprovalConfirmation(id): taskRequests?.dismissConfirmation(id: id)
        case let .questionDraftChanged(id, response): taskRequests?.draftChanged(id: id, response: response)
        case let .answerQuestion(id, response): taskRequests?.answer(id: id, response: response)
        case let .cancelQuestion(id): taskRequests?.cancelQuestion(id: id)
        case .pickAttachment, .removeAttachment, .openAttachment, .voice:
            break // These capabilities stay hidden until their concrete host handlers are available.
        }
    }

    func addConnection(_ request: AddConnectionRequest) async throws {
        guard !changingConnections else { throw PairingError.busy }
        changingConnections = true
        defer { changingConnections = false }
        guard let vault else { throw StoreFailure.unavailable }
        let payload: PairingPayload
        if let pendingPairing { payload = pendingPairing }
        else {
            switch request {
            case let .code(code, backend): payload = try await pairing.pairCode(code, expectation: .init(backend: backend))
            case let .payload(raw, fallback):
                let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                if let url = URL(string: trimmed), ["https", "clawket"].contains(url.scheme?.lowercased() ?? ""),
                   (try? PairingParser.parseLink(trimmed)) != nil {
                    let backend = OfficialPairingServices.service(for: url)?.backend ?? fallback
                    payload = try await pairing.pairLink(trimmed, expectation: .init(backend: backend))
                } else {
                    let parsed = try PairingParser.parseQR(trimmed)
                    payload = try await pairing.pairQR(trimmed, expectation: .init(backend: parsed.backend))
                }
            case let .direct(address, backend, label, token, password):
                guard let url = URL(string: address.trimmingCharacters(in: .whitespacesAndNewlines)),
                      ["ws", "wss"].contains(url.scheme?.lowercased() ?? ""), url.host?.isEmpty == false,
                      url.user == nil, url.password == nil, url.fragment == nil, url.query == nil else {
                    throw PairingError.invalidPayload
                }
                payload = .init(backend: backend, transport: .custom, url: url,
                    displayName: label.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? backend.title,
                    token: token.nilIfEmpty, password: password.nilIfEmpty)
            }
            pendingPairing = payload
        }
        let existing = registry.records.first { connection in
            guard connection.backendKind == payload.backend, connection.transportKind == payload.transport else { return false }
            if let relay = payload.relay {
                return connection.relay?.serverURL == relay.serverURL && connection.relay?.gatewayID == relay.gatewayID
            }
            return connection.url == payload.url
        }
        let connection = try BackendConnection(pairing: payload, id: existing?.id ?? UUID().uuidString.lowercased(),
            label: existing?.label, createdAt: existing?.createdAt ?? Int64(Date().timeIntervalSince1970 * 1000))
        var next = registry
        next.records.removeAll { $0.id == connection.id }; next.records.append(connection)
        next.activeConnectionID = connection.id; next.freeConnectionID = next.freeConnectionID ?? connection.id
        next.paused = false; next.revision += 1
        try await vault.writeRegistry(next)
        registry = next; connections = next.records; activeConnectionID = connection.id; pendingPairing = nil
        connectSaved(connection.id)
    }

    func activate(_ id: String) {
        guard !changingConnections, connections.contains(where: { $0.id == id }), let vault else { return }
        changingConnections = true
        Task {
            defer { changingConnections = false }
            var next = registry; next.activeConnectionID = id; next.paused = false; next.revision += 1
            do {
                try await vault.writeRegistry(next)
                guard next.revision >= registry.revision else { return }
                registry = next; activeConnectionID = id; connectSaved(id)
            } catch { notice = String(localized: "The connection selection could not be saved. Please try again.") }
        }
    }

    func disconnect() {
        guard !changingConnections, let runtime, let vault else { return }
        changingConnections = true
        activationTask?.cancel()
        selectionRevision = UUID(); activationRevision = UUID(); wireRevision = UUID()
        taskRequests?.invalidate()
        unconfirmedCreations.formUnion(creatingCatalogs); creatingCatalogs = []
        Task {
            defer { changingConnections = false }
            await runtime.disconnect()
            var next = registry; next.paused = true; next.revision += 1
            do { try await vault.writeRegistry(next); registry = next }
            catch { notice = String(localized: "Disconnected. This preference could not be saved.") }
        }
    }

    func removeConnection(_ id: String) {
        guard !changingConnections, let vault else { return }
        changingConnections = true
        Task {
            defer { changingConnections = false }
            var next = registry; next.records.removeAll { $0.id == id }
            if next.activeConnectionID == id { next.activeConnectionID = next.records.first?.id }
            if next.freeConnectionID == id { next.freeConnectionID = nil }
            next.revision += 1
            do {
                try await vault.writeRegistry(next)
                let wasActive = activeConnectionID == id
                registry = next; connections = next.records; activeConnectionID = next.activeConnectionID
                if wasActive {
                    activationRevision = UUID(); wireRevision = UUID()
                    taskRequests?.invalidate()
                    await runtime?.disconnect()
                    agents = []; sessions = []; presentation.agents = []; presentation.selectedConversation = nil
                    if let active = next.activeConnectionID { connectSaved(active) }
                }
            } catch { notice = String(localized: "The connection could not be removed. Your saved data is unchanged.") }
        }
    }

    func showConnectAfterDismissal() {
        Task { try? await Task.sleep(for: .milliseconds(350)); destination = .connect }
    }

    func setForeground(_ foreground: Bool) {
        if !foreground { for route in documents.keys { scheduleSave(route, immediate: true) } }
        Task { await runtime?.setForeground(foreground) }
        if foreground { taskRequests?.refresh(route: presentation.selectedConversation) }
        else { taskRequests?.flushDrafts() }
    }

    private func networkPathHint() {
        networkHintTask?.cancel()
        networkHintTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            let now = ContinuousClock.now
            if let lastNetworkHint, lastNetworkHint.duration(to: now) < .seconds(5) { return }
            lastNetworkHint = now
            // The OS path is a probe/retry hint, never evidence of backend readiness.
            await runtime?.networkPathChanged()
        }
    }

    private func connectSaved(_ id: String) {
        guard let connection = connections.first(where: { $0.id == id }), let runtime else { return }
        activationTask?.cancel(); selectionRevision = UUID(); activationRevision = UUID(); wireRevision = UUID()
        taskRequests?.invalidate()
        unconfirmedCreations.formUnion(creatingCatalogs); creatingCatalogs = []
        let activation = activationRevision
        let alreadyReady = state.phase == .ready && state.connectionID == id
        if state.connectionID != id {
            agents = []; sessions = []; presentation.agents = []; presentation.catalogs = [:]
            presentation.selectedConversation = nil
        }
        activationTask = Task {
            if let roster = try? await catalogCache?.read(connectionID: id), activation == activationRevision,
               activeConnectionID == id, agents.isEmpty {
                showingCachedRoster = true; agents = roster.agents; sessions = roster.sessions; rebuildRoster()
            }
            do {
                try await runtime.activate(connection)
                if alreadyReady, activation == activationRevision, activeConnectionID == id {
                    taskRequests?.update(state); refresh()
                }
            }
            catch is CancellationError { }
            catch { if activation == activationRevision, activeConnectionID == id { showFailure(error) } }
        }
    }

    private func receive(_ event: RuntimeEvent) {
        switch event {
        case let .state(state):
            guard state.connectionID == nil || state.connectionID == activeConnectionID else { return }
            let wasReady = self.state.phase == .ready
            if state.connectionID != self.state.connectionID || wasReady && state.phase != .ready {
                wireRevision = UUID()
                unconfirmedCreations.formUnion(creatingCatalogs); creatingCatalogs = []
                for id in presentation.catalogs.keys { presentation.catalogs[id]?.isLoading = false }
                for route in presentation.conversations.keys { presentation.conversations[route]?.isLoadingHistory = false }
            }
            if state.phase != .ready {
                for route in documents.keys where route.connectionID == self.state.connectionID {
                    if var document = documents[route] {
                        for index in document.messages.indices where document.messages[index].delivery == .queued {
                            document.messages[index].delivery = .held
                        }
                        document.revision += 1; documents[route] = document; scheduleSave(route)
                    }
                }
            }
            self.state = state
            presentation.connection = connectionPresentation(state)
            taskRequests?.update(state)
            presentation.isLoading = [.connecting, .handshaking].contains(state.phase) && agents.isEmpty
            presentation.features[.refresh] = state.phase == .ready ? .available : .unsupported
            for route in presentation.conversations.keys { updatePresentation(route) }
            if state.phase == .ready, !wasReady {
                refresh()
                if let route = presentation.selectedConversation {
                    let activation = activationRevision, wire = wireRevision
                    Task {
                        guard activation == activationRevision, wire == wireRevision else { return }
                        await loadHistory(route)
                        guard activation == activationRevision, wire == wireRevision else { return }
                        await loadModels(route)
                    }
                }
            }
        case let .roster(roster):
            guard roster.connectionID == activeConnectionID else { return }
            showingCachedRoster = false
            agents = roster.agents; sessions = roster.sessions
            rebuildRoster()
            catalogCacheRevision += 1
            let revision = catalogCacheRevision
            Task { try? await catalogCache?.write(roster, revision: revision) }
        case let .update(connectionID, update):
            guard connectionID == activeConnectionID else { return }
            receive(update, connectionID: connectionID)
        case let .failure(id, failure):
            guard id == nil || id == activeConnectionID else { return }
            if !failure.retryable { showFailure(failure) }
        case let .pendingRequests(snapshot):
            guard snapshot.connectionID == activeConnectionID else { return }
            taskRequests?.apply(snapshot)
        case let .requestResolved(connectionID, reference, resolution):
            guard connectionID == activeConnectionID else { return }
            taskRequests?.resolved(reference: reference, resolution: resolution)
        }
    }

    private func refresh() {
        guard let runtime, let id = activeConnectionID else { return }
        taskRequests?.refresh()
        if let route = presentation.selectedConversation { taskRequests?.refresh(route: route) }
        let activation = activationRevision, wire = wireRevision
        Task {
            guard activation == activationRevision, wire == wireRevision else { return }
            do {
                _ = try await runtime.refreshRoster()
                guard activation == activationRevision, wire == wireRevision, id == activeConnectionID else { return }
                unconfirmedCreations = unconfirmedCreations.filter { $0.connectionID != id }
                rebuildRoster()
            } catch { if activation == activationRevision, wire == wireRevision, id == activeConnectionID { showFailure(error) } }
        }
    }

    private func rebuildRoster() {
        presentation.isLoading = false
        let activity: (RuntimeAgent) -> Int64 = { agent in
            self.sessions.filter { $0.connectionID == agent.connectionID && $0.agentID == agent.agentID }
                .compactMap(\.lastActivityAtMs).max() ?? 0
        }
        let ordered = agents.enumerated().sorted { lhs, rhs in
            let first = activity(lhs.element), second = activity(rhs.element)
            return first == second ? lhs.offset < rhs.offset : first > second
        }.map(\.element)
        presentation.agents = ordered.map { agent in
            let mode: AgentEntryMode = agent.entryMode == .sessions || agent.mainSessionKey.isEmpty
                ? .catalog(.init(connectionID: agent.connectionID, agentID: agent.agentID))
                : .conversation(.init(connectionID: agent.connectionID, agentID: agent.agentID, sessionID: agent.mainSessionKey))
            let last = sessions.filter { $0.agentID == agent.agentID }.max { ($0.lastActivityAtMs ?? 0) < ($1.lastActivityAtMs ?? 0) }
            return AgentPresentation(id: agent.agentID, entryMode: mode, name: agent.name,
                subtitle: last?.preview ?? "", backendLabel: connections.first { $0.id == agent.connectionID }?.backendKind.title,
                initials: String(agent.name.prefix(1)), attention: taskRequests?.attention(connectionID: agent.connectionID,
                    sessionKeys: Set(sessions.filter { $0.connectionID == agent.connectionID && $0.agentID == agent.agentID }.map(\.key))
                        .union(agent.mainSessionKey.isEmpty ? [] : [agent.mainSessionKey])) ?? .none, isWorking: showingCachedRoster ? false : last?.hasActiveRun ?? false,
                cachedLabel: showingCachedRoster ? String(localized: "Saved on this device") : nil)
        }
        for key in presentation.catalogs.keys { updateCatalog(key) }
        for key in presentation.conversations.keys { updatePresentation(key) }
    }

    private func showCatalog(_ id: AgentCatalogID) {
        guard id.connectionID == activeConnectionID, let runtime else { return }
        let activation = activationRevision, wire = wireRevision
        updateCatalog(id)
        presentation.catalogs[id]?.error = nil
        presentation.catalogs[id]?.isLoading = true
        Task {
            guard activation == activationRevision, wire == wireRevision else { return }
            do {
                if state.phase == .ready {
                    if state.capabilities.projects {
                        let values = try await runtime.projects()
                        guard activation == activationRevision, wire == wireRevision, id.connectionID == activeConnectionID else { return }
                        projects[id.connectionID] = values
                    }
                    _ = try await runtime.refreshRoster()
                    guard activation == activationRevision, wire == wireRevision else { return }
                    unconfirmedCreations.remove(id)
                }
                guard activation == activationRevision, wire == wireRevision, id.connectionID == activeConnectionID else { return }
                updateCatalog(id); presentation.catalogs[id]?.isLoading = false
            } catch {
                guard activation == activationRevision, wire == wireRevision, id.connectionID == activeConnectionID else { return }
                presentation.catalogs[id]?.isLoading = false
                presentation.catalogs[id]?.error = String(localized: "Conversations could not be refreshed. Check your connection and try again.")
            }
        }
    }

    private func updateCatalog(_ id: AgentCatalogID) {
        guard let agent = agents.first(where: { $0.agentID == id.agentID && $0.connectionID == id.connectionID }) else { return }
        let previous = presentation.catalogs[id]
        let projectID = previous?.selectedProjectID
        let rows = sessionPresentations(connectionID: id.connectionID, agentID: id.agentID).filter { row in
            projectID == nil || sessions.first(where: { $0.connectionID == id.connectionID && $0.key == row.route.sessionID })?.project?.id == projectID
        }
        let creating = creatingCatalogs.contains(id)
        let unavailableProject = projectID.map { selected in projects[id.connectionID]?.first(where: { $0.id == selected })?.available != true } ?? false
        var create: ActionAvailability = .unsupported
        if state.capabilities.sessionCreate {
            create = state.phase == .ready && !creating && !unavailableProject && !unconfirmedCreations.contains(id) ? .available
                : .temporarilyUnavailable(creating ? String(localized: "Creating conversation…") : unavailableProject ? String(localized: "This project is unavailable.") : String(localized: "Reconnect to create a conversation."))
            if unconfirmedCreations.contains(id) { create = .temporarilyUnavailable(String(localized: "Refresh conversations before creating another.")) }
        }
        presentation.catalogs[id] = .init(id: id, title: agent.name,
            sessions: rows, projects: (projects[id.connectionID] ?? []).map { .init(id: $0.id, title: $0.name) },
            selectedProjectID: projectID, isLoading: previous?.isLoading ?? false, error: previous?.error,
            createSession: create,
            refresh: state.phase == .ready ? .available : .temporarilyUnavailable(String(localized: "Reconnect to refresh conversations.")))
    }

    private func createSession(_ id: AgentCatalogID, projectID: String?) {
        guard id.connectionID == activeConnectionID, state.phase == .ready, state.capabilities.sessionCreate,
              !creatingCatalogs.contains(id), !unconfirmedCreations.contains(id), let runtime else { return }
        if let projectID, projects[id.connectionID]?.first(where: { $0.id == projectID })?.available != true { return }
        creatingCatalogs.insert(id); updateCatalog(id)
        let activation = activationRevision, wire = wireRevision
        Task {
            defer {
                if activation == activationRevision, wire == wireRevision { creatingCatalogs.remove(id); updateCatalog(id) }
            }
            guard activation == activationRevision, wire == wireRevision, id.connectionID == activeConnectionID else { return }
            do {
                let session = try await runtime.createSession(agentID: id.agentID, projectID: projectID)
                guard activation == activationRevision, wire == wireRevision, id.connectionID == activeConnectionID else { return }
                sessions.removeAll { $0.connectionID == id.connectionID && $0.key == session.key }; sessions.append(session)
                presentation.selectedConversation = .init(connectionID: id.connectionID, agentID: id.agentID, sessionID: session.key)
                rebuildRoster()
            } catch {
                guard activation == activationRevision, wire == wireRevision, id.connectionID == activeConnectionID else { return }
                unconfirmedCreations.insert(id)
                presentation.catalogs[id]?.error = String(localized: "Creation could not be confirmed. Refresh conversations before trying again.")
            }
        }
    }

    private func sessionPresentations(connectionID: String, agentID: String) -> [SessionPresentation] {
        sessions.filter { $0.connectionID == connectionID && $0.agentID == agentID && !$0.key.isEmpty }.map { session in
            .init(id: session.key, route: .init(connectionID: connectionID, agentID: agentID, sessionID: session.key),
                  title: session.title, subtitle: session.preview,
                  symbol: session.hasActiveRun ? "ellipsis.bubble" : "bubble.left")
        }
    }

    private func open(_ route: ConversationID) {
        guard route.isConcrete, route.connectionID == activeConnectionID, let cache else { return }
        let revision = UUID(); selectionRevision = revision
        Task {
            do {
                if documents[route] == nil {
                    let cached = try await cache.read(connectionID: route.connectionID, agentID: route.agentID, sessionID: route.sessionID)
                    guard selectionRevision == revision, presentation.selectedConversation == route else { return }
                    documents[route] = cached
                    presentation.drafts[route] = ComposerDraft(conversationID: route, text: cached.draft)
                }
                updatePresentation(route)
                taskRequests?.refresh(route: route)
                await loadHistory(route)
                await loadModels(route)
            } catch { if selectionRevision == revision { showFailure(error) } }
        }
    }

    private func loadHistory(_ route: ConversationID, earlier: Bool = false) async {
        guard route.connectionID == activeConnectionID, state.phase == .ready, state.capabilities.history,
              let runtime, let document = documents[route] else { return }
        let revision = UUID(); historyRevisions[route] = revision
        let activation = activationRevision, wire = wireRevision
        let liveRevision = liveRevisions[route, default: 0]
        let knownIDs = Set(document.messages.map(\.id))
        presentation.conversations[route]?.isLoadingHistory = true
        do {
            let history = try await runtime.loadSession(key: route.sessionID, limit: document.historyLimit,
                                                       cursor: earlier ? document.nextCursor : nil)
            guard activation == activationRevision, wire == wireRevision, activeConnectionID == route.connectionID, historyRevisions[route] == revision else { return }
            mergeHistory(history, route: route, earlier: earlier, liveRevision: liveRevision, knownIDs: knownIDs)
            presentation.conversations[route]?.isLoadingHistory = false
        } catch {
            guard activation == activationRevision, wire == wireRevision, historyRevisions[route] == revision else { return }
            presentation.conversations[route]?.isLoadingHistory = false
            if presentation.selectedConversation == route { showFailure(error) }
        }
    }

    private func mergeHistory(_ history: RuntimeHistory, route: ConversationID, earlier: Bool, liveRevision: Int64, knownIDs: Set<String>) {
        guard var document = documents[route] else { return }
        let old = document.messages
        var remote = history.messages.map { message -> NativeMessage in
            let previous = old.first { $0.remoteID == message.id || (message.role == .user && message.idempotencyKey != nil && $0.idempotencyKey == message.idempotencyKey) }
            return NativeMessage(id: previous?.id ?? "remote-\(message.id)", remoteID: message.id, role: message.role,
                local: previous?.local ?? false, text: message.text, runID: message.runID, idempotencyKey: message.idempotencyKey,
                timestampMs: message.timestampMs, delivery: previous?.local == true ? .delivered : nil, isWork: message.role == .tool)
        }
        let represented = Set(remote.map(\.id))
        let retained = old.filter { !represented.contains($0.id) && ($0.local || $0.streaming || !knownIDs.contains($0.id)) }
        if earlier && history.pagination == .cursor {
            let knownRemote = Set(old.map(\.id)); remote.removeAll { knownRemote.contains($0.id) }
            document.messages = remote + old
        } else { document.messages = remote + retained }
        document.nextCursor = history.nextCursor; document.hasMore = history.hasMore ?? false
        document.revision += 1; documents[route] = document
        if liveRevisions[route, default: 0] == liveRevision {
            if history.hasActiveRun { running[route] = history.activeRun?["runId"]?.stringValue ?? running[route] ?? "" }
            else { running.removeValue(forKey: route) }
        }
        updatePresentation(route); scheduleSave(route)
    }

    private func loadEarlier(_ route: ConversationID) {
        guard documents[route]?.hasMore == true else { return }
        if documents[route]?.nextCursor == nil { documents[route]?.historyLimit += 80 }
        Task { await loadHistory(route, earlier: true) }
    }

    private func loadModels(_ route: ConversationID) async {
        guard route.connectionID == activeConnectionID, state.capabilities.models, let runtime else { return }
        let activation = activationRevision, wire = wireRevision
        do {
            let models = try await runtime.models(sessionKey: state.capabilities.modelPerSession ? route.sessionID : nil)
            guard activation == activationRevision, wire == wireRevision, route.connectionID == activeConnectionID else { return }
            var choices: [String: RuntimeModel] = [:]
            let display = try models.map { model -> ModelPresentation in
                let key = try DocumentStore.scopedKey(namespace: "model", parts: [model.provider ?? "", model.id])
                choices[key] = model
                return .init(id: key, title: model.name, subtitle: model.provider, isSelected: model.selected)
            }
            modelChoices[route] = choices
            presentation.conversations[route]?.models = display
            presentation.conversations[route]?.modelTitle = models.first(where: \.selected)?.name ?? String(localized: "Choose model")
            presentation.conversations[route]?.modelScopeLabel = state.capabilities.modelPerSession ? String(localized: "This conversation") : String(localized: "Applies to all conversations")
        } catch { if activation == activationRevision, wire == wireRevision, route == presentation.selectedConversation { showFailure(error) } }
    }

    private func selectModel(_ route: ConversationID, id: String) {
        guard route.connectionID == activeConnectionID, let model = modelChoices[route]?[id], let runtime else { return }
        let activation = activationRevision, wire = wireRevision
        Task {
            guard activation == activationRevision, wire == wireRevision, route.connectionID == activeConnectionID else { return }
            do {
                try await runtime.selectModel(id: model.id, provider: model.provider,
                                              sessionKey: state.capabilities.modelPerSession ? route.sessionID : nil)
                guard activation == activationRevision, wire == wireRevision else { return }
                await loadModels(route)
            } catch { if activation == activationRevision, wire == wireRevision, route.connectionID == activeConnectionID { showFailure(error) } }
        }
    }

    private func send(_ route: ConversationID) {
        guard route.connectionID == activeConnectionID, state.phase == .ready, state.capabilities.chat,
              var document = documents[route] else { return }
        guard sessions.first(where: { $0.connectionID == route.connectionID && $0.key == route.sessionID })?.canContinue != false else { return }
        let text = presentation.draft(for: route).text
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        guard document.messages.filter({ [.queued, .held, .sending].contains($0.delivery) }).count < 32 else {
            presentation.draft(for: route).hint = String(localized: "There are 32 pending messages. Finish or remove one before adding another.")
            return
        }
        let id = UUID().uuidString.lowercased()
        let entry = NativeMessage(id: id, role: .user, local: true, text: text, idempotencyKey: id,
                                  timestampMs: Int64(Date().timeIntervalSince1970 * 1000), delivery: .queued)
        document.messages.append(entry); document.draft = ""; document.revision += 1
        documents[route] = document
        presentation.draft(for: route).text = ""
        updatePresentation(route)
        scheduleSave(route, immediate: true)
        drainQueue(route)
    }

    private func drainQueue(_ route: ConversationID) {
        guard route.connectionID == activeConnectionID, state.phase == .ready, state.capabilities.chat,
              running[route] == nil, sendTasks[route] == nil, let runtime,
              let queued = documents[route]?.messages.first(where: { $0.local && $0.delivery == .queued }),
              let id = queued.idempotencyKey else { return }
        guard sessions.first(where: { $0.connectionID == route.connectionID && $0.key == route.sessionID })?.canContinue != false else { return }
        // Reserve the item synchronously. Editing/removal can never race a Task that
        // captured queued text but has not entered its first actor turn yet.
        updateSend(route, id: queued.id, delivery: .sending)
        let activation = activationRevision, wire = wireRevision
        sendTasks[route] = Task {
            do {
                // Queue persistence alone never proves dispatch. Persist sending before entering the wire path.
                try await persist(route)
                guard activation == activationRevision, wire == wireRevision, route.connectionID == activeConnectionID, state.phase == .ready, running[route] == nil else {
                    updateSend(route, id: queued.id, delivery: .held)
                    sendTasks.removeValue(forKey: route); scheduleSave(route, immediate: true); return
                }
                let receipt = try await runtime.send(sessionKey: route.sessionID, input: .init(text: queued.text, idempotencyKey: id))
                if activation == activationRevision, wire == wireRevision {
                    updateSend(route, id: queued.id, delivery: .sent, runID: receipt.runID)
                    if finishedRuns[route]?.contains(receipt.runID) != true { running[route] = receipt.runID }
                } else {
                    updateSend(route, id: queued.id, delivery: .uncertain, runID: receipt.runID)
                }
            } catch {
                let delivery = (error as? RuntimeFailure)?.delivery
                let uncertain = delivery == .uncertain || delivery == .responseReceived
                updateSend(route, id: queued.id, delivery: uncertain ? .uncertain : .failed)
                if activation == activationRevision, wire == wireRevision, route == presentation.selectedConversation { showFailure(error) }
            }
            sendTasks.removeValue(forKey: route)
            updatePresentation(route); scheduleSave(route, immediate: true)
            if activation == activationRevision, wire == wireRevision, running[route] == nil { drainQueue(route) }
        }
    }

    private func updateSend(_ route: ConversationID, id: String, delivery: NativeDelivery, runID: String? = nil) {
        guard let index = documents[route]?.messages.firstIndex(where: { $0.id == id }) else { return }
        if documents[route]?.messages[index].delivery != .delivered { documents[route]?.messages[index].delivery = delivery }
        if let runID { documents[route]?.messages[index].runID = runID }
        changed(route)
    }

    private func stop(_ route: ConversationID) {
        guard route.connectionID == activeConnectionID, state.capabilities.abort, let runtime else { return }
        guard sessions.first(where: { $0.connectionID == route.connectionID && $0.key == route.sessionID })?.canContinue != false else { return }
        let runID = running[route]?.nilIfEmpty
        let activation = activationRevision, wire = wireRevision
        Task {
            guard activation == activationRevision, wire == wireRevision, route.connectionID == activeConnectionID else { return }
            do { try await runtime.abort(sessionKey: route.sessionID, runID: runID) }
            catch { if activation == activationRevision, wire == wireRevision, route.connectionID == activeConnectionID { showFailure(error) } }
        }
    }

    private func receive(_ update: RuntimeSessionUpdate, connectionID: String) {
        switch update {
        case let .runStarted(key, runID):
            for route in documents.keys where route.connectionID == connectionID && route.sessionID == key {
                liveRevisions[route, default: 0] += 1
                running[route] = runID; updatePresentation(route)
            }
        case let .text(update):
            for route in documents.keys where route.connectionID == connectionID && route.sessionID == update.sessionKey {
                liveRevisions[route, default: 0] += 1
                let key = "stream-\(update.runID)-\(update.segmentID)"
                if let index = documents[route]?.messages.firstIndex(where: { $0.id == key }) {
                    if update.mode == .delta { documents[route]?.messages[index].text += update.text }
                    else { documents[route]?.messages[index].text = update.text }
                } else {
                    documents[route]?.messages.append(.init(id: key, role: .assistant, text: update.text,
                        runID: update.runID, segmentID: update.segmentID, streaming: true))
                }
                running[route] = update.runID; changed(route); updatePresentation(route); scheduleSave(route)
            }
        case let .runFinished(key, runID, _, _, _):
            for route in documents.keys where route.connectionID == connectionID && route.sessionID == key {
                liveRevisions[route, default: 0] += 1
                var finished = finishedRuns[route] ?? []
                if !finished.contains(runID) { finished.append(runID) }
                finishedRuns[route] = Array(finished.suffix(128))
                if running[route] == runID { running.removeValue(forKey: route) }
                if var document = documents[route] {
                    for index in document.messages.indices where document.messages[index].runID == runID { document.messages[index].streaming = false }
                    document.revision += 1; documents[route] = document
                }
                updatePresentation(route); scheduleSave(route)
                drainQueue(route)
            }
        case let .sessionMetadata(session):
            sessions.removeAll { $0.key == session.key && $0.connectionID == connectionID }; sessions.append(session); rebuildRoster()
        case .thought, .tool, .work, .other: break
        }
    }

    private func updatePresentation(_ route: ConversationID) {
        guard let document = documents[route] else { return }
        let name = agents.first { $0.agentID == route.agentID && $0.connectionID == route.connectionID }?.name ?? String(localized: "Agent")
        let session = sessions.first { $0.key == route.sessionID && $0.connectionID == route.connectionID }
        let connected = route.connectionID == activeConnectionID && state.phase == .ready
        var features: [ClientFeature: ActionAvailability] = [.connectionSettings: .available]
        if state.capabilities.chat {
            features[.send] = connected ? .available
                : .temporarilyUnavailable(String(localized: "Reconnect to send. Your draft is saved."))
            if session?.canContinue == false { features[.send] = .temporarilyUnavailable(String(localized: "This conversation is read-only here.")) }
        }
        if state.capabilities.abort && running[route] != nil && session?.canContinue != false { features[.stop] = connected ? .available : .temporarilyUnavailable(String(localized: "Reconnect to stop this run.")) }
        if state.capabilities.sessions { features[.sessions] = .available }
        if state.capabilities.sessionCreate {
            let catalogID = AgentCatalogID(connectionID: route.connectionID, agentID: route.agentID)
            features[.newSession] = connected && !creatingCatalogs.contains(catalogID) && !unconfirmedCreations.contains(catalogID) ? .available
                : .temporarilyUnavailable(String(localized: "Reconnect or refresh conversations before creating another."))
        }
        if state.capabilities.models {
            features[.models] = connected ? .available : .temporarilyUnavailable(String(localized: "Reconnect to change models."))
            if state.capabilities.modelPerSession && session?.canContinue == false { features[.models] = .temporarilyUnavailable(String(localized: "This conversation is read-only here.")) }
        }
        if document.hasMore { features[.loadEarlier] = connected ? .available : .temporarilyUnavailable(String(localized: "Reconnect to load earlier messages.")) }
        let previous = presentation.conversations[route]
        let transcript: [MessagePresentation] = document.messages.map { present($0, agentName: name) }
        let requests: [MessagePresentation] = taskRequests?.messages(for: route) ?? []
        let messages: [MessagePresentation] = transcript + requests
        presentation.conversations[route] = .init(id: route, agentName: name, sessionTitle: session?.title ?? name,
            messages: messages,
            connection: presentation.connection,
            sessions: sessionPresentations(connectionID: route.connectionID, agentID: route.agentID),
            models: previous?.models ?? [], modelTitle: previous?.modelTitle,
            modelScopeLabel: previous?.modelScopeLabel, sendLabel: running[route] == nil ? String(localized: "Send") : String(localized: "Add to queue"),
            isLoadingHistory: previous?.isLoadingHistory ?? false, features: features)
    }

    private func present(_ message: NativeMessage, agentName: String) -> MessagePresentation {
        let author: MessageAuthor = message.local ? .local : message.role == .assistant ? .agent(name: agentName, label: nil)
            : message.role == .user ? .participant(name: String(localized: "Participant"), channel: nil) : .system
        let content: [MessageContent] = message.isWork
            ? [.work(.init(id: message.id, title: String(localized: "Tool output"), phase: .complete, output: message.text))]
            : [.markdown(message.text)]
        let delivery: MessageDelivery? = switch message.delivery {
        case .queued: .queued
        case .held: .held(String(localized: "Ready when you are. Send this message when the connection is available."))
        case .sending: .sending
        case .sent: .sent
        case .delivered: .delivered
        case .uncertain: .uncertain(String(localized: "Delivery could not be confirmed. Check the conversation before sending again."))
        case .failed: .failed(String(localized: "Not sent. Your message is saved."))
        case nil: nil
        }
        var actions: [MessageAction] = [.copy]
        let ownedPending = message.local && message.role == .user && message.idempotencyKey?.isEmpty == false
        if ownedPending && [.queued, .held, .failed].contains(message.delivery) { actions += [.edit, .remove] }
        if ownedPending && message.delivery == .held { actions.append(.sendNow) }
        return .init(id: message.id, author: author, content: content, delivery: delivery, isStreaming: message.streaming, actions: actions)
    }

    private func messageAction(_ route: ConversationID, messageID: String, action: MessageAction) {
        guard let message = documents[route]?.messages.first(where: { $0.id == messageID }) else { return }
        switch action {
        case .copy: UIPasteboard.general.string = message.text
        case .edit:
            guard route.connectionID == activeConnectionID, var document = documents[route],
                  let edit = try? document.holdForEditing(messageID: messageID) else { return }
            documents[route] = document; updatePresentation(route); scheduleSave(route, immediate: true)
            destination = .editPending(route, edit, activation: activationRevision)
        case .sendNow:
            guard message.local, message.role == .user, message.idempotencyKey?.isEmpty == false,
                  message.delivery == .held, route.connectionID == activeConnectionID, state.phase == .ready,
                  let index = documents[route]?.messages.firstIndex(where: { $0.id == messageID }) else { return }
            documents[route]?.messages[index].delivery = .queued; changed(route)
            updatePresentation(route); scheduleSave(route, immediate: true); drainQueue(route)
        case .remove:
            guard var document = documents[route] else { return }
            do { try document.removePending(messageID: messageID) } catch { return }
            documents[route] = document
            updatePresentation(route); scheduleSave(route, immediate: true)
        default: break
        }
    }

    func savePendingEdit(_ edit: NativePendingEdit, route: ConversationID, activation: UUID, text: String) async throws {
        guard activation == activationRevision, route.connectionID == activeConnectionID,
              destination?.id == edit.id.uuidString, let original = documents[route] else { throw StoreFailure.invalidDocument }
        var updated = original
        try updated.apply(edit, text: text)
        documents[route] = updated; updatePresentation(route)
        saveTasks[route]?.cancel()
        do { try await persist(route) }
        catch {
            // Do not overwrite history or delivery changes that arrived while writing.
            if documents[route]?.revision == updated.revision {
                var restored = original; restored.revision = updated.revision + 1
                documents[route] = restored; updatePresentation(route); scheduleSave(route, immediate: true)
            }
            throw error
        }
        guard activation == activationRevision, destination?.id == edit.id.uuidString,
              let current = documents[route]?.messages.first(where: { $0.id == edit.messageID }),
              current.idempotencyKey == edit.idempotencyKey, current.text == text, current.delivery == .held else {
            throw StoreFailure.invalidDocument
        }
        destination = nil
    }

    private func changed(_ route: ConversationID) { documents[route]?.revision += 1 }

    private func scheduleSave(_ route: ConversationID, immediate: Bool = false) {
        saveTasks[route]?.cancel()
        saveTasks[route] = Task {
            if !immediate { try? await Task.sleep(for: .milliseconds(350)) }
            guard !Task.isCancelled else { return }
            do { try await persist(route) }
            catch { presentation.draft(for: route).hint = String(localized: "This draft could not be saved. Keep Clawket open and try again.") }
        }
    }

    private func persist(_ route: ConversationID) async throws {
        guard let cache, let document = documents[route] else { throw StoreFailure.unavailable }
        try await cache.write(document, connectionID: route.connectionID, agentID: route.agentID, sessionID: route.sessionID)
    }

    private func connectionPresentation(_ state: RuntimeConnectionState) -> ConnectionPresentation {
        let phase: ConnectionPhase = switch state.phase {
        case .idle: .disconnected
        case .connecting, .handshaking: .connecting
        case .ready: .ready
        case .reconnecting: .reconnecting
        case .offline: .unavailable
        case .error: .unavailable
        }
        let label: String = switch state.phase {
        case .idle: String(localized: "Disconnected")
        case .connecting: String(localized: "Connecting…")
        case .handshaking: String(localized: "Checking your agent…")
        case .ready: String(localized: "Connected")
        case .reconnecting: String(localized: "Reconnecting…")
        case .offline: String(localized: "Agent unavailable")
        case .error: String(localized: "Connection needs attention")
        }
        return .init(phase: phase, label: label, connectionID: state.connectionID,
                     action: [.offline, .error, .idle].contains(state.phase) && activeConnectionID != nil ? .available : .unsupported)
    }

    private func showFailure(_ error: Error) {
        if error is StoreFailure { notice = String(localized: "Your data could not be saved safely. Keep Clawket open and try again."); return }
        guard let failure = error as? RuntimeFailure else { notice = String(localized: "The operation could not be completed. Please try again."); return }
        switch failure.code {
        case .authenticationRequired, .pairingRequired: notice = String(localized: "Your agent needs to be paired again. Add its current pairing code in Settings.")
        case .permissionsRequired: notice = String(localized: "This connection does not have permission for that action.")
        case .superseded: break
        case .timeout, .network, .notConnected:
            notice = failure.delivery == .uncertain ? String(localized: "Delivery could not be confirmed. Your original message is saved. Check the conversation before sending again.")
                : String(localized: "Your agent could not be reached. Your draft is saved.")
        case .unsupported: notice = String(localized: "This action is unavailable for this connection.")
        default: notice = String(localized: "The operation could not be completed. Check your connection and try again.")
        }
    }

    static func pairingErrorText(_ error: Error) -> String {
        guard let error = error as? PairingError else {
            return error is StoreFailure ? String(localized: "Pairing data could not be saved. Try Connect again to save the existing result.")
                : String(localized: "Could not complete pairing. Check the details and try again.")
        }
        switch error {
        case .expired, .alreadyUsed: return String(localized: "This invitation has expired or was already used. Get a new code from your computer.")
        case .rateLimited: return String(localized: "Too many attempts. Wait a little before trying again.")
        case .backendMismatch: return String(localized: "This code belongs to a different agent. Choose the matching agent and try again.")
        case .environmentMismatch, .previewRequiresDebugMode: return String(localized: "This invitation uses a different service environment.")
        case .timeout, .network: return String(localized: "The pairing service could not be reached. Check your computer before trying this invitation again.")
        case .busy: return String(localized: "A pairing attempt is already in progress.")
        default: return String(localized: "Could not use this pairing code or link. Check it or generate a new invitation.")
        }
    }
}

private extension String { var nilIfEmpty: String? { isEmpty ? nil : self } }
