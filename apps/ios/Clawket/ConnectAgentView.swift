import ClawketPairing
import SwiftUI

extension PairingBackend {
    var title: String {
        switch self {
        case .openclaw: "OpenClaw"
        case .hermes: "Hermes"
        case .codex: "Codex"
        case .claudeCode: "Claude Code"
        case .pi: "Pi"
        case .localModel: String(localized: "Local model")
        }
    }
}

struct ConnectAgentView: View {
    private enum Method: String, CaseIterable {
        case code, qr, direct
        var title: String {
            switch self {
            case .code: String(localized: "Pairing code")
            case .qr: String(localized: "QR or link")
            case .direct: String(localized: "Direct")
            }
        }
    }
    @EnvironmentObject private var client: NativeAppModel
    @Environment(\.dismiss) private var dismiss
    @State private var method = Method.code
    @State private var backend = PairingBackend.openclaw
    @State private var code = ""
    @State private var raw = ""
    @State private var address = ""
    @State private var label = ""
    @State private var token = ""
    @State private var password = ""
    @State private var scanner = false
    @State private var error: String?
    @State private var connecting = false
    @FocusState private var focusCode: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Connect with", selection: $method) {
                        ForEach(Method.allCases, id: \.self) { Text($0.title).tag($0) }
                    }.pickerStyle(.segmented).labelsHidden().disabled(client.pendingPairing != nil)
                }.listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                Section {
                    Picker("Agent", selection: $backend) {
                        ForEach(PairingBackend.allCases, id: \.self) { Text($0.title).tag($0) }
                    }
                    switch method {
                    case .code:
                        TextField("Pairing code", text: $code)
                            .textInputAutocapitalization(.characters).autocorrectionDisabled()
                            .font(.title2.monospaced()).focused($focusCode)
                            .accessibilityIdentifier("pairing-code")
                    case .qr:
                        Button { scanner = true } label: { Label("Scan QR code", systemImage: "qrcode.viewfinder") }
                            .accessibilityIdentifier("scan-pairing-qr")
                        TextField("Paste pairing QR text or link", text: $raw, axis: .vertical)
                            .lineLimit(3...6).textInputAutocapitalization(.never).autocorrectionDisabled()
                            .accessibilityIdentifier("pairing-payload")
                    case .direct:
                        TextField("Address", text: $address).keyboardType(.URL)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .accessibilityIdentifier("connection-address")
                        TextField("Name (optional)", text: $label).accessibilityIdentifier("connection-name")
                        SecureField("Token (if required)", text: $token).textInputAutocapitalization(.never).autocorrectionDisabled()
                            .accessibilityIdentifier("connection-token")
                        if backend == .openclaw {
                            SecureField("Password (if required)", text: $password).textInputAutocapitalization(.never).autocorrectionDisabled()
                        }
                    }
                } header: { Text(method == .direct ? String(localized: "Connection") : String(localized: "Pair your agent")) } footer: {
                    if method == .code {
                        Text("Enter the code shown by Clawket on your computer. Keep that window open while pairing.")
                    } else if method == .qr {
                        Text("Scan the QR code shown by Clawket on your computer, or paste its pairing link.")
                    } else {
                        Text("Use the WebSocket address provided by your agent. Credentials are saved securely on this device.")
                    }
                }
                .disabled(client.pendingPairing != nil)
                if let error {
                    Section { Label(error, systemImage: "exclamationmark.circle").foregroundStyle(.red).font(.subheadline) }
                }
                Section {
                    Button(action: connect) {
                        HStack { Spacer(); if connecting { ProgressView().padding(.trailing, 4) }; Text(connecting ? String(localized: "Connecting…") : client.pendingPairing != nil ? String(localized: "Save connection") : String(localized: "Connect")).bold(); Spacer() }
                            .frame(minHeight: 32)
                    }
                    .disabled(connecting || (!canConnect && client.pendingPairing == nil))
                    .accessibilityIdentifier("confirm-connect")
                }
            }
            .navigationTitle("Connect an agent").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(connecting)
                }
            }
            .disabled(connecting)
            .interactiveDismissDisabled(connecting)
            .sheet(isPresented: $scanner) {
                PairingScanner { value in raw = value; scanner = false }
            }
        }
    }

    private var canConnect: Bool {
        switch method {
        case .code: !code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .qr: !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .direct: !address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    private func connect() {
        error = nil; connecting = true; focusCode = false
        let request: AddConnectionRequest
        switch method {
        case .code: request = .code(code, backend: backend)
        case .qr: request = .payload(raw, fallbackBackend: backend)
        case .direct: request = .direct(address: address, backend: backend, label: label, token: token, password: password)
        }
        Task {
            do { try await client.addConnection(request); connecting = false; dismiss() }
            catch { self.error = NativeAppModel.pairingErrorText(error); connecting = false }
        }
    }
}
