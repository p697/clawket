import ClawketUI
import SwiftUI

struct NativeSavedHistoryView: View {
    let controller: NativeHistoryController
    @Environment(\.dismiss) private var dismiss
    @State private var entries: [NativeSavedMetadata] = []
    @State private var query = ""
    @State private var filter = NativeSavedFilter.all
    @State private var refresh = UUID()
    @State private var loading = true
    @State private var notice: String?
    @State private var share: NativeMediaShare?
    @State private var sharing = false
    @State private var visible = true
    var body: some View {
        NavigationStack {
            List {
                Picker("Saved conversations", selection: $filter) {
                    Text("All").tag(NativeSavedFilter.all)
                    Text("Pinned").tag(NativeSavedFilter.pinned)
                    Text("With files").tag(NativeSavedFilter.files)
                }.pickerStyle(.segmented).listRowSeparator(.hidden)
                if let notice { Text(notice).font(.footnote).foregroundStyle(.secondary) }
                if loading { ProgressView().frame(maxWidth: .infinity) }
                else if entries.isEmpty {
                    Text("No saved conversations").foregroundStyle(.secondary).padding(.vertical, 28)
                }
                ForEach(entries) { entry in
                    NavigationLink {
                        NativeSavedDetailView(controller: controller, id: entry.id) { refresh = UUID() }
                    } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            HStack {
                                Text(entry.title.isEmpty ? String(localized: "Conversation") : entry.title).lineLimit(2)
                                if entry.pinned { Image(systemName: "pin.fill").font(.caption).foregroundStyle(.secondary) }
                            }
                            Text(Date(timeIntervalSince1970: entry.savedAt / 1_000), style: .date)
                                .font(.caption).foregroundStyle(.secondary)
                        }.padding(.vertical, 3)
                    }
                }
            }
            .modifier(NativeSavedSearch(enabled: controller.access().search, text: $query))
            .navigationTitle("Saved conversations").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    if controller.access().bulkExport {
                        Button("Export all") { exportAll() }.disabled(sharing || entries.isEmpty || loading)
                    }
                }
            }
            .task(id: NativeSavedQuery(query: query, filter: filter, refresh: refresh)) { await load() }
            .sheet(item: $share) { NativeActivityView(share: $0) }
            .onAppear { visible = true }
            .onDisappear {
                visible = false
                let abandoned = share
                Task { await abandoned?.releaseIfUnpresented() }
            }
        }
    }
    private func load() async {
        loading = true
        do {
            let listing = try await controller.saved.list()
            let needle = controller.access().search ? query : ""
            let values = try await controller.saved.search(needle, filter: filter)
            try Task.checkCancellation()
            entries = values; notice = listing.recoveredFromRollback ? String(localized: "Saved conversations were recovered from the last verified copy.") : nil
        } catch { if !Task.isCancelled { notice = NativeHistoryController.failureText(error) } }
        if !Task.isCancelled { loading = false }
    }
    private func exportAll() {
        guard !sharing, visible, share == nil, controller.access().bulkExport else { return }
        sharing = true
        let ids = entries.map(\.id)
        Task {
            defer { sharing = false }
            do {
                let prepared = try await controller.shareAll(ids)
                guard visible else { await prepared.releaseIfUnpresented(); return }
                share = prepared
            } catch { if visible { notice = NativeHistoryController.failureText(error) } }
        }
    }
}

private struct NativeSavedQuery: Hashable { let query: String; let filter: NativeSavedFilter; let refresh: UUID }
private struct NativeSavedSearch: ViewModifier {
    let enabled: Bool
    @Binding var text: String
    @ViewBuilder func body(content: Content) -> some View {
        if enabled { content.searchable(text: $text, prompt: "Search saved conversations") }
        else { content }
    }
}

private struct NativeSavedDetailView: View {
    let controller: NativeHistoryController
    let id: String
    let onChange: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var value: NativeSavedConversation?
    @State private var notice: String?
    @State private var rename = false
    @State private var name = ""
    @State private var delete = false
    @State private var busy = false
    @State private var visible = true
    @State private var share: NativeMediaShare?
    var body: some View {
        Group {
            if let value {
                NativeReadOnlyTranscript(transcript: value.transcript, caption: String(localized: "Read-only copy on this device."))
            } else if let notice { Text(notice).foregroundStyle(.secondary).padding() }
            else { ProgressView() }
        }
        .navigationTitle(value?.title ?? String(localized: "Saved conversations")).navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if let value {
                    Menu {
                        Button("Rename") { name = value.title; rename = true }
                        Button(value.pinned == true ? String(localized: "Unpin") : String(localized: "Pin")) {
                            mutate { _ = try await controller.saved.setPinned(id, pinned: value.pinned != true) }
                        }
                        Button { export(.markdown) } label: { Text(verbatim: "Markdown") }
                        Button { export(.json) } label: { Text(verbatim: "JSON") }
                        Button("Delete", role: .destructive) { delete = true }
                    } label: { Image(systemName: "ellipsis.circle").frame(minWidth: 44, minHeight: 44) }
                        .accessibilityLabel("Archive actions").disabled(busy)
                }
            }
        }
        .task(id: id) { await reload() }
        .alert("Rename", isPresented: $rename) {
            TextField("Name", text: $name)
            Button("Cancel", role: .cancel) {}
            Button("Save") { let captured = name; mutate { _ = try await controller.saved.rename(id, name: captured) } }
                .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || name.utf16.count > 200)
        }
        .confirmationDialog("Delete this saved copy?", isPresented: $delete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { mutate(removing: true) { try await controller.saved.remove(id) } }
            Button("Cancel", role: .cancel) {}
        }
        .alert("Clawket", isPresented: Binding(get: { value != nil && notice != nil }, set: { if !$0 { notice = nil } })) {
            Button("OK", role: .cancel) { notice = nil }
        } message: { Text(notice ?? "") }
        .sheet(item: $share) { NativeActivityView(share: $0) }
        .onAppear { visible = true }
        .onDisappear { visible = false; let abandoned = share; Task { await abandoned?.releaseIfUnpresented() } }
    }
    private func reload() async {
        do { let entry = try await controller.saved.conversation(id); try Task.checkCancellation(); value = entry }
        catch { if !Task.isCancelled { notice = NativeHistoryController.failureText(error) } }
    }
    private func mutate(removing: Bool = false, operation: @escaping @MainActor () async throws -> Void) {
        guard !busy, visible else { return }; busy = true
        Task {
            defer { busy = false }
            do {
                try await operation(); onChange()
                guard visible else { return }
                if removing { dismiss() } else { await reload() }
            } catch { if visible { notice = NativeHistoryController.failureText(error) } }
        }
    }
    private func export(_ format: NativeHistoryExportFormat) {
        guard !busy, visible, share == nil, let value else { return }; busy = true
        let transcript = NativePublicTranscript(title: value.title, messages: value.transcript.messages)
        Task {
            defer { busy = false }
            do {
                let prepared = try await controller.share(transcript, format: format)
                guard visible else { await prepared.releaseIfUnpresented(); return }
                share = prepared
            } catch { if visible { notice = NativeHistoryController.failureText(error) } }
        }
    }
}

struct NativeReadOnlyTranscript: View {
    let transcript: NativePublicTranscript
    let caption: String
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 24) {
                Text(caption).font(.footnote).foregroundStyle(.secondary)
                ForEach(Array(transcript.messages.enumerated()), id: \.offset) { _, message in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(message.role == .user ? String(localized: "User") : String(localized: "Assistant")).font(.caption.weight(.semibold))
                            if let ms = message.timestampMs, ms <= 253_402_300_799_999 {
                                Text(Date(timeIntervalSince1970: ms / 1_000), style: .date).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        if !message.text.isEmpty { NativeReadOnlyMessageText(message.text) }
                        ForEach(Array(message.attachments.enumerated()), id: \.offset) { _, name in
                            Label(name, systemImage: "paperclip").font(.footnote).foregroundStyle(.secondary).textSelection(.enabled)
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            }.padding(20)
        }
    }
}
