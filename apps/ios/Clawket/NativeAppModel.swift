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
    let rosterState = NativeRosterState()
    private var rosterReading = NativeRosterReadingVisibility()
    private var rosterForeground = true
    private var rosterHistoryReady: [ConversationID: NativeRosterHistoryRead] = [:]
    /// Nil preserves the pre-provider fallback; any injected set is authoritative, including an empty set.
    var rosterExplicitAccess: Set<AgentCatalogID>? = nil { didSet { rebuildRoster() } }
    let preferences = NativePreferences()
    let presentation = ClientPresentation(title: String(localized: "Agents"),
        emptyTitle: String(localized: "Your agents, within reach"),
        emptyDetail: String(localized: "Connect an agent to continue conversations and keep work moving."))
    @Published var destination: Destination? { didSet { markVisibleRosterRead() } }
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
    private var physicalOperations: [NativeHistoryScope: UUID] = [:]
    private var physicalFailures: Set<NativeHistoryScope> = []
    private var preparedPhysicalMutations: [UUID: ConversationID] = [:]
    private var previousPhysicalUncertainty: [UUID: Bool] = [:]
    private var physicalReady: Set<NativeHistoryScope> = []
    private var physicalLiveEvidence: [NativeHistoryScope: NativePhysicalLiveEvidence] = [:]
    private var physicalRecoveryTasks: [NativeHistoryScope: Task<Void, Never>] = [:]
    private var physicalRecoveryIDs: [NativeHistoryScope: UUID] = [:]
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
        rosterState.onFailure = { [weak self] in self?.notice = String(localized: "Preferences are unavailable. Reopen Clawket before trying again.") }
        rosterState.onChange = { [weak self] in Task { @MainActor [weak self] in self?.rebuildRoster() } }
        await rosterState.load()
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
        case let .setAgentPinned(scope, pinned):
            guard let agent = rosterAgent(scope), canUseRosterActions(agent) else { return }
            rosterState.setAgentPinned(scope, pinned: pinned)
        case let .setSessionOnHome(route, visible):
            guard let session = rosterSession(route), session.archived != true, session.allowedActions?.pin == true,
                  let agent = rosterAgent(.init(connectionID: route.connectionID, agentID: route.agentID)), canUseRosterActions(agent) else { return }
            rosterState.setSessionOnHome(route, visible: visible)
        case let .markAgentRead(scope):
            guard let agent = rosterAgent(scope), canUseRosterActions(agent), rosterIsLive else { return }
            rosterState.markRead(sessions.filter { scope == AgentCatalogID(connectionID: $0.connectionID, agentID: $0.agentID) })
        case let .markSessionRead(route):
            guard let session = rosterSession(route), let agent = rosterAgent(.init(connectionID: route.connectionID, agentID: route.agentID)),
                  canUseRosterActions(agent), rosterIsLive else { return }
            rosterState.markRead([session])
        case let .conversationReadingVisibilityChanged(route, viewID, scope, visible):
            guard presentation.acceptsReadingContext(for: route, scopeID: scope) else { return }
            rosterReading.update(route, viewID: viewID, scope: scope, visible: visible,
                currentView: conversationVisibility.isShowing(route, viewID: viewID)); markVisibleRosterRead()
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
        retirePreparedPhysicalMutations(); selectionRevision = UUID(); activationRevision = UUID(); wireRevision = UUID(); physicalReady = []
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
                    activationRevision = UUID(); wireRevision = UUID(); physicalReady = []
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
        rosterForeground = foreground
        preferences.setForeground(foreground)
        if foreground { markVisibleRosterRead() }
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
        retireMedia(); activationTask?.cancel(); retirePreparedPhysicalMutations(); selectionRevision = UUID(); activationRevision = UUID(); wireRevision = UUID(); physicalReady = []
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
                retirePreparedPhysicalMutations(); retireMedia(); wireRevision = UUID(); physicalReady = []
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
            if state.phase == .ready { rosterState.seedIfUnset(connectionID: roster.connectionID, sessions: roster.sessions) }
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

    private var rosterIsLive: Bool { !showingCachedRoster && state.phase == .ready }
    private func rosterAgent(_ scope: AgentCatalogID) -> RuntimeAgent? {
        guard scope.connectionID.utf8.elementsEqual((activeConnectionID ?? "").utf8) else { return nil }
        return agents.first { NativeRosterProjection.scope($0) == scope }
    }
    private func rosterSession(_ route: ConversationID) -> RuntimeSession? {
        guard route.connectionID.utf8.elementsEqual((activeConnectionID ?? "").utf8) else { return nil }
        return sessions.first { NativeRosterProjection.route($0) == route }
    }
    private func canUseRosterActions(_ agent: RuntimeAgent) -> Bool {
        rosterState.canSave && NativeRosterProjection.canUseLocalActions(agent, freeConnectionID: registry.freeConnectionID,
            explicitAccess: rosterExplicitAccess)
    }
    private func markVisibleRosterRead() {
        guard let route = presentation.selectedConversation,
              rosterReading.permitsRead(route, scope: presentation.readingContexts[route]?.id, foreground: rosterForeground,
                  live: rosterIsLive, historyReady: rosterHistoryReady[route]?.isCurrent(wire: wireRevision, readingScope: presentation.readingContexts[route]?.id) == true,
                  obscured: destination != nil || mediaPicker != nil || mediaPreview != nil || voiceSheet != nil,
                  held: navigationHeldRoutes.contains(.init(route))), let session = rosterSession(route) else { return }
        rosterState.markRead([session])
    }
    private func rebuildRoster() {
        presentation.isLoading = false
        markVisibleRosterRead()
        let snapshot = rosterState.document
        let index = rosterState.index
        let summaries = NativeRosterProjection.summaries(agents: agents, sessions: sessions, document: snapshot,
            connectionID: activeConnectionID ?? "", live: rosterIsLive)
        presentation.agents = summaries.flatMap { summary -> [AgentPresentation] in
            let agent = summary.agent, scope = NativeRosterProjection.scope(agent)
            let mode: AgentEntryMode = agent.entryMode == .sessions || agent.mainSessionKey.isEmpty
                ? .catalog(scope) : .conversation(.init(connectionID: agent.connectionID, agentID: agent.agentID, sessionID: agent.mainSessionKey))
            let connection = connections.first { $0.id.utf8.elementsEqual(agent.connectionID.utf8) }
            let backend = connection?.backendKind.title
            let localAccess = canUseRosterActions(agent)
            let pending = rosterIsLive ? taskRequests?.attention(connectionID: agent.connectionID,
                sessionKeys: Set(summary.sessions.map(\.key)).union(agent.mainSessionKey.isEmpty ? [] : [agent.mainSessionKey])) ?? .none : .none
            let attention = NativeRosterProjection.stronger(summary.attention, pending)
            var preview = summary.previewSession?.preview ?? (agent.entryMode == .sessions ? summary.recent.map { displayTitle(for: $0) } : nil) ?? ""
            if let source = summary.previewSession, source.preview != nil, !source.key.utf8.elementsEqual(agent.mainSessionKey.utf8),
               agent.entryMode != .sessions, connection?.backendKind != .pi {
                preview = "\(displayTitle(for: source)): \(preview)"
            }
            var rows = [AgentPresentation(id: NativeRosterProjection.renderID(scope), entryMode: mode, name: agent.name,
                subtitle: preview, backendLabel: backend, initials: String(agent.name.prefix(1)),
                timeLabel: rosterTime(summary.lastActivityAtMs), unread: summary.unread, attention: attention,
                isWorking: rosterIsLive && summary.sessions.contains(where: \.hasActiveRun),
                cachedLabel: rosterIsLive ? nil : String(localized: "Saved on this device"), isPinned: summary.pinned,
                localActions: .init(pin: localAccess ? .available : .unsupported,
                    markRead: localAccess && rosterIsLive && summary.sessions.contains(where: { NativeRosterProjection.unread($0, index: index, live: true) }) ? .available : .unsupported,
                    connectionSettings: .available))]
            rows += summary.home.map { session in
                AgentPresentation(id: NativeRosterProjection.renderID(scope, sessionID: session.key), route: NativeRosterProjection.route(session),
                    kind: .pinnedSession, name: displayTitle(for: session), subtitle: session.preview ?? "", backendLabel: backend,
                    symbol: "bubble.left", initials: String(agent.name.prefix(1)), timeLabel: rosterTime(NativeRosterProjection.activity(session)),
                    unread: NativeRosterProjection.unread(session, index: index, live: rosterIsLive), attention: rosterIsLive ? NativeRosterProjection.attention(session) : .none,
                    isWorking: rosterIsLive && session.hasActiveRun, cachedLabel: rosterIsLive ? nil : String(localized: "Saved on this device"),
                    localActions: .init(pin: localAccess ? .available : .unsupported,
                        markRead: localAccess && NativeRosterProjection.unread(session, index: index, live: rosterIsLive) ? .available : .unsupported))
            }
            return rows
        }
        for key in presentation.catalogs.keys { updateCatalog(key) }
        restoreNavigationIfAvailable()
        for key in presentation.conversations.keys { updatePresentation(key) }
    }
    private func rosterTime(_ time: Int64?) -> String? {
        guard let time else { return nil }
        return Date(timeIntervalSince1970: Double(time) / 1_000).formatted(.relative(presentation: .named))
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
                  unread: NativeRosterProjection.unread(session, index: rosterState.index, live: rosterIsLive),
                  management: managementAvailability, isArchived: session.archived == true,
                  isOnHome: rosterState.index.preference(.init(connectionID: connectionID, agentID: agentID)).homeSessions.contains { $0.utf8.elementsEqual(session.key.utf8) },
                  homeAction: rosterAgent(.init(connectionID: connectionID, agentID: agentID)).map {
                      canUseRosterActions($0) && session.archived != true && session.allowedActions?.pin == true ? .available : .unsupported
                  } ?? .unsupported,
                  markReadAction: rosterAgent(.init(connectionID: connectionID, agentID: agentID)).map {
                      canUseRosterActions($0) && NativeRosterProjection.unread(session, index: rosterState.index, live: rosterIsLive) ? .available : .unsupported
                  } ?? .unsupported)
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
        rosterHistoryReady.removeValue(forKey: route)
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
                    taskJournal?.bindHistoryScope(route, epoch: cached.historyEpoch)
                    taskRequests?.bindHistoryScope(route, epoch: cached.historyEpoch)
                    if cached.physicalMutationUnconfirmed == true { taskRequests?.pauseHistoryScope(route) }
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
        guard physicalOperations[NativeHistoryScope(route)] == nil,
              !physicalFailures.contains(NativeHistoryScope(route)) else { return }
        guard route.connectionID == activeConnectionID, state.phase == .ready, state.capabilities.history,
              sessionManager?.isMutating(route) != true,
              let runtime, let document = documents[route] else { return }
        let revision = UUID(); historyRevisions[route] = revision
        let activation = activationRevision, wire = wireRevision
        let liveRevision = liveRevisions[route, default: 0]
        let readSnapshot = Dictionary(uniqueKeysWithValues: document.messages.map { ($0.id, $0) })
        let readingScope = presentation.readingContexts[route]?.id
        presentation.conversations[route]?.isLoadingHistory = true
        do {
            let history = try await runtime.loadSession(key: route.sessionID, limit: document.historyLimit,
                                                       cursor: earlier ? document.nextCursor : nil)
            guard activation == activationRevision, wire == wireRevision, activeConnectionID == route.connectionID, historyRevisions[route] == revision else { return }
            try await mergeHistory(history, route: route, earlier: earlier, liveRevision: liveRevision,
                readSnapshot: readSnapshot, revision: revision, activation: activation, wire: wire)
            guard activation == activationRevision, wire == wireRevision, historyRevisions[route] == revision else { return }
            if let evidence = NativeRosterHistoryRead.accepted(wire: wire, readingScope: readingScope, earlier: earlier),
               presentation.readingContexts[route]?.id == evidence.readingScope {
                rosterHistoryReady = [route: evidence]
                markVisibleRosterRead()
            }
            presentation.conversations[route]?.isLoadingHistory = false
        } catch {
            guard activation == activationRevision, wire == wireRevision, historyRevisions[route] == revision else { return }
            presentation.conversations[route]?.isLoadingHistory = false
            if presentation.selectedConversation == route { showFailure(error) }
        }
    }

    private func mergeHistory(_ history: RuntimeHistory, route: ConversationID, earlier: Bool, liveRevision: Int64,
                              readSnapshot: [String: NativeMessage], revision: UUID, activation: UUID, wire: UUID) async throws {
        guard history.key.utf8.elementsEqual(route.sessionID.utf8) else { throw RuntimeFailure(.invalidResponse) }
        guard let original = documents[route] else { throw RuntimeFailure(.superseded) }
        let decision = try NativePhysicalHistoryPolicy.head(history.sessionID, current: original, earlier: earlier)
        if decision != .unchanged {
            try await reconcilePhysicalHistory(route, decision: decision) {
                activation == self.activationRevision && wire == self.wireRevision &&
                    self.historyRevisions[route] == revision && self.activeConnectionID == route.connectionID
            }
        }
        guard var document = documents[route] else { throw RuntimeFailure(.superseded) }
        let projection = try NativeHistoryApplication.prepare(history, stored: document.messages,
            readSnapshot: readSnapshot, epoch: document.historyEpoch, route: route, earlier: earlier)
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
        guard activation == activationRevision, wire == wireRevision, historyRevisions[route] == revision else { throw RuntimeFailure(.superseded) }
        if !earlier {
            let scope = NativeHistoryScope(route)
            if physicalLiveEvidence[scope] == nil, let epoch = document.historyEpoch {
                physicalLiveEvidence[scope] = .init(epoch: epoch, retiringRunIDs: [])
            }
            physicalReady.insert(scope); taskRequests?.refresh(route: route); updatePresentation(route)
        }
        if !earlier, history.hasActiveRun, let runID = history.activeRun?["runId"]?.stringValue {
            physicalLiveEvidence[NativeHistoryScope(route)]?.admit(runID)
        }
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
        guard physicalPermitsInput(route), route.isConcrete, route.connectionID == activeConnectionID, state.phase == .ready,
              plan.connectionID == route.connectionID, plan.sessionKey == route.sessionID,
              plan.thinkingLevel == nil, let runtime, var document = documents[route],
              sessionManager?.permitsInput(route) != false,
              document.messages.filter({ [.queued, .held, .sending].contains($0.delivery) }).count < 32 else {
            throw RuntimeFailure(.requestBusy)
        }
        let host = sessionHostContext, epoch = document.historyEpoch
        let id = UUID().uuidString.lowercased()
        try await runtime.validatePrompt(sessionKey: route.sessionID, input: .init(text: plan.text, idempotencyKey: id))
        guard physicalPermitsInput(route), documents[route]?.historyEpoch == epoch, host.sameConnection(as: sessionHostContext), state.phase == .ready,
              sessionManager?.permitsInput(route) != false, let latest = documents[route],
              latest.revision == document.revision else { throw RuntimeFailure(.superseded) }
        try document.enqueueSettingCommand(plan.text, id: id, timestampMs: Int64(Date().timeIntervalSince1970 * 1_000))
        document.messages[document.messages.count - 1].historyEpoch = document.historyEpoch
        documents[route] = document; updatePresentation(route)
        do { try await persist(route) }
        catch { updateSend(route, id: id, delivery: .held); updatePresentation(route); throw error }
        guard physicalPermitsInput(route), documents[route]?.historyEpoch == epoch, host.sameConnection(as: sessionHostContext), state.phase == .ready,
              sessionManager?.permitsInput(route) != false else {
            updateSend(route, id: id, delivery: .held); updatePresentation(route)
            scheduleSave(route, immediate: true); throw RuntimeFailure(.superseded)
        }
        drainQueue(route)
    }

    private func send(_ route: ConversationID) {
        guard voice?.attempt?.context.route != route else { return }
        guard physicalPermitsInput(route), !navigationHeldRoutes.contains(NativeStoredRoute(route)), route.connectionID == activeConnectionID, state.phase == .ready, state.capabilities.chat,
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
                guard physicalPermitsInput(route), activation == activationRevision, wire == wireRevision, scope == mediaScope(route),
                      presentation.draft(for: route).text == text, var current = documents[route],
                      current.draftResourceIDs == ids, state.phase == .ready, sessionManager?.permitsInput(route) != false else { return }
                let references = try await mediaReferences(ids)
                try await modelControls?.verifyInput(route)
                try validateMediaModel(route, hasImages: references.contains { $0.kind == .image })
                guard physicalPermitsInput(route), activation == activationRevision, wire == wireRevision, scope == mediaScope(route),
                      presentation.draft(for: route).text == text, documents[route]?.revision == current.revision,
                      !navigationHeldRoutes.contains(NativeStoredRoute(route)), sessionManager?.permitsInput(route) != false, modelControls?.permitsInput(route) != false else { return }
                current.messages.append(.init(id: id, role: .user, local: true, text: text, idempotencyKey: id,
                    timestampMs: Int64(Date().timeIntervalSince1970 * 1000), delivery: .queued, media: references,
                    historyEpoch: current.historyEpoch))
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
        guard physicalPermitsInput(route), !navigationHeldRoutes.contains(NativeStoredRoute(route)), route.connectionID == activeConnectionID, state.phase == .ready, state.capabilities.chat,
              sessionManager?.permitsInput(route) != false, modelControls?.permitsInput(route) != false,
              running[route] == nil, sendTasks[route] == nil, let runtime,
              let document = documents[route],
              let queued = document.messages.first(where: { $0.isOwnedUser && $0.delivery == .queued && $0.historyEpoch == document.historyEpoch }),
              let id = queued.idempotencyKey else { return }
        guard sessions.first(where: { $0.connectionID == route.connectionID && $0.key == route.sessionID })?.canContinue != false else { return }
        let activation = activationRevision, wire = wireRevision, epoch = document.historyEpoch
        sendTasks[route] = Task {
            var reserved = false, wireEntered = false
            do {
                let input = try await mediaPrompt(route, text: queued.text, ids: queued.media.compactMap(\.resourceID), idempotencyKey: id)
                guard physicalPermitsInput(route), documents[route]?.historyEpoch == epoch,
                      activation == activationRevision, wire == wireRevision, state.phase == .ready,
                      let current = documents[route]?.messages.first(where: { $0.id == queued.id }),
                      current.delivery == .queued, current.text == queued.text, current.media == queued.media,
                      current.idempotencyKey == id else { sendTasks.removeValue(forKey: route); return }
                // Complete local frame/model validation before retiring editable ownership.
                // Then reserve synchronously before the persistence await.
                updateSend(route, id: queued.id, delivery: .sending); reserved = true
                liveRevisions[route, default: 0] += 1
                try await persist(route)
                guard physicalPermitsInput(route), documents[route]?.historyEpoch == epoch,
                      activation == activationRevision, wire == wireRevision, route.connectionID == activeConnectionID, state.phase == .ready,
                      sessionManager?.permitsInput(route) != false, running[route] == nil else {
                    updateSend(route, id: queued.id, delivery: .held)
                    sendTasks.removeValue(forKey: route); scheduleSave(route, immediate: true); return
                }
                try await modelControls?.verifyInput(route)
                guard physicalPermitsInput(route), documents[route]?.historyEpoch == epoch,
                      activation == activationRevision, wire == wireRevision, state.phase == .ready,
                      !navigationHeldRoutes.contains(NativeStoredRoute(route)), sessionManager?.permitsInput(route) != false, modelControls?.permitsInput(route) != false else {
                    updateSend(route, id: queued.id, delivery: .held)
                    sendTasks.removeValue(forKey: route); scheduleSave(route, immediate: true); return
                }
                try validateMediaModel(route, hasImages: input.attachments.contains { $0.type == .image })
                wireEntered = true
                let receipt = try await runtime.send(sessionKey: route.sessionID, input: input)
                if physicalPermitsInput(route), documents[route]?.historyEpoch == epoch,
                   activation == activationRevision, wire == wireRevision {
                    liveRevisions[route, default: 0] += 1
                    taskJournal?.receipt(receipt, route: route, input: queued.text)
                    updateSend(route, id: queued.id, delivery: .sent, runID: receipt.runID)
                    physicalLiveEvidence[NativeHistoryScope(route)]?.admit(receipt.runID)
                    if finishedRuns[route]?.contains(where: { historySame($0, receipt.runID) }) != true { running[route] = receipt.runID }
                    refreshLiveHistory(route)
                } else { updateSend(route, id: queued.id, delivery: .uncertain, runID: receipt.runID) }
            } catch {
                let current = documents[route]?.messages.first(where: { $0.id == queued.id })
                if reserved || (current?.delivery == .queued && current?.text == queued.text && current?.media == queued.media) {
                    let failure = error as? RuntimeFailure
                    let delivery = failure?.delivery
                    let paused = modelControls?.permitsInput(route) == false && (delivery == .notDispatched || delivery == .rejectedBeforeDispatch)
                    let scopeChanged = documents[route]?.historyEpoch != epoch || activation != activationRevision || wire != wireRevision
                    let next: NativeDelivery = delivery == .uncertain || delivery == .responseReceived || wireEntered && delivery == nil
                        ? .uncertain : scopeChanged || paused ? .held : .failed
                    updateSend(route, id: queued.id, delivery: next)
                    if activation == activationRevision, wire == wireRevision, route == presentation.selectedConversation { showMediaFailure(error, route: route) }
                }
            }
            sendTasks.removeValue(forKey: route)
            updatePresentation(route); scheduleSave(route, immediate: true)
            if documents[route]?.historyEpoch == epoch, activation == activationRevision, wire == wireRevision, running[route] == nil { drainQueue(route) }
        }
    }

    private func updateSend(_ route: ConversationID, id: String, delivery: NativeDelivery, runID: String? = nil) {
        guard let index = documents[route]?.messages.firstIndex(where: { $0.id == id }) else { return }
        if documents[route]?.messages[index].delivery != .delivered { documents[route]?.messages[index].delivery = delivery }
        if let runID { documents[route]?.messages[index].runID = runID }
        changed(route)
    }

    private func stop(_ route: ConversationID) {
        guard physicalPermitsInput(route), !navigationHeldRoutes.contains(NativeStoredRoute(route)), route.connectionID == activeConnectionID, state.capabilities.abort,
              sessionManager?.permitsInput(route) != false, let runtime else { return }
        guard sessions.first(where: { $0.connectionID == route.connectionID && $0.key == route.sessionID })?.canContinue != false else { return }
        let runID = running[route]?.nilIfEmpty
        let activation = activationRevision, wire = wireRevision, epoch = documents[route]?.historyEpoch
        Task {
            guard physicalPermitsInput(route), documents[route]?.historyEpoch == epoch, activation == activationRevision, wire == wireRevision, route.connectionID == activeConnectionID,
                  sessionManager?.permitsInput(route) != false else { return }
            do { try await runtime.abort(sessionKey: route.sessionID, runID: runID) }
            catch { if activation == activationRevision, wire == wireRevision, route.connectionID == activeConnectionID { showFailure(error) } }
        }
    }

    private func receive(_ update: RuntimeSessionUpdate, connectionID: String) {
        switch update {
        case let .runStarted(key, runID):
            for route in documents.keys where historySame(route.connectionID, connectionID) && historySame(route.sessionID, key) {
                guard acceptPhysicalLive(route, runID: runID, inputKey: update.workCompletion?.inputMessageKey) else { continue }
                taskJournal?.started(route, runID: runID)
                liveRevisions[route, default: 0] += 1
                running[route] = runID; updatePresentation(route)
            }
        case let .text(update):
            for route in documents.keys where historySame(route.connectionID, connectionID) && historySame(route.sessionID, update.sessionKey) {
                guard acceptPhysicalLive(route, runID: update.runID, inputKey: update.inputMessageKey) else { continue }
                taskJournal?.text(update, route: route)
                liveRevisions[route, default: 0] += 1
                guard var document = documents[route] else { continue }
                let previous = document.messages
                let epoch = document.historyEpoch
                guard NativeLiveMessages.text(update, in: &document, epoch: epoch) else { continue }
                retireChangedHistoryMedia(old: previous, new: document.messages)
                documents[route] = document
                running[route] = update.runID; changed(route); updatePresentation(route); scheduleSave(route)
            }
        case let .runFinished(key, runID, reason, segmentID, _):
            for route in documents.keys where historySame(route.connectionID, connectionID) && historySame(route.sessionID, key) {
                guard acceptPhysicalLive(route, runID: runID, inputKey: update.workCompletion?.inputMessageKey) else { continue }
                taskJournal?.finished(route, runID: runID, reason: reason, completion: update.workCompletion)
                liveRevisions[route, default: 0] += 1
                var finished = finishedRuns[route] ?? []
                if !finished.contains(where: { historySame($0, runID) }) { finished.append(runID) }
                finishedRuns[route] = Array(finished.suffix(128))
                if historySame(running[route], runID) { running.removeValue(forKey: route) }
                if var document = documents[route] {
                    let backend = connections.first { $0.id.utf8.elementsEqual(connectionID.utf8) }?.backendKind
                    let epoch = document.historyEpoch
                    let target = NativeLiveMessages.finish(runID: runID, segmentID: segmentID,
                        metadata: backend.flatMap { update.finalMessageMetadata(backend: $0) },
                        notice: backend.flatMap { update.terminalNotice(backend: $0) },
                        hasAttachments: !update.finalAttachments.isEmpty, in: &document, epoch: epoch)
                    document.revision += 1; documents[route] = document
                    bindFinalMedia(update, route: route, messageID: target)
                }
                refreshLiveHistory(route)
                updatePresentation(route); scheduleSave(route)
                drainQueue(route)
            }
        case let .sessionMetadata(session):
            sessionManager?.catalogChanged(sessionKey: session.key)
            sessions.removeAll { $0.key == session.key && $0.connectionID == connectionID }; sessions.append(session); rebuildRoster()
        case let .work(work):
            guard let key = work.sessionKey else { return }
            for route in journalRoutes(connectionID: connectionID, sessionKey: key) {
                guard acceptPhysicalLive(route, runID: work.runID, inputKey: work.inputMessageKey) else { continue }
                taskJournal?.record(work, route: route); updatePresentation(route)
            }
        case .thought, .tool, .other: break
        }
    }

    /// Reads queued by Runtime start their own RPC after preceding reads. This
    /// repairs pre-receipt deltas/finals without replaying an unknown live frame.
    private func refreshLiveHistory(_ route: ConversationID) {
        let host = sessionHostContext, epoch = documents[route]?.historyEpoch
        Task {
            guard host.sameConnection(as: sessionHostContext), documents[route]?.historyEpoch == epoch,
                  physicalPermitsInput(route) else { return }
            await loadHistory(route)
        }
    }

    private func acceptPhysicalLive(_ route: ConversationID, runID: String?, inputKey: String?) -> Bool {
        let scope = NativeHistoryScope(route)
        guard physicalPermitsInput(route), let document = documents[route],
              var evidence = physicalLiveEvidence[scope] else { return false }
        let accepted = evidence.accepts(runID: runID, inputKey: inputKey, current: document)
        physicalLiveEvidence[scope] = evidence
        if !accepted, physicalRecoveryTasks[scope] == nil {
            let host = sessionHostContext, id = UUID()
            // One bounded read per route; a stopped/old event never gains write authority.
            physicalRecoveryIDs[scope] = id
            physicalRecoveryTasks[scope] = Task {
                defer {
                    if physicalRecoveryIDs[scope] == id {
                        physicalRecoveryTasks.removeValue(forKey: scope); physicalRecoveryIDs.removeValue(forKey: scope)
                    }
                }
                guard host.sameConnection(as: sessionHostContext), physicalPermitsInput(route) else { return }
                await loadHistory(route)
            }
        }
        return accepted
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
        if !physicalPermitsInput(route) {
            let reason = documents[route]?.physicalMutationUnconfirmed == true || physicalFailures.contains(NativeHistoryScope(route))
                ? String(localized: "Review the conversation update before sending.") : String(localized: "Loading conversation…")
            for feature in [ClientFeature.send, .stop, .photos, .camera, .files, .paste, .models, .modelControls, .loadEarlier] where features[feature]?.isVisible == true {
                features[feature] = .temporarilyUnavailable(reason)
            }
        }
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
        var content: [MessageContent] = [NativeTranscriptPresentation.textContent(message)]
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
        if ownedPending && message.delivery == .held, let route, physicalPermitsInput(route), route.connectionID == activeConnectionID,
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
            guard physicalPermitsLocalChanges(route), route.connectionID == activeConnectionID, var document = documents[route],
                  let edit = try? document.holdForEditing(messageID: messageID) else { return }
            documents[route] = document; updatePresentation(route); scheduleSave(route, immediate: true)
            destination = .editPending(route, edit, activation: activationRevision)
        case .sendNow:
            guard physicalPermitsInput(route), message.isOwnedUser, message.idempotencyKey?.isEmpty == false,
                  message.delivery == .held, !navigationHeldRoutes.contains(NativeStoredRoute(route)), route.connectionID == activeConnectionID, state.phase == .ready,
                  sessionManager?.permitsInput(route) != false, modelControls?.permitsInput(route) != false,
                  let index = documents[route]?.messages.firstIndex(where: { $0.id == messageID }) else { return }
            let currentEpoch = documents[route]?.historyEpoch
            documents[route]?.messages[index].historyEpoch = currentEpoch
            documents[route]?.messages[index].remoteID = nil; documents[route]?.messages[index].providedID = nil
            documents[route]?.messages[index].idSource = nil; documents[route]?.messages[index].transcriptPosition = nil
            documents[route]?.messages[index].transcriptBoundary = nil; documents[route]?.messages[index].sourceRevisionHash = nil
            documents[route]?.messages[index].runID = nil; documents[route]?.messages[index].segmentID = nil
            documents[route]?.messages[index].delivery = .queued; changed(route)
            updatePresentation(route); scheduleSave(route, immediate: true); drainQueue(route)
        case .remove:
            guard physicalPermitsLocalChanges(route) else { return }
            guard var document = documents[route] else { return }
            do { try document.removePending(messageID: messageID) } catch { return }
            documents[route] = document
            releaseMediaAfterCommit(route, ids: Set(message.media.compactMap(\.resourceID)))
            updatePresentation(route)
        default: break
        }
    }

    func savePendingEdit(_ edit: NativePendingEdit, route: ConversationID, activation: UUID, text: String, media selectedMedia: [NativeMediaReference]? = nil) async throws {
        guard physicalPermitsLocalChanges(route), activation == activationRevision, route.connectionID == activeConnectionID,
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
            guard physicalOperations[NativeHistoryScope(route)] == nil else { return }
            do { try await persist(route) }
            catch { presentation.draft(for: route).hint = String(localized: "This draft could not be saved. Keep Clawket open and try again.") }
        }
    }

    func persist(_ route: ConversationID, physicalOperation: UUID? = nil) async throws {
        let scope = NativeHistoryScope(route)
        guard !physicalFailures.contains(scope), physicalOperations[scope] == physicalOperation else { throw RuntimeFailure(.requestBusy) }
        guard let cache, let document = documents[route] else { throw StoreFailure.unavailable }
        try await cache.write(document, connectionID: route.connectionID, agentID: route.agentID, sessionID: route.sessionID)
    }

    func physicalPermitsInput(_ route: ConversationID) -> Bool {
        let scope = NativeHistoryScope(route)
        return physicalPermitsLocalChanges(route) && physicalReady.contains(scope) &&
            documents[route]?.historyEpoch != nil && documents[route]?.physicalMutationUnconfirmed != true
    }

    func physicalPermitsLocalChanges(_ route: ConversationID) -> Bool {
        let scope = NativeHistoryScope(route)
        return physicalOperations[scope] == nil && !physicalFailures.contains(scope)
    }

    func beginPhysicalOperation(_ route: ConversationID, token: UUID) throws {
        let scope = NativeHistoryScope(route)
        guard !physicalFailures.contains(scope), physicalOperations[scope] == nil else { throw RuntimeFailure(.requestBusy) }
        physicalOperations[scope] = token
        taskRequests?.pauseHistoryScope(route)
        if case let .editPending(editRoute, _, _)? = destination, editRoute == route { destination = nil }
        if mediaVisibleRoute == route { retireMediaSelection() }
        else if voice?.attempt?.context.route == route || voiceSheet?.context.route == route { retireVoice() }
        mediaDraftRevisions[route] = UUID()
        mediaModelRevisions.removeValue(forKey: route)
        modelControls?.retireSession(route)
        sessionManager?.catalogChanged(sessionKey: route.sessionID)
        if let messages = documents[route]?.messages { retireChangedHistoryMedia(old: messages, new: []) }
        updatePresentation(route)
    }

    /// The operation fence stays synchronous; actor suspension cannot let a new
    /// send, picker, ordinary save or stale history read overtake this transaction.
    func reconcilePhysicalHistory(_ route: ConversationID, decision: NativePhysicalHistoryPolicy.Decision,
                                         operation supplied: UUID? = nil, acknowledgedMutation: Bool = false,
                                         current: @MainActor () -> Bool) async throws {
        guard current(), let cache, let original = documents[route] else { throw RuntimeFailure(.superseded) }
        let scope = NativeHistoryScope(route), token = supplied ?? UUID()
        if supplied == nil { try beginPhysicalOperation(route, token: token) }
        guard physicalOperations[scope] == token else { throw RuntimeFailure(.superseded) }
        var persistedRevision: Int64?
        defer {
            if physicalOperations[scope] == token {
                physicalOperations.removeValue(forKey: scope)
                if !physicalFailures.contains(scope), documents[route]?.physicalMutationUnconfirmed != true {
                    taskRequests?.resumeHistoryScope(route)
                }
                updatePresentation(route)
                if !physicalFailures.contains(scope), documents[route]?.revision != persistedRevision {
                    scheduleSave(route, immediate: true)
                }
            }
        }
        do {
            var version = try await cache.historyStoredVersion(scope: scope)
            guard current(), physicalOperations[scope] == token else { throw RuntimeFailure(.superseded) }
            if version == nil || version!.revision < original.revision {
                try await cache.write(original, connectionID: route.connectionID, agentID: route.agentID, sessionID: route.sessionID)
                version = try await cache.historyStoredVersion(scope: scope)
            }
            guard current(), physicalOperations[scope] == token, let version,
                  version.revision == original.revision, version.epoch == original.historyEpoch,
                  historySame(version.physicalSessionID, original.physicalSessionID) else { throw RuntimeFailure(.superseded) }
            let replacement: NativeConversation
            let changedEpoch: Bool
            switch decision {
            case .unchanged: return
            case let .establish(physicalID):
                replacement = try await cache.establishHistoryScope(scope: scope, expectedRevision: version.revision,
                    epoch: UUID(), physicalSessionID: physicalID)
                changedEpoch = true
            case let .bind(physicalID):
                guard let epoch = original.historyEpoch else { throw NativeHistoryFailure.changed }
                replacement = try await cache.bindPhysicalSession(scope: scope, expectedRevision: version.revision,
                    epoch: epoch, expectedCurrentHash: version.sha256, physicalSessionID: physicalID)
                changedEpoch = false
            case let .rollover(physicalID):
                replacement = try await cache.rollover(scope: scope, expectedRevision: version.revision,
                    fromEpoch: original.historyEpoch, toEpoch: UUID(), physicalSessionID: physicalID,
                    retainingMessageIDs: Set(original.messages.filter(NativePhysicalHistoryPolicy.retainAcrossBoundary).map(\.id)),
                    expectedCurrentHash: version.sha256).current
                changedEpoch = true
            }
            // A completed storage transaction must be adopted even when the
            // connection changed during it. It supplies no new wire authority.
            guard physicalOperations[scope] == token, let latest = documents[route],
                  latest.historyEpoch == original.historyEpoch else { throw NativeHistoryFailure.commitUncertain }
            var adopted = replacement
            adopted.draft = latest.draft; adopted.draftResourceIDs = latest.draftResourceIDs
            NativePhysicalHistoryPolicy.hold(&adopted)
            let observedID: String? = switch decision {
            case let .establish(value), let .rollover(value): value
            case let .bind(value): value
            case .unchanged: nil
            }
            if acknowledgedMutation || (original.physicalSessionID != nil && observedID != nil &&
                !historySame(original.physicalSessionID, observedID)) {
                adopted.physicalMutationUnconfirmed = nil
            }
            adopted.revision = max(adopted.revision, latest.revision)
            if try historyEncode(adopted) != historyEncode(replacement) { adopted.revision += 1 }
            documents[route] = adopted
            taskJournal?.bindHistoryScope(route, epoch: adopted.historyEpoch)
            if changedEpoch, let epoch = adopted.historyEpoch {
                physicalLiveEvidence[scope] = .init(epoch: epoch,
                    retiringRunIDs: original.messages.compactMap(\.runID) + [running[route]].compactMap { $0 })
                running.removeValue(forKey: route); finishedRuns.removeValue(forKey: route)
                if original.historyEpoch != nil { taskRequests?.retireHistoryScope(route, epoch: epoch) }
                else { taskRequests?.bindHistoryScope(route, epoch: epoch) }
                physicalReady.remove(scope)
                preferences.recordReading(.init(), route: route)
                presentation.readingContexts[route] = .init()
            }
            if adopted.physicalMutationUnconfirmed != true { taskRequests?.resumeHistoryScope(route) }
            updatePresentation(route)
            if adopted.revision != replacement.revision {
                try await cache.write(adopted, connectionID: route.connectionID, agentID: route.agentID, sessionID: route.sessionID)
            }
            persistedRevision = adopted.revision
        } catch {
            if let failure = error as? NativeHistoryFailure, failure == .commitUncertain || failure == .changed {
                physicalFailures.insert(scope)
            }
            if physicalFailures.contains(scope) {
                notice = String(localized: "Saved data could not be read safely. Reopen Clawket after unlocking this device.")
            }
            throw error
        }
        guard current() else { throw RuntimeFailure(.superseded) }
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

    private func retirePreparedPhysicalMutations() {
        for (id, route) in preparedPhysicalMutations {
            let scope = NativeHistoryScope(route)
            if physicalOperations[scope] == id { physicalOperations.removeValue(forKey: scope) }
            // The already-persisted intent remains conservative; a late ACK cannot
            // become a new connection's physical identity or unlock its input.
            previousPhysicalUncertainty.removeValue(forKey: id)
        }
        preparedPhysicalMutations = [:]
    }

    func adoptPreparedPhysicalConversation(_ loaded: NativeConversation, route: ConversationID,
                                           operation: UUID, host: NativeSessionHostContext) throws {
        guard host.sameConnection(as: sessionHostContext), state.phase == .ready,
              physicalOperations[NativeHistoryScope(route)] == operation, documents[route] == nil else {
            throw RuntimeFailure(.superseded)
        }
        documents[route] = loaded
        taskJournal?.bindHistoryScope(route, epoch: loaded.historyEpoch)
        taskRequests?.bindHistoryScope(route, epoch: loaded.historyEpoch)
    }

    private func prepareSessionMutation(_ target: NativeSessionMutationTarget) async throws {
        guard target.host.sameConnection(as: sessionHostContext), target.route.connectionID == activeConnectionID,
              state.phase == .ready else { throw RuntimeFailure(.superseded) }
        let route = target.route, destructive = [.reset, .delete].contains(target.action)
        historyRevisions[route] = UUID()
        presentation.conversations[route]?.isLoadingHistory = false
        if destructive {
            guard sendTasks[route] == nil, !mediaSendPreparations.contains(route) else { throw RuntimeFailure(.requestBusy) }
            try beginPhysicalOperation(route, token: target.id)
            preparedPhysicalMutations[target.id] = route
            if documents[route] == nil, let cache {
                let loaded = try await cache.read(connectionID: route.connectionID, agentID: route.agentID, sessionID: route.sessionID)
                try adoptPreparedPhysicalConversation(loaded, route: route, operation: target.id, host: target.host)
            }
            previousPhysicalUncertainty[target.id] = documents[route]?.physicalMutationUnconfirmed == true
            guard var document = documents[route], !document.messages.contains(where: { $0.delivery == .sending }) else { throw RuntimeFailure(.requestBusy) }
            NativePhysicalHistoryPolicy.hold(&document)
            // The durable intent is conservative on a crash between dispatch and ACK.
            document.physicalMutationUnconfirmed = true; document.revision += 1
            documents[route] = document; saveTasks[route]?.cancel()
            try await persist(route, physicalOperation: target.id)
        } else if target.action == .archive, var document = documents[route] {
            guard sendTasks[route] == nil, !mediaSendPreparations.contains(route) else { throw RuntimeFailure(.requestBusy) }
            if try document.holdForSessionMutation() {
                documents[route] = document; saveTasks[route]?.cancel(); try await persist(route)
            }
        }
        guard target.host.sameConnection(as: sessionHostContext), state.phase == .ready,
              !destructive || physicalOperations[NativeHistoryScope(route)] == target.id else { throw RuntimeFailure(.superseded) }
    }

    private func sessionMutationFinished(_ outcome: NativeSessionMutationOutcome) {
        switch outcome {
        case let .acknowledged(target, roster, created):
            // Consume exactly once, including an ACK whose catalog refresh failed.
            // receipt.sessionID is the pre-action ID, never the new physical ID.
            if let route = preparedPhysicalMutations.removeValue(forKey: target.id) {
                previousPhysicalUncertainty.removeValue(forKey: target.id)
                let scope = NativeHistoryScope(route)
                guard physicalOperations[scope] == target.id else { return }
                Task {
                    do {
                        try await reconcilePhysicalHistory(route, decision: .rollover(nil), operation: target.id, acknowledgedMutation: true) {
                            self.physicalOperations[scope] == target.id
                        }
                        applySessionRoster(target, roster: roster, created: created)
                        if target.host.sameConnection(as: sessionHostContext), target.action == .reset {
                            await loadHistory(route)
                        }
                    } catch { showFailure(error) }
                }
            } else { applySessionRoster(target, roster: roster, created: created) }
        case let .notDispatched(target):
            if let route = preparedPhysicalMutations.removeValue(forKey: target.id) {
                let scope = NativeHistoryScope(route)
                if physicalOperations[scope] == target.id {
                    documents[route]?.physicalMutationUnconfirmed = previousPhysicalUncertainty.removeValue(forKey: target.id) == true
                    changed(route); physicalOperations.removeValue(forKey: scope)
                    if documents[route]?.physicalMutationUnconfirmed != true { taskRequests?.resumeHistoryScope(route) }
                    scheduleSave(route, immediate: true); updatePresentation(route)
                }
            }
            rebuildRoster()
        case let .uncertain(target):
            // Preserve the durable intent and held input. Only a later proven
            // physical boundary or another explicit ACK can retire it.
            if let route = preparedPhysicalMutations.removeValue(forKey: target.id) {
                previousPhysicalUncertainty.removeValue(forKey: target.id)
                if physicalOperations[NativeHistoryScope(route)] == target.id {
                    physicalOperations.removeValue(forKey: NativeHistoryScope(route))
                    updatePresentation(route); scheduleSave(route, immediate: true)
                }
            }
            rebuildRoster()
        }
    }

    private func applySessionRoster(_ target: NativeSessionMutationTarget, roster: RuntimeRoster?, created: RuntimeSession?) {
        guard target.host.sameConnection(as: sessionHostContext), target.route.connectionID == activeConnectionID,
              let roster, roster.connectionID == activeConnectionID else { return }
        showingCachedRoster = false; agents = roster.agents; sessions = roster.sessions
        historyRevisions[target.route] = UUID()
        if target.action == .restore || target.action == .archive { archivedSessions[target.route.connectionID] = nil }
        if target.action == .branch, let created, target.host.selection == selectionRevision {
            presentation.selectedConversation = .init(connectionID: created.connectionID, agentID: created.agentID, sessionID: created.key)
        } else if [.delete, .archive].contains(target.action), target.host.selection == selectionRevision,
                  presentation.selectedConversation == target.route,
                  !roster.sessions.contains(where: { historySame($0.connectionID, target.route.connectionID) && historySame($0.key, target.route.sessionID) }) {
            presentation.selectedConversation = nil
        }
        rebuildRoster()
        for id in presentation.catalogs.keys where id.connectionID == target.route.connectionID && presentation.catalogs[id]?.showingArchived == true {
            loadArchivedCatalog(id)
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
