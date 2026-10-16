#if os(iOS)
import SwiftUI
import UIKit

@MainActor
public struct NativeClientView: View {
    @ObservedObject private var model: ClientPresentation
    private let onIntent: @MainActor (ClientIntent) -> Void
    @State private var sheet: ClientSheet?
    @State private var search = ""
    @State private var rosterSelection: ConversationID?
    @State private var didSynchronizeSelection = false

    public init(model: ClientPresentation, onIntent: @escaping @MainActor (ClientIntent) -> Void) {
        self.model = model
        self.onIntent = onIntent
    }

    public var body: some View {
        NavigationSplitView {
            roster
        } detail: {
            if let route = model.selectedConversation {
                if let conversation = model.conversations[route] {
                    NativeConversationView(model: model, conversation: conversation,
                                           draft: model.draft(for: route), obscured: sheet != nil, onIntent: onIntent,
                                           showSheet: { sheet = $0 })
                        .id(route)
                } else {
                    ProgressView("Opening conversation…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color(uiColor: .systemBackground))
                }
            } else {
                WelcomeContent(title: model.emptyTitle, detail: String(localized: "Choose an agent to continue a conversation."))
            }
        }
        .navigationSplitViewStyle(.balanced)
        .tint(model.appearance.accentColor)
        .sheet(item: $sheet) { item in
            ClientSheetView(item: item, model: model, onIntent: onIntent)
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if model.connectionApprovals.contains(where: { $0.outcome == nil }) {
                Button {
                    sheet = .connectionApprovals
                } label: {
                    Label("Connection needs approval", systemImage: "hand.raised")
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .background(Color(uiColor: .secondarySystemBackground))
                .accessibilityIdentifier("connection-approval")
            }
        }
        .onChange(of: model.selectedConversation) { route in
            // Synchronize the sidebar directly; do not run its user-selection setter.
            rosterSelection = RosterSelectionPolicy.row(for: route, agents: model.agents)
            if let route { onIntent(.openConversation(route)) }
            else { onIntent(.closeConversation) }
        }
        .onChange(of: model.requestedCatalog) { id in
            if let id, model.catalogs[id] != nil { sheet = .catalog(id) }
        }
        .onChange(of: model.agents) { agents in
            rosterSelection = RosterSelectionPolicy.rowAfterRosterRefresh(
                currentRow: rosterSelection, selected: model.selectedConversation, agents: agents)
        }
        .onAppear {
            guard !didSynchronizeSelection else { return }
            didSynchronizeSelection = true
            if let id = model.requestedCatalog, model.catalogs[id] != nil { sheet = .catalog(id) }
            rosterSelection = RosterSelectionPolicy.row(for: model.selectedConversation, agents: model.agents)
        }
    }

    private var filteredAgents: [AgentPresentation] {
        let entries = model.agents.filter {
            switch $0.entryMode {
            case let .conversation(route): route.isConcrete
            case let .catalog(id): !id.connectionID.isEmpty && !id.agentID.isEmpty
            }
        }
        guard !search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return entries }
        return entries.filter {
            [$0.name, $0.subtitle, $0.backendLabel ?? ""].contains { $0.localizedStandardContains(search) }
        }
    }

    private var roster: some View {
        List(selection: rosterSelectionBinding) {
            if model.agents.isEmpty {
                if model.isLoading {
                    VStack(spacing: 20) {
                        ClawketMark().frame(width: 72, height: 68).accessibilityHidden(true)
                        ProgressView("Loading agents…")
                    }
                    .frame(maxWidth: .infinity, minHeight: 260)
                    .listRowSeparator(.hidden)
                } else {
                    VStack(spacing: 24) {
                        WelcomeContent(title: model.emptyTitle, detail: model.emptyDetail)
                        if model.availability(.addConnection).isVisible {
                            Button {
                                onIntent(.openDestination(.addConnection, conversation: nil))
                            } label: {
                                Label("Connect an agent", systemImage: "plus")
                                    .font(.body.weight(.semibold))
                                    .padding(.horizontal, 12).frame(minHeight: 44)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(.primary)
                            .disabled(!model.availability(.addConnection).isEnabled)
                            .accessibilityIdentifier("connect-agent")
                        }
                    }
                    .padding(.vertical, 38)
                    .frame(maxWidth: .infinity)
                    .listRowSeparator(.hidden)
                }
            } else {
                ForEach(filteredAgents) { agent in
                    Group {
                        if agent.requiresUpgrade {
                            Button {
                                let id: AgentCatalogID
                                switch agent.entryMode {
                                case let .conversation(route): id = .init(connectionID: route.connectionID, agentID: route.agentID)
                                case let .catalog(value): id = value
                                }
                                onIntent(.reviewProAgent(id))
                            } label: { AgentRow(agent: agent) }.buttonStyle(.plain)
                        } else { switch agent.entryMode {
                        case let .conversation(route):
                            if route.isConcrete {
                                NavigationLink(value: route) { AgentRow(agent: agent) }
                            }
                        case let .catalog(id):
                            Button {
                                onIntent(.openAgentCatalog(id))
                                sheet = .catalog(id)
                            } label: { AgentRow(agent: agent) }
                                .buttonStyle(.plain)
                        } }
                    }
                    .contextMenu { rosterActions(agent) }
                    .disabled(!agent.availability.isEnabled && !agent.requiresUpgrade)
                    .accessibilityIdentifier("agent-\(agent.id)")
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 11, leading: 20, bottom: 11, trailing: 20))
                }
                if filteredAgents.isEmpty {
                    Text("No matching agents or conversations")
                        .foregroundStyle(.secondary).padding(.vertical, 30)
                        .listRowSeparator(.hidden)
                }
            }
        }
        .listStyle(.plain)
        .navigationTitle(model.title)
        .searchable(text: $search, prompt: "Search agents and conversations")
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                if model.availability(.account).isVisible {
                    Button {
                        onIntent(.openDestination(.account, conversation: nil))
                    } label: {
                        Image(systemName: "gearshape")
                            .font(.title3)
                            .overlay(alignment: .topTrailing) {
                                if model.accountAttentionCount > 0 {
                                    Circle().fill(.red).frame(width: 7, height: 7).offset(x: 2, y: -1)
                                }
                            }
                    }
                    .frame(minWidth: 44, minHeight: 44)
                    .disabled(!model.availability(.account).isEnabled)
                    .accessibilityLabel("Settings")
                    .accessibilityValue(model.accountAttentionCount > 0 ? String(localized: "Needs attention") : "")
                }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                if model.availability(.savedHistory).isVisible {
                    Button { onIntent(.openDestination(.savedHistory, conversation: nil)) } label: {
                        Image(systemName: "books.vertical").frame(minWidth: 44, minHeight: 44)
                    }.accessibilityLabel("Saved conversations")
                        .disabled(!model.availability(.savedHistory).isEnabled)
                }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                if model.availability(.refresh).isVisible {
                    Button { onIntent(.refresh) } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .frame(minWidth: 44, minHeight: 44)
                    .disabled(!model.availability(.refresh).isEnabled)
                    .accessibilityIdentifier("roster-refresh")
                }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                if model.availability(.addConnection).isVisible || model.availability(.createAgent).isVisible {
                    Menu {
                        if model.availability(.createAgent).isVisible {
                            Button {
                                onIntent(.openDestination(.createAgent, conversation: nil))
                            } label: { Label("New agent", systemImage: "person.crop.circle.badge.plus") }
                                .disabled(!model.availability(.createAgent).isEnabled)
                        }
                        if model.availability(.addConnection).isVisible {
                            Button {
                                onIntent(.openDestination(.addConnection, conversation: nil))
                            } label: { Label("Add connection", systemImage: "link") }
                                .disabled(!model.availability(.addConnection).isEnabled)
                        }
                    } label: {
                        Image(systemName: "plus").font(.title3)
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel("Add")
                    .accessibilityIdentifier("roster-add")
                }
            }
            ToolbarItem(placement: .bottomBar) {
                ConnectionStatusView(status: model.connection) {
                    if let intent = model.connection.primaryIntent { onIntent(intent) }
                }
            }
        }
    }

    @ViewBuilder
    private func rosterActions(_ agent: AgentPresentation) -> some View {
        let scope: AgentCatalogID = switch agent.entryMode {
        case let .catalog(id): id
        case let .conversation(route): .init(connectionID: route.connectionID, agentID: route.agentID)
        }
        if agent.localActions.pin.isVisible {
            Button {
                if agent.kind == .agent { onIntent(.setAgentPinned(scope, pinned: !agent.isPinned)) }
                else if let route = agent.route { onIntent(.setSessionOnHome(route, visible: false)) }
            } label: {
                if agent.kind == .pinnedSession { Label("Hide from home", systemImage: "house") }
                else if agent.isPinned { Label("Unpin Agent", systemImage: "pin.slash") }
                else { Label("Pin Agent", systemImage: "pin") }
            }.disabled(!agent.localActions.pin.isEnabled)
        }
        if agent.localActions.markRead.isVisible {
            Button {
                if agent.kind == .agent { onIntent(.markAgentRead(scope)) }
                else if let route = agent.route { onIntent(.markSessionRead(route)) }
            } label: { Label("Mark as read", systemImage: "checkmark.bubble") }
                .disabled(!agent.localActions.markRead.isEnabled)
        }
        if agent.localActions.connectionSettings.isVisible {
            Button { onIntent(.openDestination(.connectionSettings, conversation: agent.route)) }
                label: { Label("Connections", systemImage: "link") }
                .disabled(!agent.localActions.connectionSettings.isEnabled)
        }
    }

    private var rosterSelectionBinding: Binding<ConversationID?> {
        Binding(get: { rosterSelection }, set: { proposed in
            let previous = rosterSelection
            rosterSelection = proposed
            if let route = RosterSelectionPolicy.explicitConversation(
                proposedRow: proposed, previousRow: previous, agents: filteredAgents) {
                model.selectedConversation = route
            }
        })
    }
}

@MainActor
private struct AgentRow: View {
    let agent: AgentPresentation
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            avatar
            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(agent.name).font(.body.weight(.semibold)).foregroundStyle(.primary)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                    Spacer(minLength: 0)
                    if agent.requiresUpgrade { Image(systemName: "lock").font(.caption).foregroundStyle(.secondary).accessibilityLabel("Upgrade to Pro") }
                    if agent.isPinned && agent.kind == .agent { Image(systemName: "pin.fill").font(.caption2).foregroundStyle(.secondary).accessibilityLabel("Pinned") }
                    if !dynamicTypeSize.isAccessibilitySize, let time = agent.timeLabel {
                        Text(time).font(.caption).foregroundStyle(.tertiary).lineLimit(1)
                    }
                }
                Text(agent.activityLabel ?? agent.subtitle)
                    .font(.subheadline)
                    .foregroundStyle(agent.attention == .none ? Color.secondary : Color.primary)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                if let cached = agent.cachedLabel {
                    Text(cached).font(.caption).foregroundStyle(.secondary)
                }
                if let explanation = agent.availability.explanation {
                    Text(explanation).font(.caption).foregroundStyle(.secondary)
                }
            }
            if agent.attention != .none {
                Image(systemName: agent.attention == .approval ? "hand.raised.fill" : agent.attention == .input ? "text.bubble.fill" : "exclamationmark.circle.fill")
                    .font(.caption).foregroundStyle(.orange).padding(.top, 4)
            }
            if agent.unread {
                Circle().fill(Color.accentColor).frame(width: 8, height: 8).padding(.top, 7)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityValue([agent.backendLabel, agent.timeLabel, agent.unread ? String(localized: "Unread messages") : nil,
                             agent.attention == .approval ? String(localized: "Approval needed") : nil,
                             agent.attention == .input ? String(localized: "Input needed") : nil,
                             [.error, .scheduledFailure].contains(agent.attention) ? String(localized: "Needs attention") : nil].compactMap { $0 }.joined(separator: ", "))
    }

    private var avatar: some View {
        ZStack(alignment: .bottomTrailing) {
            ZStack {
                RoundedRectangle(cornerRadius: agent.kind == .agent ? 19 : 14, style: .continuous)
                    .fill(Color(uiColor: .secondarySystemBackground))
                if let data = agent.avatarData, let image = UIImage(data: data) {
                    Image(uiImage: image).resizable().scaledToFill()
                } else if let symbol = agent.symbol {
                    Image(systemName: symbol).font(.title2.weight(.medium)).foregroundStyle(.secondary)
                } else if !agent.initials.isEmpty {
                    Text(agent.initials).font(.title3.weight(.semibold)).foregroundStyle(.primary)
                } else {
                    ClawketMark().padding(11)
                }
            }
            .frame(width: 54, height: 54)
            .clipShape(RoundedRectangle(cornerRadius: agent.kind == .agent ? 19 : 14, style: .continuous))
            if let backend = agent.backendLabel {
                Text(backend).font(.system(size: 8, weight: .semibold))
                    .padding(.horizontal, 4).padding(.vertical, 2)
                    .background(Color(uiColor: .systemBackground), in: Capsule())
                    .overlay(Capsule().stroke(Color(uiColor: .separator).opacity(0.3)))
                    .offset(x: 4, y: 4)
            }
        }
        .accessibilityHidden(true)
    }
}

@MainActor
struct WelcomeContent: View {
    var title: String
    var detail: String
    var body: some View {
        VStack(spacing: 18) {
            ClawketMark().frame(width: 78, height: 74).padding(.bottom, 8).accessibilityHidden(true)
            Text(title).font(.title2.weight(.semibold)).multilineTextAlignment(.center)
            Text(detail).font(.body).foregroundStyle(.secondary).multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 30).frame(maxWidth: 400)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemBackground))
    }
}

@MainActor
struct ConnectionStatusView: View {
    let status: ConnectionPresentation
    var reconnect: () -> Void

    var body: some View {
        if !status.label.isEmpty {
            Group {
                if status.action.isVisible {
                    Button(action: reconnect) { label }
                        .disabled(!status.action.isEnabled || status.primaryIntent == nil)
                } else { label }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel([status.label, status.detail].compactMap { $0 }.joined(separator: ". "))
        }
    }

    private var label: some View {
        HStack(spacing: 7) {
            if status.phase == .connecting || status.phase == .reconnecting {
                ProgressView().controlSize(.small)
            } else {
                Image(systemName: status.phase == .ready ? "checkmark.circle" : status.phase == .approvalRequired ? "hand.raised" : "wifi.slash")
            }
            Text(status.label).lineLimit(2)
        }
        .font(.footnote).foregroundStyle(.secondary)
        .frame(minHeight: 44)
    }
}

enum ClientSheet: Identifiable {
    case sessions(ConversationID), models(ConversationID), catalog(AgentCatalogID), connectionApprovals
    case work(ConversationID, workID: String)
    case management(ConversationID, reviewID: UUID)
    var id: String {
        switch self {
        case let .sessions(route): "sessions-\(route.connectionID)-\(route.agentID)"
        case let .models(route): "models-\(route.connectionID)-\(route.agentID)-\(route.sessionID)"
        case let .catalog(id): "catalog-\(id.connectionID)-\(id.agentID)"
        case .connectionApprovals: "connection-approvals"
        case let .management(_, reviewID): "management-\(reviewID)"
        case let .work(route, workID): "work-\(route.connectionID)-\(route.agentID)-\(route.sessionID)-\(workID)"
        }
    }
}

@MainActor
struct NativeConversationView: View {
    @ObservedObject var model: ClientPresentation
    let conversation: ConversationPresentation
    @ObservedObject var draft: ComposerDraft
    let obscured: Bool
    let onIntent: @MainActor (ClientIntent) -> Void
    let showSheet: (ClientSheet) -> Void
    @State private var expanded = false
    @State private var following = true
    @State private var scrollRequest = 0
    @StateObject private var readingInteraction = NativeTranscriptReadingInteraction()
    @State private var accessoryHeight: CGFloat = 0
    @State private var visibilityID = UUID()
    @State private var ownedReadingScope: UUID?
    @Environment(\.scenePhase) private var scenePhase

    private func reportReadingVisibility(_ visible: Bool) {
        if visible { ownedReadingScope = model.readingContexts[conversation.id]?.id }
        guard let scope = ownedReadingScope else { return }
        onIntent(.conversationReadingVisibilityChanged(conversation.id, viewID: visibilityID, scopeID: scope, visible: visible))
    }
    private var canRead: Bool { !obscured && !expanded && scenePhase == .active }

    var body: some View {
        GeometryReader { geometry in
            let toolbarWork = expanded || geometry.size.height < 500
            VStack(spacing: 0) {
                ZStack(alignment: .bottom) {
                    if conversation.messages.isEmpty {
                        if conversation.isLoading {
                            ProgressView("Loading conversation…")
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                        } else {
                            VStack(spacing: 12) {
                                Text(conversation.agentName).font(.title2.weight(.semibold))
                                Text("Start a conversation").font(.body).foregroundStyle(.secondary)
                            }.frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                    } else {
                        NativeTranscript(messages: conversation.messages, conversationID: conversation.id,
                                         model: model, following: $following, scrollRequest: scrollRequest,
                                         historyAvailability: conversation.availability(.loadEarlier),
                                         isLoadingHistory: conversation.isLoadingHistory,
                                         onIntent: onIntent, readingInteraction: readingInteraction)
                    }
                    if !following && !conversation.messages.isEmpty {
                        Button {
                            scrollRequest += 1
                        } label: {
                            Label("Latest messages", systemImage: "arrow.down")
                                .font(.footnote.weight(.medium)).padding(.horizontal, 14).frame(minHeight: 44)
                        }
                        .background(.regularMaterial, in: Capsule())
                        .overlay(Capsule().stroke(Color(uiColor: .separator).opacity(0.25)))
                        .padding(.bottom, 12)
                        .accessibilityIdentifier("jump-to-latest")
                    }
                }
                .frame(minHeight: 0, maxHeight: expanded ? 0 : .infinity)
                .clipped()
                .opacity(expanded ? 0 : 1)
                .accessibilityHidden(expanded)

                ScrollView(.vertical, showsIndicators: accessoryHeight > accessoryViewportHeight(geometry.size.height)) {
                    conversationAccessories(toolbarWork: toolbarWork)
                }
                .scrollBounceBehavior(.basedOnSize)
                .scrollDismissesKeyboard(.never)
                .frame(height: accessoryViewportHeight(geometry.size.height))
                NativeComposer(draft: draft, conversation: conversation, expanded: $expanded,
                               onIntent: { intent in
                                   readingInteraction.forwardComposerIntent(intent, to: onIntent)
                               }, showModels: { showSheet(.models(conversation.id)) },
                               maximumHeight: geometry.size.height - accessoryViewportHeight(geometry.size.height))
            }
            .onPreferenceChange(NativeConversationAccessoryHeightKey.self) { accessoryHeight = $0 }
            .toolbar { conversationToolbar(toolbarWork: toolbarWork) }
        }
        .background(Color(uiColor: .systemBackground))
        .onAppear {
            onIntent(.conversationVisibilityChanged(conversation.id, viewID: visibilityID, visible: true))
            reportReadingVisibility(canRead)
        }
        .onDisappear {
            onIntent(.conversationVisibilityChanged(conversation.id, viewID: visibilityID, visible: false))
            reportReadingVisibility(false)
        }
        .onChange(of: draft.acceptedLocalInputID) { id in
            guard let id, let latest = model.conversations[conversation.id],
                  latest.messages.contains(where: { $0.id == id && $0.author.isLocal }) else { return }
            scrollRequest += 1
        }
        .onChange(of: canRead) { reportReadingVisibility($0) }
        .onChange(of: model.readingContexts[conversation.id]?.id) { _ in reportReadingVisibility(canRead) }
        .navigationTitle(conversation.agentName)
        .navigationBarTitleDisplayMode(.inline)
        .overlay(alignment: .top) {
            if !expanded && conversation.connection.phase != .ready && !conversation.connection.label.isEmpty {
                ConnectionStatusView(status: conversation.connection) {
                    if let intent = conversation.connection.primaryIntent(fallbackConnectionID: conversation.id.connectionID) { onIntent(intent) }
                }
                .padding(.horizontal, 12)
                .background(.regularMaterial, in: Capsule())
                .padding(.top, 4)
            }
        }
    }

    @ToolbarContentBuilder
    private func conversationToolbar(toolbarWork: Bool) -> some ToolbarContent {
        ToolbarItem(placement: .principal) {
            if conversation.availability(.sessions).isVisible {
                Button {
                    showSheet(.sessions(conversation.id))
                } label: {
                    headerTitle(showChevron: true)
                }
                .buttonStyle(.plain)
                .disabled(!conversation.availability(.sessions).isEnabled)
                .accessibilityLabel(Text("\(conversation.agentName), \(conversation.sessionTitle), conversations"))
                .accessibilityIdentifier("conversation-sessions")
            } else { headerTitle(showChevron: false) }
        }
        ToolbarItemGroup(placement: .navigationBarTrailing) {
            if toolbarWork, let work = conversation.work, work.inspect.isVisible, !work.id.isEmpty {
                NativeWorkToolbarButton(work: work) { openWork(work) }
            }
            if hasMoreActions {
                Menu {
                    if conversation.availability(.sessionManagement).isVisible {
                        Button {
                            let id = UUID()
                            onIntent(.prepareSessionManagement(conversation.id, requestID: id))
                            showSheet(.management(conversation.id, reviewID: id))
                        } label: { Label("Manage conversation", systemImage: "slider.horizontal.3") }
                            .disabled(!conversation.availability(.sessionManagement).isEnabled)
                    }
                    destinationButton("Agent settings", symbol: "slider.horizontal.3", feature: .agentSettings, destination: .agentSettings)
                    destinationButton("Memory", symbol: "brain", feature: .memory, destination: .memory)
                    destinationButton("Skills", symbol: "sparkles", feature: .skills, destination: .skills)
                    destinationButton("Scheduled tasks", symbol: "calendar", feature: .schedule, destination: .schedule)
                    destinationButton("Files", symbol: "folder", feature: .sessionFiles, destination: .sessionFiles)
                    destinationButton("Connection settings", symbol: "link", feature: .connectionSettings, destination: .connectionSettings)
                    destinationButton("Export conversation", symbol: "square.and.arrow.up", feature: .exportConversation, destination: .exportConversation)
                    destinationButton("Saved conversations", symbol: "books.vertical", feature: .savedHistory, destination: .savedHistory)
                    destinationButton("Previous transcripts", symbol: "clock.arrow.circlepath", feature: .previousTranscripts, destination: .previousTranscripts)
                    if conversation.availability(.loadEarlier).isVisible {
                        Button {
                            onIntent(.loadEarlier(conversation.id))
                        } label: { Label("Load earlier messages", systemImage: "clock.arrow.circlepath") }
                            .disabled(!conversation.availability(.loadEarlier).isEnabled || conversation.isLoadingHistory)
                    }
                } label: {
                    Image(systemName: "ellipsis").foregroundStyle(Color(uiColor: .label))
                        .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                }
                .tint(Color(uiColor: .label))
                .accessibilityLabel("Conversation actions")
                .accessibilityIdentifier("conversation-actions")
            }
        }
    }

    private func openWork(_ work: WorkDockPresentation) {
        guard let intent = work.openIntent(conversationID: conversation.id) else { return }
        onIntent(intent)
        showSheet(.work(conversation.id, workID: work.id))
    }

    private func conversationAccessories(toolbarWork: Bool) -> some View {
        VStack(spacing: 0) {
            if !expanded && conversation.availability(.pro).isVisible {
                Button {
                    onIntent(.openDestination(.pro, conversation: conversation.id))
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "lock.open")
                        VStack(alignment: .leading, spacing: 3) {
                            Text("View the full conversation").font(.callout.weight(.semibold))
                            Text("Latest messages · read-only preview").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                    }.frame(minHeight: 44).padding(.horizontal, 20).padding(.vertical, 8)
                }.buttonStyle(.plain).accessibilityIdentifier("conversation-upgrade")
            }
            if !toolbarWork, let work = conversation.work, work.inspect.isVisible, !work.id.isEmpty {
                NativeWorkDock(work: work) { openWork(work) }
            }
        }
        .background(GeometryReader { accessory in
            Color.clear.preference(key: NativeConversationAccessoryHeightKey.self, value: accessory.size.height)
        })
    }

    private func accessoryViewportHeight(_ height: CGFloat) -> CGFloat {
        min(accessoryHeight, max(0, min(height * 0.35, height - 64)))
    }

    private var hasMoreActions: Bool {
        [ClientFeature.agentSettings, .memory, .skills, .schedule, .sessionFiles, .connectionSettings, .loadEarlier, .sessionManagement,
         .savedHistory, .exportConversation, .previousTranscripts]
            .contains { conversation.availability($0).isVisible }
    }

    private func headerTitle(showChevron: Bool) -> some View {
        VStack(spacing: 1) {
            HStack(spacing: 5) {
                Text(conversation.agentName).font(.subheadline.weight(.semibold)).lineLimit(1)
                if showChevron { Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold)) }
            }
            Text(conversation.subtitle ?? conversation.sessionTitle)
                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }.frame(minHeight: 44).contentShape(Rectangle())
    }

    @ViewBuilder
    private func destinationButton(_ title: LocalizedStringKey, symbol: String, feature: ClientFeature, destination: ClientDestination) -> some View {
        if conversation.availability(feature).isVisible {
            Button {
                onIntent(.openDestination(destination, conversation: conversation.id))
            } label: { Label(title, systemImage: symbol) }
                .disabled(!conversation.availability(feature).isEnabled)
        }
    }
}

private struct NativeConversationAccessoryHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}
#endif
