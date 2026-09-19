import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeThreadActivityRuns, ThreadActivityCacheService } from './thread-activity-cache';
import type { ThreadRunSeed } from '../screens/Thread/model';

const mockedStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

const scope = { connectionId: 'connection-1', agentId: 'atlas', sessionKey: 'agent:atlas:main' };
const scopeKey = 'clawket.threadActivity.v1.connection-1::atlas::agent:atlas:main';

function seed(overrides: Partial<ThreadRunSeed> = {}): ThreadRunSeed {
  return {
    id: 'nightly:1700000000000',
    kind: 'cron',
    title: 'Nightly report',
    status: 'succeeded',
    updatedAt: 1_700_000_000_000,
    sessionKey: 'agent:atlas:cron:nightly',
    jobId: 'nightly',
    agentId: 'atlas',
    summary: 'Sent the report',
    cronRun: { ts: 1_700_000_000_000, jobId: 'nightly', action: 'finished', status: 'ok' },
    ...overrides,
  };
}

describe('ThreadActivityCacheService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedStorage.getItem.mockResolvedValue(null);
    mockedStorage.getAllKeys.mockResolvedValue([]);
  });

  it('round-trips a snapshot under a connection, Agent and session scoped key', async () => {
    const runs = [seed(), seed({ id: 'digest:1699999000000', jobId: 'digest', updatedAt: 1_699_999_000_000 })];
    await ThreadActivityCacheService.write(scope, runs);

    expect(mockedStorage.setItem).toHaveBeenCalledTimes(1);
    const [key, raw] = mockedStorage.setItem.mock.calls[0]!;
    expect(key).toBe(scopeKey);
    mockedStorage.getItem.mockResolvedValueOnce(raw);

    await expect(ThreadActivityCacheService.read(scope)).resolves.toEqual(runs);
    expect(mockedStorage.getItem).toHaveBeenCalledWith(scopeKey);
  });

  it('removes the record instead of storing an empty snapshot', async () => {
    await ThreadActivityCacheService.write(scope, []);
    expect(mockedStorage.setItem).not.toHaveBeenCalled();
    expect(mockedStorage.removeItem).toHaveBeenCalledWith(scopeKey);
  });

  it('returns null for a missing, malformed or unreadable record', async () => {
    await expect(ThreadActivityCacheService.read(scope)).resolves.toBeNull();
    mockedStorage.getItem.mockResolvedValueOnce('{not json');
    await expect(ThreadActivityCacheService.read(scope)).resolves.toBeNull();
    mockedStorage.getItem.mockResolvedValueOnce(JSON.stringify({ version: 99, runs: [seed()] }));
    await expect(ThreadActivityCacheService.read(scope)).resolves.toBeNull();
    mockedStorage.getItem.mockRejectedValueOnce(new Error('storage offline'));
    await expect(ThreadActivityCacheService.read(scope)).resolves.toBeNull();
  });

  it('drops corrupted entries, duplicates and non-cron kinds without throwing', () => {
    const runs = normalizeThreadActivityRuns({
      version: 1,
      savedAt: 1,
      runs: [
        seed(),
        seed(),
        { ...seed({ id: 'no-title' }), title: '' },
        { ...seed({ id: 'bad-status' }), status: 'exploded' },
        { ...seed({ id: 'bad-time' }), updatedAt: Number.NaN },
        { ...seed({ id: 'subagent' }), kind: 'subagent' },
        { ...seed({ id: 'no-run-record' }), cronRun: { jobId: 'x' } },
        'garbage',
        null,
      ],
    });
    expect(runs?.map((run) => run.id)).toEqual(['nightly:1700000000000', 'no-run-record']);
    expect(runs?.[1]?.cronRun).toBeUndefined();
    expect(normalizeThreadActivityRuns({ version: 1, runs: 'nope' })).toBeNull();
    expect(normalizeThreadActivityRuns([])).toBeNull();
  });

  it('clears only the removed connection and can clear everything', async () => {
    mockedStorage.getAllKeys.mockResolvedValue([
      scopeKey,
      'clawket.threadActivity.v1.connection-1::atlas::agent:atlas:other',
      'clawket.threadActivity.v1.connection-2::hermes::main',
      'clawket.chatCache.index.v2',
    ]);
    await ThreadActivityCacheService.clearConnection('connection-1');
    expect(mockedStorage.multiRemove).toHaveBeenLastCalledWith([
      scopeKey,
      'clawket.threadActivity.v1.connection-1::atlas::agent:atlas:other',
    ]);

    await ThreadActivityCacheService.clearAll();
    expect(mockedStorage.multiRemove).toHaveBeenLastCalledWith([
      scopeKey,
      'clawket.threadActivity.v1.connection-1::atlas::agent:atlas:other',
      'clawket.threadActivity.v1.connection-2::hermes::main',
    ]);
  });
});
