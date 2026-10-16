import ClawketUI
import SwiftUI

@main
struct ClawketApp: App {
    @StateObject private var client = NativeAppModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            NativeAppRootView(client: client)
                .task { await client.start() }
                .onChange(of: phase) { phase in
                    client.setForeground(phase == .active)
                    client.voiceSceneChanged(phase)
                }
        }
    }
}

/// The app and UIKit regression hosts use the same real modal presenters.
/// Starting connections and observing the scene remain the App's responsibility.
@MainActor
struct NativeAppRootView: View {
    @ObservedObject var client: NativeAppModel
    @State private var destinationOnScreen: UUID?

    var body: some View {
        NativeClientView(model: client.presentation, onIntent: client.handle)
            .preferredColorScheme(client.presentation.appearance.colorScheme)
            .tint(client.presentation.appearance.accentColor)
            .sheet(item: $client.destination, onDismiss: {
                let dismissed = destinationOnScreen
                destinationOnScreen = nil
                client.destinationDidDismiss(presentationID: dismissed)
            }) { destination in
                let presentationID = client.destinationPresentationID
                destinationContent(destination)
                    .onAppear { destinationOnScreen = presentationID }
                    .modifier(NativeNoticeAlert(client: client, canPresent: {
                        client.destination != nil && client.destinationPresentationID == presentationID
                    }))
            }
            .sheet(item: $client.mediaPicker) { request in NativeMediaPicker(client: client, request: request) }
            .sheet(item: $client.voiceSheet) { request in
                if let voice = client.voice { NativeVoiceSheet(client: client, voice: voice, request: request) }
            }
            .nativePro(controller: client.pro, presenterID: client.proRootPresenterID)
            .fullScreenCover(item: $client.mediaPreview) { preview in NativeMediaViewer(preview: preview) }
            .modifier(NativeNoticeAlert(client: client, canPresent: {
                client.destination == nil && destinationOnScreen == nil
            }))
    }

    @ViewBuilder private func destinationContent(_ destination: NativeAppModel.Destination) -> some View {
        switch destination {
        case .connect: ConnectAgentView(client: client)
        case .connections: ConnectionsView(client: client)
        case .settings: NativeSettingsView(client: client, preferences: client.preferences)
        case let .deviceApproval(connectionID): DeviceApprovalView(client: client, connectionID: connectionID)
        case let .savedHistory(id):
            if let history = client.historyController { NativeSavedHistoryView(controller: history, client: client).id(id) }
        case let .previousTranscripts(scope, id):
            if let history = client.historyController { NativePreviousTranscriptsView(controller: history, scope: scope).id(id) }
        case let .exportConversation(request):
            if let history = client.historyController { NativeConversationExportView(controller: history, request: request).id(request.id) }
        case let .editPending(route, edit, activation):
            PendingMessageEditor(client: client, route: route, edit: edit, activation: activation)
        }
    }
}

@MainActor
private struct NativeNoticeAlert: ViewModifier {
    private struct Notice: Identifiable { let id: UUID; let text: String }
    @ObservedObject var client: NativeAppModel
    let canPresent: @MainActor () -> Bool

    func body(content: Content) -> some View {
        content.alert(item: Binding(
            get: { canPresent() ? client.notice.map { Notice(id: client.noticeRevision, text: $0) } : nil },
            // Losing a presenter is not acknowledgement. Only the displayed OK consumes its own notice.
            set: { _ in })) { notice in
                Alert(title: Text("Clawket"), message: Text(notice.text), dismissButton: .cancel(Text("OK")) {
                    if canPresent() { client.dismissNotice(id: notice.id) }
                })
            }
    }
}
