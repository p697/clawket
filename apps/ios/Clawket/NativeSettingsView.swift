import ClawketUI
import SwiftUI

struct NativeSettingsView: View {
    @ObservedObject var client: NativeAppModel
    @ObservedObject var preferences: NativePreferences
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                Section {
                    NavigationLink { ConnectionsView(client: client, embedded: true) } label: {
                        Label("Connections", systemImage: "link")
                    }
                }
                Section("Appearance") {
                    Picker("Theme", selection: themeBinding) {
                        ForEach(ClientAppearancePresentation.Theme.allCases, id: \.self) { theme in
                            Text(theme.title).tag(theme)
                        }
                    }
                    .disabled(!preferences.canSave || preferences.isSaving)
                    NavigationLink { NativeChatAppearanceView(preferences: preferences, model: client.presentation) } label: {
                        Label("Chat appearance", systemImage: "textformat.size")
                    }
                }
                Section {
                    Button {
                        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                    } label: { Label("System settings", systemImage: "gearshape") }
                }
                Section {
                    LabeledContent("Version") {
                        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—"
                        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—"
                        Text(verbatim: "\(version) (\(build))").foregroundStyle(.secondary)
                    }
                    Text("This development app has its own connections and storage.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if let error = preferences.error {
                    Section { Text(error).font(.footnote).foregroundStyle(.secondary) }
                }
            }
            .navigationTitle("Settings").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .tint(preferences.appearance.accentColor)
        .preferredColorScheme(preferences.appearance.colorScheme)
    }
    private var themeBinding: Binding<ClientAppearancePresentation.Theme> {
        Binding(get: { preferences.appearance.theme }, set: { theme in
            var value = preferences.appearance; value.theme = theme
            Task { _ = await preferences.save(value) }
        })
    }
}

private struct NativeChatAppearanceView: View {
    @ObservedObject var preferences: NativePreferences
    @ObservedObject var model: ClientPresentation
    @Environment(\.dismiss) private var dismiss
    @ScaledMetric(relativeTo: .body) private var bodySize: Double = 17
    @State private var draft: ClientAppearancePresentation
    init(preferences: NativePreferences, model: ClientPresentation) {
        self.preferences = preferences; self.model = model
        _draft = State(initialValue: preferences.appearance)
    }
    var body: some View {
        Form {
            Section("Preview") {
                VStack(alignment: .leading, spacing: 12) {
                    if draft.showAgentAvatar {
                        HStack(spacing: 7) {
                            Image(systemName: "person.crop.circle.fill").foregroundStyle(draft.accentColor)
                            Text(agentName).font(.caption.weight(.semibold))
                        }
                    }
                    Text("Your agents, within reach")
                        .font(.system(size: CGFloat(bodySize * Double(draft.chatFontSize) / 17)))
                        .fixedSize(horizontal: false, vertical: true)
                    HStack { Spacer(); Image(systemName: "arrow.up.circle.fill").font(.title).foregroundStyle(draft.accentColor) }
                        .accessibilityHidden(true)
                }.padding(.vertical, 8).accessibilityElement(children: .combine)
            }
            Section("Accent color") {
                ForEach(ClientAppearancePresentation.Accent.allCases, id: \.self) { accent in
                    Button { draft.accent = accent } label: {
                        HStack(spacing: 12) {
                            Circle().fill(Color(uiColor: accent.uiColor)).frame(width: 22, height: 22).accessibilityHidden(true)
                            Text(accent.title).foregroundStyle(.primary)
                            Spacer()
                            if draft.accent == accent { Image(systemName: "checkmark").fontWeight(.semibold) }
                        }.frame(minHeight: 32)
                    }
                    .accessibilityAddTraits(draft.accent == accent ? .isSelected : [])
                }
            }
            Section {
                Stepper(value: $draft.chatFontSize, in: 12...20) {
                    LabeledContent("Chat font size") { Text(draft.chatFontSize, format: .number).monospacedDigit() }
                }
                Toggle("Show agent avatar", isOn: $draft.showAgentAvatar)
            }
            Section {
                Button("Reset appearance") {
                    let theme = draft.theme; draft = .init(theme: theme)
                }
                .disabled(draft == ClientAppearancePresentation(theme: draft.theme))
            }
            if let error = preferences.error { Section { Text(error).font(.footnote).foregroundStyle(.secondary) } }
        }
        .disabled(preferences.isSaving || !preferences.canSave)
        .tint(draft.accentColor)
        .navigationTitle("Chat appearance").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button {
                    Task { if await preferences.save(draft) { dismiss() } }
                } label: {
                    if preferences.isSaving { ProgressView().accessibilityLabel("Saving…") }
                    else { Text("Save") }
                }
                .disabled(!preferences.canSave || preferences.isSaving || draft == preferences.appearance)
            }
        }
    }
    private var agentName: String {
        guard let route = model.selectedConversation else { return "Clawket" }
        return model.agents.first { agent in
            switch agent.entryMode {
            case let .conversation(id): id.connectionID == route.connectionID && id.agentID == route.agentID
            case let .catalog(id): id.connectionID == route.connectionID && id.agentID == route.agentID
            }
        }?.name ?? "Clawket"
    }
}

private extension ClientAppearancePresentation.Theme {
    var title: String {
        switch self {
        case .system: String(localized: "System")
        case .light: String(localized: "Light")
        case .dark: String(localized: "Dark")
        }
    }
}
private extension ClientAppearancePresentation.Accent {
    var title: String {
        switch self {
        case .iceBlue: String(localized: "Ice blue")
        case .jadeGreen: String(localized: "Jade green")
        case .oceanTeal: String(localized: "Ocean teal")
        case .sunsetOrange: String(localized: "Sunset orange")
        case .rosePink: String(localized: "Rose pink")
        case .royalPurple: String(localized: "Royal purple")
        }
    }
}
