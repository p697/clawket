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
                                           draft: model.draft(for: route), onIntent: onIntent,
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
                        switch agent.entryMode {
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
                        }
                    }
                    .disabled(!agent.availability.isEnabled)
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
                Image(systemName: agent.attention == .approval ? "hand.raised.fill" : "text.bubble.fill")
                    .font(.caption).foregroundStyle(.orange).padding(.top, 4)
            } else if agent.unread {
                Circle().fill(Color.accentColor).frame(width: 8, height: 8).padding(.top, 7)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityValue([agent.backendLabel, agent.timeLabel, agent.unread ? String(localized: "Unread messages") : nil,
                             agent.attention == .approval ? String(localized: "Approval needed") : nil,
                             agent.attention == .input ? String(localized: "Input needed") : nil].compactMap { $0 }.joined(separator: ", "))
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
private struct NativeConversationView: View {
    @ObservedObject var model: ClientPresentation
    let conversation: ConversationPresentation
    @ObservedObject var draft: ComposerDraft
    let onIntent: @MainActor (ClientIntent) -> Void
    let showSheet: (ClientSheet) -> Void
    @State private var expanded = false
    @State private var following = true
    @State private var scrollRequest = 0
    @State private var visibilityID = UUID()

    var body: some View {
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
                                     onIntent: onIntent)
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
            .frame(maxHeight: expanded ? 0 : .infinity)
            .opacity(expanded ? 0 : 1)
            .accessibilityHidden(expanded)

            if let work = conversation.work, work.inspect.isVisible, !work.id.isEmpty {
                NativeWorkDock(work: work) {
                    guard let intent = work.openIntent(conversationID: conversation.id) else { return }
                    onIntent(intent)
                    showSheet(.work(conversation.id, workID: work.id))
                }
            }
            NativeComposer(draft: draft, conversation: conversation, expanded: $expanded,
                           onIntent: { intent in
                               if case .send = intent { scrollRequest += 1 }
                               onIntent(intent)
                           }, showModels: { showSheet(.models(conversation.id)) })
        }
        .background(Color(uiColor: .systemBackground))
        .onAppear { onIntent(.conversationVisibilityChanged(conversation.id, viewID: visibilityID, visible: true)) }
        .onDisappear { onIntent(.conversationVisibilityChanged(conversation.id, viewID: visibilityID, visible: false)) }
        .navigationTitle(conversation.agentName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
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
            ToolbarItem(placement: .navigationBarTrailing) {
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
                        Image(systemName: "ellipsis").frame(minWidth: 44, minHeight: 44)
                    }.accessibilityLabel("Conversation actions")
                }
            }
        }
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
        }.frame(minHeight: 44)
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
#endif
