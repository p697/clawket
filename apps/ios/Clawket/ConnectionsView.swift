import ClawketRuntime
import SwiftUI

struct ConnectionsView: View {
    @ObservedObject var client: NativeAppModel
    var embedded = false
    @Environment(\.dismiss) private var dismiss
    @State private var remove: BackendConnection?
    @State private var proPresenterID = UUID()

    var body: some View {
        Group {
            if embedded { content }
            else { NavigationStack { content } }
        }.nativePro(controller: client.pro, presenterID: proPresenterID)
    }
    @MainActor func addConnection() {
        if client.proCanAddConnection { client.showConnectAfterDismissal() }
        else { client.showPro(.gatewayConnections, presenterID: proPresenterID, continuing: .addConnection) }
    }

    private var content: some View {
            List {
                if let approval = client.deviceApproval, approval.connectionID == client.activeConnectionID {
                    Section {
                        Button { client.handle(.reviewDeviceApproval(connectionID: approval.connectionID, contextID: approval.id)) }
                            label: { Label("Device approval required", systemImage: "hand.raised") }
                            .accessibilityIdentifier("review-device-approval")
                    }
                }
                Section("Connections") {
                    if client.connections.isEmpty {
                        Text("Connect an agent to get started.").foregroundStyle(.secondary)
                    }
                    ForEach(client.connections) { connection in
                        Button { client.activate(connection.id, presenterID: proPresenterID) } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "link.circle.fill").font(.title2).foregroundStyle(.secondary)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(connection.label).foregroundStyle(.primary)
                                    Text(connection.backendKind.title).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if connection.id == client.activeConnectionID {
                                    Image(systemName: "checkmark").font(.body.weight(.semibold)).foregroundStyle(.primary)
                                }
                            }.frame(minHeight: 44)
                        }
                        .accessibilityIdentifier("saved-connection-\(connection.id)")
                        .swipeActions { Button("Remove", role: .destructive) { remove = connection } }
                    }
                    Button(action: addConnection) { Label("Add connection", systemImage: "plus") }
                    if client.activeConnectionID != nil {
                        Button("Disconnect") { client.disconnect() }
                    }
                }
                Section {
                    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—"
                    LabeledContent("Version", value: String(localized: "\(version) · Native development"))
                    Text("This development app has its own connections and storage.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .disabled(client.changingConnections || client.proSwitching)
            .navigationTitle("Connections").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { if !embedded { Button("Done") { dismiss() } } } }
            .confirmationDialog("Remove this connection?", isPresented: Binding(get: { remove != nil }, set: { if !$0 { remove = nil } }), titleVisibility: .visible) {
                Button("Remove connection", role: .destructive) {
                    if let id = remove?.id { client.removeConnection(id) }; remove = nil
                }
            } message: { Text("Saved conversations remain on this device. You can pair the agent again later.") }
    }
}
