#if os(iOS)
import SwiftUI

@MainActor
struct ClientSheetView: View {
    let item: ClientSheet
    @ObservedObject var model: ClientPresentation
    let onIntent: @MainActor (ClientIntent) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    var body: some View {
        NavigationStack {
            Group {
                switch item {
                case let .sessions(route): sessions(route)
                case let .models(route): models(route)
                case let .catalog(id): catalog(id)
                case .connectionApprovals: connectionApprovals
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .onChange(of: model.selectedConversation) { route in
            if case let .catalog(id) = item, let route, route.isConcrete,
               route.connectionID == id.connectionID, route.agentID == id.agentID { dismiss() }
        }
    }

    private func sessions(_ route: ConversationID) -> some View {
        let conversation = model.conversations[route]
        let rows = (conversation?.sessions ?? []).filter {
            $0.route.isConcrete && (search.isEmpty || $0.title.localizedStandardContains(search) || ($0.subtitle ?? "").localizedStandardContains(search))
        }
        return List {
            if conversation?.availability(.newSession).isVisible == true {
                Button {
                    dismiss()
                    onIntent(.openDestination(.newSession, conversation: route))
                } label: { Label("New conversation", systemImage: "square.and.pencil") }
                    .disabled(conversation?.availability(.newSession).isEnabled != true)
            }
            Section {
                ForEach(rows) { session in
                    Button {
                        model.selectedConversation = session.route
                        dismiss()
                    } label: {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: session.symbol).foregroundStyle(.secondary).frame(width: 24)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(session.title).font(.body).foregroundStyle(.primary)
                                if let subtitle = session.subtitle {
                                    Text(subtitle).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            Spacer(minLength: 4)
                            if session.isSelected { Image(systemName: "checkmark").font(.body.weight(.semibold)) }
                            else if session.unread { Circle().fill(Color.accentColor).frame(width: 7, height: 7).padding(.top, 7) }
                        }
                        .padding(.vertical, 4).frame(minHeight: 44)
                    }
                    .accessibilityAddTraits(session.isSelected ? .isSelected : [])
                    .accessibilityIdentifier("session-\(session.id)")
                }
                if rows.isEmpty {
                    Text(search.isEmpty ? String(localized: "No conversations yet") : String(localized: "No matching conversations"))
                        .foregroundStyle(.secondary).frame(minHeight: 60)
                }
            }
        }
        .navigationTitle("Conversations")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $search, prompt: "Search conversations")
    }

    private func catalog(_ id: AgentCatalogID) -> some View {
        let catalog = model.catalogs[id]
        let rows = (catalog?.sessions ?? []).filter {
            $0.route.isConcrete && (search.isEmpty || $0.title.localizedStandardContains(search) || ($0.subtitle ?? "").localizedStandardContains(search))
        }
        return List {
            if let catalog, !catalog.projects.isEmpty {
                Section("Project") {
                    Menu {
                        Button("All projects") { onIntent(.selectCatalogProject(id, projectID: nil)) }
                        ForEach(catalog.projects) { project in
                            Button {
                                onIntent(.selectCatalogProject(id, projectID: project.id))
                            } label: {
                                if catalog.selectedProjectID == project.id { Label(project.title, systemImage: "checkmark") }
                                else { Text(project.title) }
                            }
                        }
                    } label: {
                        HStack {
                            Label(catalog.projects.first(where: { $0.id == catalog.selectedProjectID })?.title ?? String(localized: "All projects"), systemImage: "folder")
                            Spacer()
                            Image(systemName: "chevron.up.chevron.down").font(.caption)
                        }.frame(minHeight: 44)
                    }
                }
            }
            if catalog?.createSession.isVisible == true {
                Button {
                    onIntent(.createSession(id, projectID: catalog?.selectedProjectID))
                } label: { Label("New conversation", systemImage: "square.and.pencil") }
                    .disabled(catalog?.createSession.isEnabled != true)
            }
            Section("Conversations") {
                ForEach(rows) { session in
                    Button {
                        model.selectedConversation = session.route
                        dismiss()
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: session.symbol).foregroundStyle(.secondary)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(session.title).foregroundStyle(.primary)
                                if let subtitle = session.subtitle { Text(subtitle).font(.caption).foregroundStyle(.secondary) }
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                        }.padding(.vertical, 5).frame(minHeight: 44)
                    }
                }
                if catalog == nil || catalog?.isLoading == true {
                    ProgressView("Loading conversations…").frame(maxWidth: .infinity, minHeight: 60)
                } else if let error = catalog?.error {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(error).foregroundStyle(.secondary)
                        if catalog?.refresh.isVisible == true {
                            Button("Try again") { onIntent(.refreshCatalog(id)) }
                                .disabled(catalog?.refresh.isEnabled != true)
                        }
                    }.padding(.vertical, 12)
                } else if rows.isEmpty {
                    Text(search.isEmpty ? String(localized: "No conversations yet") : String(localized: "No matching conversations"))
                        .foregroundStyle(.secondary).frame(minHeight: 60)
                }
            }
        }
        .navigationTitle(catalog?.title ?? String(localized: "Conversations"))
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $search, prompt: "Search conversations")
    }

    private func models(_ route: ConversationID) -> some View {
        let conversation = model.conversations[route]
        let choices = (conversation?.models ?? []).filter {
            $0.availability.isVisible && (search.isEmpty || $0.title.localizedStandardContains(search) || ($0.subtitle ?? "").localizedStandardContains(search))
        }
        let groups = choices.reduce(into: [String]()) { result, item in
            let group = item.group ?? ""
            if !result.contains(group) { result.append(group) }
        }
        return List {
            if let scope = conversation?.modelScopeLabel {
                Section {
                    Label(scope, systemImage: "info.circle").font(.subheadline).foregroundStyle(.secondary)
                }
            }
            ForEach(groups, id: \.self) { group in
                Section {
                    ForEach(choices.filter { ($0.group ?? "") == group }) { choice in
                        Button {
                            onIntent(.selectModel(route, modelID: choice.id))
                        } label: {
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(choice.title).font(.body).foregroundStyle(.primary)
                                    if let subtitle = choice.subtitle {
                                        Text(subtitle).font(.caption).foregroundStyle(.secondary)
                                    }
                                    if let reason = choice.availability.explanation {
                                        Text(reason).font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                                Spacer(minLength: 4)
                                if choice.isSubmitting { ProgressView() }
                                else if choice.isSelected { Image(systemName: "checkmark").font(.body.weight(.semibold)) }
                            }.padding(.vertical, 4).frame(minHeight: 44)
                        }
                        .disabled(!choice.availability.isEnabled || choices.contains(where: \.isSubmitting))
                        .accessibilityAddTraits(choice.isSelected ? .isSelected : [])
                        .accessibilityIdentifier("model-\(choice.id)")
                    }
                } header: {
                    if !group.isEmpty { Text(group) }
                }
            }
            if choices.isEmpty {
                Text("No available models").foregroundStyle(.secondary).frame(minHeight: 60)
            }
        }
        .navigationTitle("Model")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $search, prompt: "Search models")
        .onChange(of: conversation?.models.first(where: \.isSelected)?.id) { selected in
            if selected != nil { dismiss() }
        }
    }

    private var connectionApprovals: some View {
        ScrollView {
            LazyVStack(spacing: 20) {
                ForEach(model.connectionApprovals) { approval in
                    ApprovalContentView(approval: approval, model: model, onIntent: onIntent)
                }
            }.padding(20)
        }
        .navigationTitle("Connection approval")
        .navigationBarTitleDisplayMode(.inline)
    }
}
#endif
