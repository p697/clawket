import { act, renderHook } from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import * as Audio from 'expo-audio';
import { connectSpeech } from '../services/speech/speechStream';
import { useChatVoiceInput } from './useChatVoiceInput';

jest.mock('react-native-reanimated', () => {
  const { useRef } = require('react');
  return { useSharedValue: <T,>(value: T) => useRef({ value }).current };
});
jest.mock('../services/speech/speechStream', () => ({ speechServiceUrl: 'wss://speech.example/v1/speech', connectSpeech: jest.fn() }));
jest.mock('../services/analytics/events', () => ({ analyticsEvents: { chatVoiceInputTapped: jest.fn(), chatVoiceInputFailed: jest.fn() } }));
jest.mock('../services/haptics', () => ({ triggerLightImpact: jest.fn() }));
const deferred = <T,>() => {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe('cloud voice lifecycle', () => {
  let buffer: (value: { data: ArrayBuffer; sampleRate: number; channels: number }) => void;
  let result: ReturnType<typeof deferred<string>>;
  let ready: ReturnType<typeof deferred<void>>;
  let start: jest.Mock, stop: jest.Mock;
  let connection: { ready: Promise<void>; result: Promise<string>; audio: jest.Mock; finish: jest.Mock; cancel: jest.Mock };
  let background: (state: string) => void;
  beforeEach(() => {
    jest.useFakeTimers(); jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_name, callback) => {
      background = callback as (state: string) => void; return { remove: jest.fn() };
    });
    start = jest.fn(async () => {}); stop = jest.fn();
    (Audio.useAudioStream as jest.Mock).mockImplementation((options: any) => { buffer = options.onBuffer; return { stream: { start, stop } } as any; });
    (Audio.getRecordingPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    result = deferred<string>(); ready = deferred<void>();
    connection = { ready: ready.promise, result: result.promise, audio: jest.fn(), finish: jest.fn(),
      cancel: jest.fn(() => { ready.reject(Error('cancelled')); result.reject(Error('cancelled')); }) };
    void ready.promise.catch(() => {}); void result.promise.catch(() => {});
    (connectSpeech as jest.Mock).mockResolvedValue(connection);
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
  function setup() {
    const setInput = jest.fn(), onSubmit = jest.fn();
    const hook = renderHook(({ scope, enabled }: { scope: string; enabled: boolean }) => useChatVoiceInput({
      input: 'Existing draft', setInput, onSubmit, composerRef: { current: null }, t: (key) => key, scope, enabled,
    }), { initialProps: { scope: 'openclaw/main', enabled: true } });
    return { ...hook, setInput, onSubmit };
  }
  async function begin(hook: ReturnType<typeof setup>, providerReady = true) {
    await act(async () => { void hook.result.current.startVoiceInput(); await tick(); });
    expect(hook.result.current.voiceInputState).toBe('listening');
    if (providerReady) await act(async () => { ready.resolve(); await tick(); });
  }
  function speak() { buffer({ data: new Float32Array(8000).fill(0.2).buffer, sampleRate: 16000, channels: 1 }); }
  it.each(['openclaw/main', 'hermes/main'])('release sends one completed transcript through the same callback for %s', async (scope) => {
    const hook = setup(); hook.rerender({ scope, enabled: true });
    await begin(hook);
    await act(async () => { speak(); hook.result.current.stopVoiceInput(true); result.resolve('Hello world'); await tick(); });
    expect(hook.onSubmit).toHaveBeenCalledTimes(1);
    expect(hook.onSubmit).toHaveBeenCalledWith('Existing draft Hello world');
    expect(stop).toHaveBeenCalled(); expect(hook.result.current.voiceInputState).toBe('idle');
  });
  it('tap stop fills the draft without sending', async () => {
    const hook = setup(); await begin(hook);
    await act(async () => { speak(); hook.result.current.stopVoiceInput(false); result.resolve('editable text'); await tick(); });
    expect(hook.setInput).toHaveBeenCalledWith('Existing draft editable text'); expect(hook.onSubmit).not.toHaveBeenCalled();
  });
  it('waits for native streaming status and only stops on a real interruption', async () => {
    let streaming = false;
    (Audio.useAudioStream as jest.Mock).mockImplementation((options: any) => {
      buffer = options.onBuffer; return { stream: { start, stop }, isStreaming: streaming };
    });
    const hook = setup(); await begin(hook);
    expect(stop).not.toHaveBeenCalled();
    streaming = true; hook.rerender({ scope: 'openclaw/main', enabled: true }); act(speak);
    streaming = false; hook.rerender({ scope: 'openclaw/main', enabled: true });
    expect(connection.finish).toHaveBeenCalledTimes(1);
    await act(async () => { result.resolve('interrupted draft'); await tick(); });
    expect(hook.setInput).toHaveBeenCalledWith('Existing draft interrupted draft'); expect(hook.onSubmit).not.toHaveBeenCalled();
  });
  it('captures the first word before provider readiness and drains it before finish', async () => {
    const hook = setup(); await begin(hook, false);
    act(() => { speak(); hook.result.current.stopVoiceInput(true); });
    expect(connection.audio).not.toHaveBeenCalled();
    await act(async () => { ready.resolve(); await tick(); await jest.advanceTimersByTimeAsync(25); });
    expect(connection.audio).toHaveBeenCalledTimes(1); expect(connection.finish).toHaveBeenCalledTimes(1);
    await act(async () => { result.resolve('first word'); await tick(); });
    expect(hook.onSubmit).toHaveBeenCalledWith('Existing draft first word');
  });
  it('release while permission is pending cancels without opening capture', async () => {
    const permission = deferred<{ granted: boolean }>();
    (Audio.getRecordingPermissionsAsync as jest.Mock).mockReturnValue(permission.promise);
    const hook = setup();
    act(() => { void hook.result.current.startVoiceInput(); hook.result.current.stopVoiceInput(true); });
    await act(async () => { permission.resolve({ granted: true }); await tick(); });
    expect(start).not.toHaveBeenCalled(); expect(connectSpeech).not.toHaveBeenCalled();
  });
  it('cancel before permission inspection completes does not open a late system prompt', async () => {
    const permission = deferred<{ granted: boolean }>();
    (Audio.getRecordingPermissionsAsync as jest.Mock).mockReturnValue(permission.promise);
    const hook = setup();
    act(() => { void hook.result.current.startVoiceInput(); hook.result.current.cancelVoiceInput(); });
    await act(async () => { permission.resolve({ granted: false }); await tick(); });
    expect(Audio.requestRecordingPermissionsAsync).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
  });
  it('waits for native start before restoring audio when cancelled', async () => {
    const native = deferred<void>(); start.mockReturnValue(native.promise);
    const hook = setup();
    await act(async () => { void hook.result.current.startVoiceInput(); await tick(); hook.result.current.cancelVoiceInput(); });
    expect(Audio.setAudioModeAsync).not.toHaveBeenCalled();
    await act(async () => { native.resolve(); await tick(); });
    expect(stop).toHaveBeenCalledTimes(1); expect(Audio.setAudioModeAsync).toHaveBeenCalledTimes(1);
    expect(connectSpeech).not.toHaveBeenCalled();
  });
  it('cancel frees capture without waiting for an old connection; late cleanup cannot stop the next recording', async () => {
    const pendingConnection = deferred<typeof connection>();
    (connectSpeech as jest.Mock).mockReturnValueOnce(pendingConnection.promise);
    const hook = setup(); await begin(hook, false);
    await act(async () => { hook.result.current.cancelVoiceInput(); await tick(); });
    expect(hook.result.current.voiceInputState).toBe('idle');
    const nextReady = deferred<void>(), nextResult = deferred<string>();
    void nextResult.promise.catch(() => {}); void nextReady.promise.catch(() => {});
    const next = { ready: nextReady.promise, result: nextResult.promise, audio: jest.fn(), finish: jest.fn(),
      cancel: jest.fn(() => { nextReady.reject(Error('cancelled')); nextResult.reject(Error('cancelled')); }) };
    (connectSpeech as jest.Mock).mockResolvedValueOnce(next);
    await begin(hook, false);
    expect(start).toHaveBeenCalledTimes(2);
    const stopped = stop.mock.calls.length;
    await act(async () => { pendingConnection.resolve(connection); await tick(); });
    expect(connection.cancel).toHaveBeenCalled(); expect(stop).toHaveBeenCalledTimes(stopped);
    expect(hook.result.current.voiceInputState).toBe('listening');
    await act(async () => { nextReady.resolve(); await tick(); speak(); hook.result.current.stopVoiceInput(true); nextResult.resolve('new recording'); await tick(); });
    expect(hook.onSubmit).toHaveBeenCalledWith('Existing draft new recording');
  });
  it('cancel while identity is pending allows repeated starts without an invisible busy slot', async () => {
    const pending = deferred<typeof connection>();
    (connectSpeech as jest.Mock).mockReturnValue(pending.promise);
    const hook = setup();
    for (let i = 0; i < 4; i++) {
      await begin(hook, false);
      await act(async () => { hook.result.current.cancelVoiceInput(); await tick(); });
      expect(hook.result.current.voiceInputState).toBe('idle');
    }
    expect(start).toHaveBeenCalledTimes(4);
    await act(async () => { pending.resolve(connection); await tick(); });
    expect(hook.onSubmit).not.toHaveBeenCalled();
  });
  it.each(['hermes/other', 'openclaw/other'])('rejects late text after scope changes to %s', async (scope) => {
    const hook = setup(); await begin(hook); act(speak);
    hook.rerender({ scope, enabled: true });
    await act(async () => { result.resolve('late'); await tick(); });
    expect(hook.setInput).not.toHaveBeenCalled(); expect(hook.onSubmit).not.toHaveBeenCalled();
  });
  it('backgrounding during finalization prevents release-to-send', async () => {
    const hook = setup(); await begin(hook);
    await act(async () => { speak(); hook.result.current.stopVoiceInput(true); background('background'); result.resolve('saved'); await tick(); });
    expect(hook.onSubmit).not.toHaveBeenCalled(); expect(hook.setInput).toHaveBeenCalledWith('Existing draft saved');
  });
  it('silence never sends the existing draft', async () => {
    const hook = setup(); await begin(hook);
    await act(async () => { speak(); hook.result.current.stopVoiceInput(true); result.resolve(''); await tick(); });
    expect(hook.onSubmit).not.toHaveBeenCalled(); expect(hook.setInput).not.toHaveBeenCalled();
  });
  it('denied microphone permission never contacts the provider', async () => {
    (Audio.getRecordingPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
    (Audio.requestRecordingPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
    const hook = setup(); await act(async () => { await hook.result.current.startVoiceInput(); });
    expect(connectSpeech).not.toHaveBeenCalled(); expect(Alert.alert).toHaveBeenCalled();
  });
  it('limits recording to two minutes and returns a draft', async () => {
    const hook = setup(); await begin(hook); act(speak);
    await act(async () => { await jest.advanceTimersByTimeAsync(120000); result.resolve('bounded'); await tick(); });
    expect(connection.finish).toHaveBeenCalled(); expect(hook.onSubmit).not.toHaveBeenCalled();
  });
  it('unmount closes capture and ignores provider completion', async () => {
    const hook = setup(); await begin(hook); act(speak); hook.unmount();
    await act(async () => { result.resolve('late'); await tick(); });
    expect(connection.cancel).toHaveBeenCalled(); expect(stop).toHaveBeenCalled(); expect(hook.onSubmit).not.toHaveBeenCalled();
  });
  it('explicit retry replays retained audio once into the draft without recording or sending again', async () => {
    const hook = setup(); await begin(hook);
    await act(async () => { speak(); hook.result.current.stopVoiceInput(true); result.reject(Error('speech_disconnected')); await tick(); });
    const retry = (Alert.alert as jest.Mock).mock.calls.at(-1)[2].find((button: { text: string }) => button.text === 'Retry');
    const retriedResult = deferred<string>();
    const replay = { ready: Promise.resolve(), result: retriedResult.promise, audio: jest.fn(), finish: jest.fn(), cancel: jest.fn() };
    (connectSpeech as jest.Mock).mockResolvedValue(replay);
    await act(async () => { retry.onPress(); await tick(); await jest.advanceTimersByTimeAsync(25); });
    expect(start).toHaveBeenCalledTimes(1); expect(replay.audio).toHaveBeenCalledTimes(1); expect(replay.finish).toHaveBeenCalledTimes(1);
    await act(async () => { retriedResult.resolve('recovered'); await tick(); });
    expect(hook.setInput).toHaveBeenCalledWith('Existing draft recovered'); expect(hook.onSubmit).not.toHaveBeenCalled();
  });
  it('discarding a failed recording prevents a stale retry action from reopening it', async () => {
    const hook = setup(); await begin(hook);
    await act(async () => { speak(); result.reject(Error('speech_disconnected')); await tick(); });
    const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)[2];
    act(() => { buttons[0].onPress(); buttons[1].onPress(); });
    expect(connectSpeech).toHaveBeenCalledTimes(1); expect(hook.onSubmit).not.toHaveBeenCalled();
  });
});
