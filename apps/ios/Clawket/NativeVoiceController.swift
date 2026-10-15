import ClawketSpeech
import ClawketTransport
import ClawketUI
import Foundation
import SwiftUI

/// On-device capture/ASR state. This object cannot send a chat or write a draft.
@MainActor
final class NativeVoiceController: ObservableObject {
    enum Phase { case preparing, recording, transcribing, failed }
    struct Attempt {
        let id: UUID
        let context: NativeVoiceContext
        let recovery: Bool
        var recordingID: String?
        var phase: Phase
        var send = false
        var failure: SpeechFailure?
        var seconds = 0.0
        var level = 0.0
        var transcriptPreview = ""
    }
    let store: SpeechRecordingStore
    let configuration: SpeechServiceConfiguration?
    private let identity: @Sendable () async throws -> SpeechSigningIdentity
    private let driver: any SpeechAudioDriver
    private let socketFactory: any SpeechSocketFactory
    private let clock: any TransportClock
    private lazy var recorder = SpeechRecorder(store: store, driver: driver, clock: clock) { [weak self] update in
        await self?.receive(update)
    }
    private var transcriber: SpeechTranscriber?
    private var captureTask: Task<Void, Never>?
    private var recognitionTask: Task<Void, Never>?
    private var teardownTask: Task<Void, Never>?
    private var reloadRevision = UUID()
    private var deleting: Set<String> = []
    @Published private(set) var attempt: Attempt?
    @Published private(set) var recordings: [SpeechRecording] = []
    @Published private(set) var failure: SpeechFailure?
    var onChange: @MainActor () -> Void = {}
    var onResult: @MainActor (NativeVoiceResult) -> Void = { _ in }

    init(directory: URL? = nil, serviceURL: String, driver: any SpeechAudioDriver = IOSSpeechAudioDriver(),
         socketFactory: any SpeechSocketFactory = URLSessionSpeechSocketFactory(),
         clock: any TransportClock = MonotonicTransportClock(),
         identity: @escaping @Sendable () async throws -> SpeechSigningIdentity) throws {
        let root = try directory ?? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
            appropriateFor: nil, create: true).appendingPathComponent("NativeVoice", isDirectory: true)
        store = try SpeechRecordingStore(directory: root)
        configuration = try? SpeechServiceConfiguration(serviceURL)
        self.identity = identity; self.driver = driver; self.socketFactory = socketFactory; self.clock = clock
    }

    func restore() async {
        let revision = UUID(); reloadRevision = revision
        do {
            let items = try await store.recordings()
            guard reloadRevision == revision else { return }
            recordings = items; onChange()
        } catch {
            guard reloadRevision == revision else { return }
            failure = SpeechFailure(.storage); onChange()
        }
    }
    func saved(for context: NativeVoiceContext) -> [SpeechRecording] {
        guard let scope = try? context.scope else { return [] }
        return recordings.filter { $0.scope == scope && !$0.isRecording }
    }
    func start(_ context: NativeVoiceContext) {
        guard configuration != nil else { failure = .init(.unavailable); onChange(); return }
        guard attempt == nil else { failure = .init(.busy); onChange(); return }
        let id = UUID(), previous = teardownTask
        attempt = .init(id: id, context: context, recovery: false, phase: .preparing)
        failure = nil; onChange()
        captureTask = Task { [weak self] in
            await previous?.value
            guard let self, attempt?.id == id, !Task.isCancelled else { return }
            do {
                let recording = try await recorder.start(scope: context.scope, draft: context.text)
                guard attempt?.id == id, !Task.isCancelled else { await recorder.stop(recordingID: recording.id); return }
                attempt?.recordingID = recording.id; attempt?.phase = .recording; onChange()
                recognize(recording, context: context, recovery: false, id: id)
            } catch {
                guard attempt?.id == id else { return }
                failure = error as? SpeechFailure ?? .init(.captureFailed)
                attempt = nil; onChange(); await restore()
            }
        }
    }
    @discardableResult func retry(_ recording: SpeechRecording, context: NativeVoiceContext) -> UUID? {
        guard attempt == nil, let scope = try? context.scope, recording.scope == scope, !recording.isRecording,
              recording.bytes > 0, configuration != nil || recording.hasCompletedTranscription, !deleting.contains(recording.id) else { return nil }
        let id = UUID()
        attempt = .init(id: id, context: context, recovery: true, recordingID: recording.id, phase: .transcribing)
        failure = nil; onChange()
        if recording.hasCompletedTranscription {
            recognitionTask = Task { [weak self] in
                guard let self else { return }
                do {
                    guard let text = try await store.completedText(recording.id), !text.isEmpty else { throw SpeechFailure(.noSpeech) }
                    guard attempt?.id == id, !Task.isCancelled else { return }
                    attempt = nil; recognitionTask = nil; onChange()
                    onResult(.init(id: id, context: context, recording: recording, text: text, isRecovery: true, explicitlySend: false))
                } catch {
                    guard attempt?.id == id else { return }
                    attempt = nil; recognitionTask = nil; failure = error as? SpeechFailure ?? .init(.storage); onChange()
                }
            }
        } else { recognize(recording, context: context, recovery: true, id: id) }
        return id
    }
    func stop(_ context: NativeVoiceContext, explicitlySend: Bool) {
        guard let captured = attempt, captured.context.route == context.route,
              captured.context.activation == context.activation, captured.context.selection == context.selection,
              !captured.recovery else { return }
        guard let recordingID = captured.recordingID else { retire(); return }
        attempt?.send = explicitlySend && captured.failure == nil && captured.context == context && captured.phase == .recording
        attempt?.phase = .transcribing; onChange()
        Task { await recorder.stop(recordingID: recordingID) }
    }
    /// Synchronously revokes the attempt before any awaited native teardown.
    func retire() {
        attempt = nil; failure = nil; captureTask?.cancel(); captureTask = nil
        recognitionTask?.cancel(); recognitionTask = nil
        let old = transcriber; transcriber = nil
        let previous = teardownTask, recorder = self.recorder
        teardownTask = Task { [weak self] in
            await previous?.value
            await recorder.stop(); await old?.cancel()
            await self?.restore()
        }
        onChange()
    }
    func cancelAttempt(_ id: UUID) { if attempt?.id == id { retire() } }
    func discard(_ recording: SpeechRecording) async throws {
        guard attempt?.recordingID != recording.id, !recording.isRecording, !deleting.contains(recording.id) else { return }
        deleting.insert(recording.id); defer { deleting.remove(recording.id) }
        try await store.discard(recording.id); await restore()
    }
    private func receive(_ update: SpeechCaptureUpdate) async {
        switch update {
        case let .recording(recording, level):
            guard attempt?.recordingID == recording.id else { return }
            attempt?.seconds = recording.seconds; attempt?.level = level; onChange()
        case let .stopped(recording, error):
            guard attempt?.recordingID == recording.id else { await restore(); return }
            attempt?.seconds = recording.seconds; attempt?.level = 0
            if let error { attempt?.failure = error; attempt?.send = false; failure = error }
            if attempt?.failure == nil { attempt?.phase = .transcribing }
            else if recognitionTask == nil { attempt = nil }
            onChange(); await restore()
        }
    }
    private func recognize(_ recording: SpeechRecording, context: NativeVoiceContext, recovery: Bool, id: UUID) {
        guard let configuration else { return }
        let transcriber = SpeechTranscriber(store: store, configuration: configuration, factory: socketFactory, clock: clock, identity: identity)
        self.transcriber = transcriber
        recognitionTask = Task { [weak self] in
            guard let self else { return }
            do {
                let text = try await transcriber.transcribe(recording.id) { [weak self] progress in
                    await self?.transcriptionProgress(progress, id: id)
                }
                // Wait for the capture callback to publish an interruption/limit
                // before considering the explicit send intent.
                if !recovery { await recorder.stop(recordingID: recording.id) }
                guard let current = attempt, current.id == id, !Task.isCancelled else { return }
                recognitionTask = nil; self.transcriber = nil
                if let error = current.failure { throw error }
                let saved = try await store.recording(recording.id)
                guard attempt?.id == id, !Task.isCancelled else { return }
                attempt = nil; failure = nil; onChange()
                onResult(.init(id: id, context: context, recording: saved, text: text,
                               isRecovery: recovery, explicitlySend: current.send && !recovery))
                await restore()
            } catch {
                guard attempt?.id == id else { return }
                recognitionTask = nil; self.transcriber = nil
                let error = error as? SpeechFailure ?? SpeechFailure(.failed)
                failure = error; attempt?.failure = error; attempt?.send = false
                let current = try? await store.recording(recording.id)
                guard attempt?.id == id else { return }
                if current?.isRecording == true {
                    attempt?.phase = .recording // ASR failure never stops local capture.
                } else { attempt = nil }
                onChange(); await restore()
            }
        }
    }
    private func transcriptionProgress(_ progress: SpeechTranscriptionProgress, id: UUID) {
        guard attempt?.id == id else { return }
        attempt?.transcriptPreview = String(progress.text.suffix(80)); onChange()
    }
    deinit { captureTask?.cancel(); recognitionTask?.cancel(); teardownTask?.cancel() }
}
