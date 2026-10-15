import ClawketMedia
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
        case deviceApproval(connectionID: String)
        var id: String {
            switch self {
            case .connect: "connect"
            case .connections: "connections"
            case let .deviceApproval(id): "device-approval-\(id)"
            case let .editPending(_, edit, _): edit.id.uuidString
            }
        }
    }
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
    private var catalogCache: NativeCatalogStore?
    private var catalogCacheRevision: Int64 = 0
    private var showingCachedRoster = false
    var runtime: RuntimeCoordinator?
    private var taskRequests: NativeTaskRequests?
    private var sessionManager: NativeSessionManagement?
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
            self.sessionManager = NativeSessionManagement(presentation: presentation, runtime: runtime,
                context: { [weak self] in self?.sessionHostContext ?? .init(activation: UUID(), wire: UUID(), selection: UUID()) },
                prepare: { [weak self] target in
                    guard let self else { throw RuntimeFailure(.superseded) }
                    try await self.prepareSessionMutation(target)
                }, outcome: { [weak self] outcome in self?.sessionMutationFinished(outcome) },
                onChange: { [weak self] in self?.rebuildRoster() })
