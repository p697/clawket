import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
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
import { createSpeechLevelState, processSpeechLevel } from '../services/speech/speechLevel';
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
  // Microphone level arrives ~20 times per second; a shared value keeps that
  // off the React render path so only the composer halo reacts to it.
  const voiceInputLevel = useSharedValue(0);
  const voiceInputLevelStateRef = useRef(createSpeechLevelState());
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
        voiceInputLevel.value = 0;
        voiceInputLevelStateRef.current = createSpeechLevelState();
      }
    });

    const levelSubscription = addSpeechRecognitionLevelListener(({ level }) => {
      const processed = processSpeechLevel(voiceInputLevelStateRef.current, level);
      voiceInputLevelStateRef.current = processed.state;
      voiceInputLevel.value = processed.level;
    });

    const errorSubscription = addSpeechRecognitionErrorListener(({ code, message }) => {
      analyticsEvents.chatVoiceInputFailed({ code, stage: 'recognition' });
      setVoiceInputState('idle');
      voiceInputBaseTextRef.current = '';
      voiceInputDraftStateRef.current = createSpeechDraftState();
      voiceInputLevel.value = 0;
      voiceInputLevelStateRef.current = createSpeechLevelState();
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
  }, [setInput, speechRecognitionLanguage, t, voiceInputLevel]);

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
    voiceInputLevelStateRef.current = createSpeechLevelState();
    setVoiceInputState('authorizing');

    try {
      const permissions = await requestSpeechRecognitionPermissionsAsync();
      if (!permissions.microphoneGranted) {
        analyticsEvents.chatVoiceInputFailed({ code: 'ERR_MICROPHONE_PERMISSION_DENIED', stage: 'permissions' });
        setVoiceInputState('idle');
        voiceInputBaseTextRef.current = '';
        voiceInputDraftStateRef.current = createSpeechDraftState();
        voiceInputLevel.value = 0;
        voiceInputLevelStateRef.current = createSpeechLevelState();
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
        voiceInputLevel.value = 0;
        voiceInputLevelStateRef.current = createSpeechLevelState();
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
        voiceInputLevel.value = 0;
        voiceInputLevelStateRef.current = createSpeechLevelState();
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
      voiceInputLevel.value = 0;
      voiceInputLevelStateRef.current = createSpeechLevelState();
      const message = error instanceof Error && error.message
        ? error.message
        : t('Unable to transcribe speech right now.', { ns: 'chat' });
      Alert.alert(t('Voice input failed', { ns: 'chat' }), message);
    }
  }, [composerRef, input, speechRecognitionLanguage, t, voiceInputActive, voiceInputLevel, voiceInputSupported]);

  return {
    toggleVoiceInput,
    voiceInputActive,
    voiceInputDisabled,
    voiceInputLevel,
    voiceInputState,
    voiceInputSupported,
  };
}
