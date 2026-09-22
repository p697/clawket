import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { useVoiceShortcut } from './useVoiceShortcut';

let mockChange: (state: string) => void;
jest.mock('react-native', () => ({ AppState: {
  currentState: 'active',
  addEventListener: jest.fn((_event, callback) => { mockChange = callback; return { remove: jest.fn() }; }),
} }));
beforeEach(() => { jest.useFakeTimers(); AppState.currentState = 'active'; });
afterEach(() => jest.useRealTimers());
function setup() {
  const props = { requested: true, scope: 'connection:agent:main', ready: true, start: jest.fn(), consume: jest.fn() };
  const hook = renderHook(useVoiceShortcut, { initialProps: props });
  return { ...hook, props };
}
function settle() { act(() => jest.advanceTimersByTime(350)); }
function background(state: 'active' | 'background') {
  act(() => { AppState.currentState = state; mockChange(state); });
}
test('waits for readiness and consumes once even if navigation params have not cleared', () => {
  const { rerender, props } = setup();
  rerender({ ...props, ready: false }); settle();
  expect(props.start).not.toHaveBeenCalled();
  rerender(props); settle();
  expect(props.start).toHaveBeenCalledTimes(1);
  expect(props.consume).toHaveBeenCalledTimes(1);
  rerender({ ...props, ready: false }); rerender(props); settle();
  expect(props.start).toHaveBeenCalledTimes(1);
  rerender({ ...props, requested: false }); rerender(props); settle();
  expect(props.start).toHaveBeenCalledTimes(2);
});
test('waits for foreground on a cold launch and cancels a timer on background', () => {
  AppState.currentState = 'background';
  const { props } = setup(); settle();
  expect(props.start).not.toHaveBeenCalled();
  background('active'); background('background'); settle();
  expect(props.start).not.toHaveBeenCalled();
  background('active'); settle();
  expect(props.start).toHaveBeenCalledTimes(1);
});
test('discards the shortcut when the destination scope changes', () => {
  const { props, rerender } = setup();
  rerender({ ...props, scope: 'another:agent:main' }); settle();
  expect(props.start).not.toHaveBeenCalled();
  expect(props.consume).toHaveBeenCalledTimes(1);
});
test('unmount cancels recording startup', () => {
  const { props, unmount } = setup(); unmount(); settle();
  expect(props.start).not.toHaveBeenCalled();
});
