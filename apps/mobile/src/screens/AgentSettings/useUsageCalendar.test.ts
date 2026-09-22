import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { useUsageCalendar } from './useUsageCalendar';
import * as zone from '../../services/usage-time-zone';

afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

it('refreshes at midnight and on foreground, and cleans up its listener', () => {
  jest.useFakeTimers();
  let foreground: ((state: AppStateStatus) => void) | undefined;
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    foreground = listener;
    return { remove };
  });
  let date = new Date(2026, 8, 21, 23, 59);
  const view = renderHook(() => useUsageCalendar(() => date));
  expect(view.result.current.key).toContain('2026-09-21');
  act(() => { date = new Date(2026, 8, 22, 0, 0); jest.advanceTimersByTime(60_000); });
  expect(view.result.current.key).toContain('2026-09-22');
  expect(view.result.current.revision).toBe(1);
  act(() => foreground?.('active'));
  expect(view.result.current.revision).toBe(2);
  view.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it('invalidates same-date data after a timezone change without rerendering every minute', () => {
  jest.useFakeTimers();
  const getZone = jest.spyOn(zone, 'usageTimeZone').mockReturnValue({ mode: 'specific', timeZone: 'Asia/Tokyo', utcOffset: 'UTC+9:00' });
  const view = renderHook(() => useUsageCalendar(() => new Date(2026, 8, 21, 12)));
  const first = view.result.current;
  act(() => jest.advanceTimersByTime(60_000));
  expect(view.result.current).toBe(first);
  getZone.mockReturnValue({ mode: 'specific', timeZone: 'Asia/Shanghai', utcOffset: 'UTC+8:00' });
  act(() => jest.advanceTimersByTime(60_000));
  expect(view.result.current.key).toContain('Asia/Shanghai');
  expect(view.result.current.revision).toBe(1);
  view.unmount();
});
