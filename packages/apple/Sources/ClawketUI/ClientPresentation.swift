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

public struct ConversationID: Hashable, Sendable, Identifiable {
    public var connectionID: String
    public var agentID: String
    public var sessionID: String
    public var id: Self { self }
    public var isConcrete: Bool { !connectionID.isEmpty && !agentID.isEmpty && !sessionID.isEmpty }

    public init(connectionID: String, agentID: String, sessionID: String) {
        self.connectionID = connectionID
        self.agentID = agentID
        self.sessionID = sessionID
    }
}

public struct AgentCatalogID: Hashable, Sendable, Identifiable {
    public var connectionID: String
    public var agentID: String
    public var id: Self { self }
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
    public init(id: AgentCatalogID, title: String, sessions: [SessionPresentation] = [],
                projects: [ProjectPresentation] = [], selectedProjectID: String? = nil,
                isLoading: Bool = false, error: String? = nil,
                createSession: ActionAvailability = .unsupported, refresh: ActionAvailability = .unsupported) {
        self.id = id; self.title = title; self.sessions = sessions; self.projects = projects
        self.selectedProjectID = selectedProjectID; self.isLoading = isLoading; self.error = error
        self.createSession = createSession; self.refresh = refresh
    }
}

public enum ClientFeature: String, Hashable, Sendable {
    case account, addConnection, createAgent, refresh, reconnect
    case sessions, newSession, models, send, stop, voice
    case photos, camera, files, paste, skills, commands, schedule, tools, sessionFiles
    case agentSettings, memory, connectionSettings, loadEarlier
}

public enum ClientDestination: String, Hashable, Sendable {
    case account, addConnection, createAgent, newSession, agentSettings, memory
    case connectionSettings, skills, commands, schedule, tools, sessionFiles
}

public enum AttachmentSource: String, Hashable, Sendable {
    case photos, camera, files, paste
}

public enum ConnectionPhase: String, Hashable, Sendable {
    case disconnected, connecting, ready, reconnecting, unavailable, authenticationRequired
}

public struct ConnectionPresentation: Hashable, Sendable {
    public var phase: ConnectionPhase
    public var label: String
    public var detail: String?
    public var connectionID: String?
    public var action: ActionAvailability

    public init(phase: ConnectionPhase = .disconnected, label: String = "", detail: String? = nil,
                connectionID: String? = nil, action: ActionAvailability = .unsupported) {
        self.phase = phase
        self.label = label
        self.detail = detail
        self.connectionID = connectionID
        self.action = action
    }
}

public struct AgentPresentation: Identifiable, Hashable, Sendable {
    public enum Kind: String, Hashable, Sendable { case agent, pinnedSession }
    public enum Attention: String, Hashable, Sendable { case none, input, approval }

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

    public init(id: String, entryMode: AgentEntryMode, kind: Kind = .agent, name: String,
                subtitle: String = "", backendLabel: String? = nil, symbol: String? = nil,
                initials: String = "", avatarData: Data? = nil, activityLabel: String? = nil,
                timeLabel: String? = nil, unread: Bool = false, attention: Attention = .none,
                isWorking: Bool = false, cachedLabel: String? = nil,
                availability: ActionAvailability = .available) {
        self.id = id; self.entryMode = entryMode; self.kind = kind; self.name = name
        self.subtitle = subtitle; self.backendLabel = backendLabel; self.symbol = symbol
        self.initials = initials; self.avatarData = avatarData; self.activityLabel = activityLabel
        self.timeLabel = timeLabel; self.unread = unread; self.attention = attention
        self.isWorking = isWorking; self.cachedLabel = cachedLabel; self.availability = availability
    }

    public init(id: String, route: ConversationID, kind: Kind = .agent, name: String,
                subtitle: String = "", backendLabel: String? = nil, symbol: String? = nil,
                initials: String = "", avatarData: Data? = nil, activityLabel: String? = nil,
                timeLabel: String? = nil, unread: Bool = false, attention: Attention = .none,
                isWorking: Bool = false, cachedLabel: String? = nil,
                availability: ActionAvailability = .available) {
        self.init(id: id, entryMode: .conversation(route), kind: kind, name: name, subtitle: subtitle,
                  backendLabel: backendLabel, symbol: symbol, initials: initials, avatarData: avatarData,
                  activityLabel: activityLabel, timeLabel: timeLabel, unread: unread, attention: attention,
                  isWorking: isWorking, cachedLabel: cachedLabel, availability: availability)
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

    public init(id: String, route: ConversationID, title: String, subtitle: String? = nil,
                symbol: String = "bubble.left", timeLabel: String? = nil,
                isSelected: Bool = false, unread: Bool = false) {
        self.id = id; self.route = route; self.title = title; self.subtitle = subtitle
        self.symbol = symbol; self.timeLabel = timeLabel; self.isSelected = isSelected; self.unread = unread
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

    public init(id: String, title: String, subtitle: String? = nil, group: String? = nil,
                isSelected: Bool = false, isSubmitting: Bool = false, availability: ActionAvailability = .available) {
        self.id = id; self.title = title; self.subtitle = subtitle; self.group = group
        self.isSelected = isSelected; self.isSubmitting = isSubmitting; self.availability = availability
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
    /// Only proven local sends use the trailing alignment, never just role=user.
    case local
    case agent(name: String, label: String?)
    case participant(name: String, channel: String?)
    case system

    public var isLocal: Bool { self == .local }
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

public enum ApprovalDecision: String, Hashable, Sendable { case allowOnce, allowAlways, deny }

public struct ApprovalPresentation: Identifiable, Hashable, Sendable {
    public enum Kind: String, Hashable, Sendable { case execution, plugin, pairing }
    public enum Outcome: String, Hashable, Sendable { case allowed, denied, expired }
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
    public var submitting: ApprovalDecision?
    public var outcome: Outcome?
    public var error: String?
    /// Already formatted by the runtime; nil never creates a countdown.
    public var expiryLabel: String?

    public init(id: String, kind: Kind = .execution, title: String, reason: String? = nil,
                command: String? = nil, scope: String? = nil, symbol: String = "hand.raised",
                decisions: [ApprovalDecision] = [.deny, .allowOnce], submitting: ApprovalDecision? = nil,
                outcome: Outcome? = nil, error: String? = nil, expiryLabel: String? = nil) {
        self.id = id; self.kind = kind; self.title = title; self.reason = reason
        self.command = command; self.scope = scope; self.symbol = symbol; self.decisions = decisions
        self.submitting = submitting; self.outcome = outcome; self.error = error; self.expiryLabel = expiryLabel
    }
}

public struct QuestionOption: Identifiable, Hashable, Sendable {
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
    public var options: [QuestionOption]
    public var allowsMultiple: Bool
    public var allowsCustom: Bool
    public var placeholder: String?
    public var isRequired: Bool

    public init(id: String, title: String, options: [QuestionOption] = [], allowsMultiple: Bool = false,
                allowsCustom: Bool = false, placeholder: String? = nil, isRequired: Bool = true) {
        self.id = id; self.title = title; self.options = options; self.allowsMultiple = allowsMultiple
        self.allowsCustom = allowsCustom; self.placeholder = placeholder; self.isRequired = isRequired
    }
}

public struct QuestionPresentation: Identifiable, Hashable, Sendable {
    /// Host-wide unique presentation identity, scoped to its conversation/request generation.
    /// Response drafts and answer intents use this identity, not an unscoped wire request ID.
    public var id: String
    public var title: String
    public var detail: String?
    public var fields: [QuestionField]
    public var isSubmitting: Bool
    public var resolvedLabel: String?
    public var error: String?
    public var canSubmit: Bool

    public init(id: String, title: String, detail: String? = nil, fields: [QuestionField],
                isSubmitting: Bool = false, resolvedLabel: String? = nil,
                error: String? = nil, canSubmit: Bool = true) {
        self.id = id; self.title = title; self.detail = detail; self.fields = fields
        self.isSubmitting = isSubmitting; self.resolvedLabel = resolvedLabel; self.error = error; self.canSubmit = canSubmit
    }
}

public struct QuestionFieldAnswer: Equatable, Sendable {
    public var selectedOptionIDs: [String]
    public var text: String
    public init(selectedOptionIDs: [String] = [], text: String = "") {
        self.selectedOptionIDs = selectedOptionIDs; self.text = text
    }
}

public struct QuestionResponse: Equatable, Sendable {
    public var fields: [String: QuestionFieldAnswer]
    public init(fields: [String: QuestionFieldAnswer] = [:]) { self.fields = fields }
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

    public init(id: ConversationID, agentName: String, sessionTitle: String, subtitle: String? = nil,
                messages: [MessagePresentation] = [], connection: ConnectionPresentation = .init(),
                sessions: [SessionPresentation] = [], models: [ModelPresentation] = [],
                modelTitle: String? = nil, modelScopeLabel: String? = nil, sendLabel: String = "Send",
                isLoading: Bool = false, isLoadingHistory: Bool = false,
                features: [ClientFeature: ActionAvailability] = [:]) {
        self.id = id; self.agentName = agentName; self.sessionTitle = sessionTitle; self.subtitle = subtitle
        self.messages = messages; self.connection = connection; self.sessions = sessions; self.models = models
        self.modelTitle = modelTitle; self.modelScopeLabel = modelScopeLabel; self.isLoading = isLoading
        self.sendLabel = sendLabel
        self.isLoadingHistory = isLoadingHistory; self.features = features
    }

    public func availability(_ feature: ClientFeature) -> ActionAvailability { features[feature] ?? .unsupported }
}

@MainActor
public final class ComposerDraft: ObservableObject {
    public let conversationID: ConversationID
    @Published public var text: String
    @Published public var attachments: [AttachmentPresentation]
    @Published public var voice: VoicePresentation?
    @Published public var hint: String?

    public init(conversationID: ConversationID, text: String = "", attachments: [AttachmentPresentation] = [],
                voice: VoicePresentation? = nil, hint: String? = nil) {
        self.conversationID = conversationID; self.text = text; self.attachments = attachments
        self.voice = voice; self.hint = hint
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
    public init(phase: Phase, label: String, detail: String? = nil,
                canStop: Bool = false, canCancel: Bool = false, canRetry: Bool = false) {
        self.phase = phase; self.label = label; self.detail = detail
        self.canStop = canStop; self.canCancel = canCancel; self.canRetry = canRetry
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

    public init(title: String = "Agents", agents: [AgentPresentation] = [],
                selectedConversation: ConversationID? = nil,
                conversations: [ConversationID: ConversationPresentation] = [:],
                catalogs: [AgentCatalogID: AgentCatalogPresentation] = [:],
                connection: ConnectionPresentation = .init(), isLoading: Bool = false,
                emptyTitle: String = "Your agents, within reach", emptyDetail: String = "Connect an agent to continue conversations and keep work moving.",
                accountAttentionCount: Int = 0, features: [ClientFeature: ActionAvailability] = [:],
                drafts: [ConversationID: ComposerDraft] = [:], questionResponses: [String: QuestionResponse] = [:],
                expandedContentIDs: Set<String> = [],
                connectionApprovals: [ApprovalPresentation] = []) {
        self.title = title; self.agents = agents; self.selectedConversation = selectedConversation
        self.conversations = conversations; self.connection = connection; self.isLoading = isLoading
        self.catalogs = catalogs
        self.emptyTitle = emptyTitle; self.emptyDetail = emptyDetail; self.accountAttentionCount = accountAttentionCount
        self.features = features; self.drafts = drafts; self.questionResponses = questionResponses
        self.expandedContentIDs = expandedContentIDs
        self.connectionApprovals = connectionApprovals
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

public enum VoiceIntent: String, Sendable { case start, stop, finishAndSend, cancel, retry }

public enum ClientIntent: Sendable {
    case openAgentCatalog(AgentCatalogID)
    case selectCatalogProject(AgentCatalogID, projectID: String?)
    case createSession(AgentCatalogID, projectID: String?)
    case refreshCatalog(AgentCatalogID)
    case openConversation(ConversationID)
    case closeConversation
    case openDestination(ClientDestination, conversation: ConversationID?)
    case refresh
    case reconnect(connectionID: String?)
    case draftChanged(ConversationID, text: String)
    case send(ConversationID)
    case stop(ConversationID)
    case selectModel(ConversationID, modelID: String)
    case pickAttachment(ConversationID, source: AttachmentSource)
    case removeAttachment(ConversationID, attachmentID: String)
    case openAttachment(attachmentID: String)
    case voice(ConversationID, action: VoiceIntent)
    case loadEarlier(ConversationID)
    case messageAction(ConversationID, messageID: String, action: MessageAction)
    case resolveApproval(approvalID: String, decision: ApprovalDecision)
    case answerQuestion(questionID: String, response: QuestionResponse)
    case openURL(URL)
}
