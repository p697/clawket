package com.clawket.voicecapture

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Process
import android.os.SystemClock
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.jni.NativeArrayBuffer
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors

private const val BUFFER_EVENT = "onVoiceCaptureBuffer"
private const val STATUS_EVENT = "onVoiceCaptureStatus"
private const val CHUNK_MS = 40
private val SAMPLE_RATES = intArrayOf(16000, 48000, 44100)

internal class VoiceCapturePermissionException :
  CodedException("RECORD_AUDIO permission has not been granted")

internal class VoiceCaptureStartException(message: String) :
  CodedException(message)

class ClawketVoiceCaptureModule : Module() {
  internal val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ClawketVoiceCapture")

    Events(BUFFER_EVENT, STATUS_EVENT)

    OnCreate {
      VoiceCaptureController.attach(this@ClawketVoiceCaptureModule)
    }

    OnDestroy {
      VoiceCaptureController.detach(this@ClawketVoiceCaptureModule)
    }

    AsyncFunction("prepare") { promise: Promise ->
      VoiceCaptureController.run(promise) { prepare(this@ClawketVoiceCaptureModule.context) }
    }

    AsyncFunction("start") { captureId: String, requestedAt: Double, promise: Promise ->
      VoiceCaptureController.run(promise) { start(this@ClawketVoiceCaptureModule.context, captureId, requestedAt) }
    }

    AsyncFunction("stop") { captureId: String, promise: Promise ->
      VoiceCaptureController.run(promise) { stop(captureId) }
    }

    AsyncFunction("release") { promise: Promise ->
      VoiceCaptureController.run(promise) { release() }
    }
  }

  internal fun emit(event: String, body: Map<String, Any?>) {
    sendEvent(event, body)
  }
}

/**
 * One process-wide recorder. The AudioRecord is created before the first press and reused;
 * nothing is recorded until `start`. Control work runs on a dedicated thread instead of the
 * shared Expo module queue; samples are read on their own urgent-audio thread in 40 ms chunks.
 */
internal object VoiceCaptureController {
  private val control = Executors.newSingleThreadExecutor { runnable ->
    Thread({
      Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
      runnable.run()
    }, "clawket-voice-control")
  }

  @Volatile private var module: WeakReference<ClawketVoiceCaptureModule>? = null
  @Volatile private var captureId: String? = null
  private var recorder: AudioRecord? = null
  private var reader: Thread? = null
  private var releasePending = false

  fun run(promise: Promise, block: VoiceCaptureController.() -> Any?) {
    control.execute {
      try {
        val result = block()
        promise.resolve(if (result == Unit) null else result)
      } catch (error: CodedException) {
        promise.reject(error)
      } catch (error: Throwable) {
        promise.reject(VoiceCaptureStartException(error.message ?: "The microphone could not start"))
      }
    }
  }

  fun attach(owner: ClawketVoiceCaptureModule) {
    module = WeakReference(owner)
  }

  fun detach(owner: ClawketVoiceCaptureModule) {
    control.execute {
      val current = module?.get()
      if (current != null && current !== owner) return@execute
      module = null
      captureId?.let { finishCapture() }
      teardown()
    }
  }

  // Control thread only.

  fun prepare(context: Context) {
    releasePending = false
    if (captureId != null || recorder != null || !granted(context)) return
    recorder = createRecorder()
  }

  fun start(context: Context, id: String, requestedAt: Double): Map<String, Any> {
    val queueMs = (System.currentTimeMillis() - requestedAt).coerceAtLeast(0.0)
    if (!granted(context)) throw VoiceCapturePermissionException()
    if (captureId != null) finishCapture()
    releasePending = false

    val warm = recorder != null
    val preparation = SystemClock.elapsedRealtime()
    val record = recorder ?: createRecorder().also { recorder = it }
    val engineMs = (SystemClock.elapsedRealtime() - preparation).toDouble()

    val launch = SystemClock.elapsedRealtime()
    try {
      record.startRecording()
    } catch (error: IllegalStateException) {
      discardRecorder()
      throw VoiceCaptureStartException("The microphone is held by another app or the system")
    }
    if (record.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
      discardRecorder()
      throw VoiceCaptureStartException("The microphone is held by another app or the system")
    }
    val startMs = (SystemClock.elapsedRealtime() - launch).toDouble()
    captureId = id
    startReader(record, id)

    val audio = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
    return mapOf(
      "queueMs" to queueMs,
      "activateMs" to 0.0,
      "engineMs" to engineMs,
      "startMs" to startMs,
      "warm" to warm,
      "inputRoute" to inputRoute(record.routedDevice),
      "bluetooth" to bluetoothConnected(audio),
      "otherAudio" to (audio?.isMusicActive == true)
    )
  }

  fun stop(id: String) {
    if (captureId != id) return
    finishCapture()
    if (releasePending) teardown()
  }

  fun release() {
    if (captureId != null) {
      // The owning attempt's stop completes the release; another screen never stops it.
      releasePending = true
      return
    }
    teardown()
  }

  private fun finishCapture() {
    captureId = null
    try {
      recorder?.stop()
    } catch (_: IllegalStateException) {
      // Already stopped.
    }
    reader?.let { if (it !== Thread.currentThread()) it.join(500) }
    reader = null
  }

  private fun fail(id: String) {
    if (captureId != id) return
    finishCapture()
    discardRecorder()
    module?.get()?.emit(STATUS_EVENT, mapOf("captureId" to id, "reason" to "failed"))
  }

  private fun teardown() {
    releasePending = false
    discardRecorder()
  }

  private fun discardRecorder() {
    recorder?.release()
    recorder = null
  }

  @SuppressLint("MissingPermission")
  private fun createRecorder(): AudioRecord {
    val channel = AudioFormat.CHANNEL_IN_MONO
    val encoding = AudioFormat.ENCODING_PCM_FLOAT
    for (rate in SAMPLE_RATES) {
      val minimum = AudioRecord.getMinBufferSize(rate, channel, encoding)
      if (minimum <= 0) continue
      // At least 200 ms of headroom so the 40 ms reader never overruns.
      val bufferSize = maxOf(minimum, rate * 4 / 5)
      val record = try {
        AudioRecord(MediaRecorder.AudioSource.MIC, rate, channel, encoding, bufferSize)
      } catch (_: Exception) {
        null
      }
      if (record?.state == AudioRecord.STATE_INITIALIZED) return record
      record?.release()
    }
    throw VoiceCaptureStartException("The microphone is unavailable")
  }

  private fun startReader(record: AudioRecord, id: String) {
    val frames = record.sampleRate * CHUNK_MS / 1000
    val rate = record.sampleRate.toDouble()
    val thread = Thread({
      Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
      val samples = FloatArray(frames)
      while (captureId == id) {
        val read = record.read(samples, 0, frames, AudioRecord.READ_BLOCKING)
        if (captureId != id) break
        if (read > 0) {
          val bytes = ByteBuffer.allocateDirect(read * 4).order(ByteOrder.nativeOrder())
          bytes.asFloatBuffer().put(samples, 0, read)
          module?.get()?.emit(BUFFER_EVENT, mapOf(
            "captureId" to id,
            "data" to NativeArrayBuffer(bytes),
            "sampleRate" to rate,
            "channels" to 1
          ))
        } else if (read < 0) {
          control.execute { fail(id) }
          break
        }
      }
    }, "clawket-voice-reader")
    reader = thread
    thread.start()
  }

  private fun granted(context: Context): Boolean =
    context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

  /** Device categories only; product names are never reported. */
  private fun inputRoute(device: AudioDeviceInfo?): String = when (device?.type) {
    null -> "none"
    AudioDeviceInfo.TYPE_BUILTIN_MIC -> "built_in"
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_HEADSET -> "bluetooth"
    AudioDeviceInfo.TYPE_WIRED_HEADSET -> "wired"
    AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_HEADSET -> "usb"
    else -> "other"
  }

  private fun bluetoothConnected(audio: AudioManager?): Boolean {
    val devices = audio?.getDevices(AudioManager.GET_DEVICES_OUTPUTS) ?: return false
    return devices.any {
      it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
        it.type == AudioDeviceInfo.TYPE_BLE_HEADSET
    }
  }
}
