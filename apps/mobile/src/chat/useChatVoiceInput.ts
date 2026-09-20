import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, Platform } from 'react-native';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioStream } from 'expo-audio';
import { useSharedValue } from 'react-native-reanimated';
import type { ComposerHandle } from '../components/ui/Composer';
import { analyticsEvents } from '../services/analytics/events';
import { triggerLightImpact } from '../services/haptics';
import { speechServiceUrl, type SpeechConnection } from '../services/speech/speechStream';
import { createRecording, savedRecordings, RECORDING_SECONDS, PCM_BYTES_PER_SECOND, type SpeechRecording } from '../services/speech/speechRecordings';
import { transcribeRecording } from '../services/speech/transcribeRecording';
import { SpeechError, speechError, speechErrorCopy } from '../services/speech/speechErrors';
import { speechCaptureLease } from '../services/speech/speechCaptureLease';
import { SpeechPcm } from '../services/speech/speechPcm';
import { createSpeechLevelState, processSpeechLevel } from '../services/speech/speechLevel';

type Phase = 'idle' | 'authorizing' | 'listening' | 'transcribing';
type Props = {
  composerRef: RefObject<ComposerHandle | null>; input: string; setInput: (value: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  scope?: string; enabled?: boolean; onSubmit?: (text: string) => void;
};
type Attempt = {
  scope: string; draft: string; pcm: SpeechPcm; recording?: SpeechRecording;
  cancelled: boolean; stopped: boolean; send: boolean; captured: boolean;
  releaseCapture?: () => void;
  nativeStart?: Promise<void>; restoring?: Promise<void>; timer?: ReturnType<typeof setTimeout>;
  connection?: SpeechConnection; abort: AbortController; stop: () => void; stoppedPromise: Promise<void>;
  error?: SpeechError; startedAt: number; firstBuffer: boolean;
};

/** Capture is local and independent of transcription. Only this attempt owns native teardown. */
export function useChatVoiceInput(options: Props) {
  const latest = useRef(options); latest.current = options;
  const mounted = useRef(true), permissionGranted = useRef(false), permissionGeneration = useRef(0);
  const observedStreaming = useRef(false), active = useRef<Attempt | null>(null);
  const [voiceInputState, setPhase] = useState<Phase>('idle');
  const [voiceRecoveryCount, setRecoveryCount] = useState(0);
  const [voiceRecordingSaved, setRecordingSaved] = useState(false);
  const voiceInputLevel = useSharedValue(0), meter = useRef(createSpeechLevelState());
  const finishRef = useRef<(send: boolean) => void>(() => {});
  const stopCaptureError = useRef<(error: unknown) => void>(() => {});
  const { stream, isStreaming } = useAudioStream({ sampleRate: 16000, channels: 1, encoding: 'float32',
    onBuffer(buffer) {
      const op = active.current;
      if (!op || op.cancelled || op.stopped || !op.recording) return;
      try {
        const pcm = op.pcm.convert(buffer.data, buffer.sampleRate, buffer.channels);
        const bytes = pcm.slice(0, RECORDING_SECONDS * PCM_BYTES_PER_SECOND - op.recording.bytes);
        if (bytes.length) op.recording.append(bytes);
        if (!op.firstBuffer && bytes.length) {
          op.firstBuffer = true;
          analyticsEvents.chatVoiceInputTiming({ stage: 'first_buffer', duration_ms: Date.now() - op.startedAt });
        }
        let energy = 0;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let i = 0; i < bytes.length; i += 2) energy += (view.getInt16(i, true) / 32768) ** 2;
        const level = processSpeechLevel(meter.current, Math.min(1, Math.sqrt(energy / Math.max(1, bytes.length / 2)) * 5.5));
        meter.current = level.state; voiceInputLevel.value = level.level;
        if (op.recording.bytes >= RECORDING_SECONDS * PCM_BYTES_PER_SECOND) finishRef.current(false);
      } catch (error) { stopCaptureError.current(error); }
    },
  });
  const streamRef = useRef(stream); streamRef.current = stream;
  const currentScopeEnabled = () => latest.current.enabled !== false;
  const current = (op: Attempt) => mounted.current && !op.cancelled && active.current === op && op.scope === (latest.current.scope ?? '') && latest.current.enabled !== false;
  const refresh = () => {
    if (!mounted.current) return;
    try { setRecoveryCount(savedRecordings(latest.current.scope ?? '').length); } catch { /* Retry on next focus. */ }
  };
  const release = (op: Attempt) => {
    clearTimeout(op.timer);
    if (op.restoring) return op.restoring;
    op.restoring = (async () => {
      await op.nativeStart?.catch(() => {});
      if (op.captured) {
        try { streamRef.current.stop(); } catch { /* Already stopped. */ }
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      }
      try { op.recording?.close(); } catch { op.error ??= new SpeechError('speech_storage'); } finally { op.releaseCapture?.(); }
      if (active.current === op) voiceInputLevel.value = 0;
    })();
    return op.restoring;
  };
  // Navigation/background cancellation preserves the journal; explicit discard is separate.
  const suspend = useCallback((discard = false) => {
    const op = active.current;
    if (!op) return;
    op.cancelled = true; op.stopped = true; op.send = false; op.stop(); op.abort.abort(); op.connection?.cancel();
    void release(op).then(() => {
      try { if (op.recording && (discard || op.recording.bytes === 0)) op.recording.discard(); } catch { /* Retain on failed deletion. */ }
      if (active.current === op) { active.current = null; if (mounted.current) { setPhase('idle'); setRecordingSaved(false); refresh(); } }
    });
  }, []);
  const cancelVoiceInput = useCallback(() => suspend(!active.current?.stopped), [suspend]);
  const stopVoiceInput = useCallback((send = false) => {
    const op = active.current;
    if (!op || op.cancelled || op.stopped) return;
    if (!op.captured || !op.recording?.bytes) { suspend(); return; }
    op.stopped = true; op.send = send && !op.error; op.stop();
    void release(op);
    if (current(op)) setPhase('transcribing');
  }, [suspend]);
  finishRef.current = stopVoiceInput;
  stopCaptureError.current = (error) => {
    const op = active.current; if (!op || op.cancelled) return;
    op.error = speechError(error); op.stopped = true; op.send = false; op.stop(); op.abort.abort(); op.connection?.cancel();
    void release(op);
  };
  const report = (error: SpeechError, retry?: () => void) => {
    const t = latest.current.t;
    analyticsEvents.chatVoiceInputFailed({ code: error.code, stage: error.code === 'speech_permission' ? 'permissions' : error.code === 'speech_capture_failed' ? 'start' : 'recognition', request_id: error.requestId || undefined });
    const detail = [t(speechErrorCopy(error), { ns: 'chat' }),
      error.retryAfterMs ? t('Try again in {{seconds}} seconds.', { ns: 'chat', seconds: Math.ceil(error.retryAfterMs / 1000) }) : '',
      `${error.code}${error.requestId ? ` · ${error.requestId}` : ''}`].filter(Boolean).join('\n');
    Alert.alert(t('Voice input failed', { ns: 'chat' }), detail, error.code === 'speech_permission'
      ? [{ text: t('Cancel', { ns: 'common' }), style: 'cancel' }, { text: t('Settings', { ns: 'common' }), onPress: () => { void Linking.openSettings(); } }]
      : [{ text: t('Keep audio', { ns: 'chat' }), style: 'cancel' }, ...(retry ? [{ text: t('Retry', { ns: 'common' }), onPress: retry }] : [])]);
  };
  const run = useCallback(async (retained?: SpeechRecording) => {
    if (active.current || latest.current.enabled === false) return;
    let stop!: () => void;
    const op: Attempt = { scope: latest.current.scope ?? '', draft: latest.current.input || retained?.metadata.draft || '', pcm: new SpeechPcm(),
      recording: retained, cancelled: false, stopped: Boolean(retained), send: false, captured: false,
      abort: new AbortController(), stoppedPromise: new Promise<void>((resolve) => { stop = resolve; }), stop: () => stop(),
      startedAt: Date.now(), firstBuffer: false };
    if (retained) op.stop();
    active.current = op; observedStreaming.current = false;
    setPhase(retained ? 'transcribing' : 'authorizing'); setRecordingSaved(false); meter.current = createSpeechLevelState();
    latest.current.composerRef.current?.blur();
    analyticsEvents.chatVoiceInputTapped({ action: 'start', has_existing_text: Boolean(op.draft.trim()), locale: 'system', source: 'chat_composer' });
    let failure: SpeechError | undefined;
    try {
      if (!speechServiceUrl) throw new SpeechError('speech_unavailable');
      if (!retained) {
        if (!permissionGranted.current) {
          const existing = await getRecordingPermissionsAsync();
          if (!current(op)) return;
          const permission = existing.granted ? existing : await requestRecordingPermissionsAsync();
          if (!current(op)) return;
          permissionGranted.current = permission.granted;
          if (!permission.granted) throw new SpeechError('speech_permission');
        }
        op.releaseCapture = await speechCaptureLease.acquire(op.abort.signal);
        if (!current(op)) { op.releaseCapture(); return; }
        op.recording = createRecording(op.scope, op.draft);
        op.captured = true;
        op.nativeStart = Promise.resolve().then(() => streamRef.current.start());
        try { await op.nativeStart; } catch { permissionGranted.current = false; throw new SpeechError('speech_capture_failed'); }
        if (!current(op)) return;
        analyticsEvents.chatVoiceInputTiming({ stage: 'native_started', duration_ms: Date.now() - op.startedAt });
        setPhase('listening'); triggerLightImpact();
        op.timer = setTimeout(() => stopVoiceInput(false), RECORDING_SECONDS * 1000);
      }
      let text = '';
      try {
        text = await transcribeRecording(op.recording!, op.abort.signal, (connection) => { op.connection = connection; }, () => !op.stopped && !op.cancelled);
      } catch (error) {
        op.error ??= speechError(error); op.send = false;
        // A broken network never stops the microphone or removes the journal.
        if (current(op) && !op.stopped) setRecordingSaved(true);
      }
      await op.stoppedPromise;
      if (op.error) throw op.error;
      if (!current(op)) return;
      const joined = [op.draft.trimEnd(), text].filter(Boolean).join(' ');
      latest.current.setInput(joined);
      if (op.send) latest.current.onSubmit?.(joined);
      op.recording!.discard();
    } catch (error) { if (current(op)) failure = speechError(error); }
    finally {
      op.abort.abort(); op.connection?.cancel();
      await release(op);
      try { if (op.recording?.bytes === 0) op.recording.discard(); } catch { /* Preserve files on errors. */ }
      if (active.current === op) { active.current = null; if (mounted.current) { setPhase('idle'); setRecordingSaved(false); refresh(); } }
    }
    // Show retry only after teardown has released the active slot.
    if (failure && mounted.current && op.scope === (latest.current.scope ?? '') && currentScopeEnabled()) {
      const recording = op.recording;
      let recoverable = false;
      try { recoverable = Boolean(recording && recording.bytes > 0); } catch { /* Recover from the saved entry later. */ }
      report(failure, recording && recoverable ? () => { if (op.scope === (latest.current.scope ?? '')) void run(recording); } : undefined);
    }
  }, [stopVoiceInput]);
  const recoverVoiceInput = useCallback(() => {
    if (active.current || latest.current.enabled === false) return;
    try {
      const recording = savedRecordings(latest.current.scope ?? '')[0];
      if (!recording) { refresh(); return; }
      const t = latest.current.t, scope = latest.current.scope;
      Alert.alert(t('Saved recording', { ns: 'chat' }), t('Your audio is saved on this device. Retry transcription or delete it.', { ns: 'chat' }), [
        { text: t('Keep audio', { ns: 'chat' }), style: 'cancel' },
        { text: t('Delete', { ns: 'common' }), style: 'destructive', onPress: () => { try { recording.discard(); refresh(); } catch { report(new SpeechError('speech_storage')); } } },
        { text: t('Retry', { ns: 'common' }), onPress: () => { if (scope === latest.current.scope) void run(recording); } },
      ]);
    } catch { report(new SpeechError('speech_storage')); }
  }, [run]);
  const startVoiceInput = useCallback(() => {
    try { if (savedRecordings(latest.current.scope ?? '').length) { recoverVoiceInput(); return; } }
    catch { report(new SpeechError('speech_storage')); return; }
    void run();
  }, [run, recoverVoiceInput]);
  useEffect(() => {
    mounted.current = true;
    const warmPermission = () => {
      const generation = ++permissionGeneration.current;
      void getRecordingPermissionsAsync().then((permission) => {
        if (mounted.current && generation === permissionGeneration.current) permissionGranted.current = permission.granted;
      }).catch(() => {});
    };
    if (speechServiceUrl) warmPermission(); // Never prompts or opens the microphone.
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') { permissionGeneration.current++; permissionGranted.current = false; suspend(); }
      else { if (speechServiceUrl) warmPermission(); refresh(); }
    });
    return () => { mounted.current = false; permissionGeneration.current++; suspend(); sub.remove(); };
  }, [suspend]);
  useEffect(() => {
    if (isStreaming) observedStreaming.current = true;
    if (isStreaming === false && observedStreaming.current && voiceInputState === 'listening') stopVoiceInput(false);
  }, [isStreaming, voiceInputState, stopVoiceInput]);
  useEffect(() => { suspend(); refresh(); }, [options.scope, options.enabled, suspend]);
  return {
    startVoiceInput, stopVoiceInput, cancelVoiceInput, recoverVoiceInput, voiceRecoveryCount, voiceRecordingSaved,
    toggleVoiceInput: () => { if (active.current) stopVoiceInput(false); else startVoiceInput(); },
    voiceInputActive: voiceInputState !== 'idle', voiceInputDisabled: options.enabled === false,
    voiceInputLevel, voiceInputState, voiceInputSupported: Boolean(speechServiceUrl) && (Platform.OS === 'ios' || Platform.OS === 'android'),
  };
}
