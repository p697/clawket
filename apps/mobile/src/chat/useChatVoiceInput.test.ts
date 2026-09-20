import { act, renderHook } from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import * as Audio from 'expo-audio';
import { connectSpeech } from '../services/speech/speechStream';
import { useChatVoiceInput } from './useChatVoiceInput';
import { recordings, createRecording } from '../services/speech/__tests__/recording-store.fixture';

jest.mock('react-native-reanimated', () => {
  const { useRef } = require('react'); return { useSharedValue: (value: unknown) => useRef({ value }).current };
});
jest.mock('../services/speech/speechRecordings', () => require('../services/speech/__tests__/recording-store.fixture'));
jest.mock('../services/speech/speechStream', () => ({ speechServiceUrl: 'wss://speech.example/v1/speech', connectSpeech: jest.fn() }));
jest.mock('../services/analytics/events', () => ({ analyticsEvents: { chatVoiceInputTapped: jest.fn(), chatVoiceInputFailed: jest.fn(), chatVoiceInputTiming: jest.fn() } }));
jest.mock('../services/haptics', () => ({ triggerLightImpact: jest.fn() }));
const deferred = <T,>() => {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => {}); return { promise, resolve, reject };
};
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
describe('durable voice lifecycle', () => {
  let buffer: (value: { data: ArrayBuffer; sampleRate: number; channels: number }) => void;
  let result: ReturnType<typeof deferred<string>>, ready: ReturnType<typeof deferred<void>>;
  let start: jest.Mock, stop: jest.Mock, connection: any, background: (state: string) => void;
  beforeEach(() => {
    jest.useFakeTimers(); jest.clearAllMocks(); recordings.clear();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_name, callback) => { background = callback as (state: string) => void; return { remove: jest.fn() }; });
    start = jest.fn(async () => {}); stop = jest.fn();
    (Audio.useAudioStream as jest.Mock).mockImplementation((options: any) => { buffer = options.onBuffer; return { stream: { start, stop } }; });
    (Audio.getRecordingPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    result = deferred<string>(); ready = deferred<void>();
    connection = { ready: ready.promise, result: result.promise, audio: jest.fn(), finish: jest.fn(),
      cancel: jest.fn(() => { ready.reject(Error('speech_cancelled')); result.reject(Error('speech_cancelled')); }) };
    (connectSpeech as jest.Mock).mockResolvedValue(connection);
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
  function setup(scope = 'openclaw/main') {
    const setInput = jest.fn(), onSubmit = jest.fn();
    const hook = renderHook(({ scope, enabled }: { scope: string; enabled: boolean }) => useChatVoiceInput({
      input: 'Existing draft', setInput, onSubmit, composerRef: { current: null }, t: (key) => key, scope, enabled,
    }), { initialProps: { scope, enabled: true } });
    return { ...hook, setInput, onSubmit };
  }
  async function begin(hook: ReturnType<typeof setup>, online = true) {
    await act(async () => { hook.result.current.startVoiceInput(); await tick(); });
    expect(hook.result.current.voiceInputState).toBe('listening');
    if (online) await act(async () => { ready.resolve(); await tick(); });
  }
  function speak(seconds = 0.5) { buffer({ data: new Float32Array(16000 * seconds).fill(0.2).buffer, sampleRate: 16000, channels: 1 }); }
  async function finish(hook: ReturnType<typeof setup>, send: boolean) {
    await act(async () => { hook.result.current.stopVoiceInput(send); await jest.advanceTimersByTimeAsync(400); });
  }
  it.each(['openclaw/main', 'hermes/main'])('captures and sends exactly once for %s', async (scope) => {
    const hook = setup(scope); await begin(hook); act(() => speak()); await finish(hook, true);
    expect(connection.finish).toHaveBeenCalledTimes(1);
    await act(async () => { result.resolve('hello'); await tick(); });
    expect(hook.onSubmit).toHaveBeenCalledWith('Existing draft hello'); expect(recordings.size).toBe(0);
    expect(hook.result.current.voiceInputState).toBe('idle');
  });
  it('keeps recording after network failure and retries all audio without sending', async () => {
    const hook = setup(); await begin(hook); act(() => speak());
    await act(async () => { result.reject(Error('speech_disconnected')); await jest.advanceTimersByTimeAsync(60); });
    expect(stop).not.toHaveBeenCalled(); expect(hook.result.current.voiceRecordingSaved).toBe(true);
    act(() => speak()); await finish(hook, true);
    expect([...recordings.values()][0]!.bytes).toBe(32000);
    expect(hook.result.current.voiceRecoveryCount).toBe(1);
    const retry = (Alert.alert as jest.Mock).mock.calls.at(-1)[2].find((b: any) => b.text === 'Retry');
    const nextResult = deferred<string>();
    const replay = { ready: Promise.resolve(), result: nextResult.promise, audio: jest.fn(), finish: jest.fn(), cancel: jest.fn() };
    (connectSpeech as jest.Mock).mockResolvedValue(replay);
    await act(async () => { retry.onPress(); await jest.advanceTimersByTimeAsync(500); });
    expect(start).toHaveBeenCalledTimes(1); expect(replay.finish).toHaveBeenCalledTimes(1);
    await act(async () => { nextResult.resolve('recovered'); await tick(); });
    expect(hook.setInput).toHaveBeenCalledWith('Existing draft recovered'); expect(hook.onSubmit).not.toHaveBeenCalled();
  });
  it.each(['background', 'unmount', 'scope'])('preserves local audio after %s and suppresses late sends', async (mode) => {
    const hook = setup(); await begin(hook); act(() => speak());
    await act(async () => {
      if (mode === 'background') background('background');
      if (mode === 'unmount') hook.unmount();
      if (mode === 'scope') hook.rerender({ scope: 'hermes/main', enabled: true });
      await tick(); await jest.advanceTimersByTimeAsync(100);
    });
    expect(recordings.size).toBe(1); expect(hook.onSubmit).not.toHaveBeenCalled(); expect(stop).toHaveBeenCalledTimes(1);
    const reopened = setup(); await act(tick);
    expect(reopened.result.current.voiceRecoveryCount).toBe(1);
  });
  it('explicit cancel removes only this attempt and a delayed connection cannot stop its replacement', async () => {
    const pending = deferred<any>(); (connectSpeech as jest.Mock).mockReturnValueOnce(pending.promise);
    const hook = setup(); await begin(hook, false); act(() => speak());
    await act(async () => { hook.result.current.cancelVoiceInput(); await tick(); });
    expect(recordings.size).toBe(0);
    await begin(hook); const stopped = stop.mock.calls.length;
    await act(async () => { pending.resolve({ ...connection, cancel: jest.fn() }); await tick(); });
    expect(stop).toHaveBeenCalledTimes(stopped); expect(hook.result.current.voiceInputState).toBe('listening');
  });
  it('pending saved audio is never overwritten by another microphone tap', async () => {
    const saved = createRecording('openclaw/main', 'old'); saved.append(new Uint8Array(16000));
    const hook = setup(); await act(async () => { hook.result.current.startVoiceInput(); await tick(); });
    expect(start).not.toHaveBeenCalled(); expect(recordings.size).toBe(1);
    expect(Alert.alert).toHaveBeenCalledWith('Saved recording', expect.any(String), expect.any(Array));
  });
  it('permission preflight never prompts and cancellation ignores a late permission response', async () => {
    const permission = deferred<any>(); (Audio.getRecordingPermissionsAsync as jest.Mock).mockReturnValue(permission.promise);
    const hook = setup();
    await act(async () => { hook.result.current.startVoiceInput(); hook.result.current.cancelVoiceInput(); permission.resolve({ granted: false }); await tick(); });
    expect(Audio.requestRecordingPermissionsAsync).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
  });
  it('survives storage write failure with earlier audio retained', async () => {
    const hook = setup(); await begin(hook); act(() => speak());
    const record = [...recordings.values()][0]!; record.append = () => { throw Error('speech_storage'); };
    await act(async () => { speak(); await jest.advanceTimersByTimeAsync(60); await tick(); });
    expect(record.bytes).toBe(16000); expect(stop).toHaveBeenCalled(); expect(hook.onSubmit).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('Voice input failed', expect.stringContaining('speech_storage'), expect.any(Array));
  });
});
