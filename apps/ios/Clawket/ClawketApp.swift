import ClawketUI
import SwiftUI

@main
struct ClawketApp: App {
    @StateObject private var client = NativeAppModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            NativeClientView(model: client.presentation, onIntent: client.handle)
                .sheet(item: $client.destination) { destination in
                    switch destination {
                    case .connect: ConnectAgentView(client: client)
                    case .connections: ConnectionsView(client: client)
                    case let .editPending(route, edit, activation):
                        PendingMessageEditor(client: client, route: route, edit: edit, activation: activation)
                    }
                }
                .alert("Clawket", isPresented: Binding(get: { client.notice != nil }, set: { if !$0 { client.notice = nil } })) {
                    Button("OK", role: .cancel) { client.notice = nil }
                } message: { Text(client.notice ?? "") }
                .task { await client.start() }
                .onChange(of: phase) { phase in
                    client.setForeground(phase == .active)
                }
        }
    }
}
