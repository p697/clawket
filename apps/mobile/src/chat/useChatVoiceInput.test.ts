import { act, renderHook } from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import * as Audio from 'expo-audio';
import { connectSpeech } from '../services/speech/speechStream';
import { useChatVoiceInput } from './useChatVoiceInput';
import { recordings, createRecording } from '../services/speech/__tests__/recording-store.fixture';
import { SpeechError } from '../services/speech/speechErrors';
import { voiceCapture } from '../services/speech/voiceCapture';
import { analyticsEvents } from '../services/analytics/events';

jest.mock('react-native-reanimated', () => {
  const { useRef } = require('react'); return { useSharedValue: (value: unknown) => useRef({ value }).current };
});
jest.mock('../services/speech/speechRecordings', () => require('../services/speech/__tests__/recording-store.fixture'));
jest.mock('../services/speech/speechStream', () => ({ speechServiceUrl: 'wss://speech.example/v1/speech', connectSpeech: jest.fn() }));
jest.mock('../services/analytics/events', () => ({ analyticsEvents: { chatVoiceInputTapped: jest.fn(), chatVoiceInputFailed: jest.fn(), chatVoiceInputTiming: jest.fn() } }));
jest.mock('../services/haptics', () => ({ triggerLightImpact: jest.fn() }));
jest.mock('../services/speech/voiceCapture', () => {
  const listeners = { buffer: new Set<(event: any) => void>(), status: new Set<(event: any) => void>() };
  const subscribe = (set: Set<(event: any) => void>) => (listener: (event: any) => void) => {
    set.add(listener); return { remove: () => { set.delete(listener); } };
  };
  return { voiceCaptureAvailable: true, mockListeners: listeners,
    mockSubscribe: { buffer: subscribe(listeners.buffer), status: subscribe(listeners.status) },
    voiceCapture: { start: jest.fn(), stop: jest.fn(), hold: jest.fn(), onBuffer: jest.fn(), onStatus: jest.fn() } };
});
const captureMock = jest.requireMock('../services/speech/voiceCapture') as {
  mockListeners: { buffer: Set<(event: any) => void>; status: Set<(event: any) => void> };
  mockSubscribe: { buffer: (listener: (event: any) => void) => unknown; status: (listener: (event: any) => void) => unknown };
};
const captureListeners = captureMock.mockListeners;
const timing = { queueMs: 2, activateMs: 0, engineMs: 1, startMs: 90, warm: true, inputRoute: 'built_in', bluetooth: false, otherAudio: false };
const deferred = <T,>() => {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => {}); return { promise, resolve, reject };
};
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
describe('durable voice lifecycle', () => {
  let result: ReturnType<typeof deferred<string>>, ready: ReturnType<typeof deferred<void>>;
  let start: jest.Mock, stop: jest.Mock, hold: jest.Mock, released: jest.Mock, connection: any, background: (state: string) => void;
  beforeEach(() => {
    jest.useFakeTimers(); jest.clearAllMocks(); recordings.clear();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_name, callback) => { background = callback as (state: string) => void; return { remove: jest.fn() }; });
    start = voiceCapture.start as jest.Mock; stop = voiceCapture.stop as jest.Mock; hold = voiceCapture.hold as jest.Mock;
    released = jest.fn(); start.mockImplementation(async () => timing); stop.mockImplementation(async () => {}); hold.mockImplementation(() => released);
    (voiceCapture.onBuffer as jest.Mock).mockImplementation(captureMock.mockSubscribe.buffer);
    (voiceCapture.onStatus as jest.Mock).mockImplementation(captureMock.mockSubscribe.status);
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
  function emit(event: object, kind: 'buffer' | 'status' = 'buffer') { for (const listener of [...captureListeners[kind]]) listener(event); }
  function speak(seconds = 0.5, captureId = start.mock.calls.at(-1)?.[0]) {
    emit({ captureId, data: new Float32Array(16000 * seconds).fill(0.2).buffer, sampleRate: 16000, channels: 1 });
  }
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
  it.each(['openclaw/main', 'hermes/main'])('recovers brief busy admission while preserving recording for %s', async scope => {
    const hook = setup(scope); await begin(hook, false); act(() => speak());
    const nextResult = deferred<string>();
    const replay = { ready: Promise.resolve(), result: nextResult.promise, audio: jest.fn(), finish: jest.fn(), cancel: jest.fn() };
    (connectSpeech as jest.Mock).mockResolvedValue(replay);
    await act(async () => {
      const error = new SpeechError('speech_busy', '', 123000); ready.reject(error); result.reject(error);
      await jest.advanceTimersByTimeAsync(700);
    });
    expect(hook.result.current.voiceInputState).toBe('listening');
    expect(stop).not.toHaveBeenCalled(); expect(Alert.alert).not.toHaveBeenCalled();
    act(() => speak()); await finish(hook, false);
    expect(replay.finish).toHaveBeenCalledTimes(1);
    await act(async () => { nextResult.resolve('recovered'); await tick(); });
    expect(hook.setInput).toHaveBeenCalledWith('Existing draft recovered');
    expect(hook.onSubmit).not.toHaveBeenCalled(); expect(recordings.size).toBe(0);
  });
  it('does not show an expired cooldown when the user finishes a long local recording', async () => {
    const hook = setup(); await begin(hook, false); act(() => speak());
    await act(async () => {
      const error = new SpeechError('speech_busy', '', 123000); ready.reject(error); result.reject(error);
      await jest.advanceTimersByTimeAsync(130000);
    });
    await finish(hook, false);
    const detail = (Alert.alert as jest.Mock).mock.calls.at(-1)[1];
    expect(detail).toContain('speech_busy'); expect(detail).not.toContain('Try again in');
    expect(recordings.size).toBe(1); expect(hook.onSubmit).not.toHaveBeenCalled();
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
  it('shows listening on the press itself and reports native start timing', async () => {
    const native = deferred<typeof timing>(); start.mockReturnValueOnce(native.promise);
    const hook = setup(); await act(tick);
    act(() => { hook.result.current.startVoiceInput(); });
    expect(hook.result.current.voiceInputState).toBe('listening');
    await act(tick);
    expect(start).toHaveBeenCalledWith(expect.stringMatching(/^voice-/), expect.any(Number));
    await act(async () => { native.resolve(timing); await tick(); });
    expect(analyticsEvents.chatVoiceInputTiming).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'native_started', queue_ms: 2, start_ms: 90, warm: true, input_route: 'built_in', bluetooth: false, other_audio: false,
    }));
  });
  it('keeps only audio from its own capture', async () => {
    const hook = setup(); await begin(hook);
    act(() => { speak(0.5, 'voice-another-capture'); speak(0.25); });
    expect([...recordings.values()][0]!.bytes).toBe(8000);
    await act(async () => { hook.result.current.cancelVoiceInput(); await tick(); });
  });
  it('a native interruption ends capture but transcribes what was recorded', async () => {
    const hook = setup(); await begin(hook); act(() => speak());
    await act(async () => { emit({ captureId: start.mock.calls.at(-1)?.[0], reason: 'interrupted' }, 'status'); await jest.advanceTimersByTimeAsync(400); });
    expect(hook.result.current.voiceInputState).toBe('transcribing');
    expect(stop).toHaveBeenCalledTimes(1); expect(connection.finish).toHaveBeenCalledTimes(1);
    await act(async () => { result.resolve('kept'); await tick(); });
    expect(hook.setInput).toHaveBeenCalledWith('Existing draft kept'); expect(hook.onSubmit).not.toHaveBeenCalled();
  });
  it('keeps the recorder warm only while the chat is focused and foregrounded', async () => {
    const hook = setup(); await act(tick);
    expect(hold).toHaveBeenCalledTimes(1); expect(released).not.toHaveBeenCalled();
    await act(async () => { hook.rerender({ scope: 'openclaw/main', enabled: false }); await tick(); });
    expect(released).toHaveBeenCalledTimes(1);
    await act(async () => { hook.rerender({ scope: 'openclaw/main', enabled: true }); await tick(); });
    expect(hold).toHaveBeenCalledTimes(2);
    await act(async () => { background('background'); await tick(); });
    expect(released).toHaveBeenCalledTimes(2);
  });
});
