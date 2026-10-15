import Combine
import Foundation

/// Presentation availability comes from the adapter's negotiated capabilities.
/// Unsupported actions disappear; temporary failures remain explainable.
public enum ActionAvailability: Hashable, Sendable {
    case available
    case unsupported
    case temporarilyUnavailable(String)

    public var isVisible: Bool { self != .unsupported }
    public var isEnabled: Bool { self == .available }
    public var explanation: String? {
        if case let .temporarilyUnavailable(reason) = self { return reason }
        return nil
    }
}

public struct ConversationID: Hashable, Codable, Sendable, Identifiable {
    public var connectionID: String
    public var agentID: String
    public var sessionID: String
    public var id: Self { self }
    public static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.connectionID.utf8.elementsEqual(rhs.connectionID.utf8) && lhs.agentID.utf8.elementsEqual(rhs.agentID.utf8) && lhs.sessionID.utf8.elementsEqual(rhs.sessionID.utf8)
    }
    public func hash(into hasher: inout Hasher) {
        hasher.combine(Data(connectionID.utf8)); hasher.combine(Data(agentID.utf8)); hasher.combine(Data(sessionID.utf8))
    }
    public var isConcrete: Bool { !connectionID.isEmpty && !agentID.isEmpty && !sessionID.isEmpty }

    public init(connectionID: String, agentID: String, sessionID: String) {
        self.connectionID = connectionID
        self.agentID = agentID
        self.sessionID = sessionID
    }
}

public struct AgentCatalogID: Hashable, Codable, Sendable, Identifiable {
    public var connectionID: String
    public var agentID: String
    public var id: Self { self }
    public static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.connectionID.utf8.elementsEqual(rhs.connectionID.utf8) && lhs.agentID.utf8.elementsEqual(rhs.agentID.utf8)
    }
    public func hash(into hasher: inout Hasher) {
        hasher.combine(Data(connectionID.utf8)); hasher.combine(Data(agentID.utf8))
    }
    public init(connectionID: String, agentID: String) {
        self.connectionID = connectionID; self.agentID = agentID
    }
}

public enum AgentEntryMode: Hashable, Sendable {
    case conversation(ConversationID)
    case catalog(AgentCatalogID)
}

public struct ProjectPresentation: Identifiable, Hashable, Sendable {
    public var id: String
    public var title: String
    public var subtitle: String?
    public init(id: String, title: String, subtitle: String? = nil) {
        self.id = id; self.title = title; self.subtitle = subtitle
    }
}

public struct AgentCatalogPresentation: Identifiable, Hashable, Sendable {
    public var id: AgentCatalogID
    public var title: String
    public var sessions: [SessionPresentation]
    public var projects: [ProjectPresentation]
    public var selectedProjectID: String?
    public var isLoading: Bool
    public var error: String?
    public var createSession: ActionAvailability
    public var refresh: ActionAvailability
    public var archive: ActionAvailability
    public var showingArchived: Bool
    public init(id: AgentCatalogID, title: String, sessions: [SessionPresentation] = [],
                projects: [ProjectPresentation] = [], selectedProjectID: String? = nil,
                isLoading: Bool = false, error: String? = nil,
                createSession: ActionAvailability = .unsupported, refresh: ActionAvailability = .unsupported,
                archive: ActionAvailability = .unsupported, showingArchived: Bool = false) {
        self.id = id; self.title = title; self.sessions = sessions; self.projects = projects
        self.selectedProjectID = selectedProjectID; self.isLoading = isLoading; self.error = error
        self.createSession = createSession; self.refresh = refresh
        self.archive = archive; self.showingArchived = showingArchived
    }
}

public enum ClientFeature: String, Hashable, Sendable {
    case account, addConnection, createAgent, refresh, reconnect
    case sessions, newSession, models, send, stop, voice
    case photos, camera, files, paste, skills, commands, schedule, tools, sessionFiles
    case agentSettings, memory, connectionSettings, loadEarlier, sessionManagement, modelControls
    case savedHistory, exportConversation, previousTranscripts
}

public enum ClientDestination: String, Hashable, Sendable {
    case account, addConnection, createAgent, newSession, agentSettings, memory
    case connectionSettings, skills, commands, schedule, tools, sessionFiles
    case savedHistory, exportConversation, previousTranscripts
}

public enum AttachmentSource: String, Hashable, Sendable {
    case photos, camera, files, paste
}

public enum ConnectionPhase: String, Hashable, Sendable {
    case disconnected, connecting, ready, reconnecting, unavailable, authenticationRequired, approvalRequired
}

public struct ConnectionPresentation: Hashable, Sendable {
    public var phase: ConnectionPhase
    public var label: String
    public var detail: String?
    public var connectionID: String?
    public var action: ActionAvailability
    public var approvalReviewID: UUID?

    public init(phase: ConnectionPhase = .disconnected, label: String = "", detail: String? = nil,
                connectionID: String? = nil, action: ActionAvailability = .unsupported, approvalReviewID: UUID? = nil) {
        self.phase = phase
        self.label = label
        self.detail = detail
        self.connectionID = connectionID
        self.action = action
        self.approvalReviewID = approvalReviewID
    }

    var primaryIntent: ClientIntent? { primaryIntent(fallbackConnectionID: nil) }

    func primaryIntent(fallbackConnectionID: String?) -> ClientIntent? {
        guard action.isEnabled else { return nil }
        if phase == .approvalRequired {
            guard let connectionID, !connectionID.isEmpty, let approvalReviewID else { return nil }
            return .reviewDeviceApproval(connectionID: connectionID, contextID: approvalReviewID)
        }
        return .reconnect(connectionID: connectionID ?? fallbackConnectionID)
    }
}

public struct AgentPresentation: Identifiable, Hashable, Sendable {
    public enum Kind: String, Hashable, Sendable { case agent, pinnedSession }
    public enum Attention: String, Hashable, Sendable { case none, input, approval, error, scheduledFailure }

    public var id: String
    public var entryMode: AgentEntryMode
    public var route: ConversationID? {
        if case let .conversation(route) = entryMode { return route }
        return nil
    }
    public var kind: Kind
    public var name: String
    public var subtitle: String
    public var backendLabel: String?
    public var symbol: String?
    public var initials: String
    /// The runtime supplies a bounded, decoded-source thumbnail. Views never fetch avatar URLs.
    public var avatarData: Data?
    public var activityLabel: String?
    public var timeLabel: String?
    public var unread: Bool
    public var attention: Attention
    public var isWorking: Bool
    public var cachedLabel: String?
    public var availability: ActionAvailability
    public var isPinned: Bool
    public var localActions: RosterActionsPresentation

    public init(id: String, entryMode: AgentEntryMode, kind: Kind = .agent, name: String,
                subtitle: String = "", backendLabel: String? = nil, symbol: String? = nil,
                initials: String = "", avatarData: Data? = nil, activityLabel: String? = nil,
                timeLabel: String? = nil, unread: Bool = false, attention: Attention = .none,
                isWorking: Bool = false, cachedLabel: String? = nil,
                availability: ActionAvailability = .available, isPinned: Bool = false,
                localActions: RosterActionsPresentation = .init()) {
        self.id = id; self.entryMode = entryMode; self.kind = kind; self.name = name
        self.subtitle = subtitle; self.backendLabel = backendLabel; self.symbol = symbol
        self.initials = initials; self.avatarData = avatarData; self.activityLabel = activityLabel
        self.timeLabel = timeLabel; self.unread = unread; self.attention = attention
        self.isWorking = isWorking; self.cachedLabel = cachedLabel; self.availability = availability
        self.isPinned = isPinned; self.localActions = localActions
    }

    public init(id: String, route: ConversationID, kind: Kind = .agent, name: String,
                subtitle: String = "", backendLabel: String? = nil, symbol: String? = nil,
                initials: String = "", avatarData: Data? = nil, activityLabel: String? = nil,
                timeLabel: String? = nil, unread: Bool = false, attention: Attention = .none,
                isWorking: Bool = false, cachedLabel: String? = nil,
                availability: ActionAvailability = .available, isPinned: Bool = false,
                localActions: RosterActionsPresentation = .init()) {
        self.init(id: id, entryMode: .conversation(route), kind: kind, name: name, subtitle: subtitle,
                  backendLabel: backendLabel, symbol: symbol, initials: initials, avatarData: avatarData,
                  activityLabel: activityLabel, timeLabel: timeLabel, unread: unread, attention: attention,
                  isWorking: isWorking, cachedLabel: cachedLabel, availability: availability, isPinned: isPinned, localActions: localActions)
    }
}

public struct SessionPresentation: Identifiable, Hashable, Sendable {
    public var id: String
    public var route: ConversationID
    public var title: String
    public var subtitle: String?
    public var symbol: String
    public var timeLabel: String?
    public var isSelected: Bool
    public var unread: Bool
    public var management: ActionAvailability
    public var isArchived: Bool
    public var isOnHome: Bool
    public var homeAction: ActionAvailability
    public var markReadAction: ActionAvailability

    public init(id: String, route: ConversationID, title: String, subtitle: String? = nil,
                symbol: String = "bubble.left", timeLabel: String? = nil,
                isSelected: Bool = false, unread: Bool = false, management: ActionAvailability = .unsupported,
                isArchived: Bool = false, isOnHome: Bool = false, homeAction: ActionAvailability = .unsupported,
                markReadAction: ActionAvailability = .unsupported) {
        self.id = id; self.route = route; self.title = title; self.subtitle = subtitle
        self.symbol = symbol; self.timeLabel = timeLabel; self.isSelected = isSelected; self.unread = unread
        self.management = management; self.isArchived = isArchived
        self.isOnHome = isOnHome; self.homeAction = homeAction; self.markReadAction = markReadAction
    }
}

public struct ModelPresentation: Identifiable, Hashable, Sendable {
    public var id: String
    public var title: String
    public var subtitle: String?
    public var group: String?
    public var isSelected: Bool
    public var isSubmitting: Bool
    public var availability: ActionAvailability
    public var catalogOrder: Double?
    public var searchTerms: [String]
    public var isConfiguredDefault: Bool

    public init(id: String, title: String, subtitle: String? = nil, group: String? = nil,
                isSelected: Bool = false, isSubmitting: Bool = false, availability: ActionAvailability = .available,
                catalogOrder: Double? = nil, searchTerms: [String] = [], isConfiguredDefault: Bool = false) {
        self.id = id; self.title = title; self.subtitle = subtitle; self.group = group
        self.isSelected = isSelected; self.isSubmitting = isSubmitting; self.availability = availability
        self.catalogOrder = catalogOrder; self.searchTerms = searchTerms; self.isConfiguredDefault = isConfiguredDefault
    }
}

public struct AttachmentPresentation: Identifiable, Hashable, Sendable {
    public enum Kind: String, Hashable, Sendable { case image, file, audio, video }
    public enum Phase: Hashable, Sendable { case preparing, ready, failed(String) }
    public var id: String
    public var name: String
    public var kind: Kind
    public var detail: String?
    public var phase: Phase
    public var thumbnailData: Data?
    public var aspectRatio: Double?
    public var canOpen: Bool
    public var canRemove: Bool

    public init(id: String, name: String, kind: Kind, detail: String? = nil, phase: Phase = .ready,
                thumbnailData: Data? = nil, aspectRatio: Double? = nil,
                canOpen: Bool = false, canRemove: Bool = false) {
        self.id = id; self.name = name; self.kind = kind; self.detail = detail; self.phase = phase
        self.thumbnailData = thumbnailData; self.aspectRatio = aspectRatio
        self.canOpen = canOpen; self.canRemove = canRemove
    }
}

public enum MessageDelivery: Hashable, Sendable {
    case queued, held(String?), sending, sent, delivered, uncertain(String?), failed(String)
}

public enum MessageAuthor: Hashable, Sendable {
    /// Local ownership is supplied by the host; presentation never grants queue authority.
    case local
    /// An unattributed direct-chat user history row; it owns no local send.
    case directUser
    case agent(name: String, label: String?)
    case participant(name: String, channel: String?)
    case system

    public var isLocal: Bool { self == .local }
    public var isOutgoing: Bool { self == .local || self == .directUser }
}

public enum MessageAction: String, Hashable, Sendable {
    case copy, share, favorite, replyInNewSession, sendNow, edit, remove
}

public struct WorkPresentation: Identifiable, Hashable, Sendable {
    public enum Phase: String, Hashable, Sendable { case running, complete, failed, stopped }
    public var id: String
    public var title: String
    public var detail: String?
    public var symbol: String
    public var phase: Phase
    public var output: String?

    public init(id: String, title: String, detail: String? = nil, symbol: String = "terminal",
                phase: Phase = .running, output: String? = nil) {
        self.id = id; self.title = title; self.detail = detail; self.symbol = symbol
        self.phase = phase; self.output = output
    }
}

public enum ApprovalDecision: String, Hashable, Sendable { case allowOnce, allowAlways, deny, approve, reject }

/// The host maps this unique identity to an already prepared, frozen runtime reference/token.
/// It is ephemeral presentation state and grants no authority on its own.
public struct ApprovalConfirmationPresentation: Identifiable, Hashable, Sendable {
    public let id: String
    public let approvalID: String
    public let title: String
    public let detail: String?
    public init(id: String, approvalID: String, title: String, detail: String? = nil) {
        self.id = id; self.approvalID = approvalID; self.title = title; self.detail = detail
    }
}

public struct ApprovalPresentation: Identifiable, Hashable, Sendable {
    public enum Kind: String, Hashable, Sendable { case execution, plugin, pairing }
    public enum Outcome: String, Hashable, Sendable { case allowed, denied, approved, rejected, expired }
    /// Host-wide unique presentation identity, scoped to its connection/request generation.
    /// The host maps this back to the backend request; it is never an unscoped wire request ID.
    public var id: String
    public var kind: Kind
    public var title: String
    public var reason: String?
    public var command: String?
    public var scope: String?
    public var symbol: String
    public var decisions: [ApprovalDecision]
    public var canResolve: Bool
    public var submitting: ApprovalDecision?
    public var outcome: Outcome?
    public var error: String?
    /// Already formatted by the runtime; nil never creates a countdown.
    public var expiryLabel: String?

    public init(id: String, kind: Kind = .execution, title: String, reason: String? = nil,
                command: String? = nil, scope: String? = nil, symbol: String = "hand.raised",
                decisions: [ApprovalDecision] = [], submitting: ApprovalDecision? = nil,
                outcome: Outcome? = nil, error: String? = nil, expiryLabel: String? = nil, canResolve: Bool = false) {
        self.id = id; self.kind = kind; self.title = title; self.reason = reason
        self.command = command; self.scope = scope; self.symbol = symbol
        self.decisions = decisions; self.canResolve = canResolve
        self.submitting = submitting; self.outcome = outcome; self.error = error; self.expiryLabel = expiryLabel
    }

    /// Pairing never borrows execution permission semantics, even if a stale host supplies them.
    public var visibleDecisions: [ApprovalDecision] {
        switch kind {
        case .pairing: decisions.filter { [.approve, .reject].contains($0) }
        case .execution: decisions.filter { [.allowOnce, .allowAlways, .deny].contains($0) }
        case .plugin: [] // None of the current adapters implements a plugin resolver.
        }
    }

    func intent(for decision: ApprovalDecision) -> ClientIntent? {
        guard canResolve, outcome == nil, submitting == nil, visibleDecisions.contains(decision) else { return nil }
        if decision == .allowAlways { return .prepareApprovalConfirmation(approvalID: id) }
        return .resolveApproval(approvalID: id, decision: decision)
    }
}

public struct QuestionOption: Identifiable, Hashable, Sendable {
    /// Stable for the actual option value; an array position must not retarget a restored draft.
    public var id: String
    public var label: String
    public var detail: String?
    public init(id: String, label: String, detail: String? = nil) {
        self.id = id; self.label = label; self.detail = detail
    }
}

public struct QuestionField: Identifiable, Hashable, Sendable {
    public var id: String
    public var title: String
    public var header: String?
    public var options: [QuestionOption]
    public var allowsMultiple: Bool
    public var allowsCustom: Bool
    public var placeholder: String?
    public var isRequired: Bool

    public init(id: String, title: String, options: [QuestionOption] = [], allowsMultiple: Bool = false,
                allowsCustom: Bool = false, placeholder: String? = nil, isRequired: Bool = true, header: String? = nil) {
        self.id = id; self.title = title; self.options = options; self.allowsMultiple = allowsMultiple
        self.allowsCustom = allowsCustom; self.placeholder = placeholder; self.isRequired = isRequired; self.header = header
    }
}

public struct QuestionPresentation: Identifiable, Hashable, Sendable {
    public enum Kind: String, Hashable, Sendable { case select, confirm, input, editor, form }
    public enum Submission: Hashable, Sendable { case answer, confirm(Bool), cancel }
    /// Host-wide unique presentation identity, scoped to its conversation/request generation.
    /// Response drafts and answer intents use this identity, not an unscoped wire request ID.
    public var id: String
    public var title: String
    /// Select/input/editor use exactly one field; confirm uses none. Form fields retain their IDs.
    public var kind: Kind
    public var detail: String?
    public var fields: [QuestionField]
    public var isSubmitting: Bool
    public var resolvedLabel: String?
    public var error: String?
    public var canSubmit: Bool
    public var canCancel: Bool
    /// Local editing permission is separate from wire response/cancellation authority.
    /// Without an explicit override, it follows canSubmit even on a copied held review.
    public var canEdit: Bool {
        get { explicitCanEdit ?? canSubmit }
        set { explicitCanEdit = newValue }
    }
    private var explicitCanEdit: Bool?
    /// Only authoritative acceptance of this exact local answer may set this true.
    public var responseIsAccepted: Bool
    /// Only the pressed action spins. Unknown delivery must disable actions without claiming a submission.
    public var submittingAction: Submission?

    public init(id: String, title: String, detail: String? = nil, fields: [QuestionField],
                isSubmitting: Bool = false, resolvedLabel: String? = nil,
                error: String? = nil, canSubmit: Bool = true, kind: Kind = .form,
                canCancel: Bool = false, submittingAction: Submission? = nil,
                canEdit: Bool? = nil, responseIsAccepted: Bool = false) {
        self.id = id; self.title = title; self.detail = detail; self.fields = fields
        self.isSubmitting = isSubmitting; self.resolvedLabel = resolvedLabel; self.error = error; self.canSubmit = canSubmit
        self.kind = kind; self.canCancel = canCancel; self.submittingAction = submittingAction
        self.explicitCanEdit = canEdit; self.responseIsAccepted = responseIsAccepted
    }

    public var canEditFields: Bool { canEdit && !isSubmitting && submittingAction == nil && resolvedLabel == nil }

    public var showsAnswerActions: Bool {
        guard resolvedLabel == nil else { return false }
        if canSubmit { return true }
        switch submittingAction {
        case .answer?: return kind != .confirm
        case .confirm?: return kind == .confirm
        case .cancel?, nil: return false
        }
    }

    public var showsCancelAction: Bool {
        resolvedLabel == nil && (canCancel || submittingAction == .cancel)
    }
}

public struct QuestionFieldAnswer: Codable, Equatable, Sendable {
    public var selectedOptionIDs: [String]
    public var text: String
    /// Custom is an explicit alternative to listed options, including for multiple-choice fields.
    public var isCustom: Bool
    public init(selectedOptionIDs: [String] = [], text: String = "", isCustom: Bool = false) {
        self.selectedOptionIDs = selectedOptionIDs; self.text = text; self.isCustom = isCustom
    }
}

/// Draft-only values may be persisted by the host; no request reference or authority is encoded.
public struct QuestionResponse: Codable, Equatable, Sendable {
    public var fields: [String: QuestionFieldAnswer]
    public var confirmed: Bool?
    public init(fields: [String: QuestionFieldAnswer] = [:], confirmed: Bool? = nil) {
        self.fields = fields; self.confirmed = confirmed
    }
}

public enum MessageContent: Hashable, Sendable {
    case markdown(String)
    case code(language: String?, text: String)
    case attachment(AttachmentPresentation)
    case work(WorkPresentation)
    case approval(ApprovalPresentation)
    case question(QuestionPresentation)
    case notice(String)
}

public struct MessagePresentation: Identifiable, Hashable, Sendable {
    /// Runtime presentation/render key, unchanged across cache/live/final reconciliation.
    public var id: String
    public var author: MessageAuthor
    public var content: [MessageContent]
    public var timeLabel: String?
    public var delivery: MessageDelivery?
    public var isStreaming: Bool
    public var actions: [MessageAction]

    public init(id: String, author: MessageAuthor, content: [MessageContent], timeLabel: String? = nil,
                delivery: MessageDelivery? = nil, isStreaming: Bool = false, actions: [MessageAction] = []) {
        self.id = id; self.author = author; self.content = content; self.timeLabel = timeLabel
        self.delivery = delivery; self.isStreaming = isStreaming; self.actions = actions
    }
}

public struct ConversationPresentation: Identifiable, Hashable, Sendable {
    public var id: ConversationID
    public var agentName: String
    public var sessionTitle: String
    public var subtitle: String?
    public var messages: [MessagePresentation]
    public var connection: ConnectionPresentation
    public var sessions: [SessionPresentation]
    public var models: [ModelPresentation]
    public var modelTitle: String?
    public var modelScopeLabel: String?
    /// Describes the host's supported send behavior, such as "Send" or "Add to queue".
    public var sendLabel: String
    public var isLoading: Bool
    public var isLoadingHistory: Bool
    public var features: [ClientFeature: ActionAvailability]
    public var work: WorkDockPresentation?

    public init(id: ConversationID, agentName: String, sessionTitle: String, subtitle: String? = nil,
                messages: [MessagePresentation] = [], connection: ConnectionPresentation = .init(),
                sessions: [SessionPresentation] = [], models: [ModelPresentation] = [],
                modelTitle: String? = nil, modelScopeLabel: String? = nil, sendLabel: String = String(localized: "Send"),
                isLoading: Bool = false, isLoadingHistory: Bool = false,
                features: [ClientFeature: ActionAvailability] = [:], work: WorkDockPresentation? = nil) {
        self.id = id; self.agentName = agentName; self.sessionTitle = sessionTitle; self.subtitle = subtitle
        self.messages = messages; self.connection = connection; self.sessions = sessions; self.models = models
        self.modelTitle = modelTitle; self.modelScopeLabel = modelScopeLabel; self.isLoading = isLoading
        self.sendLabel = sendLabel
        self.isLoadingHistory = isLoadingHistory; self.features = features
        self.work = work
    }

    public func availability(_ feature: ClientFeature) -> ActionAvailability { features[feature] ?? .unsupported }
}

@MainActor
public final class ComposerDraft: ObservableObject {
    public let conversationID: ConversationID
    @Published public var text: String { didSet { if oldValue != text { editRevision = UUID() } } }
    @Published public var attachments: [AttachmentPresentation] {
        didSet { if oldValue.map(\.id) != attachments.map(\.id) { editRevision = UUID() } }
    }
    @Published public private(set) var editRevision = UUID()
    @Published public var voice: VoicePresentation?
    @Published public var hint: String?
    /// Explicit host paste/dictation uses the current native selection and undo
    /// stack. It is ephemeral UI work, never a second persisted text buffer.
    @Published public var insertion: ComposerTextInsertion?

    @discardableResult public func insertText(_ text: String, acknowledgement: Bool = false,
                                             expectedRevision: UUID? = nil, replacingText: Bool = false) -> UUID {
        let insertion = ComposerTextInsertion(text: text, acknowledgement: acknowledgement,
                                              expectedRevision: expectedRevision, replacingText: replacingText)
        self.insertion = insertion; return insertion.id
    }

    public init(conversationID: ConversationID, text: String = "", attachments: [AttachmentPresentation] = [],
                voice: VoicePresentation? = nil, hint: String? = nil) {
        self.conversationID = conversationID; self.text = text; self.attachments = attachments
        self.voice = voice; self.hint = hint
    }
}

public struct ComposerTextInsertion: Sendable, Equatable {
    public let id = UUID()
    public let text: String
    public let acknowledgement: Bool
    public let expectedRevision: UUID?
    public let replacingText: Bool
    public init(text: String, acknowledgement: Bool = false, expectedRevision: UUID? = nil, replacingText: Bool = false) {
        self.text = text; self.acknowledgement = acknowledgement; self.expectedRevision = expectedRevision; self.replacingText = replacingText
    }
}

public struct VoicePresentation: Hashable, Sendable {
    public enum Phase: String, Hashable, Sendable { case recording, transcribing, recoverable, failed }
    public var phase: Phase
    public var label: String
    public var detail: String?
    public var canStop: Bool
    public var canCancel: Bool
    public var canRetry: Bool
    public var canReview: Bool
    public var level: Double?
    public init(phase: Phase, label: String, detail: String? = nil,
                canStop: Bool = false, canCancel: Bool = false, canRetry: Bool = false, canReview: Bool = false, level: Double? = nil) {
        self.phase = phase; self.label = label; self.detail = detail
        self.canStop = canStop; self.canCancel = canCancel; self.canRetry = canRetry
        self.canReview = canReview
        self.level = level.flatMap { $0.isFinite ? min(1, max(0, $0)) : nil }
    }
}

/// A presentation store, not a second backend or transport state machine.
/// The host owns persistence, lifecycle, capability negotiation and all side effects.
@MainActor
public final class ClientPresentation: ObservableObject {
    private var transientDrafts: [ConversationID: ComposerDraft] = [:]
    @Published public var title: String
    @Published public var agents: [AgentPresentation]
    @Published public var selectedConversation: ConversationID?
    @Published public var conversations: [ConversationID: ConversationPresentation]
    @Published public var catalogs: [AgentCatalogID: AgentCatalogPresentation]
    @Published public var connection: ConnectionPresentation
    @Published public var isLoading: Bool
    @Published public var emptyTitle: String
    @Published public var emptyDetail: String
    @Published public var accountAttentionCount: Int
    @Published public var features: [ClientFeature: ActionAvailability]
    @Published public var drafts: [ConversationID: ComposerDraft]
    @Published public var questionResponses: [String: QuestionResponse]
    @Published public var expandedContentIDs: Set<String>
    /// Connection-wide consents remain separate from transcript-owned approvals.
    @Published public var connectionApprovals: [ApprovalPresentation]
    @Published public var approvalConfirmation: ApprovalConfirmationPresentation?
    @Published public var sessionManagement: SessionManagementPresentation?
    @Published public var modelControls: ModelControlsPresentation?
    @Published public var appearance: ClientAppearancePresentation
    @Published public var readingContexts: [ConversationID: ConversationReadingPresentation]
    /// Host-controlled display request; no backend call is implied by showing a catalog.
    @Published public var requestedCatalog: AgentCatalogID?

    public init(title: String = String(localized: "Agents"), agents: [AgentPresentation] = [],
                selectedConversation: ConversationID? = nil,
                conversations: [ConversationID: ConversationPresentation] = [:],
                catalogs: [AgentCatalogID: AgentCatalogPresentation] = [:],
                connection: ConnectionPresentation = .init(), isLoading: Bool = false,
                emptyTitle: String = String(localized: "Your agents, within reach"),
                emptyDetail: String = String(localized: "Connect an agent to continue conversations and keep work moving."),
                accountAttentionCount: Int = 0, features: [ClientFeature: ActionAvailability] = [:],
                drafts: [ConversationID: ComposerDraft] = [:], questionResponses: [String: QuestionResponse] = [:],
                expandedContentIDs: Set<String> = [],
                connectionApprovals: [ApprovalPresentation] = [], approvalConfirmation: ApprovalConfirmationPresentation? = nil,
                sessionManagement: SessionManagementPresentation? = nil, modelControls: ModelControlsPresentation? = nil,
                appearance: ClientAppearancePresentation = .init(),
                readingContexts: [ConversationID: ConversationReadingPresentation] = [:],
                requestedCatalog: AgentCatalogID? = nil) {
        self.title = title; self.agents = agents; self.selectedConversation = selectedConversation
        self.conversations = conversations; self.connection = connection; self.isLoading = isLoading
        self.catalogs = catalogs
        self.emptyTitle = emptyTitle; self.emptyDetail = emptyDetail; self.accountAttentionCount = accountAttentionCount
        self.features = features; self.drafts = drafts; self.questionResponses = questionResponses
        self.expandedContentIDs = expandedContentIDs
        self.connectionApprovals = connectionApprovals
        self.approvalConfirmation = approvalConfirmation
        self.sessionManagement = sessionManagement
        self.modelControls = modelControls
        self.appearance = appearance; self.readingContexts = readingContexts; self.requestedCatalog = requestedCatalog
    }

    public func acceptsReadingContext(for route: ConversationID, scopeID: UUID) -> Bool {
        selectedConversation == route && readingContexts[route]?.id == scopeID
    }

    public func availability(_ feature: ClientFeature) -> ActionAvailability { features[feature] ?? .unsupported }

    public func draft(for id: ConversationID) -> ComposerDraft {
        if let existing = drafts[id] { return existing }
        if let existing = transientDrafts[id] { return existing }
        let draft = ComposerDraft(conversationID: id)
        // Reading a view's draft must not publish a change during SwiftUI rendering.
        // The host may supply persisted drafts; unsaved presentation drafts retain identity here.
        transientDrafts[id] = draft
        return draft
    }
}

public enum VoiceIntent: String, Sendable { case start, stop, finishAndSend, cancel, retry, showRecordings }

public enum ClientIntent: Sendable {
    case setAgentPinned(AgentCatalogID, pinned: Bool)
    case setSessionOnHome(ConversationID, visible: Bool)
    case markAgentRead(AgentCatalogID)
    case markSessionRead(ConversationID)
    case conversationReadingVisibilityChanged(ConversationID, viewID: UUID, scopeID: UUID, visible: Bool)
    case openAgentCatalog(AgentCatalogID)
    case selectCatalogProject(AgentCatalogID, projectID: String?)
    case createSession(AgentCatalogID, projectID: String?)
    case refreshCatalog(AgentCatalogID)
    case selectCatalogArchive(AgentCatalogID, archived: Bool)
    case prepareSessionManagement(ConversationID, requestID: UUID)
    case dismissSessionManagement(reviewID: UUID)
    case requestSessionAction(reviewID: UUID, action: SessionLifecycleAction)
    case renameSession(reviewID: UUID, title: String)
    case confirmSessionMutation(confirmationID: UUID)
    case dismissSessionMutationConfirmation(confirmationID: UUID)
    case openConversation(ConversationID)
    case closeConversation
    /// Visibility is independent of selected route; native Back must not clear a secondary session.
    case conversationVisibilityChanged(ConversationID, viewID: UUID, visible: Bool)
    case readingContextChanged(ConversationID, scopeID: UUID, context: ConversationReadingContext)
    case openDestination(ClientDestination, conversation: ConversationID?)
    case refresh
    case reconnect(connectionID: String?)
    /// Opens a host-owned, read-only review of this exact pending device connection.
    case reviewDeviceApproval(connectionID: String, contextID: UUID)
    case draftChanged(ConversationID, text: String)
    case send(ConversationID)
    case stop(ConversationID)
    case selectModel(ConversationID, modelID: String)
    case prepareModelControls(ConversationID, requestID: UUID)
    case dismissModelControls(reviewID: UUID)
    case refreshModelControls(reviewID: UUID)
    case chooseModelControl(reviewID: UUID, choice: ModelControlChoice)
    case confirmModelPermissions(confirmationID: UUID)
    case dismissModelPermissions(confirmationID: UUID)
    case pickAttachment(ConversationID, source: AttachmentSource)
    case removeAttachment(ConversationID, attachmentID: String)
    case openAttachment(attachmentID: String)
    case voice(ConversationID, action: VoiceIntent)
    /// Reports only completion of one explicit native insertion, never durable
    /// storage or permission to send. Hosts fence ID/route before committing.
    case composerInsertionApplied(ConversationID, insertionID: UUID, text: String?)
    case loadEarlier(ConversationID)
    case messageAction(ConversationID, messageID: String, action: MessageAction)
    case resolveApproval(approvalID: String, decision: ApprovalDecision)
    /// The host obtains a frozen one-use runtime confirmation before showing its own dialog.
    case prepareApprovalConfirmation(approvalID: String)
    case confirmApproval(confirmationID: String)
    case dismissApprovalConfirmation(confirmationID: String)
    case questionDraftChanged(questionID: String, response: QuestionResponse)
    case answerQuestion(questionID: String, response: QuestionResponse)
    case cancelQuestion(questionID: String)
    /// Read-only intent. The host may mark this exact work record read or load bounded data.
    case workInspectorOpened(ConversationID, workID: String)
    case workStepOpened(ConversationID, workID: String, recordID: String, stepID: String)
    case openURL(URL)
}
