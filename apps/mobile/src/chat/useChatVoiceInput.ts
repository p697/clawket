import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, Platform } from 'react-native';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioStream } from 'expo-audio';
import { useSharedValue } from 'react-native-reanimated';
import type { ComposerHandle } from '../components/ui/Composer';
import { analyticsEvents } from '../services/analytics/events';
import { triggerLightImpact } from '../services/haptics';
import { connectSpeech, speechServiceUrl, type SpeechConnection } from '../services/speech/speechStream';
import { SpeechPcm } from '../services/speech/speechPcm';
import { createSpeechLevelState, processSpeechLevel } from '../services/speech/speechLevel';

type Phase = 'idle' | 'authorizing' | 'listening' | 'transcribing';
type Props = {
  composerRef: RefObject<ComposerHandle | null>;
  input: string;
  setInput: (value: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  scope?: string;
  enabled?: boolean;
  onSubmit?: (text: string) => void;
};
type Attempt = {
  scope: string | undefined;
  draft: string;
  chunks: Uint8Array[];
  bytes: number;
  sent: number;
  pcm: SpeechPcm;
  cancelled: boolean;
  stopped: boolean;
  send: boolean;
  ready: boolean;
  starting: boolean;
  nativeStart?: Promise<void>;
  captured: boolean;
  connection?: SpeechConnection;
  restoring?: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
  failure?: boolean;
};

/** One recording owns permission, capture, provider and final delivery through all awaits. */
export function useChatVoiceInput(options: Props) {
  const latest = useRef(options); latest.current = options;
  const mounted = useRef(true);
  const observedStreaming = useRef(false);
  const active = useRef<Attempt | null>(null);
  const saved = useRef<Pick<Attempt, 'scope' | 'draft' | 'chunks' | 'bytes'> | null>(null);
  const [voiceInputState, setPhase] = useState<Phase>('idle');
  const voiceInputLevel = useSharedValue(0);
  const meter = useRef(createSpeechLevelState());
  const finishRef = useRef<(send: boolean) => void>(() => {});
  const failRef = useRef<() => void>(() => {});
  const { stream, isStreaming } = useAudioStream({ sampleRate: 16000, channels: 1, encoding: 'float32',
    onBuffer(buffer) {
      const op = active.current;
      if (!op || op.cancelled || op.stopped) return;
      try {
        const pcm = op.pcm.convert(buffer.data, buffer.sampleRate, buffer.channels);
        const bytes = pcm.slice(0, 120 * 32000 - op.bytes);
        let energy = 0;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let i = 0; i < bytes.length; i += 2) energy += (view.getInt16(i, true) / 32768) ** 2;
        const processed = processSpeechLevel(meter.current, Math.min(1, Math.sqrt(energy / Math.max(1, bytes.length / 2)) * 5.5));
        meter.current = processed.state; voiceInputLevel.value = processed.level;
        if (bytes.length) {
          op.chunks.push(bytes); op.bytes += bytes.length;
          if (op.ready) { op.connection!.audio(bytes); op.sent++; }
        }
        if (op.bytes >= 120 * 32000) finishRef.current(false);
      } catch { failRef.current(); }
    },
  });
  const streamRef = useRef(stream); streamRef.current = stream;
  const current = (op: Attempt) => mounted.current && !op.cancelled && active.current === op &&
    op.scope === latest.current.scope && latest.current.enabled !== false;
  const release = (op: Attempt) => {
    clearTimeout(op.timer);
    if (op.restoring) return op.restoring;
    voiceInputLevel.value = 0;
    op.restoring = (async () => {
      // Never let an old attempt's finally stop the next recording's shared native stream.
      if (op.nativeStart) await op.nativeStart.catch(() => {});
      if (!op.captured) return;
      try { streamRef.current.stop(); } catch { /* Already released. */ }
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    })();
    return op.restoring;
  };
  const cancelVoiceInput = useCallback(() => {
    saved.current = null;
    const op = active.current;
    if (!op) return;
    op.cancelled = true; op.stopped = true; op.connection?.cancel();
    void release(op).then(() => {
      if (active.current !== op) return;
      active.current = null;
      if (mounted.current) setPhase('idle');
    });
  }, []);
  const stopVoiceInput = useCallback((send = false) => {
    const op = active.current;
    if (!op || op.cancelled || op.stopped) return;
    if (op.starting || !op.captured || op.bytes < 8000) { cancelVoiceInput(); return; }
    op.stopped = true; op.send = send;
    void release(op);
    if (current(op)) setPhase('transcribing');
    if (op.ready) op.connection!.finish();
  }, [cancelVoiceInput]);
  finishRef.current = stopVoiceInput;
  failRef.current = () => {
    const op = active.current;
    if (!op) return;
    op.failure = true; op.connection?.cancel(); op.stopped = true;
    void release(op);
  };
  const startVoiceInput = useCallback(async (retry = false) => {
    if (active.current || latest.current.enabled === false) return;
    const retained = retry && saved.current?.scope === latest.current.scope ? saved.current : null;
    saved.current = null;
    const op: Attempt = { scope: latest.current.scope, draft: latest.current.input, chunks: retained?.chunks ?? [], bytes: retained?.bytes ?? 0,
      sent: 0, pcm: new SpeechPcm(), cancelled: false, stopped: Boolean(retained), send: false, ready: false, starting: false, captured: false };
    active.current = op;
    observedStreaming.current = false;
    setPhase('authorizing'); meter.current = createSpeechLevelState();
    latest.current.composerRef.current?.blur();
    analyticsEvents.chatVoiceInputTapped({ action: 'start', has_existing_text: Boolean(op.draft.trim()), locale: 'system', source: 'chat_composer' });
    try {
      if (!speechServiceUrl) throw Error('speech_unavailable');
      if (!retained) {
      const existing = await getRecordingPermissionsAsync();
      if (!current(op)) return;
      const permission = existing.granted ? existing : await requestRecordingPermissionsAsync();
      if (!current(op)) return;
      if (!permission.granted) throw Error('speech_permission');
      op.starting = true; op.captured = true;
      op.nativeStart = Promise.resolve().then(() => streamRef.current.start());
      try { await op.nativeStart; } finally { op.starting = false; }
      if (!current(op)) return;
      setPhase('listening'); triggerLightImpact();
      op.timer = setTimeout(() => stopVoiceInput(false), 120000);
      } else setPhase('transcribing');
      if (op.failure) throw Error('speech_capture_failed');
      // Local capture starts first. Buffers preserve the first word during connection setup.
      op.connection = await connectSpeech();
      if (!current(op)) { op.connection.cancel(); return; }
      await op.connection.ready;
      if (op.failure) throw Error('speech_capture_failed');
      while (op.sent < op.chunks.length && current(op)) {
        op.connection.audio(op.chunks[op.sent++]);
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
      }
      if (!current(op)) return;
      op.ready = true;
      if (op.stopped) op.connection.finish();
      const text = await op.connection.result;
      if (!current(op)) return;
      if (!text) throw Error('speech_no_speech');
      const joined = [op.draft.trimEnd(), text].filter(Boolean).join(' ');
      latest.current.setInput(joined);
      if (op.send) latest.current.onSubmit?.(joined);
    } catch (error) {
      if (current(op)) {
        const code = error instanceof Error ? error.message : 'speech_failed';
        analyticsEvents.chatVoiceInputFailed({ code: ['speech_permission', 'speech_no_speech', 'speech_unavailable'].includes(code) ? code : 'speech_failed', stage: 'recognition' });
        const t = latest.current.t;
        const message = code === 'speech_permission' ? t('Microphone access is required to transcribe speech.', { ns: 'chat' })
          : code === 'speech_no_speech' ? t('No speech detected. Please try again.', { ns: 'chat' })
          : t('Unable to transcribe speech right now.', { ns: 'chat' });
        const retryable = op.bytes >= 8000 && code !== 'speech_permission' && code !== 'speech_no_speech';
        if (retryable) saved.current = { scope: op.scope, draft: op.draft, chunks: op.chunks, bytes: op.bytes };
        Alert.alert(t('Voice input failed', { ns: 'chat' }), message,
          code === 'speech_permission' ? [{ text: t('Cancel', { ns: 'common' }), style: 'cancel' },
            { text: t('Settings', { ns: 'common' }), onPress: () => { void Linking.openSettings(); } }] : retryable ? [{ text: t('Cancel', { ns: 'common' }), style: 'cancel', onPress: () => { saved.current = null; } },
            { text: t('Retry', { ns: 'common' }), onPress: () => { if (saved.current?.scope === latest.current.scope) void startVoiceInput(true); } }] : undefined);
      }
    } finally {
      op.connection?.cancel();
      await release(op);
      op.chunks = [];
      if (active.current === op) {
        active.current = null;
        if (mounted.current) setPhase('idle');
      }
    }
  }, [stopVoiceInput]);
  useEffect(() => {
    mounted.current = true;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') { if (active.current) active.current.send = false; stopVoiceInput(false); }
    });
    return () => { mounted.current = false; cancelVoiceInput(); sub.remove(); };
  }, [cancelVoiceInput, stopVoiceInput]);
  useEffect(() => {
    if (isStreaming) observedStreaming.current = true;
    // Native status events may arrive after start() resolves. The initial false is not an interruption.
    if (isStreaming === false && observedStreaming.current && voiceInputState === 'listening') stopVoiceInput(false);
  }, [isStreaming, voiceInputState, stopVoiceInput]);
  useEffect(() => { cancelVoiceInput(); }, [options.scope, options.enabled, cancelVoiceInput]);
  return {
    startVoiceInput: () => startVoiceInput(false), stopVoiceInput, cancelVoiceInput,
    toggleVoiceInput: () => { if (active.current) stopVoiceInput(false); else void startVoiceInput(); },
    voiceInputActive: voiceInputState !== 'idle', voiceInputDisabled: options.enabled === false,
    voiceInputLevel, voiceInputState, voiceInputSupported: Boolean(speechServiceUrl) && (Platform.OS === 'ios' || Platform.OS === 'android'),
  };
}
