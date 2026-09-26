import { requireOptionalNativeModule } from 'expo';

/** Mono float32 PCM at 16 kHz, or the hardware rate when the device could not convert. */
type VoiceCaptureBuffer = { captureId: string; data: ArrayBuffer; sampleRate: number; channels: number };
/** Native capture ended without a stop request: interruption, route loss, media reset or a read failure. */
type VoiceCaptureStatus = { captureId: string; reason: string };
/** Start diagnostics: milliseconds per native step and port categories, never device names. */
export type VoiceCaptureTiming = {
  queueMs: number; activateMs: number; engineMs: number; startMs: number;
  warm: boolean; inputRoute: string; bluetooth: boolean; otherAudio: boolean;
};
type Subscription = { remove(): void };
type NativeVoiceCapture = {
  prepare(): Promise<void>;
  start(captureId: string, requestedAt: number): Promise<VoiceCaptureTiming>;
  stop(captureId: string): Promise<void>;
  release(): Promise<void>;
  addListener(event: 'onVoiceCaptureBuffer', listener: (event: VoiceCaptureBuffer) => void): Subscription;
  addListener(event: 'onVoiceCaptureStatus', listener: (event: VoiceCaptureStatus) => void): Subscription;
};

const native = requireOptionalNativeModule<NativeVoiceCapture>('ClawketVoiceCapture');
const inert: Subscription = { remove() {} };
let holders = 0;

/** A binary without the local module (an older development client) keeps dictation hidden. */
export const voiceCaptureAvailable = native !== null;

/** The process-wide microphone owned by the local `clawket-voice-capture` module. */
export const voiceCapture = {
  start(captureId: string, requestedAt: number): Promise<VoiceCaptureTiming> {
    return native ? native.start(captureId, requestedAt) : Promise.reject(new Error('voice_capture_unavailable'));
  },
  /** Stops only the capture with this identity; resolves after native teardown has finished. */
  stop(captureId: string): Promise<void> {
    return native ? native.stop(captureId) : Promise.resolve();
  },
  onBuffer(listener: (event: VoiceCaptureBuffer) => void): Subscription {
    return native ? native.addListener('onVoiceCaptureBuffer', listener) : inert;
  },
  onStatus(listener: (event: VoiceCaptureStatus) => void): Subscription {
    return native ? native.addListener('onVoiceCaptureStatus', listener) : inert;
  },
  /**
   * Keeps the category and engine warm while any focused chat holds it, without opening the
   * microphone. The last holder releases the audio session; an active capture finishes first.
   */
  hold(): () => void {
    if (!native) return () => {};
    holders += 1;
    void native.prepare().catch(() => {});
    let held = true;
    return () => {
      if (!held) return;
      held = false; holders -= 1;
      if (holders === 0) void native.release().catch(() => {});
    };
  },
};
