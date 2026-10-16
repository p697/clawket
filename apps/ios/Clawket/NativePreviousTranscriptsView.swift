import ClawketUI
import SwiftUI

struct NativePreviousTranscriptsView: View {
    let controller: NativeHistoryController
    let scope: NativeHistoryScope
    @Environment(\.dismiss) private var dismiss
    @State private var entries: [NativePhysicalArchive] = []
    @State private var loading = true
    @State private var notice: String?
    var body: some View {
        NavigationStack {
            List {
                Section {
                    if loading { ProgressView().frame(maxWidth: .infinity) }
                    else if entries.isEmpty && notice == nil { Text("No previous transcripts").foregroundStyle(.secondary) }
                    ForEach(entries) { entry in
                        NavigationLink {
                            NativePhysicalTranscriptView(controller: controller, id: entry.id, expectedScope: scope).id(entry.id)
                        } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                if let date = historyDate(Double(entry.savedAt)) { Text(date, style: .date) }
                                else { Text("Saved on this device") }
                                Text(ByteCountFormatter.string(fromByteCount: Int64(entry.byteCount), countStyle: .file))
                                    .font(.caption).foregroundStyle(.secondary)
                            }.padding(.vertical, 3)
                        }
                    }
                } footer: { Text("Read-only copy on this device.") }
                if let notice { Text(notice).foregroundStyle(.secondary) }
            }
            .navigationTitle("Previous transcripts").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
            .task(id: scope) {
                do {
                    let values = try await controller.conversations.physicalArchives(scope: scope)
                    try Task.checkCancellation(); entries = values
                } catch { if !Task.isCancelled { notice = NativeHistoryController.failureText(error) } }
                if !Task.isCancelled { loading = false }
            }
        }
    }
}

private struct NativePhysicalTranscriptView: View {
    let controller: NativeHistoryController
    let id: UUID
    let expectedScope: NativeHistoryScope
    @State private var value: NativeConversation?
    @State private var notice: String?
    private var busy: Bool { operationState.isBusy }
    @State private var visible = true
    @State private var share: NativeMediaShare?
    @State private var operationState = NativeHistoryOperation()
    @State private var preview: NativeMediaPreview?
    @State private var previewRequest: UUID?
    @State private var loadTask: Task<Void, Never>?
    var body: some View {
        Group {
            if let value {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 24) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("This copy includes only history loaded on this device.")
                            Text("Previous transcripts use cached attachments only.")
                        }.font(.footnote).foregroundStyle(.secondary)
                        ForEach(value.messages) { message in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(role(message)).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                                if !message.text.isEmpty { NativeReadOnlyMessageText(message.text) }
                                ForEach(message.media) { reference in
                                    Button { open(reference) } label: {
                                        Label(reference.name, systemImage: reference.kind == .image ? "photo" : "doc")
                                            .frame(minHeight: 44, alignment: .leading)
                                    }.disabled(previewRequest != nil)
                                }
                            }.frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }.padding(20)
                }
            } else if let notice { Text(notice).foregroundStyle(.secondary).padding() }
            else { ProgressView() }
        }
        .navigationTitle("Previous transcripts").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if value != nil {
                    Menu {
                        Button { export(.markdown) } label: { Text(verbatim: "Markdown") }
                        Button { export(.json) } label: { Text(verbatim: "JSON") }
                    } label: { Label("Export conversation", systemImage: "square.and.arrow.up") }.disabled(busy)
                }
            }
        }
        .task(id: id) {
            do {
                let (metadata, conversation) = try await controller.conversations.physicalArchive(id)
                guard metadata.scope == expectedScope else { throw NativeHistoryFailure.changed }
                try Task.checkCancellation(); value = conversation
            } catch { if !Task.isCancelled { notice = NativeHistoryController.failureText(error) } }
        }
        .sheet(item: $share) { NativeActivityView(share: $0) }
        .fullScreenCover(item: $preview) { NativeMediaViewer(preview: $0) }
        .alert("Clawket", isPresented: Binding(get: { value != nil && notice != nil }, set: { if !$0 { notice = nil } })) {
            Button("OK", role: .cancel) { notice = nil }
        } message: { Text(notice ?? "") }
        .onAppear { visible = true }
        .onDisappear {
            visible = false; operationState.retire(); previewRequest = nil; loadTask?.cancel(); loadTask = nil
            let abandoned = share
            Task { await abandoned?.releaseIfUnpresented() }
        }
    }
    private func role(_ message: NativeMessage) -> String {
        switch message.role {
        case .user: String(localized: "User")
        case .assistant: String(localized: "Assistant")
        case .system: String(localized: "System")
        case .tool: String(localized: "Tool")
        }
    }
    private func open(_ reference: NativeMediaReference) {
        guard visible, previewRequest == nil else { return }
        let epoch = value?.messages.first { $0.media.contains(where: { $0.id == reference.id }) }?.historyEpoch
        let request = UUID(); previewRequest = request
        loadTask = Task {
            defer { if previewRequest == request { previewRequest = nil; loadTask = nil } }
            do {
                let prepared = try await controller.cachedPreview(reference, scope: expectedScope, historyEpoch: epoch)
                guard visible, previewRequest == request, !Task.isCancelled else { await prepared.release(); return }
                preview = prepared
            } catch { if visible && previewRequest == request { notice = String(localized: "Attachment could not be loaded. Try again.") } }
        }
    }
    private func export(_ format: NativeHistoryExportFormat) {
        guard visible, !busy, share == nil, let value else { return }
        guard let operation = operationState.begin() else { return }
        Task {
            defer { operationState.finish(operation) }
            do {
                let prepared = try await controller.sharePhysical(value, title: String(localized: "Previous transcripts"), format: format)
                guard visible, operationState.owns(operation) else { await prepared.releaseIfUnpresented(); return }
                share = prepared
            } catch { if visible && operationState.owns(operation) { notice = NativeHistoryController.failureText(error) } }
        }
    }
}
