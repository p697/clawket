import ClawketUI
import SwiftUI

@main
struct ClawketApp: App {
    @StateObject private var client = NativeAppModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            NativeClientView(model: client.presentation, onIntent: client.handle)
                .preferredColorScheme(client.presentation.appearance.colorScheme)
                .tint(client.presentation.appearance.accentColor)
                .sheet(item: $client.destination) { destination in
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
                .sheet(item: $client.mediaPicker) { request in NativeMediaPicker(client: client, request: request) }
                .sheet(item: $client.voiceSheet) { request in
                    if let voice = client.voice { NativeVoiceSheet(client: client, voice: voice, request: request) }
                }
                .nativePro(controller: client.pro, presenterID: client.proRootPresenterID)
                .fullScreenCover(item: $client.mediaPreview) { preview in NativeMediaViewer(preview: preview) }
                .alert("Clawket", isPresented: Binding(get: { client.notice != nil }, set: { if !$0 { client.notice = nil } })) {
                    Button("OK", role: .cancel) { client.notice = nil }
                } message: { Text(client.notice ?? "") }
                .task { await client.start() }
                .onChange(of: phase) { phase in
                    client.setForeground(phase == .active)
                    client.voiceSceneChanged(phase)
                }
        }
    }
}
