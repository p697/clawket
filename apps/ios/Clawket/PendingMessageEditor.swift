import ClawketUI
import SwiftUI

struct PendingMessageEditor: View {
    @ObservedObject var client: NativeAppModel
    let route: ConversationID
    let edit: NativePendingEdit
    let activation: UUID
    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @State private var selectedMedia: [NativeMediaReference]
    @State private var saving = false
    @State private var error: String?

    init(client: NativeAppModel, route: ConversationID, edit: NativePendingEdit, activation: UUID) {
        self.client = client; self.route = route; self.edit = edit; self.activation = activation
        _text = State(initialValue: edit.originalText)
        _selectedMedia = State(initialValue: edit.originalMedia)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextEditor(text: $text)
                        .frame(minHeight: 220)
                        .accessibilityLabel("Message")
                        .accessibilityIdentifier("pending-message-editor")
                } footer: {
                    Text("Editing pauses this message. Your current draft stays separate.")
                }
                if !selectedMedia.isEmpty {
                    Section {
                        ForEach(selectedMedia) { reference in
                            HStack {
                                Label(reference.name, systemImage: reference.kind == .image ? "photo" : "doc")
                                Spacer()
                                Button(role: .destructive) { selectedMedia.removeAll { $0.id == reference.id } } label: {
                                    Image(systemName: "xmark.circle.fill").frame(minWidth: 44, minHeight: 44)
                                }.accessibilityLabel(Text("Remove \(reference.name)"))
                            }
                        }
                    }
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("Edit message").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save changes") {
                        saving = true; error = nil
                        Task {
                            do { try await client.savePendingEdit(edit, route: route, activation: activation, text: text, media: selectedMedia) }
                            catch { self.error = String(localized: "This message could not be saved. Close the editor and try again.") }
                            saving = false
                        }
                    }
                    .bold().disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && selectedMedia.isEmpty)
                    .keyboardShortcut(.defaultAction)
                    .accessibilityIdentifier("save-pending-message")
                }
            }
            .disabled(saving)
            .interactiveDismissDisabled(saving)
        }
    }
}
