export const SPEECH_CODES = [
  'speech_unavailable', 'speech_auth', 'speech_busy', 'speech_device_limit', 'speech_ip_limit', 'speech_daily_limit',
  'speech_admission_failed', 'speech_config', 'speech_provider_busy', 'speech_provider_auth', 'speech_provider_quota',
  'speech_provider_upgrade', 'speech_provider_unreachable', 'speech_provider_start_timeout', 'speech_provider_failed',
  'speech_disconnected', 'speech_connect_timeout', 'speech_audio_timeout', 'speech_finish_timeout', 'speech_timeout',
  'speech_protocol', 'speech_audio_limit', 'speech_too_long', 'speech_cancelled', 'speech_permission',
  'speech_capture_failed', 'speech_storage', 'speech_storage_full', 'speech_no_speech', 'speech_failed',
] as const;
export type SpeechCode = typeof SPEECH_CODES[number];
export class SpeechError extends Error {
  readonly retryAt: number;
  constructor(public readonly code: SpeechCode, public readonly requestId = '', public readonly retryAfterMs = 0) {
    super(code); this.retryAt = Date.now() + retryAfterMs;
  }
  get remainingRetryMs(): number { return Math.max(0, this.retryAt - Date.now()); }
}
export function speechError(error: unknown): SpeechError {
  if (error instanceof SpeechError) return error;
  const code = error instanceof Error ? error.message : '';
  return new SpeechError(SPEECH_CODES.includes(code as SpeechCode) ? code as SpeechCode : 'speech_failed');
}
export function decodeSpeechError(event: { code?: unknown; requestId?: unknown; retryAfterMs?: unknown }): SpeechError {
  const code = SPEECH_CODES.includes(event.code as SpeechCode) ? event.code as SpeechCode : 'speech_failed';
  const id = typeof event.requestId === 'string' && /^[a-f0-9-]{36}$/.test(event.requestId) ? event.requestId : '';
  const wait = typeof event.retryAfterMs === 'number' && Number.isFinite(event.retryAfterMs) ? Math.max(0, Math.min(86400000, event.retryAfterMs)) : 0;
  return new SpeechError(code, id, wait);
}
export function speechErrorCopy(error: SpeechError): string {
  switch (error.code) {
    case 'speech_permission': return 'Microphone access is required to transcribe speech.';
    case 'speech_busy': return 'The previous voice session is still closing. Please retry shortly.';
    case 'speech_device_limit': case 'speech_ip_limit': case 'speech_daily_limit': return 'The transcription limit has been reached. Your recording is saved.';
    case 'speech_auth': return 'Voice authentication failed. Check your device date and time.';
    case 'speech_storage': case 'speech_storage_full': return 'Cannot save more audio. Free up device storage or remove a saved recording.';
    case 'speech_no_speech': return 'No speech detected. Please try again.';
    case 'speech_disconnected': case 'speech_connect_timeout': case 'speech_audio_timeout': case 'speech_finish_timeout': case 'speech_timeout':
      return 'The connection was interrupted. Your recording is saved on this device.';
    case 'speech_capture_failed': return 'The microphone stopped. Your recorded audio is saved.';
    default: return 'The transcription service is unavailable. Your recording is saved on this device.';
  }
}
