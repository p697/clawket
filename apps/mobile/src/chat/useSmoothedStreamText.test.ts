import { act, renderHook } from '@testing-library/react-native';
import { buildLiveRunListData } from './liveRunThread';

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('react-native-reanimated', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

import {
  EMIT_EVERY_SECOND_TICK_MAX_CHARS,
  EMIT_EVERY_TICK_MAX_CHARS,
  SMOOTHED_STREAM_TEXT_TICK_MS,
  useSmoothedStreamText,
} from './useSmoothedStreamText';

type HookProps = {
  text: string;
  streaming: boolean;
};

function renderSmoothedStreamText(initialProps: HookProps) {
  return renderHook(({ text, streaming }: HookProps) => useSmoothedStreamText(text, streaming), {
    initialProps,
  });
}

function runTicksCountingChanges(result: { current: string }, ticks: number): number {
  let changes = 0;
  let previous = result.current;
  for (let i = 0; i < ticks; i += 1) {
    act(() => {
      jest.advanceTimersByTime(SMOOTHED_STREAM_TEXT_TICK_MS);
    });
    if (result.current !== previous) {
      changes += 1;
      previous = result.current;
    }
  }
  return changes;
}

describe('useSmoothedStreamText', () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReturnValue(false);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the target text directly without timers when not streaming', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const history = 'A long historical message that must render instantly.';

    const { result, rerender } = renderSmoothedStreamText({ text: history, streaming: false });
    expect(result.current).toBe(history);

    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(result.current).toBe(history);

    const edited = 'An edited historical message, still not streaming.';
    rerender({ text: edited, streaming: false });
    expect(result.current).toBe(edited);

    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it('drains the held-back suffix when a tool commits a paragraph while the run continues', () => {
    const text = 'Let me run a real end-to-end test through the configured provider.';
    const { result, rerender } = renderSmoothedStreamText({ text: '', streaming: true });
    rerender({ text, streaming: true });
    act(() => { jest.advanceTimersByTime(200); });
    expect(result.current).not.toBe(text);
    const committed = buildLiveRunListData({ historyMessages: [],
      streamSegments: [{ id: 'segment', text, timestampMs: 1000 }],
      toolMessages: [{ id: 'tool', role: 'tool', text: '', toolStatus: 'running' }],
      liveStreamText: null, liveStreamStartedAt: 1000, activeRunId: 'run', includePlaceholder: true,
    }).find(row => row.id === 'segment')!;
    rerender({ text: committed.text, streaming: committed.streaming === true });
    act(() => { jest.advanceTimersByTime(5_000); });
    expect(result.current).toBe(text);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('animates streaming text gradually and settles on the full text with timers cleaned up', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    const full = 'The quick brown fox jumps over the lazy dog and keeps on running far away.';

    const { result, rerender } = renderSmoothedStreamText({ text: '', streaming: true });

    const seen = new Set<string>();
    let arrived = 0;
    while (arrived < full.length) {
      arrived = Math.min(full.length, arrived + 7);
      rerender({ text: full.slice(0, arrived), streaming: true });
      act(() => {
        jest.advanceTimersByTime(99);
      });
      seen.add(result.current);
      expect(full.startsWith(result.current)).toBe(true);
    }

    // Streaming output trails the target (tail hold-back) and moved gradually.
    expect(result.current.length).toBeLessThan(full.length);
    expect(seen.size).toBeGreaterThan(3);

    rerender({ text: full, streaming: false });
    act(() => {
      jest.advanceTimersByTime(3_000);
    });
    expect(result.current).toBe(full);

    // Once settled, every interval the hook created must have been cleared.
    const createdIds = setIntervalSpy.mock.results.map((entry) => entry.value);
    const clearedIds = clearIntervalSpy.mock.calls.map((call) => call[0]);
    expect(createdIds.length).toBeGreaterThan(0);
    for (const id of createdIds) {
      expect(clearedIds).toContain(id);
    }
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it('snaps instantly when the row is recycled onto a different settled message', () => {
    const streamingText = 'Streaming answer number one that is fairly long already';
    const { result, rerender } = renderSmoothedStreamText({
      text: streamingText,
      streaming: true,
    });

    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(streamingText.startsWith(result.current)).toBe(true);

    const recycled = 'A totally different settled message.';
    rerender({ text: recycled, streaming: false });
    // The snap happens in the same render, without waiting for a tick.
    expect(result.current).toBe(recycled);

    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(result.current).toBe(recycled);
  });

  it('publishes on fewer ticks for long texts than for short ones', () => {
    // Same appended tail in both scenarios, so the pacer advances identically;
    // only the pre-seeded target length differs and selects the emit stride.
    const tail = ' word'.repeat(78);

    const shortSeed = 'seed '.repeat(20).trim();
    expect(shortSeed.length + tail.length).toBeLessThan(EMIT_EVERY_TICK_MAX_CHARS);
    const short = renderSmoothedStreamText({ text: shortSeed, streaming: true });
    short.rerender({ text: shortSeed + tail, streaming: true });
    const shortChanges = runTicksCountingChanges(short.result, 30);
    short.unmount();

    const longSeed = 'seed '.repeat(1_400).trim();
    expect(longSeed.length + tail.length).toBeGreaterThan(EMIT_EVERY_SECOND_TICK_MAX_CHARS);
    const long = renderSmoothedStreamText({ text: longSeed, streaming: true });
    long.rerender({ text: longSeed + tail, streaming: true });
    const longChanges = runTicksCountingChanges(long.result, 30);
    long.unmount();

    // Stride 3 allows at most 10 publishes across 30 ticks; stride 1
    // publishes on every advancing tick.
    expect(longChanges).toBeLessThanOrEqual(10);
    expect(shortChanges).toBeGreaterThan(longChanges);
  });

  it('publishes the final text immediately once a throttled long text settles', () => {
    const seed = 'seed '.repeat(1_400).trim();
    const { result, rerender } = renderSmoothedStreamText({ text: seed, streaming: true });

    const extended = `${seed}${' tail'.repeat(20)}`;
    expect(extended.length).toBeGreaterThan(EMIT_EVERY_SECOND_TICK_MAX_CHARS);
    rerender({ text: extended, streaming: true });
    act(() => {
      jest.advanceTimersByTime(SMOOTHED_STREAM_TEXT_TICK_MS * 3);
    });
    expect(result.current.length).toBeLessThan(extended.length);

    rerender({ text: extended, streaming: false });
    // If settling skipped a throttled publish, the interval would be cleared
    // with stale text and the loop below could never observe the full text.
    for (let i = 0; i < 60 && result.current !== extended; i += 1) {
      act(() => {
        jest.advanceTimersByTime(SMOOTHED_STREAM_TEXT_TICK_MS);
      });
    }
    expect(result.current).toBe(extended);
  });

  it('does not replay already visible text when mounted mid-stream', () => {
    const existing =
      'This message already has a lot of visible text because the app recovered an active run. ' +
      'None of it should be replayed character by character on mount.';

    const { result, rerender } = renderSmoothedStreamText({ text: existing, streaming: true });
    expect(result.current).toBe(existing);

    const extended = `${existing} Fresh words continue to arrive and animate now.`;
    rerender({ text: extended, streaming: true });
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(result.current.startsWith(existing)).toBe(true);
    expect(result.current.length).toBeGreaterThan(existing.length);
    expect(result.current.length).toBeLessThan(extended.length);

    rerender({ text: extended, streaming: false });
    act(() => {
      jest.advanceTimersByTime(3_000);
    });
    expect(result.current).toBe(extended);
  });

  it('skips the typewriter entirely when reduce motion is enabled', () => {
    mockUseReducedMotion.mockReturnValue(true);
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    const { result, rerender } = renderSmoothedStreamText({ text: 'Hello', streaming: true });
    expect(result.current).toBe('Hello');

    // Chunks land verbatim, with no interval-driven reveal in between.
    rerender({ text: 'Hello world, streamed in one chunky batch', streaming: true });
    expect(result.current).toBe('Hello world, streamed in one chunky batch');

    rerender({ text: 'Hello world, streamed in one chunky batch. Done.', streaming: false });
    expect(result.current).toBe('Hello world, streamed in one chunky batch. Done.');
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });
});
