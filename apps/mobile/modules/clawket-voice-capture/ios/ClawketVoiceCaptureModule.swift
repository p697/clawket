import AVFoundation
import ExpoModulesCore

/// Every audio-session and engine transition runs here, never on Expo's shared async queue,
/// so Keychain, file and analytics work cannot delay the microphone (or be delayed by it).
private let voiceCaptureQueue = DispatchQueue(label: "com.clawket.voice-capture", qos: .userInteractive)

public final class ClawketVoiceCaptureModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ClawketVoiceCapture")

    Events(VoiceCaptureController.bufferEvent, VoiceCaptureController.statusEvent)

    OnCreate {
      VoiceCaptureController.shared.attach(self)
    }

    OnDestroy {
      VoiceCaptureController.shared.detach(self)
    }

    OnAppEntersBackground {
      VoiceCaptureController.shared.releaseWhenIdle()
    }

    AsyncFunction("prepare") {
      try VoiceCaptureController.shared.prepare()
    }.runOnQueue(voiceCaptureQueue)

    AsyncFunction("start") { (captureId: String, requestedAt: Double) -> [String: Any] in
      try VoiceCaptureController.shared.start(captureId: captureId, requestedAt: requestedAt)
    }.runOnQueue(voiceCaptureQueue)

    AsyncFunction("stop") { (captureId: String) in
      VoiceCaptureController.shared.stop(captureId: captureId)
    }.runOnQueue(voiceCaptureQueue)

    AsyncFunction("release") {
      VoiceCaptureController.shared.release()
    }.runOnQueue(voiceCaptureQueue)
  }
}

/**
 One process-wide microphone. The session category is configured once, the engine and its tap
 stay allocated between recordings, and the session stays active while idle unless activating it
 interrupted another app's audio. Nothing is captured until `start`; the engine is paused, not
 running, between recordings. All mutable state is confined to `voiceCaptureQueue`, except the
 emit target that the tap thread reads under `emitLock`.
 */
final class VoiceCaptureController {
  static let shared = VoiceCaptureController()
  static let bufferEvent = "onVoiceCaptureBuffer"
  static let statusEvent = "onVoiceCaptureStatus"
  private static let targetSampleRate: Double = 16000
  private static let idleDeactivationSeconds: TimeInterval = 30

  private weak var module: ClawketVoiceCaptureModule?
  private var engine: AVAudioEngine?
  private var configurationObserver: NSObjectProtocol?
  private var tapFormat: AVAudioFormat?
  private var tapConverter: AVAudioConverter?
  private var sessionActive = false
  private var interruptedOthers = false
  private var captureId: String?
  private var releasePending = false
  private var idleDeactivation: DispatchWorkItem?

  private let emitLock = NSLock()
  private var emitTarget: (id: String, module: ClawketVoiceCaptureModule)?

  private init() {
    let center = NotificationCenter.default
    let session = AVAudioSession.sharedInstance()
    _ = center.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: nil) { note in
      guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
        AVAudioSession.InterruptionType(rawValue: raw) == .began else {
        return
      }
      voiceCaptureQueue.async { VoiceCaptureController.shared.handleInterruption() }
    }
    _ = center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: session, queue: nil) { _ in
      voiceCaptureQueue.async { VoiceCaptureController.shared.handleMediaServicesReset() }
    }
  }

  // MARK: - Module lifecycle

  func attach(_ module: ClawketVoiceCaptureModule) {
    voiceCaptureQueue.async { self.module = module }
  }

  func detach(_ module: ClawketVoiceCaptureModule) {
    voiceCaptureQueue.async {
      guard self.module == nil || self.module === module else {
        return
      }
      self.module = nil
      if let id = self.captureId {
        self.finishCapture(id)
      }
      self.teardown()
    }
  }

  func releaseWhenIdle() {
    voiceCaptureQueue.async { self.release() }
  }

  // MARK: - Commands (voiceCaptureQueue)

  /// Warms everything that does not open the microphone or interrupt other audio.
  func prepare() throws {
    releasePending = false
    guard captureId == nil, recordPermissionGranted() else {
      return
    }
    try configureCategory()
    let engine = ensureEngine()
    let format = engine.inputNode.outputFormat(forBus: 0)
    if sessionActive, isUsable(format) {
      if tapFormat != format {
        installTap(on: engine, format: format)
      }
      engine.prepare()
    }
  }

  func start(captureId id: String, requestedAt: Double) throws -> [String: Any] {
    let queueMs = max(0, Date().timeIntervalSince1970 * 1000 - requestedAt)
    guard recordPermissionGranted() else {
      throw VoiceCapturePermissionException()
    }
    if let current = captureId {
      finishCapture(current)
    }
    releasePending = false
    cancelIdleDeactivation()

    let session = AVAudioSession.sharedInstance()
    let warm = sessionActive && engine != nil && tapFormat != nil
    let bluetooth = routeUsesBluetooth(session.currentRoute)
    var otherAudio = false
    var activateMs = 0.0
    do {
      try configureCategory()
      if !sessionActive {
        otherAudio = session.isOtherAudioPlaying
        let activation = Date()
        try session.setActive(true)
        activateMs = milliseconds(since: activation)
        sessionActive = true
        interruptedOthers = otherAudio
      }

      let preparation = Date()
      var engine = ensureEngine()
      var format = engine.inputNode.outputFormat(forBus: 0)
      guard isUsable(format) else {
        throw VoiceCaptureUnavailableException()
      }
      if tapFormat != format {
        installTap(on: engine, format: format)
      }
      tapConverter?.reset()
      let engineMs = milliseconds(since: preparation)

      setEmitTarget(id)
      let launch = Date()
      do {
        try engine.start()
      } catch {
        // A paused engine can refuse to resume after a route change; rebuild it once.
        teardownEngine()
        engine = ensureEngine()
        format = engine.inputNode.outputFormat(forBus: 0)
        guard isUsable(format) else {
          throw VoiceCaptureUnavailableException()
        }
        installTap(on: engine, format: format)
        try engine.start()
      }
      let startMs = milliseconds(since: launch)
      captureId = id
      return [
        "queueMs": queueMs,
        "activateMs": activateMs,
        "engineMs": engineMs,
        "startMs": startMs,
        "warm": warm,
        "inputRoute": inputRoute(session.currentRoute),
        "bluetooth": bluetooth,
        "otherAudio": otherAudio
      ]
    } catch {
      clearEmitTarget()
      engine?.pause()
      settleIdleSession()
      if error is Exception {
        throw error
      }
      throw VoiceCaptureStartException(error.localizedDescription)
    }
  }

  func stop(captureId id: String) {
    guard captureId == id else {
      return
    }
    finishCapture(id)
    settleIdleSession()
  }

  func release() {
    cancelIdleDeactivation()
    if captureId != nil {
      // The owning attempt's stop completes the release; another screen never stops it.
      releasePending = true
      return
    }
    teardown()
  }

  // MARK: - Session and engine

  private func configureCategory() throws {
    let session = AVAudioSession.sharedInstance()
    let options: AVAudioSession.CategoryOptions = [.defaultToSpeaker]
    if session.category != .playAndRecord || session.mode != .measurement || session.categoryOptions != options {
      try session.setCategory(.playAndRecord, mode: .measurement, options: options)
    }
    // Start/stop haptics and slide-to-cancel feedback must stay perceptible while recording.
    if !session.allowHapticsAndSystemSoundsDuringRecording {
      try? session.setAllowHapticsAndSystemSoundsDuringRecording(true)
    }
  }

  private func ensureEngine() -> AVAudioEngine {
    if let engine {
      return engine
    }
    let engine = AVAudioEngine()
    // Instantiates the input unit now instead of on the press.
    _ = engine.inputNode
    configurationObserver = NotificationCenter.default.addObserver(
      forName: .AVAudioEngineConfigurationChange,
      object: engine,
      queue: nil
    ) { [weak engine] _ in
      voiceCaptureQueue.async { VoiceCaptureController.shared.handleConfigurationChange(engine) }
    }
    self.engine = engine
    return engine
  }

  private func installTap(on engine: AVAudioEngine, format: AVAudioFormat) {
    let input = engine.inputNode
    if tapFormat != nil {
      input.removeTap(onBus: 0)
    }
    guard let target = AVAudioFormat(
      commonFormat: .pcmFormatFloat32,
      sampleRate: Self.targetSampleRate,
      channels: 1,
      interleaved: true
    ) else {
      tapFormat = nil
      return
    }
    // The hardware rate is never forced to 16 kHz; conversion happens here instead.
    let matchesTarget = format.sampleRate == Self.targetSampleRate && format.channelCount == 1
      && format.commonFormat == .pcmFormatFloat32
    let converter = matchesTarget ? nil : AVAudioConverter(from: format, to: target)
    converter?.downmix = true
    tapConverter = converter
    let bufferSize = AVAudioFrameCount(max(1, format.sampleRate * 0.1))
    input.installTap(onBus: 0, bufferSize: bufferSize, format: format) { buffer, _ in
      VoiceCaptureController.shared.deliver(buffer, converter: converter, target: target)
    }
    tapFormat = format
  }

  private func finishCapture(_ id: String) {
    guard captureId == id || captureId == nil else {
      return
    }
    clearEmitTarget()
    captureId = nil
    // Pausing stops the hardware (and the microphone indicator) but keeps the engine allocated.
    engine?.pause()
  }

  private func settleIdleSession() {
    if releasePending {
      teardown()
    } else if interruptedOthers {
      // Let the interrupted app resume now, exactly as a released recorder would.
      deactivate()
    } else {
      scheduleIdleDeactivation()
    }
  }

  private func teardown() {
    releasePending = false
    teardownEngine()
    deactivate()
  }

  private func teardownEngine() {
    if let configurationObserver {
      NotificationCenter.default.removeObserver(configurationObserver)
    }
    configurationObserver = nil
    if let engine {
      if tapFormat != nil {
        engine.inputNode.removeTap(onBus: 0)
      }
      engine.stop()
    }
    engine = nil
    tapFormat = nil
    tapConverter = nil
  }

  private func deactivate() {
    cancelIdleDeactivation()
    guard sessionActive else {
      return
    }
    engine?.stop()
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    sessionActive = false
    interruptedOthers = false
  }

  private func scheduleIdleDeactivation() {
    cancelIdleDeactivation()
    let work = DispatchWorkItem {
      let controller = VoiceCaptureController.shared
      if controller.captureId == nil {
        controller.deactivate()
      }
    }
    idleDeactivation = work
    voiceCaptureQueue.asyncAfter(deadline: .now() + Self.idleDeactivationSeconds, execute: work)
  }

  private func cancelIdleDeactivation() {
    idleDeactivation?.cancel()
    idleDeactivation = nil
  }

  // MARK: - System notifications (voiceCaptureQueue)

  private func handleInterruption() {
    cancelIdleDeactivation()
    sessionActive = false
    interruptedOthers = false
    guard let id = captureId else {
      return
    }
    let module = self.module
    finishCapture(id)
    module?.emit(event: Self.statusEvent, payload: ["captureId": id, "reason": "interrupted"])
  }

  private func handleConfigurationChange(_ changed: AVAudioEngine?) {
    guard let engine, let changed, engine === changed else {
      return
    }
    // The engine stopped itself because the route or hardware format changed.
    let format = engine.inputNode.outputFormat(forBus: 0)
    guard let id = captureId else {
      if tapFormat != nil {
        engine.inputNode.removeTap(onBus: 0)
      }
      tapFormat = nil
      tapConverter = nil
      return
    }
    if isUsable(format) {
      if tapFormat != format {
        installTap(on: engine, format: format)
      }
      if (try? engine.start()) != nil {
        return
      }
    }
    let module = self.module
    finishCapture(id)
    module?.emit(event: Self.statusEvent, payload: ["captureId": id, "reason": "route"])
  }

  private func handleMediaServicesReset() {
    let id = captureId
    let module = self.module
    clearEmitTarget()
    captureId = nil
    if let configurationObserver {
      NotificationCenter.default.removeObserver(configurationObserver)
    }
    // The old engine and session state are invalid after a reset; rebuild on the next press.
    configurationObserver = nil
    engine = nil
    tapFormat = nil
    tapConverter = nil
    sessionActive = false
    interruptedOthers = false
    cancelIdleDeactivation()
    if let id {
      module?.emit(event: Self.statusEvent, payload: ["captureId": id, "reason": "reset"])
    }
  }

  // MARK: - Tap thread

  private func deliver(_ buffer: AVAudioPCMBuffer, converter: AVAudioConverter?, target: AVAudioFormat) {
    guard let emitter = currentEmitTarget(), buffer.frameLength > 0 else {
      return
    }
    var output = buffer
    if let converter {
      let capacity = AVAudioFrameCount(Double(buffer.frameLength) * target.sampleRate / buffer.format.sampleRate) + 1
      guard let converted = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else {
        return
      }
      var consumed = false
      var error: NSError?
      converter.convert(to: converted, error: &error) { _, status in
        if consumed {
          status.pointee = .noDataNow
          return nil
        }
        consumed = true
        status.pointee = .haveData
        return buffer
      }
      guard error == nil, converted.frameLength > 0 else {
        return
      }
      output = converted
    }
    // Mono float samples; a multi-channel buffer without a converter contributes its first channel.
    guard let samples = output.floatChannelData?[0] else {
      return
    }
    let data = NativeArrayBuffer.copy(of: samples, count: Int(output.frameLength) * MemoryLayout<Float>.size)
    let payload: [String: Any] = [
      "captureId": emitter.id,
      "data": data,
      "sampleRate": output.format.sampleRate,
      "channels": 1
    ]
    emitter.module.emit(event: Self.bufferEvent, payload: payload)
  }

  private func setEmitTarget(_ id: String) {
    emitLock.lock()
    defer { emitLock.unlock() }
    emitTarget = module.map { (id: id, module: $0) }
  }

  private func clearEmitTarget() {
    emitLock.lock()
    defer { emitLock.unlock() }
    emitTarget = nil
  }

  private func currentEmitTarget() -> (id: String, module: ClawketVoiceCaptureModule)? {
    emitLock.lock()
    defer { emitLock.unlock() }
    return emitTarget
  }

  // MARK: - Helpers

  private func isUsable(_ format: AVAudioFormat) -> Bool {
    format.sampleRate > 0 && format.channelCount > 0
  }

  private func recordPermissionGranted() -> Bool {
    if #available(iOS 17.0, *) {
      return AVAudioApplication.shared.recordPermission == .granted
    }
    return AVAudioSession.sharedInstance().recordPermission == .granted
  }

  private func milliseconds(since date: Date) -> Double {
    (Date().timeIntervalSince(date) * 1000).rounded()
  }

  /// Port categories only; device names are never reported.
  private func inputRoute(_ route: AVAudioSessionRouteDescription) -> String {
    guard let port = route.inputs.first?.portType else {
      return "none"
    }
    switch port {
    case .builtInMic:
      return "built_in"
    case .bluetoothHFP, .bluetoothLE:
      return "bluetooth"
    case .headsetMic:
      return "wired"
    case .usbAudio:
      return "usb"
    case .carAudio:
      return "car"
    default:
      return "other"
    }
  }

  private func routeUsesBluetooth(_ route: AVAudioSessionRouteDescription) -> Bool {
    let bluetooth: Set<AVAudioSession.Port> = [.bluetoothA2DP, .bluetoothHFP, .bluetoothLE]
    return (route.inputs + route.outputs).contains { bluetooth.contains($0.portType) }
  }
}

internal final class VoiceCapturePermissionException: Exception, @unchecked Sendable {
  override var reason: String {
    "Microphone permission has not been granted"
  }
}

internal final class VoiceCaptureUnavailableException: Exception, @unchecked Sendable {
  override var reason: String {
    "The microphone input is unavailable"
  }
}

internal final class VoiceCaptureStartException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "The microphone could not start: \(param)"
  }
}
