import ClawketSpeech
import SwiftUI
import UIKit

@MainActor
struct NativeVoiceSheet: View {
    @ObservedObject var client: NativeAppModel
    @ObservedObject var voice: NativeVoiceController
    let request: NativeVoiceSheetRequest
    @State private var deleting: SpeechRecording?
    @State private var ownedAttempt: UUID?

    var body: some View {
        NavigationStack {
            List {
                if let failure = voice.failure {
                    Section {
                        Label(NativeAppModel.voiceFailureText(failure), systemImage: "exclamationmark.circle")
                            .foregroundStyle(.secondary)
                        if failure.code == .permission {
                            Button("Open Settings") {
                                guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                                UIApplication.shared.open(url)
                            }
                        }
                    }
                }
                if voice.attempt?.recovery == true {
                    Section { HStack { ProgressView(); Text("Transcribing…") } }
                }
                if let result = client.voiceReview, result.recording.scope == (try? request.context.scope) {
                    NativeVoiceTranscriptEditor(client: client, request: request, result: result).id(result.id)
                }
                if !voice.saved(for: request.context).isEmpty { Section {
                    ForEach(voice.saved(for: request.context)) { recording in
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Image(systemName: "waveform").foregroundStyle(.secondary)
                                Text(recording.createdAt, format: .dateTime.month().day().hour().minute())
                                Spacer()
                                Text(NativeAppModel.voiceDuration(recording.seconds)).monospacedDigit().foregroundStyle(.secondary)
                            }
                            HStack(spacing: 24) {
                                Button {
                                    if let id = client.retryVoice(recording, sheet: request) { ownedAttempt = id }
                                } label: {
                                    Text("Retry").frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                                }
                                .accessibilityIdentifier("voice-recording-retry")
                                .disabled(voice.attempt != nil || recording.bytes == 0 ||
                                    (voice.configuration == nil && !recording.hasCompletedTranscription))
                                Button(role: .destructive) { deleting = recording } label: {
                                    Text("Delete").frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                                }
                                .accessibilityIdentifier("voice-recording-delete")
                                .disabled(voice.attempt?.recordingID == recording.id)
                            }.buttonStyle(.borderless)
                        }.padding(.vertical, 5)
                    }
                } header: { Text("Saved recordings") } footer: {
                    Text("Your audio is saved on this device. Retry transcription or delete it.")
                } }
                if voice.configuration == nil { Section { Text("Voice transcription is unavailable in this build.").foregroundStyle(.secondary) } }
            }
            .navigationTitle("Voice input").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { if client.voiceSheet?.id == request.id { client.voiceSheet = nil } }
                }
            }
            .confirmationDialog("Delete recording?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    guard let recording = deleting else { return }; deleting = nil
                    Task { await client.deleteVoice(recording, sheet: request) }
                }
                Button("Cancel", role: .cancel) { deleting = nil }
            }
        }
        .presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
        .onAppear {
            guard client.voiceSheet?.id == request.id, let id = request.attemptID,
                  let attempt = voice.attempt, attempt.id == id, attempt.recovery,
                  attempt.context.route == request.context.route,
                  attempt.context.activation == request.context.activation,
                  attempt.context.selection == request.context.selection else { return }
            ownedAttempt = id
        }
        .onDisappear { if let ownedAttempt { voice.cancelAttempt(ownedAttempt) } }
    }
}

@MainActor
private struct NativeVoiceTranscriptEditor: View {
    @ObservedObject var client: NativeAppModel
    let request: NativeVoiceSheetRequest
    let result: NativeVoiceResult
    @State private var text: String
    init(client: NativeAppModel, request: NativeVoiceSheetRequest, result: NativeVoiceResult) {
        self.client = client; self.request = request; self.result = result
        let emptyDraft = client.presentation.draft(for: request.context.route).text.isEmpty
        _text = State(initialValue: result.isRecovery && emptyDraft ?
            NativeVoicePolicy.combined(result.recording.draft, transcript: result.text) : result.text)
    }
    var body: some View {
        Section {
            TextEditor(text: $text).frame(minHeight: 140).accessibilityLabel("Review transcription")
            if !result.isRecovery { Text("Your draft changed. Insert the transcript where you want it.").font(.caption).foregroundStyle(.secondary) }
            Button("Use text") { client.useVoiceText(result, text: text, sheet: request) }
                .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || text.utf16.count > 100_000)
                .accessibilityIdentifier("voice-use-text")
        } header: { Text("Review transcription") } footer: { Text("Your recording stays on this device until the text is saved.") }
    }
}
