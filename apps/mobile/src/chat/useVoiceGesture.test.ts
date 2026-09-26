import { act, renderHook } from '@testing-library/react-native';
import { useVoiceGesture } from './useVoiceGesture';
jest.mock('../services/haptics', () => ({ triggerLightImpact: jest.fn() }));
const touch = (pageY: number) => ({ nativeEvent: { pageY } } as any);
describe('voice gestures', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  function setup() {
    const start = jest.fn(), stop = jest.fn(), cancel = jest.fn(), focus = jest.fn();
    const hook = renderHook(({ phase }: { phase: string }) => useVoiceGesture({ phase, enabled: true, start, stop, cancel, focus }), { initialProps: { phase: 'idle' } });
    return { ...hook, start, stop, cancel, focus };
  }
  it.each(['before', 'after', 'absent'])('a mic touch-down starts once and the tap keeps dictating with touch-end %s press', (order) => {
    const h = setup(); act(() => h.result.current.handlers.onPressIn(touch(500)));
    expect(h.start).toHaveBeenCalledTimes(1); expect(h.result.current.pressing).toBe(true);
    h.rerender({ phase: 'listening' });
    act(() => {
      if (order === 'before') h.result.current.handlers.onTouchEnd();
      h.result.current.handlers.onPressOut(); h.result.current.handlers.onPress();
      if (order === 'after') h.result.current.handlers.onTouchEnd();
      jest.runOnlyPendingTimers();
    });
    expect(h.start).toHaveBeenCalledTimes(1); expect(h.cancel).not.toHaveBeenCalled(); expect(h.stop).not.toHaveBeenCalled();
    expect(h.result.current.pressing).toBe(false);
  });
  it('a tap on the listening control sends and taps during finalization are ignored', () => {
    const h = setup(); h.rerender({ phase: 'listening' });
    act(() => {
      h.result.current.handlers.onPressIn(touch(500)); h.result.current.handlers.onPressOut();
      h.result.current.handlers.onPress(); jest.runOnlyPendingTimers();
    });
    expect(h.stop).toHaveBeenCalledWith(true); expect(h.start).not.toHaveBeenCalled();
    h.rerender({ phase: 'transcribing' });
    for (let i = 0; i < 3; i++) act(() => {
      h.result.current.handlers.onPressIn(touch(500)); h.result.current.handlers.onPressOut();
      h.result.current.handlers.onPress(); jest.runOnlyPendingTimers();
    });
    expect(h.stop).toHaveBeenCalledTimes(1); expect(h.start).not.toHaveBeenCalled(); expect(h.cancel).not.toHaveBeenCalled();
  });
  it.each(['handlers', 'inputHandlers'] as const)('hold release from %s sends once and suppresses the following press', (source) => {
    const h = setup(); act(() => h.result.current[source].onPressIn(touch(500)));
    // Only the mic starts on touch-down; the input area waits for the hold so typing never opens audio.
    expect(h.start).toHaveBeenCalledTimes(source === 'handlers' ? 1 : 0);
    act(() => h.result.current[source].onLongPress());
    expect(h.start).toHaveBeenCalledTimes(1); expect(h.result.current.holding).toBe(true); h.rerender({ phase: 'listening' });
    act(() => { jest.advanceTimersByTime(450); h.result.current[source].onTouchEnd(); h.result.current[source].onPress(); });
    expect(h.stop).toHaveBeenCalledTimes(1); expect(h.stop).toHaveBeenCalledWith(true); expect(h.focus).not.toHaveBeenCalled();
  });
  it('input tap focuses the editor without opening audio', () => {
    const h = setup(); act(() => {
      h.result.current.inputHandlers.onPressIn(touch(500)); h.result.current.inputHandlers.onTouchEnd();
      h.result.current.inputHandlers.onPress(); h.result.current.inputHandlers.onPressOut(); jest.runOnlyPendingTimers();
    });
    expect(h.focus).toHaveBeenCalledTimes(1); expect(h.start).not.toHaveBeenCalled(); expect(h.cancel).not.toHaveBeenCalled();
  });
  it('slide cancellation has hysteresis and never sends', () => {
    const h = setup(); act(() => { h.result.current.inputHandlers.onPressIn(touch(500)); h.result.current.inputHandlers.onLongPress(); });
    h.rerender({ phase: 'listening' });
    act(() => { jest.advanceTimersByTime(450); h.result.current.inputHandlers.onTouchMove(touch(415)); });
    expect(h.result.current.cancelling).toBe(true);
    act(() => h.result.current.inputHandlers.onTouchMove(touch(430))); expect(h.result.current.cancelling).toBe(true);
    act(() => h.result.current.inputHandlers.onTouchEnd()); expect(h.cancel).toHaveBeenCalled(); expect(h.stop).not.toHaveBeenCalled();
  });
  it('pointer termination cancels a held recording but never a completed tap', () => {
    const h = setup(); act(() => { h.result.current.handlers.onPressIn(touch(500)); h.result.current.handlers.onLongPress(); h.result.current.handlers.onTouchCancel(); h.result.current.handlers.onPress(); });
    expect(h.cancel).toHaveBeenCalledTimes(1); expect(h.start).toHaveBeenCalledTimes(1); expect(h.stop).not.toHaveBeenCalled();
  });
  it('a touch-down recording is cancelled when the system takes the touch before release', () => {
    const h = setup(); act(() => h.result.current.handlers.onPressIn(touch(500)));
    h.rerender({ phase: 'listening' });
    act(() => { h.result.current.handlers.onTouchCancel(); h.result.current.handlers.onPressOut(); jest.runOnlyPendingTimers(); });
    expect(h.start).toHaveBeenCalledTimes(1); expect(h.cancel).toHaveBeenCalledTimes(1); expect(h.stop).not.toHaveBeenCalled();
    expect(h.result.current.pressing).toBe(false);
  });
  it('a too-short hold cancels and a later press can start again', () => {
    const h = setup(); act(() => { h.result.current.handlers.onPressIn(touch(500)); h.result.current.handlers.onLongPress(); });
    h.rerender({ phase: 'listening' });
    act(() => { h.result.current.handlers.onTouchEnd(); h.result.current.handlers.onPressOut(); jest.advanceTimersByTime(1); });
    expect(h.result.current.tooShort).toBe(true);
    act(() => jest.advanceTimersByTime(1400)); expect(h.result.current.tooShort).toBe(false);
    h.rerender({ phase: 'idle' }); act(() => h.result.current.handlers.onPress());
    expect(h.start).toHaveBeenCalledTimes(2); expect(h.cancel).toHaveBeenCalledTimes(1);
  });
});
