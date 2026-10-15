import ClawketMedia
import ClawketPairing
import ClawketPersistence
import ClawketRuntime
import ClawketSpeech
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
        case connect, settings, connections, editPending(ConversationID, NativePendingEdit, activation: UUID)
        case deviceApproval(connectionID: String)
        case savedHistory(UUID), previousTranscripts(NativeHistoryScope, UUID), exportConversation(NativeHistoryExportRequest)
        var id: String {
            switch self {
            case .connect: "connect"
            case .connections: "connections"
            case .settings: "settings"
            case let .deviceApproval(id): "device-approval-\(id)"
            case let .savedHistory(id): "saved-\(id)"
            case let .previousTranscripts(_, id): "previous-\(id)"
            case let .exportConversation(request): "export-\(request.id)"
            case let .editPending(_, edit, _): edit.id.uuidString
            }
        }
    }
    let preferences = NativePreferences()
    let presentation = ClientPresentation(title: String(localized: "Agents"),
        emptyTitle: String(localized: "Your agents, within reach"),
        emptyDetail: String(localized: "Connect an agent to continue conversations and keep work moving."))
    @Published var destination: Destination?
    @Published var notice: String?
    @Published private(set) var deviceApproval: RuntimeDeviceApprovalContext?
    private var deviceApprovalNotice = false
    @Published private(set) var connections: [BackendConnection] = []
    @Published private(set) var activeConnectionID: String?
    @Published private(set) var changingConnections = false
    private var registry = ConnectionRegistry()
    private var vault: NativeVault?
    var cache: NativeConversationStore?
    var historyController: NativeHistoryController?
    private var catalogCache: NativeCatalogStore?
    private var catalogCacheRevision: Int64 = 0
    private var showingCachedRoster = false
    private var navigationHeldRoutes: Set<NativeStoredRoute> = []
    private var conversationVisibility = NativeConversationVisibility()
    var runtime: RuntimeCoordinator?
    private var taskRequests: NativeTaskRequests?
    private var sessionManager: NativeSessionManagement?
    var modelControls: NativeModelControls?
    private var archivedSessions: [String: [RuntimeSession]] = [:]
    private var archiveReads: [String: UUID] = [:]
    private var taskJournal: NativeTaskJournal?
    private let pairing = PairingService()
    private var eventTask: Task<Void, Never>?
    private var activationTask: Task<Void, Never>?
    private var started = false
    var selectionRevision = UUID()
    var activationRevision = UUID()
    var wireRevision = UUID()
    private var historyRevisions: [ConversationID: UUID] = [:]
    var state = RuntimeConnectionState()
    private var agents: [RuntimeAgent] = []
    private var sessions: [RuntimeSession] = []
    private var projects: [String: [RuntimeProject]] = [:]
    private var creatingCatalogs: Set<AgentCatalogID> = []
    private var unconfirmedCreations: Set<AgentCatalogID> = []
    var documents: [ConversationID: NativeConversation] = [:]
    var modelChoices: [ConversationID: [String: RuntimeModel]] = [:]
    private let networkMonitor = NWPathMonitor()
    private var networkHintTask: Task<Void, Never>?
    private var lastNetworkHint: ContinuousClock.Instant?
    private var running: [ConversationID: String] = [:]
    var saveTasks: [ConversationID: Task<Void, Never>] = [:]
    private var sendTasks: [ConversationID: Task<Void, Never>] = [:]
    private var finishedRuns: [ConversationID: [String]] = [:]
    private var liveRevisions: [ConversationID: Int64] = [:]
    var media: NativeMediaController?
    @Published var mediaPicker: NativeMediaPickerRequest?
    @Published var mediaPreview: NativeMediaPreview?
    var mediaImports: [UUID: NativeMediaImport] = [:]
    var mediaImportReceipts: [UUID: StagedMediaFile] = [:]
    var mediaImportResources: [UUID: UUID] = [:]
    var mediaImportTasks: [UUID: Task<Void, Never>] = [:]
    var mediaProviderProgress: [UUID: Progress] = [:]
    var mediaInvalidationTask: Task<Void, Never>?
    var mediaVisibleRoute: ConversationID?
    var mediaPreviewRequest: (id: String, token: UUID)?
    var mediaLoadRevisions: [String: UUID] = [:]
    var mediaLoads: [String: Task<Void, Never>] = [:]
    var mediaDisplays: [String: AttachmentPresentation] = [:]
    var mediaDraftRevisions: [ConversationID: UUID] = [:]
    var mediaSendPreparations: Set<ConversationID> = []
    var mediaModelRevisions: [ConversationID: UUID] = [:]
    var mediaChangingModelTokens: [ConversationID: UUID] = [:]
    var mediaChangingModels: Set<ConversationID> { Set(mediaChangingModelTokens.keys) }
    var mediaGlobalModel: (wire: UUID, supportsImages: Bool?)?
    var voice: NativeVoiceController?
    @Published var voiceSheet: NativeVoiceSheetRequest?
    @Published var voiceReview: NativeVoiceResult?
    var voiceInsertion: NativeVoiceInsertion?
    var voiceHandoffTask: Task<Void, Never>?
    var voiceShownFailure: SpeechFailure?
    /// A successful single-use claim is retained if saving fails; retry never claims it again.
    @Published private(set) var pendingPairing: PairingPayload?

    func start() async {
        guard !started else { return }; started = true
        presentation.features = [.addConnection: .available, .account: .available]
        preferences.onAppearance = { [weak self] value in
            self?.objectWillChange.send(); self?.presentation.appearance = value
        }
        await preferences.load()
        do {
            let vault = try NativeVault()
            let runtime = try RuntimeCoordinator(credentials: vault,
                client: .init(version: "3.1.2", deviceFamily: UIDevice.current.userInterfaceIdiom == .pad ? "ipad" : "iphone"))
            self.vault = vault; self.runtime = runtime; self.cache = try NativeConversationStore()
            await setupVoice(vault: vault)
            self.catalogCache = try NativeCatalogStore()
            do {
                let journal = NativeTaskJournal(store: try NativeJournalStore(), onFailure: { [weak self] in
                    self?.notice = String(localized: "Saved data could not be read safely. Reopen Clawket after unlocking this device.")
                })
                await journal.restore(); self.taskJournal = journal
            } catch {
                notice = String(localized: "Saved data could not be read safely. Reopen Clawket after unlocking this device.")
            }
            self.taskRequests = NativeTaskRequests(presentation: presentation, runtime: runtime,
                drafts: try NativeQuestionDraftStore(), onChange: { [weak self] in self?.rebuildRoster() },
                onStorageFailure: { [weak self] in
                    self?.notice = String(localized: "This draft could not be saved. Keep Clawket open and try again.")
                }, journal: taskJournal)
            do {
                let media = try NativeMediaController()
                if let cache { try await media.recover(cache: cache) }
                self.media = media
            } catch { notice = String(localized: "Some attachments could not be recovered. Your files have been kept.") }
            setupSavedHistory(runtime: runtime)
            self.sessionManager = NativeSessionManagement(presentation: presentation, runtime: runtime,
                context: { [weak self] in self?.sessionHostContext ?? .init(activation: UUID(), wire: UUID(), selection: UUID()) },
                prepare: { [weak self] target in
                    guard let self else { throw RuntimeFailure(.superseded) }
                    try await self.prepareSessionMutation(target)
                }, outcome: { [weak self] outcome in self?.sessionMutationFinished(outcome) },
                onChange: { [weak self] in self?.rebuildRoster() })
            self.modelControls = NativeModelControls(presentation: presentation, runtime: runtime,
                preferences: try? NativeModelPreferences(),
                context: { [weak self] in self?.sessionHostContext ?? .init(activation: UUID(), wire: UUID(), selection: UUID()) },
                selectedRoute: { [weak self] in self?.presentation.selectedConversation },
                queue: { [weak self] route, plan in
                    guard let self else { throw RuntimeFailure(.superseded) }
                    try await self.queueModelCommand(route, plan: plan)
                }, onSnapshot: { [weak self] route, value, rows in self?.applyModelSnapshot(route, value: value, rows: rows) },
                onChange: { [weak self] in self?.modelSettingsChanged() })
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
            if let id = registry.activeConnectionID {
                if !registry.paused { connectSaved(id) }
                else {
                    // Reopen saved navigation without reconnecting or resuming dispatch.
                    preferences.activate(id)
                    if let roster = try? await catalogCache?.read(connectionID: id), activeConnectionID == id {
                        showingCachedRoster = true; agents = roster.agents; sessions = roster.sessions; rebuildRoster()
                    }
                }
            }
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
            retireVoice()
            switch destination {
            case .addConnection: self.destination = .connect
            case .account: self.destination = .settings
            case .connectionSettings: self.destination = .connections
            case .savedHistory, .exportConversation, .previousTranscripts:
                if case let .openDestination(_, route) = intent { openHistory(destination, route: route) }
            case .newSession:
                if case let .openDestination(_, route?) = intent {
                    createSession(.init(connectionID: route.connectionID, agentID: route.agentID), projectID: nil)
                }
            default: break // These features remain unsupported in the presentation capability map.
            }
        case let .reconnect(id): activate(id ?? activeConnectionID ?? "")
        case let .reviewDeviceApproval(connectionID, contextID):
            guard NativeDeviceApprovalPolicy.matches(deviceApproval, connectionID: connectionID,
                contextID: contextID, activeConnectionID: activeConnectionID) else { return }
            destination = .deviceApproval(connectionID: connectionID)
        case .refresh: sessionManager?.refreshAcknowledged(); refresh()
        case let .prepareSessionManagement(route, id): sessionManager?.open(route, id: id)
        case let .dismissSessionManagement(id): sessionManager?.dismiss(id)
        case let .requestSessionAction(id, action): sessionManager?.request(id, action: action)
        case let .renameSession(id, title): sessionManager?.rename(id, title: title)
        case let .confirmSessionMutation(id): sessionManager?.confirm(id)
        case let .dismissSessionMutationConfirmation(id): sessionManager?.dismissConfirmation(id)
        case let .selectCatalogArchive(id, archived):
            guard id.connectionID == activeConnectionID, state.capabilities.sessionManagement?.archive == true else { return }
            presentation.catalogs[id]?.showingArchived = archived
            if archived { loadArchivedCatalog(id) } else { archiveReads[id.connectionID] = nil; showCatalog(id) }
        case let .openConversation(route): open(route)
        case .closeConversation: selectionRevision = UUID(); retireMediaSelection()
        case let .conversationVisibilityChanged(route, viewID, visible):
            if conversationVisibility.update(route, viewID: viewID, isVisible: visible),
               voice?.attempt?.context.route == route { retireVoice() }
        case let .readingContextChanged(route, scopeID, context):
            guard presentation.acceptsReadingContext(for: route, scopeID: scopeID),
                  route.connectionID == activeConnectionID, context.isValid else { return }
            preferences.recordReading(context, route: route)
        case let .openAgentCatalog(id):
            guard id.connectionID == activeConnectionID, agents.contains(where: { $0.connectionID == id.connectionID && $0.agentID == id.agentID }) else { return }
            retireVoice(); presentation.requestedCatalog = nil; preferences.opened(.init(id)); showCatalog(id)
        case let .refreshCatalog(id): showCatalog(id)
        case let .selectCatalogProject(id, projectID):
            guard id.connectionID == activeConnectionID else { return }
            presentation.catalogs[id]?.selectedProjectID = projectID; updateCatalog(id)
        case let .createSession(id, projectID): createSession(id, projectID: projectID)
        case let .draftChanged(route, text):
            guard documents[route] != nil else { return }
            documents[route]?.draft = text; changed(route); scheduleSave(route)
        case let .send(route): send(route)
        case let .stop(route): stop(route)
        case let .selectModel(route, modelID): modelControls?.chooseLegacy(route, modelID: modelID)
        case let .prepareModelControls(route, id): modelControls?.open(route, id: id)
        case let .dismissModelControls(id): modelControls?.dismiss(id)
        case let .refreshModelControls(id): modelControls?.refresh(id)
        case let .chooseModelControl(id, choice): modelControls?.choose(id, choice: choice)
        case let .confirmModelPermissions(id): modelControls?.confirm(id)
        case let .dismissModelPermissions(id): modelControls?.dismissConfirmation(id)
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
        case let .workInspectorOpened(route, workID):
            guard taskJournal?.canInspect(route, workID: workID) == true else { return }
        case let .workStepOpened(route, workID, recordID, stepID):
            guard taskJournal?.canInspect(route, workID: workID, recordID: recordID, stepID: stepID) == true else { return }
        case let .pickAttachment(route, source): pickMedia(route, source: source)
        case let .removeAttachment(route, attachmentID): removeMedia(route, id: attachmentID)
        case let .openAttachment(attachmentID): openMedia(id: attachmentID)
        case let .voice(route, action): voiceIntent(route, action: action)
        case let .composerInsertionApplied(route, insertionID, text): voiceInsertionApplied(route, id: insertionID, text: text)
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
        retireMedia(); activationTask?.cancel()
        selectionRevision = UUID(); activationRevision = UUID(); wireRevision = UUID()
        taskRequests?.invalidate(); sessionManager?.invalidate(); modelControls?.invalidate(); archiveReads = [:]; deviceApproval = nil
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
        preferences.setForeground(foreground)
        if !foreground {
            for route in documents.keys { scheduleSave(route, immediate: true) }
        }
        Task { await runtime?.setForeground(foreground) }
        if foreground { taskRequests?.refresh(route: presentation.selectedConversation) }
        else { taskRequests?.flushDrafts(); taskJournal?.flush() }
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
        retireMedia(); activationTask?.cancel(); selectionRevision = UUID(); activationRevision = UUID(); wireRevision = UUID()
        taskRequests?.invalidate(); sessionManager?.invalidate(); modelControls?.invalidate(); archiveReads = [:]; deviceApproval = nil
        unconfirmedCreations.formUnion(creatingCatalogs); creatingCatalogs = []
        preferences.activate(id)
        let activation = activationRevision
        let alreadyReady = state.phase == .ready && state.connectionID == id
        if state.connectionID != id {
            agents = []; sessions = []; presentation.agents = []; presentation.catalogs = [:]
            presentation.selectedConversation = nil
            presentation.requestedCatalog = nil
        }
        activationTask = Task {
            if let roster = try? await catalogCache?.read(connectionID: id), activation == activationRevision,
               activeConnectionID == id, agents.isEmpty {
                showingCachedRoster = true; agents = roster.agents; sessions = roster.sessions; rebuildRoster()
            }
            do {
                try await runtime.activate(connection)
                if alreadyReady, activation == activationRevision, activeConnectionID == id {
                    taskRequests?.update(state); sessionManager?.update(state); modelControls?.update(state); refresh()
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
                if let oldConnection = self.state.connectionID { taskJournal?.hold(connectionID: oldConnection) }
                retireMedia(); wireRevision = UUID()
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
            deviceApproval = state.deviceApproval
            if deviceApproval != nil, deviceApprovalNotice { notice = nil; deviceApprovalNotice = false }
            taskRequests?.update(state); sessionManager?.update(state); modelControls?.update(state)
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
            sessionManager?.catalogChanged()
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
        restoreNavigationIfAvailable()
        for key in presentation.conversations.keys { updatePresentation(key) }
    }

    private func restoreNavigationIfAvailable() {
        guard let connectionID = activeConnectionID else { return }
        let routes = sessions.filter { $0.connectionID == connectionID && $0.archived != true }.map {
            ConversationID(connectionID: connectionID, agentID: $0.agentID, sessionID: $0.key)
        }
        let mainRoutes = agents.filter { $0.connectionID == connectionID && !$0.mainSessionKey.isEmpty }.map {
            ConversationID(connectionID: connectionID, agentID: $0.agentID, sessionID: $0.mainSessionKey)
        }
        let known = routes + mainRoutes
        let fresh = !showingCachedRoster && state.phase == .ready
        if fresh { navigationHeldRoutes.subtract(known.map(NativeStoredRoute.init)) }
        let decision = preferences.restoration(connectionID: connectionID,
            agents: agents.filter { $0.connectionID == connectionID }.map(\.agentID),
            sessions: known, fresh: fresh)
        switch decision {
        case let .conversation(route):
            if !fresh { navigationHeldRoutes = [NativeStoredRoute(route)] }
            presentation.selectedConversation = route
        case let .catalog(id):
            presentation.selectedConversation = nil
            preferences.opened(.init(id)); updateCatalog(id); presentation.requestedCatalog = id
        case .home:
            presentation.selectedConversation = nil; presentation.requestedCatalog = nil
        case .wait: break
        }
    }

    private func showCatalog(_ id: AgentCatalogID) {
        guard id.connectionID == activeConnectionID, let runtime else { return }
        sessionManager?.refreshAcknowledged()
        if presentation.catalogs[id]?.showingArchived == true { loadArchivedCatalog(id); return }
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
        let archived = previous?.showingArchived == true && state.capabilities.sessionManagement?.archive == true
        let source = archived ? archivedSessions[id.connectionID] ?? [] : sessions
        let rows = sessionPresentations(connectionID: id.connectionID, agentID: id.agentID, source: source).filter { row in
            projectID == nil || source.first(where: { $0.connectionID == id.connectionID && $0.key == row.route.sessionID })?.project?.id == projectID
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
            refresh: state.phase == .ready ? .available : .temporarilyUnavailable(String(localized: "Reconnect to refresh conversations.")),
            archive: state.capabilities.sessionManagement?.archive == true
                ? (state.phase == .ready ? .available : .temporarilyUnavailable(String(localized: "Reconnect to refresh conversations."))) : .unsupported,
            showingArchived: archived)
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

    private func sessionPresentations(connectionID: String, agentID: String, source: [RuntimeSession]? = nil) -> [SessionPresentation] {
        (source ?? sessions).filter { $0.connectionID == connectionID && $0.agentID == agentID && !$0.key.isEmpty }.map { session in
            .init(id: session.key, route: .init(connectionID: connectionID, agentID: agentID, sessionID: session.key),
                  title: displayTitle(for: session), subtitle: session.preview,
                  symbol: session.hasActiveRun ? "ellipsis.bubble" : "bubble.left",
                  isSelected: presentation.selectedConversation == .init(connectionID: connectionID, agentID: agentID, sessionID: session.key),
                  management: managementAvailability, isArchived: session.archived == true)
        }
    }

    private func displayTitle(for session: RuntimeSession) -> String {
        let route = ConversationID(connectionID: session.connectionID, agentID: session.agentID, sessionID: session.key)
        return NativeTranscriptPresentation.title(session.title, key: session.key, nativeSessionID: session.sessionID,
            preview: session.preview, messages: documents[route]?.messages ?? [])
    }

    private func open(_ route: ConversationID) {
        guard route.isConcrete, route.connectionID == activeConnectionID, let cache else { return }
        retireMediaSelection(); mediaVisibleRoute = route
        presentation.requestedCatalog = nil
        preferences.opened(.init(route))
        // Only the mounted route owns an ephemeral scope; saved contexts remain bounded in preferences.
        presentation.readingContexts = [route: .init(restoration: preferences.reading(for: route))]
        let revision = UUID(); selectionRevision = revision
        Task {
            do {
                if documents[route] == nil {
                    let cached = try await cache.read(connectionID: route.connectionID, agentID: route.agentID, sessionID: route.sessionID)
                    guard selectionRevision == revision, presentation.selectedConversation == route else { return }
                    documents[route] = cached
                    presentation.drafts[route] = ComposerDraft(conversationID: route, text: cached.draft)
                    refreshDraftMedia(route)
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
              sessionManager?.isMutating(route) != true,
              let runtime, let document = documents[route] else { return }
        let revision = UUID(); historyRevisions[route] = revision
        let activation = activationRevision, wire = wireRevision
        let liveRevision = liveRevisions[route, default: 0]
        let readSnapshot = Dictionary(uniqueKeysWithValues: document.messages.map { ($0.id, $0) })
        presentation.conversations[route]?.isLoadingHistory = true
        do {
            let history = try await runtime.loadSession(key: route.sessionID, limit: document.historyLimit,
                                                       cursor: earlier ? document.nextCursor : nil)
            guard activation == activationRevision, wire == wireRevision, activeConnectionID == route.connectionID, historyRevisions[route] == revision else { return }
            try await mergeHistory(history, route: route, earlier: earlier, liveRevision: liveRevision,
                readSnapshot: readSnapshot, revision: revision, activation: activation, wire: wire)
            guard activation == activationRevision, wire == wireRevision, historyRevisions[route] == revision else { return }
            presentation.conversations[route]?.isLoadingHistory = false
        } catch {
            guard activation == activationRevision, wire == wireRevision, historyRevisions[route] == revision else { return }
            presentation.conversations[route]?.isLoadingHistory = false
            if presentation.selectedConversation == route { showFailure(error) }
        }
    }

    private func mergeHistory(_ history: RuntimeHistory, route: ConversationID, earlier: Bool, liveRevision: Int64,
                              readSnapshot: [String: NativeMessage], revision: UUID, activation: UUID, wire: UUID) async throws {
        guard var document = documents[route] else { return }
        guard history.key.utf8.elementsEqual(route.sessionID.utf8) else { throw RuntimeFailure(.invalidResponse) }
        let projection = try NativeHistoryApplication.prepare(history, stored: document.messages,
            readSnapshot: readSnapshot, epoch: nil, route: route, earlier: earlier)
        // A release intent must be durable before any consumer can save a document
        // that drops the old reference. A concurrent edit/live event keeps that
        // reference and makes this read stale, including across the journal await.
        if !projection.retiringResources.isEmpty {
            guard let media else { throw StoreFailure.unavailable }
            try await media.releaseWhenUnreferenced(projection.retiringResources)
        }
        guard activation == activationRevision, wire == wireRevision, historyRevisions[route] == revision,
              documents[route]?.revision == document.revision else { throw RuntimeFailure(.superseded) }
        retireChangedHistoryMedia(old: document.messages, new: projection.messages)
        document.messages = projection.messages
        document.nextCursor = history.nextCursor; document.hasMore = history.hasMore ?? false
        document.revision += 1; documents[route] = document
        if !earlier, liveRevisions[route, default: 0] == liveRevision {
            if history.hasActiveRun { running[route] = history.activeRun?["runId"]?.stringValue ?? running[route] ?? "" }
            else { running.removeValue(forKey: route) }
        }
        taskJournal?.history(history, route: route, earlier: earlier, acceptedHistoryIDs: projection.acceptedHistoryIDs)
        updatePresentation(route); saveTasks[route]?.cancel()
        try await persist(route)
        guard activation == activationRevision, wire == wireRevision, historyRevisions[route] == revision else { return }
        hydrateHistoryMedia(history, route: route, acceptedHistoryIDs: projection.acceptedHistoryIDs)
        if !projection.retiringResources.isEmpty, let media, let cache { try await media.reclaim(cache: cache) }
    }

    private func loadEarlier(_ route: ConversationID) {
        guard documents[route]?.hasMore == true else { return }
        if documents[route]?.nextCursor == nil { documents[route]?.historyLimit += 80 }
        Task { await loadHistory(route, earlier: true) }
    }

    private func loadModels(_ route: ConversationID) async {
        guard route.connectionID == activeConnectionID, state.capabilities.models else { return }
        await modelControls?.refreshSummary(route)
    }

    private func modelSettingsChanged() {
        rebuildRoster()
        // Resume only previously authorized, undispatched queue entries. Held
        // and uncertain messages always remain an explicit user decision.
        for route in documents.keys where route.connectionID == activeConnectionID && modelControls?.permitsInput(route) != false {
            drainQueue(route)
        }
    }

    private func applyModelSnapshot(_ route: ConversationID, value: RuntimeModelControls, rows: [ModelPresentation]) {
        guard route.connectionID == activeConnectionID, state.phase == .ready else { return }
        var choices: [String: RuntimeModel] = [:]
        for model in value.models {
            guard let id = try? NativeModelControls.modelKey(model) else { return }; choices[id] = model
        }
        modelChoices[route] = choices; mediaModelRevisions[route] = wireRevision
        if value.scope == .global { mediaGlobalModel = (wireRevision, value.models.first(where: \.selected)?.supportsImages) }
        let title = value.models.first(where: \.selected)?.name ?? value.currentModel ?? String(localized: "Choose model")
        let routes = value.scope == .global ? Array(presentation.conversations.keys).filter { $0.connectionID == route.connectionID } : [route]
        for target in routes {
            presentation.conversations[target]?.models = rows
            presentation.conversations[target]?.modelTitle = title
            presentation.conversations[target]?.modelScopeLabel = value.scope == .global
                ? String(localized: "Applies to all conversations") : String(localized: "This conversation")
            updatePresentation(target)
        }
    }

    private func queueModelCommand(_ route: ConversationID, plan: RuntimeSettingCommand) async throws {
        guard route.isConcrete, route.connectionID == activeConnectionID, state.phase == .ready,
              plan.connectionID == route.connectionID, plan.sessionKey == route.sessionID,
              plan.thinkingLevel == nil, let runtime, var document = documents[route],
              sessionManager?.permitsInput(route) != false,
              document.messages.filter({ [.queued, .held, .sending].contains($0.delivery) }).count < 32 else {
            throw RuntimeFailure(.requestBusy)
        }
        let host = sessionHostContext
        let id = UUID().uuidString.lowercased()
        try await runtime.validatePrompt(sessionKey: route.sessionID, input: .init(text: plan.text, idempotencyKey: id))
        guard host.sameConnection(as: sessionHostContext), state.phase == .ready,
              sessionManager?.permitsInput(route) != false, let latest = documents[route],
              latest.revision == document.revision else { throw RuntimeFailure(.superseded) }
        try document.enqueueSettingCommand(plan.text, id: id, timestampMs: Int64(Date().timeIntervalSince1970 * 1_000))
        documents[route] = document; updatePresentation(route)
        do { try await persist(route) }
        catch { updateSend(route, id: id, delivery: .held); updatePresentation(route); throw error }
        guard host.sameConnection(as: sessionHostContext), state.phase == .ready,
              sessionManager?.permitsInput(route) != false else {
            updateSend(route, id: id, delivery: .held); updatePresentation(route)
            scheduleSave(route, immediate: true); throw RuntimeFailure(.superseded)
        }
        drainQueue(route)
    }

    private func send(_ route: ConversationID) {
        guard voice?.attempt?.context.route != route else { return }
        guard !navigationHeldRoutes.contains(NativeStoredRoute(route)), route.connectionID == activeConnectionID, state.phase == .ready, state.capabilities.chat,
              sessionManager?.permitsInput(route) != false, modelControls?.permitsInput(route) != false,
              let document = documents[route], !mediaSendPreparations.contains(route),
              !mediaImports.values.contains(where: { $0.scope.route == route }) else { return }
        guard sessions.first(where: { $0.connectionID == route.connectionID && $0.key == route.sessionID })?.canContinue != false else { return }
        let text = presentation.draft(for: route).text, ids = document.draftResourceIDs
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !ids.isEmpty else { return }
        guard document.messages.filter({ [.queued, .held, .sending].contains($0.delivery) }).count < 32 else {
            presentation.draft(for: route).hint = String(localized: "There are 32 pending messages. Finish or remove one before adding another.")
            return
        }
        let activation = activationRevision, wire = wireRevision, scope = mediaScope(route)
        let id = UUID().uuidString.lowercased()
        mediaSendPreparations.insert(route); updatePresentation(route)
        Task {
            defer { mediaSendPreparations.remove(route); updatePresentation(route) }
            do {
                _ = try await mediaPrompt(route, text: text, ids: ids, idempotencyKey: id)
                guard activation == activationRevision, wire == wireRevision, scope == mediaScope(route),
                      presentation.draft(for: route).text == text, var current = documents[route],
                      current.draftResourceIDs == ids, state.phase == .ready, sessionManager?.permitsInput(route) != false else { return }
                let references = try await mediaReferences(ids)
                try await modelControls?.verifyInput(route)
                try validateMediaModel(route, hasImages: references.contains { $0.kind == .image })
                guard activation == activationRevision, wire == wireRevision, scope == mediaScope(route),
                      presentation.draft(for: route).text == text, documents[route]?.revision == current.revision,
                      !navigationHeldRoutes.contains(NativeStoredRoute(route)), sessionManager?.permitsInput(route) != false, modelControls?.permitsInput(route) != false else { return }
                current.messages.append(.init(id: id, role: .user, local: true, text: text, idempotencyKey: id,
                    timestampMs: Int64(Date().timeIntervalSince1970 * 1000), delivery: .queued, media: references))
                current.draft = ""; current.draftResourceIDs = []; current.revision += 1
                documents[route] = current; mediaDraftRevisions[route] = UUID()
                presentation.draft(for: route).text = ""; presentation.draft(for: route).attachments = []
                presentation.draft(for: route).hint = nil
                updatePresentation(route); scheduleSave(route, immediate: true); drainQueue(route)
            } catch {
                if activation == activationRevision, wire == wireRevision, scope == mediaScope(route) { showMediaFailure(error, route: route) }
            }
        }
    }

    private func drainQueue(_ route: ConversationID) {
        guard !navigationHeldRoutes.contains(NativeStoredRoute(route)), route.connectionID == activeConnectionID, state.phase == .ready, state.capabilities.chat,
              sessionManager?.permitsInput(route) != false, modelControls?.permitsInput(route) != false,
              running[route] == nil, sendTasks[route] == nil, let runtime,
              let queued = documents[route]?.messages.first(where: { $0.isOwnedUser && $0.delivery == .queued }),
              let id = queued.idempotencyKey else { return }
        guard sessions.first(where: { $0.connectionID == route.connectionID && $0.key == route.sessionID })?.canContinue != false else { return }
        let activation = activationRevision, wire = wireRevision
        sendTasks[route] = Task {
            var reserved = false
            do {
                let input = try await mediaPrompt(route, text: queued.text, ids: queued.media.compactMap(\.resourceID), idempotencyKey: id)
                guard activation == activationRevision, wire == wireRevision, state.phase == .ready,
                      let current = documents[route]?.messages.first(where: { $0.id == queued.id }),
                      current.delivery == .queued, current.text == queued.text, current.media == queued.media,
                      current.idempotencyKey == id else { sendTasks.removeValue(forKey: route); return }
                // Complete local frame/model validation before retiring editable ownership.
                // Then reserve synchronously before the persistence await.
                updateSend(route, id: queued.id, delivery: .sending); reserved = true
                try await persist(route)
                guard activation == activationRevision, wire == wireRevision, route.connectionID == activeConnectionID, state.phase == .ready,
                      sessionManager?.permitsInput(route) != false, running[route] == nil else {
                    updateSend(route, id: queued.id, delivery: .held)
                    sendTasks.removeValue(forKey: route); scheduleSave(route, immediate: true); return
                }
                try await modelControls?.verifyInput(route)
                guard activation == activationRevision, wire == wireRevision, state.phase == .ready,
                      !navigationHeldRoutes.contains(NativeStoredRoute(route)), sessionManager?.permitsInput(route) != false, modelControls?.permitsInput(route) != false else {
                    updateSend(route, id: queued.id, delivery: .held)
                    sendTasks.removeValue(forKey: route); scheduleSave(route, immediate: true); return
                }
                try validateMediaModel(route, hasImages: input.attachments.contains { $0.type == .image })
                let receipt = try await runtime.send(sessionKey: route.sessionID, input: input)
                if activation == activationRevision, wire == wireRevision {
                    taskJournal?.receipt(receipt, route: route, input: queued.text)
                    updateSend(route, id: queued.id, delivery: .sent, runID: receipt.runID)
                    if finishedRuns[route]?.contains(receipt.runID) != true { running[route] = receipt.runID }
                } else { updateSend(route, id: queued.id, delivery: .uncertain, runID: receipt.runID) }
            } catch {
                let current = documents[route]?.messages.first(where: { $0.id == queued.id })
                if reserved || (current?.delivery == .queued && current?.text == queued.text && current?.media == queued.media) {
                    let failure = error as? RuntimeFailure
                    let delivery = failure?.delivery
                    let paused = modelControls?.permitsInput(route) == false && (delivery == .notDispatched || delivery == .rejectedBeforeDispatch)
                    updateSend(route, id: queued.id, delivery: delivery == .uncertain || delivery == .responseReceived ? .uncertain : paused ? .held : .failed)
                    if activation == activationRevision, wire == wireRevision, route == presentation.selectedConversation { showMediaFailure(error, route: route) }
                }
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
        guard !navigationHeldRoutes.contains(NativeStoredRoute(route)), route.connectionID == activeConnectionID, state.capabilities.abort,
              sessionManager?.permitsInput(route) != false, let runtime else { return }
        guard sessions.first(where: { $0.connectionID == route.connectionID && $0.key == route.sessionID })?.canContinue != false else { return }
        let runID = running[route]?.nilIfEmpty
        let activation = activationRevision, wire = wireRevision
        Task {
            guard activation == activationRevision, wire == wireRevision, route.connectionID == activeConnectionID,
                  sessionManager?.permitsInput(route) != false else { return }
            do { try await runtime.abort(sessionKey: route.sessionID, runID: runID) }
            catch { if activation == activationRevision, wire == wireRevision, route.connectionID == activeConnectionID { showFailure(error) } }
        }
    }

    private func receive(_ update: RuntimeSessionUpdate, connectionID: String) {
        switch update {
        case let .runStarted(key, runID):
            for route in journalRoutes(connectionID: connectionID, sessionKey: key) { taskJournal?.started(route, runID: runID) }
            for route in documents.keys where route.connectionID == connectionID && route.sessionID == key {
                liveRevisions[route, default: 0] += 1
                running[route] = runID; updatePresentation(route)
            }
        case let .text(update):
            for route in journalRoutes(connectionID: connectionID, sessionKey: update.sessionKey) { taskJournal?.text(update, route: route) }
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
        case let .runFinished(key, runID, reason, _, _):
            for route in journalRoutes(connectionID: connectionID, sessionKey: key) { taskJournal?.finished(route, runID: runID, reason: reason, completion: update.workCompletion) }
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
                bindFinalMedia(update, route: route, runID: runID)
                updatePresentation(route); scheduleSave(route)
                drainQueue(route)
            }
        case let .sessionMetadata(session):
            sessionManager?.catalogChanged(sessionKey: session.key)
            sessions.removeAll { $0.key == session.key && $0.connectionID == connectionID }; sessions.append(session); rebuildRoster()
        case let .work(work):
            guard let key = work.sessionKey else { return }
            for route in journalRoutes(connectionID: connectionID, sessionKey: key) {
                taskJournal?.record(work, route: route); updatePresentation(route)
            }
        case .thought, .tool, .other: break
        }
    }

    private func journalRoutes(connectionID: String, sessionKey: String) -> Set<ConversationID> {
        var routes = Set(documents.keys.filter { $0.connectionID == connectionID && $0.sessionID == sessionKey })
        for session in sessions where session.connectionID == connectionID && session.key == sessionKey {
            routes.insert(.init(connectionID: connectionID, agentID: session.agentID, sessionID: sessionKey))
        }
        return routes
    }

    func updatePresentation(_ route: ConversationID) {
        guard let document = documents[route] else { return }
        let name = agents.first { $0.agentID == route.agentID && $0.connectionID == route.connectionID }?.name ?? String(localized: "Agent")
        let session = sessions.first { $0.key == route.sessionID && $0.connectionID == route.connectionID }
        let connected = route.connectionID == activeConnectionID && state.phase == .ready && !navigationHeldRoutes.contains(NativeStoredRoute(route))
        var features: [ClientFeature: ActionAvailability] = [.connectionSettings: .available]
        if state.capabilities.chat {
            features[.send] = connected ? .available
                : .temporarilyUnavailable(String(localized: "Reconnect to send. Your draft is saved."))
            if session?.canContinue == false { features[.send] = .temporarilyUnavailable(String(localized: "This conversation is read-only here.")) }
        }
        if sessionManager?.permitsInput(route) == false {
            features[.send] = .temporarilyUnavailable(String(localized: "Review the conversation update before sending."))
        }
        if let barrier = modelControls?.barrier(route) {
            features[.send] = .temporarilyUnavailable(barrier == .permissionsRequired
                ? String(localized: "Choose permissions again before sending.")
                : String(localized: "Review model settings before sending."))
        } else if modelControls?.permitsInput(route) == false {
            features[.send] = .temporarilyUnavailable(String(localized: "Review model settings before sending."))
        }
        if managementAvailability.isVisible {
            features[.sessionManagement] = navigationHeldRoutes.contains(NativeStoredRoute(route))
                ? .temporarilyUnavailable(String(localized: "Reconnect and reopen conversation actions.")) : managementAvailability
        }
        if state.capabilities.abort && sessionManager?.permitsInput(route) != false && running[route] != nil && session?.canContinue != false { features[.stop] = connected ? .available : .temporarilyUnavailable(String(localized: "Reconnect to stop this run.")) }
        if state.capabilities.sessions { features[.sessions] = .available }
        if state.capabilities.sessionCreate {
            let catalogID = AgentCatalogID(connectionID: route.connectionID, agentID: route.agentID)
            features[.newSession] = connected && !creatingCatalogs.contains(catalogID) && !unconfirmedCreations.contains(catalogID) ? .available
                : .temporarilyUnavailable(String(localized: "Reconnect or refresh conversations before creating another."))
        }
        if state.capabilities.models {
            features[.modelControls] = connected ? .available : .temporarilyUnavailable(String(localized: "Reconnect to review model settings."))
            features[.models] = connected ? .available : .temporarilyUnavailable(String(localized: "Reconnect to change models."))
            if state.capabilities.modelPerSession && session?.canContinue == false { features[.models] = .temporarilyUnavailable(String(localized: "This conversation is read-only here.")) }
        }
        if document.hasMore { features[.loadEarlier] = connected ? .available : .temporarilyUnavailable(String(localized: "Reconnect to load earlier messages.")) }
        addMediaFeatures(route, features: &features)
        addVoiceFeatures(route, editable: session?.canContinue != false, features: &features)
        addHistoryFeatures(route, features: &features)
        prepareMessageMedia(route)
        let previous = presentation.conversations[route]
        let hasParticipants = document.messages.contains { $0.role == .user && $0.attribution != nil }
        let transcript: [MessagePresentation] = document.messages.filter(NativeTranscriptPresentation.isVisible)
            .map { present($0, agentName: name, route: route, hasParticipants: hasParticipants) }
        let requests: [MessagePresentation] = taskRequests?.messages(for: route) ?? []
        let messages: [MessagePresentation] = transcript + requests
        presentation.conversations[route] = .init(id: route, agentName: name, sessionTitle: session.map { displayTitle(for: $0) } ?? name,
            messages: messages,
            connection: presentation.connection,
            sessions: sessionPresentations(connectionID: route.connectionID, agentID: route.agentID),
            models: previous?.models ?? [], modelTitle: previous?.modelTitle,
            modelScopeLabel: previous?.modelScopeLabel, sendLabel: running[route] == nil ? String(localized: "Send") : String(localized: "Add to queue"),
            isLoadingHistory: previous?.isLoadingHistory ?? false, features: features, work: taskJournal?.work(for: route))
    }

    func present(_ message: NativeMessage, agentName: String, route: ConversationID? = nil,
                 hasParticipants: Bool = false) -> MessagePresentation {
        let author = NativeTranscriptPresentation.author(message, agentName: agentName, hasParticipants: hasParticipants)
        var content: [MessageContent] = [.markdown(message.text)]
        content += message.media.map { .attachment(mediaPresentation($0)) }
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
        let ownedPending = message.isOwnedUser && message.idempotencyKey?.isEmpty == false
        if ownedPending && [.queued, .held, .failed].contains(message.delivery) { actions += [.edit, .remove] }
        if ownedPending && message.delivery == .held, let route, route.connectionID == activeConnectionID,
           state.phase == .ready, !navigationHeldRoutes.contains(NativeStoredRoute(route)), sessionManager?.permitsInput(route) != false,
           modelControls?.permitsInput(route) != false { actions.append(.sendNow) }
        return .init(id: message.id, author: author, content: content,
                     timeLabel: NativeTranscriptPresentation.timeLabel(message.timestampMs),
                     delivery: message.isOwnedUser ? delivery : nil, isStreaming: message.streaming, actions: actions)
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
            guard message.isOwnedUser, message.idempotencyKey?.isEmpty == false,
                  message.delivery == .held, !navigationHeldRoutes.contains(NativeStoredRoute(route)), route.connectionID == activeConnectionID, state.phase == .ready,
                  sessionManager?.permitsInput(route) != false, modelControls?.permitsInput(route) != false,
                  let index = documents[route]?.messages.firstIndex(where: { $0.id == messageID }) else { return }
            documents[route]?.messages[index].delivery = .queued; changed(route)
            updatePresentation(route); scheduleSave(route, immediate: true); drainQueue(route)
        case .remove:
            guard var document = documents[route] else { return }
            do { try document.removePending(messageID: messageID) } catch { return }
            documents[route] = document
            releaseMediaAfterCommit(route, ids: Set(message.media.compactMap(\.resourceID)))
            updatePresentation(route)
        default: break
        }
    }

    func savePendingEdit(_ edit: NativePendingEdit, route: ConversationID, activation: UUID, text: String, media selectedMedia: [NativeMediaReference]? = nil) async throws {
        guard activation == activationRevision, route.connectionID == activeConnectionID,
              destination?.id == edit.id.uuidString, let original = documents[route] else { throw StoreFailure.invalidDocument }
        var updated = original
        try updated.apply(edit, text: text, media: selectedMedia)
        documents[route] = updated; updatePresentation(route)
        saveTasks[route]?.cancel()
        let released = Set(edit.originalMedia.compactMap(\.resourceID)).subtracting((selectedMedia ?? edit.originalMedia).compactMap(\.resourceID))
        do {
            try await media?.releaseWhenUnreferenced(released)
            try await persist(route)
            if let media, let cache { try await media.reclaim(cache: cache) }
        }
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
              current.idempotencyKey == edit.idempotencyKey, current.text == text, current.media == (selectedMedia ?? edit.originalMedia), current.delivery == .held else {
            throw StoreFailure.invalidDocument
        }
        destination = nil
    }

    func changed(_ route: ConversationID) { documents[route]?.revision += 1 }

    func scheduleSave(_ route: ConversationID, immediate: Bool = false) {
        saveTasks[route]?.cancel()
        saveTasks[route] = Task {
            if !immediate { try? await Task.sleep(for: .milliseconds(350)) }
            guard !Task.isCancelled else { return }
            do { try await persist(route) }
            catch { presentation.draft(for: route).hint = String(localized: "This draft could not be saved. Keep Clawket open and try again.") }
        }
    }

    func persist(_ route: ConversationID) async throws {
        guard let cache, let document = documents[route] else { throw StoreFailure.unavailable }
        try await cache.write(document, connectionID: route.connectionID, agentID: route.agentID, sessionID: route.sessionID)
    }

    private var sessionHostContext: NativeSessionHostContext {
        .init(activation: activationRevision, wire: wireRevision, selection: selectionRevision)
    }

    private var managementAvailability: ActionAvailability {
        guard !showingCachedRoster, let capabilities = state.capabilities.sessionManagement,
              capabilities.rename || capabilities.reset || capabilities.delete || capabilities.archive || capabilities.branch else { return .unsupported }
        return state.phase == .ready ? .available : .temporarilyUnavailable(String(localized: "Reconnect and reopen conversation actions."))
    }

    private func loadArchivedCatalog(_ id: AgentCatalogID) {
        guard id.connectionID == activeConnectionID, state.phase == .ready,
              state.capabilities.sessionManagement?.archive == true, let runtime else { return }
        updateCatalog(id)
        guard archiveReads[id.connectionID] == nil else { return }
        let token = UUID(), host = sessionHostContext
        archiveReads[id.connectionID] = token
        presentation.catalogs[id]?.isLoading = true; presentation.catalogs[id]?.error = nil
        Task {
            defer {
                if archiveReads[id.connectionID] == token {
                    archiveReads.removeValue(forKey: id.connectionID)
                    presentation.catalogs[id]?.isLoading = false
                }
            }
            do {
                let rows = try await runtime.listArchivedSessions()
                guard host.sameConnection(as: sessionHostContext), archiveReads[id.connectionID] == token,
                      id.connectionID == activeConnectionID else { return }
                archivedSessions[id.connectionID] = rows; updateCatalog(id)
            } catch {
                guard host.sameConnection(as: sessionHostContext), archiveReads[id.connectionID] == token else { return }
                presentation.catalogs[id]?.error = String(localized: "Could not load archived conversations.")
            }
        }
    }

    private func prepareSessionMutation(_ target: NativeSessionMutationTarget) async throws {
        guard target.host.sameConnection(as: sessionHostContext), target.route.connectionID == activeConnectionID,
              state.phase == .ready else { throw RuntimeFailure(.superseded) }
        historyRevisions[target.route] = UUID()
        presentation.conversations[target.route]?.isLoadingHistory = false
        if [.reset, .delete, .archive].contains(target.action), var document = documents[target.route] {
            guard sendTasks[target.route] == nil, !mediaSendPreparations.contains(target.route), !document.messages.contains(where: { $0.delivery == .sending }) else {
                throw RuntimeFailure(.requestBusy)
            }
            if try document.holdForSessionMutation() {
                documents[target.route] = document
                saveTasks[target.route]?.cancel()
                try await persist(target.route)
            }
        }
        guard target.host.sameConnection(as: sessionHostContext), state.phase == .ready else { throw RuntimeFailure(.superseded) }
    }

    private func sessionMutationFinished(_ outcome: NativeSessionMutationOutcome) {
        switch outcome {
        case let .acknowledged(target, roster, created):
            guard target.host.sameConnection(as: sessionHostContext), target.route.connectionID == activeConnectionID,
                  let roster, roster.connectionID == activeConnectionID else { return }
            showingCachedRoster = false; agents = roster.agents; sessions = roster.sessions
            historyRevisions[target.route] = UUID()
            if target.action == .restore || target.action == .archive { archivedSessions[target.route.connectionID] = nil }
            if target.action == .branch, let created, target.host.selection == selectionRevision {
                presentation.selectedConversation = .init(connectionID: created.connectionID, agentID: created.agentID, sessionID: created.key)
            } else if [.delete, .archive].contains(target.action), target.host.selection == selectionRevision,
                      presentation.selectedConversation == target.route,
                      !roster.sessions.contains(where: { $0.connectionID == target.route.connectionID && $0.key == target.route.sessionID }) {
                presentation.selectedConversation = nil
            }
            rebuildRoster()
            if target.action == .reset, presentation.selectedConversation == target.route {
                let host = sessionHostContext
                Task {
                    guard host.sameConnection(as: sessionHostContext) else { return }
                    await loadHistory(target.route)
                }
            }
            for id in presentation.catalogs.keys where id.connectionID == target.route.connectionID && presentation.catalogs[id]?.showingArchived == true {
                loadArchivedCatalog(id)
            }
        case .notDispatched, .uncertain:
            // Keep content and held queue values. Unknown outcomes stay locked in sessionManager.
            rebuildRoster()
        }
    }

    func checkDeviceApproval(connectionID: String, contextID: UUID) {
        guard !changingConnections, runtime != nil, vault != nil,
              NativeDeviceApprovalPolicy.matches(deviceApproval, connectionID: connectionID,
                  contextID: contextID, activeConnectionID: activeConnectionID) else { return }
        activate(connectionID)
    }

    func isCheckingDeviceApproval(connectionID: String) -> Bool {
        activeConnectionID == connectionID && (changingConnections || [.connecting, .handshaking, .reconnecting].contains(state.phase))
    }

    private func connectionPresentation(_ state: RuntimeConnectionState) -> ConnectionPresentation {
        if let approval = state.deviceApproval, approval.connectionID == state.connectionID {
            return .init(phase: .approvalRequired, label: String(localized: "Device approval required"),
                connectionID: approval.connectionID, action: .available, approvalReviewID: approval.id)
        }
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

    func showFailure(_ error: Error) {
        deviceApprovalNotice = false
        if error is NativeHistoryFailure { notice = NativeHistoryController.failureText(error); return }
        if error is StoreFailure { notice = String(localized: "Your data could not be saved safely. Keep Clawket open and try again."); return }
        guard let failure = error as? RuntimeFailure else { notice = String(localized: "The operation could not be completed. Please try again."); return }
        switch failure.code {
        case .authenticationRequired:
            notice = NativeDeviceApprovalPolicy.failureText(failure.code, backend: state.backendKind)
        case .pairingRequired:
            if deviceApproval == nil {
                deviceApprovalNotice = state.backendKind == .openclaw
                notice = NativeDeviceApprovalPolicy.failureText(failure.code, backend: state.backendKind)
            }
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
