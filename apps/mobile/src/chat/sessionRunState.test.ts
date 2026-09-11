import {
  clearSessionRunState,
  markSessionRunDelta,
  markSessionRunStarted,
} from './sessionRunState';

describe('sessionRunState', () => {
  it('starts a run and keeps empty stream text by default', () => {
    const map = new Map();
    const state = markSessionRunStarted(map, 'agent:main', 'run_1', 1000);

    expect(state).toEqual({
      runId: 'run_1',
      streamText: null,
      startedAt: 1000,
    });
  });

  it('updates stream text for the same run', () => {
    const map = new Map();
    markSessionRunStarted(map, 'agent:main', 'run_1', 1000);
    markSessionRunDelta(map, 'agent:main', 'run_1', 'hello', 1100);
    const next = markSessionRunDelta(map, 'agent:main', 'run_1', 'hello world', 1200);

    expect(next).toEqual({
      runId: 'run_1',
      streamText: 'hello world',
      startedAt: 1000,
    });
  });

  it('ignores shorter delta text for the same run', () => {
    const map = new Map();
    markSessionRunDelta(map, 'agent:main', 'run_1', 'hello world', 1000);
    const next = markSessionRunDelta(map, 'agent:main', 'run_1', 'hello', 1100);

    expect(next.streamText).toBe('hello world');
    expect(next.startedAt).toBe(1000);
  });

  it('replaces state when a new run id arrives for the same session', () => {
    const map = new Map();
    markSessionRunDelta(map, 'agent:main', 'run_1', 'hello world', 1000);
    const next = markSessionRunStarted(map, 'agent:main', 'run_2', 2000);

    expect(next).toEqual({
      runId: 'run_2',
      streamText: null,
      startedAt: 2000,
    });
  });

  it('clears matching run state and keeps mismatched run state', () => {
    const map = new Map();
    markSessionRunStarted(map, 'agent:main', 'run_1', 1000);

    const mismatchCleared = clearSessionRunState(map, 'agent:main', 'run_2');
    const exactCleared = clearSessionRunState(map, 'agent:main', 'run_1');

    expect(mismatchCleared).toBe(false);
    expect(exactCleared).toBe(true);
    expect(map.has('agent:main')).toBe(false);
  });
});
