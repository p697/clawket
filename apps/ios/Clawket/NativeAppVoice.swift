import ClawketPersistence
import ClawketSpeech
import ClawketUI
import Foundation
import SwiftUI

@MainActor
extension NativeAppModel {
    func setupVoice(vault: NativeVault) async {
        do {
            let controller = try NativeVoiceController(serviceURL: Bundle.main.object(forInfoDictionaryKey: "ClawketSpeechURL") as? String ?? "") {
                let identity = try await vault.identity()
                return .init(publicKey: identity.publicKey, tweetNaClSecretKey: identity.secretKey)
            }
            controller.onChange = { [weak self, weak controller] in
                guard let self, let controller, let route = presentation.selectedConversation else { return }
                updateVoicePresentation(route); updatePresentation(route)
                if controller.failure == nil { voiceShownFailure = nil }
                else if let failure = controller.failure, voiceShownFailure != failure, controller.attempt == nil,
                        destination == nil, mediaPicker == nil, mediaPreview == nil, let context = voiceContext(route) {
                    voiceShownFailure = failure; voiceSheet = .init(context: context)
                }
            }
            controller.onResult = { [weak self] in self?.voiceCompleted($0) }
            voice = controller; await controller.restore()
        } catch { notice = String(localized: "Cannot save more audio. Free up device storage or remove a saved recording.") }
    }

    func voiceContext(_ route: ConversationID) -> NativeVoiceContext? {
        guard route.isConcrete, route.connectionID == activeConnectionID, presentation.selectedConversation == route,
              let document = documents[route] else { return nil }
        let draft = presentation.draft(for: route)
        return .init(route: route, activation: activationRevision, selection: selectionRevision,
                     draftRevision: draft.editRevision, text: draft.text, attachments: document.draftResourceIDs)
    }
    func voiceIntent(_ route: ConversationID, action: VoiceIntent) {
        guard let voice, let context = voiceContext(route) else { return }
        switch action {
        case .start:
            voiceHandoffTask?.cancel()
            guard presentation.conversations[route]?.availability(.voice).isEnabled == true else { return }
            voice.start(context)
        case .stop: voice.stop(context, explicitlySend: false)
        case .finishAndSend: voice.stop(context, explicitlySend: !hasUncertainVoiceSend(route))
        case .cancel: retireVoice()
        case .retry:
            voiceHandoffTask?.cancel()
            guard let recording = voice.saved(for: context).first else { return }
            voiceReview = nil
            let attempt = voice.retry(recording, context: context)
            voiceSheet = .init(context: context, attemptID: attempt)
        case .showRecordings:
            guard destination == nil, mediaPicker == nil, mediaPreview == nil else { return }
            voiceReview = nil; voiceSheet = .init(context: context)
        }
    }
    func voiceSceneChanged(_ phase: ScenePhase) {
        if phase == .background { retireVoice() }
        else if phase == .active { Task { await voice?.restore() } }
    }
    func retireVoice() {
        voice?.retire(); voiceHandoffTask?.cancel(); voiceHandoffTask = nil
        voiceInsertion = nil; voiceReview = nil; voiceSheet = nil
        for draft in presentation.drafts.values {
            draft.voice = nil
            if draft.insertion?.acknowledgement == true { draft.insertion = nil }
        }
    }
    func addVoiceFeatures(_ route: ConversationID, editable: Bool, features: inout [ClientFeature: ActionAvailability]) {
        guard let voice else { return }
        if voice.configuration != nil, state.capabilities.chat, editable {
            features[.voice] = .available
            if let attempt = voice.attempt {
                if attempt.context.route != route || attempt.phase != .recording {
                    features[.voice] = .temporarilyUnavailable(String(localized: "The previous voice session is still closing. Please retry shortly."))
                }
                if attempt.context.route == route {
                    features[.send] = .temporarilyUnavailable(String(localized: "Stop recording before sending."))
                }
            }
        }
        updateVoicePresentation(route)
    }
    func updateVoicePresentation(_ route: ConversationID) {
        guard let voice, let context = voiceContext(route) else { return }
        let draft = presentation.draft(for: route)
        if let active = voice.attempt, active.context.route == route {
            let recording = active.phase == .recording, preparing = active.phase == .preparing
            let detail = preparing ? nil : active.failure == nil ? Self.voiceDuration(active.seconds) : String(localized: "Recording saved locally · Transcription paused")
            draft.voice = .init(phase: recording ? .recording : .transcribing,
                label: preparing ? String(localized: "Voice input") : recording ? String(localized: "Listening…") : String(localized: "Transcribing…"),
                detail: detail, canStop: recording || preparing, canCancel: true)
        } else if !voice.saved(for: context).isEmpty {
            draft.voice = .init(phase: .recoverable, label: String(localized: "Saved recording"),
                detail: voice.failure.map(Self.voiceFailureText), canReview: true)
        } else { draft.voice = nil }
    }
    func voiceCompleted(_ result: NativeVoiceResult) {
        guard let context = voiceContext(result.context.route),
              context.activation == result.context.activation, context.selection == result.context.selection else { return }
        if !result.isRecovery, NativeVoicePolicy.matches(result.context, current: context) {
            let text = NativeVoicePolicy.combined(result.context.text, transcript: result.text)
            requestVoiceInsertion(result, text: text, context: context, replacingText: true,
                send: NativeVoicePolicy.canFinishAndSend(result, current: context, uncertain: hasUncertainVoiceSend(context.route)))
        } else {
            voiceReview = result
            if destination == nil, mediaPicker == nil, mediaPreview == nil { voiceSheet = .init(context: context) }
        }
    }
    func useVoiceText(_ result: NativeVoiceResult, text: String, sheet: NativeVoiceSheetRequest) {
        guard voiceSheet?.id == sheet.id, let current = voiceContext(sheet.context.route),
              current.activation == sheet.context.activation, current.selection == sheet.context.selection,
              result.recording.scope == (try? current.scope) else { return }
        // Recovery is always an explicit insertion into the current native caret.
        requestVoiceInsertion(result, text: text, context: current, replacingText: false, send: false)
    }
    private func requestVoiceInsertion(_ result: NativeVoiceResult, text: String, context: NativeVoiceContext,
                                       replacingText: Bool, send: Bool) {
        guard text.utf16.count <= 100_000, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            notice = String(localized: "Cannot save more audio. Free up device storage or remove a saved recording."); return
        }
        let id = presentation.draft(for: context.route).insertText(text, acknowledgement: true,
            expectedRevision: context.draftRevision, replacingText: replacingText)
        voiceInsertion = .init(id: id, result: result, context: context, sendAfterCommit: send)
        // A sheet covers the native input. Dismiss before the existing input
        // consumes its one-shot command; the captured revision still fences it.
        voiceSheet = nil
    }
    func voiceInsertionApplied(_ route: ConversationID, id: UUID, text: String?) {
        guard let pending = voiceInsertion, pending.id == id, pending.context.route == route,
              let current = voiceContext(route), current.activation == pending.context.activation,
              current.selection == pending.context.selection else { return }
        voiceInsertion = nil
        guard let text, current.text == text, text.utf16.count <= 100_000 else {
            voiceReview = pending.result; voiceSheet = .init(context: current); return
        }
        documents[route]?.draft = text; changed(route); updatePresentation(route)
        let revision = documents[route]?.revision ?? 0
        voiceHandoffTask?.cancel()
        voiceHandoffTask = Task { [weak self] in
            guard let self, let cache, let voice else { return }
            do {
                try await persist(route); try Task.checkCancellation()
                guard NativeVoicePolicy.matches(current, current: voiceContext(route)) else { return }
                guard try await cache.verifiedVoiceDraft(text, minimumRevision: revision,
                    connectionID: route.connectionID, agentID: route.agentID, sessionID: route.sessionID) else { throw StoreFailure.verificationFailed }
                try Task.checkCancellation()
                guard NativeVoicePolicy.matches(current, current: voiceContext(route)) else { return }
                try await voice.discard(pending.result.recording)
                try Task.checkCancellation()
                guard NativeVoicePolicy.matches(current, current: voiceContext(route)), !hasUncertainVoiceSend(route) else { return }
                if pending.sendAfterCommit { handle(.send(route)) }
            } catch {
                guard !Task.isCancelled, NativeVoicePolicy.matches(current, current: voiceContext(route)) else { return }
                presentation.draft(for: route).hint = String(localized: "This draft could not be saved. Keep Clawket open and try again.")
            }
        }
    }
    func retryVoice(_ recording: SpeechRecording, sheet: NativeVoiceSheetRequest) -> UUID? {
        guard voiceSheet?.id == sheet.id, let current = voiceContext(sheet.context.route),
              current.activation == sheet.context.activation, current.selection == sheet.context.selection else { return nil }
        voiceHandoffTask?.cancel(); voiceReview = nil
        return voice?.retry(recording, context: current)
    }
    func deleteVoice(_ recording: SpeechRecording, sheet: NativeVoiceSheetRequest) async {
        guard voiceSheet?.id == sheet.id, let current = voiceContext(sheet.context.route),
              current.activation == sheet.context.activation, current.selection == sheet.context.selection,
              recording.scope == (try? current.scope) else { return }
        do {
            try await voice?.discard(recording)
            guard voiceSheet?.id == sheet.id else { return }
            if voiceReview?.recording.id == recording.id { voiceReview = nil }
        } catch { if voiceSheet?.id == sheet.id { notice = Self.voiceFailureText(.init(.storage)) } }
    }
    private func hasUncertainVoiceSend(_ route: ConversationID) -> Bool {
        documents[route]?.messages.contains { $0.local && [.sending, .uncertain].contains($0.delivery) } == true
    }
    static func voiceDuration(_ seconds: Double) -> String {
        let value = Int(max(0, min(600, seconds)))
        return String(format: "%d:%02d", value / 60, value % 60)
    }
    static func voiceFailureText(_ error: SpeechFailure) -> String {
        switch error.code {
        case .permission: String(localized: "Microphone access is required to transcribe speech.")
        case .authentication: String(localized: "Voice authentication failed. Check your device date and time.")
        case .storage, .storageFull: String(localized: "Cannot save more audio. Free up device storage or remove a saved recording.")
        case .captureFailed: String(localized: "The microphone stopped. Your recorded audio is saved.")
        case .tooLong, .audioLimit, .deviceLimit, .ipLimit, .dailyLimit: String(localized: "The transcription limit has been reached. Your recording is saved.")
        case .noSpeech: String(localized: "No speech detected. Please try again.")
        case .busy: String(localized: "The previous voice session is still closing. Please retry shortly.")
        case .disconnected, .connectTimeout, .audioTimeout, .finishTimeout, .timeout: String(localized: "The connection was interrupted. Your recording is saved on this device.")
        default: String(localized: "The transcription service is unavailable. Your recording is saved on this device.")
        }
    }
}
