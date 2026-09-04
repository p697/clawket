import { hasCompletedAssistantForRememberedRun } from './runStateValidation';

describe('hasCompletedAssistantForRememberedRun', () => {
  it('returns true when a newer assistant message already exists', () => {
    expect(hasCompletedAssistantForRememberedRun([
      { id: 'u1', role: 'user', text: 'hi', timestampMs: 1000 },
      { id: 'a1', role: 'assistant', text: 'done', timestampMs: 5200 },
    ], {
      runId: 'run_1',
      streamText: 'do',
      startedAt: 5000,
    })).toBe(true);
  });

  it('returns false when the latest assistant is older than the remembered run', () => {
    expect(hasCompletedAssistantForRememberedRun([
      { id: 'u1', role: 'user', text: 'hi', timestampMs: 1000 },
      { id: 'a1', role: 'assistant', text: 'older', timestampMs: 3000 },
    ], {
      runId: 'run_1',
      streamText: 'do',
      startedAt: 5000,
    })).toBe(false);
  });

  it('returns false when there is no assistant message yet', () => {
    expect(hasCompletedAssistantForRememberedRun([
      { id: 'u1', role: 'user', text: 'hi', timestampMs: 1000 },
    ], {
      runId: 'run_1',
      streamText: 'do',
      startedAt: 5000,
    })).toBe(false);
  });
});
