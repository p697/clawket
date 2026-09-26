import { act, renderHook } from '@testing-library/react-native';
import { STREAM_SETTLE_HOLD_MS, useStreamingSettleHold } from './useStreamingSettleHold';

type Props = { active: boolean; identity: string };

afterEach(() => jest.useRealTimers());

const renderHold = (initialProps: Props) => renderHook<boolean, Props>(
  ({ active, identity }) => useStreamingSettleHold(active, identity),
  { initialProps },
);

it('stays in streaming presentation for the hold after the text settles, then releases', () => {
  jest.useFakeTimers();
  const { result, rerender } = renderHold({ active: true, identity: 'reply:1:0' });
  expect(result.current).toBe(true);
  rerender({ active: false, identity: 'reply:1:0' });
  expect(result.current).toBe(true);
  act(() => jest.advanceTimersByTime(STREAM_SETTLE_HOLD_MS - 1));
  expect(result.current).toBe(true);
  act(() => jest.advanceTimersByTime(1));
  expect(result.current).toBe(false);
});

it('starts settled for history and never lends a hold to another row', () => {
  jest.useFakeTimers();
  const { result, rerender } = renderHold({ active: false, identity: 'h1' });
  expect(result.current).toBe(false);
  rerender({ active: true, identity: 'reply:2:0' });
  expect(result.current).toBe(true);
  rerender({ active: false, identity: 'reply:2:0' });
  expect(result.current).toBe(true);
  // A recycled cell showing another message drops the hold at once.
  rerender({ active: false, identity: 'h7' });
  expect(result.current).toBe(false);
  act(() => jest.advanceTimersByTime(STREAM_SETTLE_HOLD_MS));
  expect(result.current).toBe(false);
});

it('resumes streaming immediately when the same reply streams again during the hold', () => {
  jest.useFakeTimers();
  const { result, rerender } = renderHold({ active: true, identity: 'reply:3:0' });
  rerender({ active: false, identity: 'reply:3:0' });
  act(() => jest.advanceTimersByTime(STREAM_SETTLE_HOLD_MS / 2));
  rerender({ active: true, identity: 'reply:3:0' });
  expect(result.current).toBe(true);
  act(() => jest.advanceTimersByTime(STREAM_SETTLE_HOLD_MS));
  expect(result.current).toBe(true);
  rerender({ active: false, identity: 'reply:3:0' });
  act(() => jest.advanceTimersByTime(STREAM_SETTLE_HOLD_MS));
  expect(result.current).toBe(false);
});
