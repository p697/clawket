import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useChatVoiceInput } from './useChatVoiceInput';
import { analyticsEvents } from '../services/analytics/events';
import * as speechRecognition from '../services/speech/speechRecognition';

// The global reanimated mock recreates shared values on every render; the hook
// relies on the real hook's stable identity, so mirror that here.
jest.mock('react-native-reanimated', () => {
  const { useRef } = require('react');
  return { useSharedValue: <T,>(initial: T) => useRef({ value: initial }).current };
});

jest.mock('../services/analytics/events', () => ({
  analyticsEvents: {
    chatVoiceInputFailed: jest.fn(),
    chatVoiceInputTapped: jest.fn(),
  },
}));

jest.mock('../services/speech/speechRecognition', () => ({
  addSpeechRecognitionErrorListener: jest.fn(() => ({ remove: jest.fn() })),
  addSpeechRecognitionLevelListener: jest.fn(() => ({ remove: jest.fn() })),
  addSpeechRecognitionResultListener: jest.fn(() => ({ remove: jest.fn() })),
  addSpeechRecognitionStateListener: jest.fn(() => ({ remove: jest.fn() })),
  getSpeechRecognitionAvailabilityAsync: jest.fn(() => Promise.resolve(false)),
  isSpeechRecognitionSupported: jest.fn(() => false),
  requestSpeechRecognitionPermissionsAsync: jest.fn(),
  startSpeechRecognitionAsync: jest.fn(),
  stopSpeechRecognitionAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('../services/speech/speechText', () => ({
  applySpeechRecognitionResult: jest.fn(),
  buildSpeechDraftText: jest.fn(),
  composeSpeechDraft: jest.fn(),
  createSpeechDraftState: jest.fn(() => ({})),
  resolveSpeechLocale: jest.fn(() => 'en-US'),
}));

describe('useChatVoiceInput', () => {
  let consoleErrorSpy: jest.SpyInstance;
  const mockedSpeech = speechRecognition as jest.Mocked<typeof speechRecognition>;
  const mockedAnalytics = analyticsEvents as jest.Mocked<typeof analyticsEvents>;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) {
        return;
      }
    });
    jest.clearAllMocks();
    mockedSpeech.isSpeechRecognitionSupported.mockReturnValue(false);
    mockedSpeech.getSpeechRecognitionAvailabilityAsync.mockResolvedValue(false);
    mockedSpeech.requestSpeechRecognitionPermissionsAsync.mockResolvedValue({
      microphoneGranted: true,
      speechGranted: true,
    });
    mockedSpeech.startSpeechRecognitionAsync.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('keeps voice input enabled independently of sending state', () => {
    const { result } = renderHook(() =>
      useChatVoiceInput({
        composerRef: { current: null },
        input: '',
        speechRecognitionLanguage: 'en',
        setInput: jest.fn(),
        t: (key: string) => key,
      }),
    );

    expect(result.current.voiceInputDisabled).toBe(false);
  });

  it('shows unavailable alert when speech is unsupported', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    const { result } = renderHook(() =>
      useChatVoiceInput({
        composerRef: { current: null },
        input: 'hello',
        speechRecognitionLanguage: 'en',
        setInput: jest.fn(),
        t: (key: string) => key,
      }),
    );

    await act(async () => {
      await result.current.toggleVoiceInput();
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Voice input unavailable',
      'Speech recognition is not available on this device.',
    );
    alertSpy.mockRestore();
  });

  it('shows microphone permission alert when microphone permission is denied', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    mockedSpeech.isSpeechRecognitionSupported.mockReturnValue(true);
    mockedSpeech.getSpeechRecognitionAvailabilityAsync.mockResolvedValue(true);
    mockedSpeech.requestSpeechRecognitionPermissionsAsync.mockResolvedValue({
      microphoneGranted: false,
      speechGranted: true,
    });

    const { result } = renderHook(() =>
      useChatVoiceInput({
        composerRef: { current: { blur: jest.fn() } as any },
        input: 'hello',
        speechRecognitionLanguage: 'en',
        setInput: jest.fn(),
        t: (key: string) => key,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.toggleVoiceInput();
    });

    expect(mockedAnalytics.chatVoiceInputFailed).toHaveBeenCalledWith({
      code: 'ERR_MICROPHONE_PERMISSION_DENIED',
      stage: 'permissions',
    });
    expect(alertSpy).toHaveBeenCalledWith(
      'Voice input unavailable',
      'Microphone access is required to transcribe speech.',
    );
    alertSpy.mockRestore();
  });

  it('shows speech permission alert when speech permission is denied', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    mockedSpeech.isSpeechRecognitionSupported.mockReturnValue(true);
    mockedSpeech.getSpeechRecognitionAvailabilityAsync.mockResolvedValue(true);
    mockedSpeech.requestSpeechRecognitionPermissionsAsync.mockResolvedValue({
      microphoneGranted: true,
      speechGranted: false,
    });

    const { result } = renderHook(() =>
      useChatVoiceInput({
        composerRef: { current: { blur: jest.fn() } as any },
        input: 'hello',
        speechRecognitionLanguage: 'en',
        setInput: jest.fn(),
        t: (key: string) => key,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.toggleVoiceInput();
    });

    expect(mockedAnalytics.chatVoiceInputFailed).toHaveBeenCalledWith({
      code: 'ERR_SPEECH_PERMISSION_DENIED',
      stage: 'permissions',
    });
    expect(alertSpy).toHaveBeenCalledWith(
      'Voice input unavailable',
      'Speech recognition access is required to transcribe speech.',
    );
    alertSpy.mockRestore();
  });

  it('shows start failed alert when start throws', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    mockedSpeech.isSpeechRecognitionSupported.mockReturnValue(true);
    mockedSpeech.getSpeechRecognitionAvailabilityAsync.mockResolvedValue(true);
    mockedSpeech.requestSpeechRecognitionPermissionsAsync.mockResolvedValue({
      microphoneGranted: true,
      speechGranted: true,
    });
    mockedSpeech.startSpeechRecognitionAsync.mockRejectedValue(new Error('native boom'));

    const { result } = renderHook(() =>
      useChatVoiceInput({
        composerRef: { current: { blur: jest.fn() } as any },
        input: 'hello',
        speechRecognitionLanguage: 'en',
        setInput: jest.fn(),
        t: (key: string) => key,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.toggleVoiceInput();
    });

    expect(mockedAnalytics.chatVoiceInputFailed).toHaveBeenCalledWith({
      code: 'ERR_SPEECH_START_FAILED',
      stage: 'start',
    });
    expect(alertSpy).toHaveBeenCalledWith('Voice input failed', 'native boom');
    alertSpy.mockRestore();
  });

  it('passes null to the native layer when set to automatic system language', async () => {
    const speechText = jest.requireMock('../services/speech/speechText') as {
      resolveSpeechLocale: jest.Mock;
    };
    speechText.resolveSpeechLocale.mockReturnValue(null);
    mockedSpeech.isSpeechRecognitionSupported.mockReturnValue(true);
    mockedSpeech.getSpeechRecognitionAvailabilityAsync.mockResolvedValue(true);
    mockedSpeech.requestSpeechRecognitionPermissionsAsync.mockResolvedValue({
      microphoneGranted: true,
      speechGranted: true,
    });

    const { result } = renderHook(() =>
      useChatVoiceInput({
        composerRef: { current: { blur: jest.fn() } as any },
        input: '',
        speechRecognitionLanguage: 'system',
        setInput: jest.fn(),
        t: (key: string) => key,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.toggleVoiceInput();
    });

    expect(mockedSpeech.getSpeechRecognitionAvailabilityAsync).toHaveBeenCalledWith(null);
    expect(mockedSpeech.startSpeechRecognitionAsync).toHaveBeenCalledWith(null);
    expect(mockedAnalytics.chatVoiceInputTapped).toHaveBeenCalledWith({
      action: 'start',
      has_existing_text: false,
      locale: 'system',
      source: 'chat_composer',
    });
  });

  it('streams the microphone level through a shared value and resets it when recognition ends', async () => {
    mockedSpeech.isSpeechRecognitionSupported.mockReturnValue(true);
    mockedSpeech.getSpeechRecognitionAvailabilityAsync.mockResolvedValue(true);
    let levelListener: ((event: { level: number }) => void) | undefined;
    let stateListener: ((event: { state: 'idle' | 'listening' }) => void) | undefined;
    mockedSpeech.addSpeechRecognitionLevelListener.mockImplementation((listener) => {
      levelListener = listener;
      return { remove: jest.fn() };
    });
    mockedSpeech.addSpeechRecognitionStateListener.mockImplementation((listener) => {
      stateListener = listener;
      return { remove: jest.fn() };
    });

    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useChatVoiceInput({
        composerRef: { current: { blur: jest.fn() } as any },
        input: '',
        speechRecognitionLanguage: 'en',
        setInput: jest.fn(),
        t: (key: string) => key,
      });
    });
    await act(async () => {
      await Promise.resolve();
    });
    const level = result.current.voiceInputLevel;

    act(() => stateListener?.({ state: 'listening' }));
    expect(result.current.voiceInputState).toBe('listening');
    expect(result.current.voiceInputActive).toBe(true);

    const rendersBeforeLevel = renders;
    // A quiet room settles the adaptive floor; speech then fills the meter.
    for (let index = 0; index < 10; index += 1) {
      act(() => levelListener?.({ level: 0.005 }));
    }
    expect(level.value).toBeLessThan(0.05);
    act(() => levelListener?.({ level: 0.3 }));
    act(() => levelListener?.({ level: 0.3 }));
    // Level samples write into the same shared value instead of producing React state.
    expect(result.current.voiceInputLevel).toBe(level);
    expect(level.value).toBeGreaterThan(0.7);
    expect(level.value).toBeLessThanOrEqual(1);
    expect(renders).toBe(rendersBeforeLevel);

    act(() => stateListener?.({ state: 'idle' }));
    expect(result.current.voiceInputState).toBe('idle');
    expect(level.value).toBe(0);
  });
});
