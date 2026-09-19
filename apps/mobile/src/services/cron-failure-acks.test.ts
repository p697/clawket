import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CronJob } from '@clawket/agent-protocol';
import { CronFailureAckService, normalizeCronFailureAcks } from './cron-failure-acks';

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;
const mockRemoveItem = AsyncStorage.removeItem as jest.Mock;
const mockGetAllKeys = AsyncStorage.getAllKeys as jest.Mock;
const mockMultiRemove = AsyncStorage.multiRemove as jest.Mock;

const KEY = 'clawket.cronFailureAcks.v1.connection-one::main';

function job(id: string, state: CronJob['state']): CronJob {
  return {
    id,
    name: id,
    enabled: true,
    createdAtMs: 1,
    updatedAtMs: 2,
    schedule: { kind: 'every', everyMs: 60_000 },
    sessionTarget: 'isolated',
    wakeMode: 'now',
    payload: { kind: 'agentTurn', message: 'run' },
    state,
  };
}

describe('CronFailureAckService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(null);
    mockGetAllKeys.mockResolvedValue([]);
  });

  it('reads a connection/Agent-scoped set and tolerates corrupt records', async () => {
    mockGetItem.mockResolvedValueOnce(JSON.stringify(['daily@100', 42, null, '']));
    await expect(CronFailureAckService.read('connection-one', 'main')).resolves.toEqual(new Set(['daily@100']));
    expect(mockGetItem).toHaveBeenCalledWith(KEY);

    mockGetItem.mockResolvedValueOnce('not-json');
    await expect(CronFailureAckService.read('connection-one', 'main')).resolves.toEqual(new Set());
    mockGetItem.mockResolvedValueOnce(JSON.stringify({ daily: true }));
    await expect(CronFailureAckService.read('connection-one', 'main')).resolves.toEqual(new Set());
    mockGetItem.mockRejectedValueOnce(new Error('storage'));
    await expect(CronFailureAckService.read('connection-one', 'main')).resolves.toEqual(new Set());
    expect(normalizeCronFailureAcks(undefined)).toEqual(new Set());
  });

  it('stores the signatures of the current failures only and notifies the scope', async () => {
    const listener = jest.fn();
    const unsubscribe = CronFailureAckService.subscribe(listener);
    mockGetItem.mockResolvedValueOnce(JSON.stringify(['stale@1']));

    await CronFailureAckService.acknowledge('connection-one', 'main', [
      job('daily', { lastRunStatus: 'error', lastRunAtMs: 100 }),
      job('weekly', { lastStatus: 'error' }),
      job('ok', { lastRunStatus: 'ok', lastRunAtMs: 200 }),
      job('skipped', { lastRunStatus: 'skipped', lastError: 'window closed', consecutiveErrors: 3 }),
    ]);

    expect(mockSetItem).toHaveBeenCalledTimes(1);
    const [key, raw] = mockSetItem.mock.calls[0] as [string, string];
    expect(key).toBe(KEY);
    expect(new Set(JSON.parse(raw))).toEqual(new Set(['daily@100', 'weekly@0']));
    expect(listener).toHaveBeenCalledWith({ connectionId: 'connection-one', agentId: 'main' });
    unsubscribe();
  });

  it('removes the record when nothing fails and stays silent when nothing changed', async () => {
    const listener = jest.fn();
    const unsubscribe = CronFailureAckService.subscribe(listener);

    mockGetItem.mockResolvedValueOnce(JSON.stringify(['daily@100']));
    await CronFailureAckService.acknowledge('connection-one', 'main', [
      job('daily', { lastRunStatus: 'error', lastRunAtMs: 100 }),
    ]);
    expect(mockSetItem).not.toHaveBeenCalled();
    expect(mockRemoveItem).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();

    mockGetItem.mockResolvedValueOnce(JSON.stringify(['daily@100']));
    await CronFailureAckService.acknowledge('connection-one', 'main', [
      job('daily', { lastRunStatus: 'ok', lastRunAtMs: 300 }),
    ]);
    expect(mockRemoveItem).toHaveBeenCalledWith(KEY);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('clears only the removed connection', async () => {
    mockGetAllKeys.mockResolvedValueOnce([
      KEY,
      'clawket.cronFailureAcks.v1.connection-one::helper',
      'clawket.cronFailureAcks.v1.connection-two::main',
      'clawket.sessionPreferences.v1.connection-one::main',
    ]);
    await CronFailureAckService.clearConnection('connection-one');
    expect(mockMultiRemove).toHaveBeenCalledWith([KEY, 'clawket.cronFailureAcks.v1.connection-one::helper']);

    mockGetAllKeys.mockResolvedValueOnce(['clawket.cronFailureAcks.v1.connection-two::main']);
    await CronFailureAckService.clearConnection('connection-one');
    expect(mockMultiRemove).toHaveBeenCalledTimes(1);
  });
});
