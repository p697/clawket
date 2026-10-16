import SwiftUI

struct NativeConversationExportView: View {
    let controller: NativeHistoryController
    let request: NativeHistoryExportRequest
    @Environment(\.dismiss) private var dismiss
    @State private var transcript: NativePublicTranscript?
    @State private var loading = true
    private var saving: Bool { operationState.isBusy }
    @State private var saved = false
    @State private var notice: String?
    @State private var share: NativeMediaShare?
    @State private var visible = true
    @State private var operationState = NativeHistoryOperation()
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(request.title.isEmpty ? String(localized: "Conversation") : request.title).font(.headline)
                    Text("Text and attachment names").font(.footnote).foregroundStyle(.secondary)
                }
                if loading { ProgressView().frame(maxWidth: .infinity) }
                if transcript != nil {
                    Section {
                        Button(saved ? String(localized: "Saved on this device") : String(localized: "Save conversation")) { save() }
                            .disabled(saving || saved)
                        Button { export(.markdown) } label: { Text(verbatim: "Markdown") }.disabled(saving)
                        Button { export(.json) } label: { Text(verbatim: "JSON") }.disabled(saving)
                    }
                }
                if let notice { Text(notice).font(.footnote).foregroundStyle(.secondary) }
            }
            .navigationTitle("Export conversation").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
            .task(id: request.id) {
                transcript = nil; saved = false; loading = true
                do {
                    let value = try await controller.load(request)
                    try Task.checkCancellation(); transcript = value
                } catch { if !Task.isCancelled { notice = NativeHistoryController.failureText(error) } }
                if !Task.isCancelled { loading = false }
            }
            .sheet(item: $share) { NativeActivityView(share: $0) }
            .onAppear { visible = true }
            .onDisappear {
                visible = false; operationState.retire()
                let abandoned = share; Task { await abandoned?.releaseIfUnpresented() }
            }
        }
    }
    private func save() {
        guard visible, !saving, !saved, let transcript else { return }
        guard let operation = operationState.begin() else { return }
        Task {
            defer { operationState.finish(operation) }
            do {
                _ = try await controller.save(transcript, request: request)
                if visible && operationState.owns(operation) { saved = true; notice = nil }
            } catch { if visible && operationState.owns(operation) { notice = NativeHistoryController.failureText(error) } }
        }
    }
    private func export(_ format: NativeHistoryExportFormat) {
        guard visible, !saving, share == nil, let transcript else { return }
        guard let operation = operationState.begin() else { return }
        Task {
            defer { operationState.finish(operation) }
            do {
                let prepared = try await controller.share(transcript, request: request, format: format)
                guard visible, operationState.owns(operation) else { await prepared.releaseIfUnpresented(); return }
                share = prepared
            } catch { if visible && operationState.owns(operation) { notice = NativeHistoryController.failureText(error) } }
        }
    }
}
