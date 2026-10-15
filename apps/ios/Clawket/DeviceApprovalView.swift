import ClawketRuntime
import SwiftUI
import UIKit

/// Matching a display snapshot can open/retry its connection, never approve a device.
enum NativeDeviceApprovalPolicy {
    static func failureText(_ code: RuntimeFailure.Code, backend: BackendKind?) -> String? {
        guard code == .authenticationRequired || code == .pairingRequired else { return nil }
        guard backend == .openclaw else {
            return String(localized: "Your agent needs to be paired again. Add its current pairing code in Settings.")
        }
        return code == .pairingRequired
            ? String(localized: "Approve this device in OpenClaw on your computer, then connect again.")
            : String(localized: "Authentication required. Check this connection’s credentials.")
    }

    static func matches(_ context: RuntimeDeviceApprovalContext?, connectionID: String,
                        contextID: UUID, activeConnectionID: String?) -> Bool {
        guard let context else { return false }
        return !connectionID.isEmpty && context.id == contextID &&
            context.connectionID == connectionID && activeConnectionID == connectionID
    }
}

struct DeviceApprovalView: View {
    @ObservedObject var client: NativeAppModel
    let connectionID: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if let context = client.deviceApproval, context.connectionID == connectionID,
                   connectionID == client.activeConnectionID {
                    Section {
                        VStack(alignment: .leading, spacing: 14) {
                            Image(systemName: "hand.raised").font(.largeTitle).foregroundStyle(.secondary).accessibilityHidden(true)
                            Text("Open OpenClaw on your computer and approve the device whose ID matches this one.")
                                .font(.body)
                            if context.reason != .notPaired && context.reason != .unknown {
                                Text("Review this device’s requested access in OpenClaw before approving.")
                                    .foregroundStyle(.secondary)
                            }
                        }.padding(.vertical, 10)
                    }
                    Section {
                        Text(verbatim: context.deviceID).font(.body.monospaced())
                            .textSelection(.enabled).lineLimit(nil)
                            .accessibilityIdentifier("approval-device-id")
                        Button {
                            guard NativeDeviceApprovalPolicy.matches(client.deviceApproval, connectionID: connectionID,
                                contextID: context.id, activeConnectionID: client.activeConnectionID) else { return }
                            UIPasteboard.general.string = context.deviceID
                        }
                            label: { Label("Copy device ID", systemImage: "doc.on.doc") }
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("copy-device-id")
                    } header: { Text("Device ID") }
                    footer: { Text("This ID is the fingerprint of this app’s public key.") }
                    Section {
                        Button {
                            client.checkDeviceApproval(connectionID: connectionID, contextID: context.id)
                        } label: {
                            HStack {
                                if client.isCheckingDeviceApproval(connectionID: connectionID) { ProgressView() }
                                Text("Check again")
                            }.frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .disabled(client.isCheckingDeviceApproval(connectionID: connectionID))
                        .accessibilityIdentifier("check-device-approval")
                    } footer: { Text("After approving the device, check the connection again.") }
                } else if client.isCheckingDeviceApproval(connectionID: connectionID) {
                    ProgressView("Checking approval…").frame(maxWidth: .infinity, minHeight: 180)
                } else if client.activeConnectionID == connectionID && client.presentation.connection.phase == .ready {
                    Label("Connected", systemImage: "checkmark.circle")
                } else {
                    Text(client.notice ?? String(localized: "This request is no longer available."))
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Approve this device").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .onChange(of: client.presentation.connection.phase) { phase in
                if phase == .ready, client.activeConnectionID == connectionID { dismiss() }
            }
        }
    }
}
