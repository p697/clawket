#if os(iOS)
import SwiftUI

@MainActor
struct NativeModelControlsView: View {
    @ObservedObject var model: ClientPresentation
    let route: ConversationID
    let reviewID: UUID
    let onIntent: @MainActor (ClientIntent) -> Void
    @State private var prepared = false

    private var review: ModelControlsPresentation? {
        guard let value = model.modelControls, value.id == reviewID, value.route == route else { return nil }
        return value
    }
    var body: some View {
        List {
            if let review {
                if review.scope != .catalog {
                    Section {
                        Label(review.scope == .global ? String(localized: "Applies to all conversations") : String(localized: "This conversation"),
                              systemImage: "info.circle").font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                if review.phase == .loading { ProgressView("Loading model settings…").frame(maxWidth: .infinity, minHeight: 44) }
                if let error = review.error {
                    Section {
                        Text(verbatim: error).foregroundStyle(.secondary)
                        if review.refresh.isVisible {
                            Button("Try again") { onIntent(.refreshModelControls(reviewID: reviewID)) }
                                .disabled(!review.refresh.isEnabled)
                        }
                    }
                }
                if let notice = review.notice { Section { Text(verbatim: notice).foregroundStyle(.secondary) } }
                modelSection(review)
                if let thinking = review.thinking, thinking.availability.isVisible {
                    Section {
                        NavigationLink { thinkingChoices } label: {
                            settingLabel("Thinking", symbol: "brain", value: review.thinkingLevels.first { $0.id == thinking.current }?.title,
                                         pending: { if case .some(.thinking(_)) = review.submitting { true } else { false } }())
                        }
                        .disabled(review.thinkingLevels.isEmpty)
                        if let reason = thinking.availability.explanation { Text(verbatim: reason).font(.footnote).foregroundStyle(.secondary) }
                    }
                }
                if let fast = review.fastMode, fast.availability.isVisible {
                    Section {
                        if let enabled = fast.enabled {
                            HStack {
                                Toggle(isOn: Binding(get: { enabled }, set: { choose(.fastMode($0)) })) {
                                    Label("Fast mode", systemImage: "bolt")
                                }
                                .disabled(!review.permits(.fastMode(!enabled)))
                                if case .some(.fastMode(_)) = review.submitting { ProgressView().accessibilityLabel("Fast mode") }
                            }.frame(minHeight: 44)
                        } else {
                            NavigationLink { fastModeChoices } label: {
                                settingLabel("Fast mode", symbol: "bolt", value: nil,
                                             pending: { if case .some(.fastMode(_)) = review.submitting { true } else { false } }())
                            }
                        }
                        if let reason = fast.availability.explanation { Text(verbatim: reason).font(.footnote).foregroundStyle(.secondary) }
                    }
                }
                if let permissions = review.permissions, permissions.availability.isVisible {
                    permissionSection(permissions, review: review)
                }
            } else {
                ProgressView("Loading model settings…").frame(maxWidth: .infinity, minHeight: 80)
            }
        }
        .navigationTitle("Model settings").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let review, review.refresh.isVisible {
                ToolbarItem(placement: .primaryAction) {
                    Button { onIntent(.refreshModelControls(reviewID: reviewID)) } label: { Image(systemName: "arrow.clockwise") }
                        .disabled(!review.refresh.isEnabled).accessibilityLabel("Refresh")
                }
            }
        }
        .overlay {
            if let confirmation = review?.confirmation, confirmation.reviewID == reviewID {
                ModelPermissionConfirmationPresenter(confirmation: confirmation, onIntent: onIntent).id(confirmation.id)
            }
        }
        .task {
            guard !prepared else { return }
            prepared = true
            onIntent(.prepareModelControls(route, requestID: reviewID))
        }
    }

    private func modelSection(_ review: ModelControlsPresentation) -> some View {
        Section("Model") {
            ForEach(review.featuredModels) { row in modelRow(row, review: review) }
            if review.orderedModels.count > 4 {
                NavigationLink { NativeModelCatalog(model: model, route: route, reviewID: reviewID, onIntent: onIntent) } label: {
                    Label("All models", systemImage: "square.grid.2x2")
                        .frame(minHeight: 44)
                }
            }
            if review.orderedModels.isEmpty, review.phase != .loading {
                Text("No available models").foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder private func modelRow(_ row: ModelPresentation, review: ModelControlsPresentation) -> some View {
        if review.modelSelection.isVisible {
            Button { choose(.model(row.id)) } label: {
                ModelControlRow(row: row, pending: review.submitting == .model(row.id))
            }.disabled(!review.permits(.model(row.id)))
        } else { ModelControlRow(row: row, pending: review.submitting == .model(row.id)) }
    }

    private var thinkingChoices: some View {
        List {
            if let review {
                ForEach(review.thinkingLevels) { level in
                    Button { choose(.thinking(level.id)) } label: {
                        HStack {
                            Text(verbatim: level.title).foregroundStyle(.primary)
                            Spacer()
                            if review.submitting == .thinking(level.id) { ProgressView() }
                            else if review.thinking?.current == level.id { Image(systemName: "checkmark").accessibilityLabel("Selected") }
                        }.frame(minHeight: 44)
                    }.disabled(!review.permits(.thinking(level.id)))
                        .accessibilityAddTraits(review.thinking?.current == level.id ? .isSelected : [])
                }
            }
        }.navigationTitle("Thinking").navigationBarTitleDisplayMode(.inline)
    }

    private var fastModeChoices: some View {
        List {
            if let review {
                ForEach([false, true], id: \.self) { enabled in
                    Button { choose(.fastMode(enabled)) } label: {
                        HStack {
                            Text(enabled ? String(localized: "On") : String(localized: "Off")).foregroundStyle(.primary)
                            Spacer()
                            if review.submitting == .fastMode(enabled) { ProgressView() }
                            else if review.fastMode?.enabled == enabled { Image(systemName: "checkmark").accessibilityLabel("Selected") }
                        }.frame(minHeight: 44)
                    }.disabled(!review.permits(.fastMode(enabled)))
                }
            }
        }.navigationTitle("Fast mode").navigationBarTitleDisplayMode(.inline)
    }

    private func permissionSection(_ permissions: PermissionControlPresentation, review: ModelControlsPresentation) -> some View {
        Section {
            ForEach(ModelPermissionMode.allCases.filter { permissions.modes.contains($0) }, id: \.self) { mode in
                Button { choose(.permissions(mode)) } label: {
                    HStack(alignment: .center, spacing: 12) {
                        Image(systemName: mode.symbol).foregroundStyle(mode == .fullAccess ? Color.orange : Color.secondary)
                            .frame(width: 24)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(mode.localizedTitle).foregroundStyle(.primary)
                            Text(mode.localizedDetail).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 4)
                        if review.submitting == .permissions(mode) { ProgressView() }
                        else if !permissions.requiresConfirmation, permissions.current == .mode(mode) {
                            Image(systemName: "checkmark").accessibilityLabel("Selected")
                        }
                    }.frame(minHeight: 44)
                }.disabled(!review.permits(.permissions(mode)))
                    .accessibilityAddTraits(!permissions.requiresConfirmation && permissions.current == .mode(mode) ? .isSelected : [])
            }
        } header: { Text("Permissions") } footer: {
            VStack(alignment: .leading, spacing: 8) {
                if permissions.requiresConfirmation { Text("Choose permissions again before sending.") }
                else if permissions.current == .computerSettings { Text("Computer settings") }
                else if permissions.current == nil { Text("Unknown") }
                if let reason = permissions.availability.explanation { Text(verbatim: reason) }
                if permissions.unencryptedTransport {
                    Text("This connection is not encrypted. Use a trusted network or switch to Relay.")
                }
            }
        }
    }

    private func settingLabel(_ title: LocalizedStringKey, symbol: String, value: String?, pending: Bool) -> some View {
        HStack(spacing: 12) {
            Label(title, systemImage: symbol).foregroundStyle(.primary)
            Spacer(minLength: 4)
            if pending { ProgressView() }
            else { Text(verbatim: value ?? String(localized: "Unknown")).foregroundStyle(.secondary) }
        }.frame(minHeight: 44)
    }
    private func choose(_ choice: ModelControlChoice) {
        guard review?.permits(choice) == true else { return }
        onIntent(.chooseModelControl(reviewID: reviewID, choice: choice))
    }
}

@MainActor
private struct NativeModelCatalog: View {
    @ObservedObject var model: ClientPresentation
    let route: ConversationID
    let reviewID: UUID
    let onIntent: @MainActor (ClientIntent) -> Void
    @State private var query = ""
    private var review: ModelControlsPresentation? {
        guard let value = model.modelControls, value.id == reviewID, value.route == route else { return nil }; return value
    }
    var body: some View {
        let rows = ModelCatalogPresentation.ordered(review?.models ?? [], query: query)
        let groups = rows.reduce(into: [String]()) { result, row in
            if !result.contains(row.group ?? "") { result.append(row.group ?? "") }
        }
        List {
            ForEach(groups, id: \.self) { group in
                Section {
                    ForEach(rows.filter { ($0.group ?? "") == group }) { row in
                        if review?.modelSelection.isVisible == true {
                            Button {
                                guard review?.permits(.model(row.id)) == true else { return }
                                onIntent(.chooseModelControl(reviewID: reviewID, choice: .model(row.id)))
                            } label: { ModelControlRow(row: row, pending: review?.submitting == .model(row.id)) }
                                .disabled(review?.permits(.model(row.id)) != true)
                        } else { ModelControlRow(row: row, pending: false) }
                    }
                } header: { if !group.isEmpty { Text(verbatim: group) } }
            }
            if rows.isEmpty { Text("No available models").foregroundStyle(.secondary) }
        }
        .navigationTitle("All models").navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: "Search models")
    }
}

@MainActor
private struct ModelControlRow: View {
    let row: ModelPresentation
    let pending: Bool
    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: row.title).foregroundStyle(.primary)
                if let subtitle = row.subtitle { Text(verbatim: subtitle).font(.caption).foregroundStyle(.secondary) }
                if row.isConfiguredDefault { Text("Default").font(.caption).foregroundStyle(.secondary) }
                if let reason = row.availability.explanation { Text(verbatim: reason).font(.caption).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 4)
            if pending { ProgressView() }
            else if row.isSelected { Image(systemName: "checkmark").accessibilityLabel("Selected") }
        }.padding(.vertical, 4).frame(minHeight: 44)
            .accessibilityAddTraits(row.isSelected ? .isSelected : [])
    }
}

@MainActor
private struct ModelPermissionConfirmationPresenter: View {
    let confirmation: ModelPermissionConfirmationPresentation
    let onIntent: @MainActor (ClientIntent) -> Void
    @State private var presented = true
    var body: some View {
        Color.clear.frame(width: 0, height: 0).accessibilityHidden(true)
            .confirmationDialog(confirmation.mode.localizedTitle, isPresented: $presented, titleVisibility: .visible) {
                Button("Confirm") { onIntent(.confirmModelPermissions(confirmationID: confirmation.id)) }
                Button("Cancel", role: .cancel) { onIntent(.dismissModelPermissions(confirmationID: confirmation.id)) }
            } message: { Text(confirmation.mode.localizedDetail) }
            .onChange(of: presented) { visible in
                if !visible {
                    Task { @MainActor in
                        await Task.yield()
                        onIntent(.dismissModelPermissions(confirmationID: confirmation.id))
                    }
                }
            }
    }
}

extension ModelPermissionMode {
    var localizedTitle: String {
        switch self {
        case .readOnly: String(localized: "Read only")
        case .workspace: String(localized: "Workspace access")
        case .fullAccess: String(localized: "Full access")
        }
    }
    var localizedDetail: String {
        switch self {
        case .readOnly: String(localized: "Read files. Ask before making changes.")
        case .workspace: String(localized: "Work in the project. Ask before broader access.")
        case .fullAccess: String(localized: "Run commands and change files without asking.")
        }
    }
    var symbol: String {
        switch self { case .readOnly: "eye"; case .workspace: "folder"; case .fullAccess: "shield.lefthalf.filled" }
    }
}
#endif
