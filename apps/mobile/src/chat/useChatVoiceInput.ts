import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import type { ComposerHandle } from '../components/ui/Composer';
import { analyticsEvents } from '../services/analytics/events';
import {
  addSpeechRecognitionErrorListener,
  addSpeechRecognitionLevelListener,
  addSpeechRecognitionResultListener,
  addSpeechRecognitionStateListener,
  getSpeechRecognitionAvailabilityAsync,
  isSpeechRecognitionSupported,
  requestSpeechRecognitionPermissionsAsync,
  SpeechRecognitionState,
  startSpeechRecognitionAsync,
  stopSpeechRecognitionAsync,
} from '../services/speech/speechRecognition';
import {
  applySpeechRecognitionResult,
  buildSpeechDraftText,
  composeSpeechDraft,
  createSpeechDraftState,
  resolveSpeechLocale,
} from '../services/speech/speechText';
import { SpeechRecognitionLanguage } from '../types';

type Translate = (key: string, options?: Record<string, unknown>) => string;

type Props = {
  composerRef: RefObject<ComposerHandle | null>;
  input: string;
  speechRecognitionLanguage: SpeechRecognitionLanguage;
  setInput: (value: string) => void;
  t: Translate;
};

export function useChatVoiceInput({
  composerRef,
  input,
  speechRecognitionLanguage,
  setInput,
  t,
}: Props) {
  const [voiceInputSupported, setVoiceInputSupported] = useState(false);
  const [voiceInputState, setVoiceInputState] = useState<'idle' | 'authorizing' | SpeechRecognitionState>('idle');
  const [voiceInputLevel, setVoiceInputLevel] = useState(0);
  const voiceInputBaseTextRef = useRef('');
  const voiceInputDraftStateRef = useRef(createSpeechDraftState());

  useEffect(() => {
    let cancelled = false;
    const locale = resolveSpeechLocale(speechRecognitionLanguage);

    if (!isSpeechRecognitionSupported()) {
      setVoiceInputSupported(false);
      return;
    }

    getSpeechRecognitionAvailabilityAsync(locale)
      .then((available) => {
        if (!cancelled) {
          setVoiceInputSupported(available);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVoiceInputSupported(false);
        }
      });

    const resultSubscription = addSpeechRecognitionResultListener(({ transcript, isFinal }) => {
      voiceInputDraftStateRef.current = applySpeechRecognitionResult(
        voiceInputDraftStateRef.current,
        transcript,
        isFinal,
      );
      setInput(
        composeSpeechDraft(
          voiceInputBaseTextRef.current,
          buildSpeechDraftText(voiceInputDraftStateRef.current),
        ),
      );
    });

    const stateSubscription = addSpeechRecognitionStateListener(({ state }) => {
      setVoiceInputState(state);
      if (state === 'idle') {
        voiceInputBaseTextRef.current = '';
        voiceInputDraftStateRef.current = createSpeechDraftState();
        setVoiceInputLevel(0);
      }
    });

    const levelSubscription = addSpeechRecognitionLevelListener(({ level }) => {
      setVoiceInputLevel(level);
    });

    const errorSubscription = addSpeechRecognitionErrorListener(({ code, message }) => {
      analyticsEvents.chatVoiceInputFailed({ code, stage: 'recognition' });
      setVoiceInputState('idle');
      voiceInputBaseTextRef.current = '';
      voiceInputDraftStateRef.current = createSpeechDraftState();
      setVoiceInputLevel(0);
      Alert.alert(
        t('Voice input failed', { ns: 'chat' }),
        message || t('Unable to transcribe speech right now.', { ns: 'chat' }),
      );
    });

    return () => {
      cancelled = true;
      resultSubscription?.remove();
      stateSubscription?.remove();
      levelSubscription?.remove();
      errorSubscription?.remove();
      void stopSpeechRecognitionAsync().catch(() => {});
    };
  }, [setInput, speechRecognitionLanguage, t]);

  const voiceInputActive = voiceInputState !== 'idle';
  const voiceInputDisabled = false;

  const toggleVoiceInput = useCallback(async () => {
    const locale = resolveSpeechLocale(speechRecognitionLanguage);
    const analyticsLocale = locale ?? 'system';

    if (voiceInputActive) {
      analyticsEvents.chatVoiceInputTapped({
        action: 'stop',
        has_existing_text: input.trim().length > 0,
        locale: analyticsLocale,
        source: 'chat_composer',
      });
      try {
        await stopSpeechRecognitionAsync();
      } catch {
        // Ignore stop errors and let the native module settle.
      }
      return;
    }

    if (!voiceInputSupported) {
      analyticsEvents.chatVoiceInputFailed({ code: 'ERR_SPEECH_UNAVAILABLE', stage: 'availability' });
      Alert.alert(
        t('Voice input unavailable', { ns: 'chat' }),
        t('Speech recognition is not available on this device.', { ns: 'chat' }),
      );
      return;
    }

    analyticsEvents.chatVoiceInputTapped({
      action: 'start',
      has_existing_text: input.trim().length > 0,
      locale: analyticsLocale,
      source: 'chat_composer',
    });

    composerRef.current?.blur();
    voiceInputBaseTextRef.current = input;
    voiceInputDraftStateRef.current = createSpeechDraftState();
    setVoiceInputState('authorizing');

    try {
      const permissions = await requestSpeechRecognitionPermissionsAsync();
      if (!permissions.microphoneGranted) {
        analyticsEvents.chatVoiceInputFailed({ code: 'ERR_MICROPHONE_PERMISSION_DENIED', stage: 'permissions' });
        setVoiceInputState('idle');
        voiceInputBaseTextRef.current = '';
        voiceInputDraftStateRef.current = createSpeechDraftState();
        setVoiceInputLevel(0);
        Alert.alert(
          t('Voice input unavailable', { ns: 'chat' }),
          t('Microphone access is required to transcribe speech.', { ns: 'chat' }),
        );
        return;
      }
      if (!permissions.speechGranted) {
        analyticsEvents.chatVoiceInputFailed({ code: 'ERR_SPEECH_PERMISSION_DENIED', stage: 'permissions' });
        setVoiceInputState('idle');
        voiceInputBaseTextRef.current = '';
        voiceInputDraftStateRef.current = createSpeechDraftState();
        setVoiceInputLevel(0);
        Alert.alert(
          t('Voice input unavailable', { ns: 'chat' }),
          t('Speech recognition access is required to transcribe speech.', { ns: 'chat' }),
        );
        return;
      }

      const available = await getSpeechRecognitionAvailabilityAsync(locale);
      if (!available) {
        analyticsEvents.chatVoiceInputFailed({ code: 'ERR_SPEECH_UNAVAILABLE', stage: 'availability' });
        setVoiceInputState('idle');
        voiceInputBaseTextRef.current = '';
        voiceInputDraftStateRef.current = createSpeechDraftState();
        setVoiceInputLevel(0);
        Alert.alert(
          t('Voice input unavailable', { ns: 'chat' }),
          t('Speech recognition is not available on this device.', { ns: 'chat' }),
        );
        return;
      }

      await startSpeechRecognitionAsync(locale);
    } catch (error) {
      analyticsEvents.chatVoiceInputFailed({ code: 'ERR_SPEECH_START_FAILED', stage: 'start' });
      setVoiceInputState('idle');
      voiceInputBaseTextRef.current = '';
      voiceInputDraftStateRef.current = createSpeechDraftState();
      setVoiceInputLevel(0);
      const message = error instanceof Error && error.message
        ? error.message
        : t('Unable to transcribe speech right now.', { ns: 'chat' });
      Alert.alert(t('Voice input failed', { ns: 'chat' }), message);
    }
  }, [composerRef, input, speechRecognitionLanguage, t, voiceInputActive, voiceInputSupported]);

  return {
    toggleVoiceInput,
    voiceInputActive,
    voiceInputDisabled,
    voiceInputLevel,
    voiceInputState,
    voiceInputSupported,
  };
}
