import { act, renderHook } from '@testing-library/react-native';
import { useBufferedDebugLog } from './useBufferedDebugLog';

describe('useBufferedDebugLog', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('buffers debug logs until the scheduled flush runs', () => {
    const { result } = renderHook(() => useBufferedDebugLog(true));

    act(() => {
      result.current.appendDebugLog('first');
      result.current.appendDebugLog('second');
    });

    expect(result.current.logs).toEqual([]);

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(result.current.logs).toHaveLength(2);
    expect(result.current.logs[0]).toContain('first');
    expect(result.current.logs[1]).toContain('second');
  });

  it('ignores logs while disabled and clears existing logs when toggled off', () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useBufferedDebugLog(enabled),
      {
        initialProps: { enabled: true },
      },
    );

    act(() => {
      result.current.appendDebugLog('visible');
      jest.runOnlyPendingTimers();
    });

    expect(result.current.logs).toHaveLength(1);

    rerender({ enabled: false });

    expect(result.current.logs).toEqual([]);

    act(() => {
      result.current.appendDebugLog('hidden');
      jest.runOnlyPendingTimers();
    });

    expect(result.current.logs).toEqual([]);
  });
});
