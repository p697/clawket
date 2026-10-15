#if os(iOS)
import SwiftUI

@MainActor
struct NativeSessionManagementView: View {
    @ObservedObject var model: ClientPresentation
    let route: ConversationID
    let reviewID: UUID
    let onIntent: @MainActor (ClientIntent) -> Void

    private var review: SessionManagementPresentation? {
        guard let value = model.sessionManagement, value.id == reviewID, value.route == route else { return nil }
        return value
    }

    var body: some View {
        List {
            if let review {
                Section { Text(verbatim: review.title).font(.headline).textSelection(.enabled) }
                if review.phase == .loading {
                    ProgressView("Loading conversation actions…").frame(maxWidth: .infinity, minHeight: 80)
                } else {
                    if let error = review.error { Section { Text(verbatim: error).foregroundStyle(.secondary) } }
                    Section {
                        ForEach(SessionLifecycleAction.allCases.filter { review.actions.contains($0) }, id: \.self) { action in
                            if action == .rename {
                                NavigationLink {
                                    NativeSessionRenameEditor(model: model, snapshot: review, onIntent: onIntent)
                                } label: { actionLabel(action, review: review) }
                                    .disabled(!review.permits(action))
                            } else {
                                Button(role: action == .delete ? .destructive : nil) {
                                    onIntent(.requestSessionAction(reviewID: reviewID, action: action))
                                } label: { actionLabel(action, review: review) }
                                    .disabled(!review.permits(action))
                            }
                        }
                        if review.actions.isEmpty, review.error == nil {
                            Text("No actions are available for this conversation.").foregroundStyle(.secondary)
                        }
                    }
                }
            } else { Text("This conversation is no longer available.").foregroundStyle(.secondary) }
        }
        .navigationTitle("Conversation actions").navigationBarTitleDisplayMode(.inline)
        .overlay {
            if let confirmation = review?.confirmation, confirmation.reviewID == reviewID,
               confirmation.action.requiresConfirmation {
                SessionMutationConfirmationPresenter(confirmation: confirmation, onIntent: onIntent)
                    .id(confirmation.id)
            }
        }
    }

    private func actionLabel(_ action: SessionLifecycleAction, review: SessionManagementPresentation) -> some View {
        HStack {
            Label(action.localizedTitle, systemImage: action.symbol)
            Spacer()
            if review.submittingAction == action { ProgressView() }
        }.frame(minHeight: 44)
    }
}

@MainActor
private struct NativeSessionRenameEditor: View {
    @ObservedObject var model: ClientPresentation
    let snapshot: SessionManagementPresentation
    let onIntent: @MainActor (ClientIntent) -> Void
    @State private var title: String
    @Environment(\.dismiss) private var dismiss
    init(model: ClientPresentation, snapshot: SessionManagementPresentation,
         onIntent: @escaping @MainActor (ClientIntent) -> Void) {
        self.model = model; self.snapshot = snapshot; self.onIntent = onIntent
        _title = State(initialValue: snapshot.title)
    }
    private var current: SessionManagementPresentation? {
        guard let value = model.sessionManagement, value.id == snapshot.id, value.route == snapshot.route else { return nil }
        return value
    }
    private var canSave: Bool { current?.permits(.rename) == true && current?.validatedTitle(title) != nil }
    var body: some View {
        Form {
            Section("Conversation name") {
                TextField("Conversation name", text: $title, axis: .vertical)
                    .lineLimit(1...4).submitLabel(.done)
                    .disabled(current?.permits(.rename) != true)
                    .onSubmit { save() }
            }
            if let error = current?.error { Section { Text(verbatim: error).foregroundStyle(.secondary) } }
            if current == nil || current?.phase == .unavailable {
                Text("This conversation is no longer available.").foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Rename conversation").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button { save() } label: {
                    if current?.submittingAction == .rename { ProgressView().accessibilityLabel("Save changes") }
                    else { Text("Save changes") }
                }.disabled(!canSave)
            }
        }
        .onChange(of: current?.title) { name in
            if name != nil, name != snapshot.title, current?.submittingAction == nil { dismiss() }
        }
    }
    private func save() {
        guard canSave, let value = current?.validatedTitle(title) else { return }
        onIntent(.renameSession(reviewID: snapshot.id, title: value))
    }
}

@MainActor
private struct SessionMutationConfirmationPresenter: View {
    let confirmation: SessionMutationConfirmation
    let onIntent: @MainActor (ClientIntent) -> Void
    @State private var presented = true
    var body: some View {
        Color.clear.frame(width: 0, height: 0).accessibilityHidden(true)
            .confirmationDialog(confirmation.action.localizedTitle, isPresented: $presented, titleVisibility: .visible) {
                Button(confirmation.action.localizedTitle, role: .destructive) {
                    onIntent(.confirmSessionMutation(confirmationID: confirmation.id))
                }
                Button("Cancel", role: .cancel) { onIntent(.dismissSessionMutationConfirmation(confirmationID: confirmation.id)) }
            } message: {
                if confirmation.action == .reset {
                    Text("Reset this conversation on the connected agent? Your local draft and pending messages will be kept.")
                } else { Text("Delete this conversation from the connected agent? This cannot be undone.") }
            }
            .onChange(of: presented) { visible in
                if !visible {
                    Task { @MainActor in
                        await Task.yield()
                        onIntent(.dismissSessionMutationConfirmation(confirmationID: confirmation.id))
                    }
                }
            }
    }
}

extension SessionLifecycleAction {
    var localizedTitle: String {
        switch self {
        case .rename: String(localized: "Rename conversation")
        case .reset: String(localized: "Reset conversation")
        case .delete: String(localized: "Delete conversation")
        case .archive: String(localized: "Archive conversation")
        case .restore: String(localized: "Restore conversation")
        case .branch: String(localized: "Continue in a new conversation")
        }
    }
    var symbol: String {
        switch self {
        case .rename: "pencil"
        case .reset: "arrow.counterclockwise"
        case .delete: "trash"
        case .archive: "archivebox"
        case .restore: "tray.and.arrow.up"
        case .branch: "doc.on.doc"
        }
    }
}
#endif
