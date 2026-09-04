import { shouldAdoptPendingOptimisticRunId } from './pendingOptimisticRun';

describe('shouldAdoptPendingOptimisticRunId', () => {
  it('returns true when the current run is still the pending optimistic id for the session', () => {
    const pendingRunIds = new Map<string, string>([['agent:main:main', 'local_run']]);

    expect(shouldAdoptPendingOptimisticRunId({
      sessionKey: 'agent:main:main',
      eventRunId: 'server_run',
      currentRunId: 'local_run',
      pendingRunIds,
    })).toBe(true);
  });

  it('returns false when the session has no pending optimistic run', () => {
    expect(shouldAdoptPendingOptimisticRunId({
      sessionKey: 'agent:main:main',
      eventRunId: 'server_run',
      currentRunId: 'local_run',
      pendingRunIds: new Map(),
    })).toBe(false);
  });

  it('returns false when the current run no longer matches the pending optimistic run', () => {
    const pendingRunIds = new Map<string, string>([['agent:main:main', 'local_run']]);

    expect(shouldAdoptPendingOptimisticRunId({
      sessionKey: 'agent:main:main',
      eventRunId: 'server_run',
      currentRunId: 'other_run',
      pendingRunIds,
    })).toBe(false);
  });

  it('returns false when the event already uses the pending optimistic run id', () => {
    const pendingRunIds = new Map<string, string>([['agent:main:main', 'shared_run']]);

    expect(shouldAdoptPendingOptimisticRunId({
      sessionKey: 'agent:main:main',
      eventRunId: 'shared_run',
      currentRunId: 'shared_run',
      pendingRunIds,
    })).toBe(false);
  });
});
