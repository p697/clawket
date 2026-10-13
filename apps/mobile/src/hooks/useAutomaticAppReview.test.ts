import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { requestAutomaticAppReview } from '../services/auto-app-review';
import { useAutomaticAppReview } from './useAutomaticAppReview';
jest.mock('../services/auto-app-review', () => ({ requestAutomaticAppReview: jest.fn().mockResolvedValue(undefined) }));
let onAppState: (state: any) => void;
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks();
  jest.mocked(requestAutomaticAppReview).mockReset().mockResolvedValue(undefined);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    onAppState = callback;
    return { remove: jest.fn() };
  });
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
it('does not invite on launch but waits for a quiet return from a thread', async () => {
  const { rerender } = renderHook(({ route, safe }: { route: string; safe: boolean }) => useAutomaticAppReview(route, safe), { initialProps: { route: 'Roster', safe: true } });
  await act(async () => { jest.advanceTimersByTime(3000); });
  expect(requestAutomaticAppReview).not.toHaveBeenCalled();
  rerender({ route: 'Thread', safe: true }); rerender({ route: 'Roster', safe: true });
  await act(async () => { jest.advanceTimersByTime(1999); });
  expect(requestAutomaticAppReview).not.toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(1); });
  expect(requestAutomaticAppReview).toHaveBeenCalledTimes(1);
});
it.each(['navigation', 'touch', 'background', 'unmount'])('cancels a pending invitation on %s', async reason => {
  const { result, rerender, unmount } = renderHook(({ route }: { route: string }) => useAutomaticAppReview(route, true), { initialProps: { route: 'Thread' } });
  rerender({ route: 'Roster' });
  if (reason === 'navigation') rerender({ route: 'AccountSettings' });
  if (reason === 'touch') act(() => result.current());
  if (reason === 'background') act(() => onAppState('background'));
  if (reason === 'unmount') unmount();
  jest.mocked(requestAutomaticAppReview).mockImplementationOnce(async safe => { expect(safe()).toBe(false); });
  await act(async () => { jest.advanceTimersByTime(2500); });
  if (reason === 'navigation' || reason === 'unmount') expect(requestAutomaticAppReview).not.toHaveBeenCalled();
});
it('waits through blocked UI, and invalidates a dispatched async attempt on navigation', async () => {
  const { rerender } = renderHook(({ route, safe }: { route: string; safe: boolean }) => useAutomaticAppReview(route, safe), { initialProps: { route: 'Thread', safe: false } });
  rerender({ route: 'Roster', safe: false });
  await act(async () => { jest.advanceTimersByTime(3000); });
  expect(requestAutomaticAppReview).not.toHaveBeenCalled();
  let guard: (() => boolean) | undefined;
  let finish: (() => void) | undefined;
  jest.mocked(requestAutomaticAppReview).mockImplementationOnce(async safe => {
    guard = safe; await new Promise<void>(resolve => { finish = resolve; });
  });
  rerender({ route: 'Roster', safe: true });
  await act(async () => { jest.advanceTimersByTime(2000); });
  expect(guard?.()).toBe(true);
  rerender({ route: 'Thread', safe: true });
  expect(guard?.()).toBe(false);
  await act(async () => finish?.());
});
