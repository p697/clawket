import ClawketCommerce
import ClawketUI
import SwiftUI

struct NativeProSettingsCard: View {
    @ObservedObject var client: NativeAppModel
    let presenterID: UUID
    var body: some View {
        Button { client.showPro(presenterID: presenterID) } label: {
            HStack(spacing: 14) {
                ClawketMark().frame(width: 36, height: 34)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.headline).foregroundStyle(.primary)
                    Text(detail).font(.footnote).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
            }.padding(.vertical, 8).frame(minHeight: 44)
        }.buttonStyle(.plain).accessibilityIdentifier("settings-pro")
    }
    private var title: String {
        if client.pro.mode == .community { return String(localized: "Community build") }
        return client.pro.paid ? String(localized: "You're Pro") : String(localized: "Upgrade to Pro")
    }
    private var detail: String {
        if client.pro.mode == .community { return String(localized: "Features are available without a store subscription.") }
        if client.pro.customer?.isLifetime(at: client.pro.now) == true || client.pro.customer?.isGrandfathered(at: client.pro.now) == true {
            return String(localized: "Lifetime is active")
        }
        return client.pro.paid ? String(localized: "Manage Clawket Pro") : String(localized: "Unlimited connections and Agents")
    }
}

struct NativeFreeConnectionView: View {
    @ObservedObject var client: NativeAppModel
    var body: some View {
        List {
            Section {
                ForEach(client.connections) { connection in
                    Button { Task { await client.switchFreeConnection(connection.id) } } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(connection.label).foregroundStyle(.primary)
                                Text(connection.backendKind.title).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if client.pro.allowance?.freeConnectionId.map({ $0.utf8.elementsEqual(connection.id.utf8) }) == true {
                                Image(systemName: "checkmark").foregroundStyle(.primary)
                            }
                        }.frame(minHeight: 44)
                    }.disabled(client.proSwitching || client.changingConnections || client.proStorageFailed || !canSwitch)
                        .accessibilityLabel(Text("Use as free connection") + Text(verbatim: ": ") + Text(verbatim: connection.label))
                }
            } footer: { Text("You can change your free connection once every 24 hours.") }
        }.navigationTitle("Choose free connection").navigationBarTitleDisplayMode(.inline)
    }
    private var canSwitch: Bool {
        guard let allowance = client.pro.allowance else { return false }
        guard let previous = allowance.lastFreeConnectionSwitchAt else { return true }
        return Double(previous) + Double(ProAllowanceStore.switchInterval) <= client.pro.now
    }
}
