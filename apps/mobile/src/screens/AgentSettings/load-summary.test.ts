import {
  CAPABILITY_MATRIX,
  createMockAdapter,
  type AgentDescriptor,
  type ConnectionDescriptor,
  type CronJob,
  type ManagementOperations,
} from '@clawket/agent-protocol';
import { formatLocalDate, loadAgentSettingsSummary } from './load-summary';

const connection: ConnectionDescriptor = {
  id: 'connection-one',
  backendKind: 'openclaw',
  transportKind: 'relay',
  label: 'Studio',
  createdAt: 1,
  isFreeSlot: true,
};

const agent: AgentDescriptor = {
  connectionId: connection.id,
  agentId: 'main',
  name: 'Lucy',
  isMain: true,
  mainSessionKey: 'agent:main:main',
};

function cronJob(patch: Partial<CronJob> = {}): CronJob {
  return {
    id: 'cron-one',
    name: 'Daily sync',
    enabled: true,
    createdAtMs: 1,
    updatedAtMs: 2,
    schedule: { kind: 'every', everyMs: 60_000 },
    sessionTarget: 'main',
    wakeMode: 'now',
    payload: { kind: 'systemEvent', text: 'sync' },
    state: {},
    ...patch,
  };
}

describe('Agent settings summary loader', () => {
  it('reads only capability-backed management summaries and aggregates pending requests', async () => {
    const listModels = jest.fn(async () => [{ id: 'model-one' }, { id: 'model-two' }]);
    const listFiles = jest.fn(async () => [{ name: 'SOUL.md' }, { name: 'MEMORY.md' }, { name: 'USER.md' }]);
    const lastHeartbeat = jest.fn(async () => ({ lastHeartbeatAt: 1_700_000_000_000 }));
    const skillStatus = jest.fn(async () => ({
      workspaceDir: '',
      managedSkillsDir: '',
      skills: [{}, {}, {}],
    }));
    const cronList = jest.fn(async () => ({
      jobs: [
        cronJob({ state: { lastStatus: 'error' } }),
        cronJob({ id: 'cron-two', state: { lastRunStatus: 'ok' } }),
        cronJob({ id: 'cron-three', state: { consecutiveErrors: 2 } }),
      ],
      total: 6,
      offset: 0,
      limit: 200,
      hasMore: false,
      nextOffset: null,
    }));
    const cost = jest.fn(async () => ({
      totals: { totalCost: 1.25, totalTokens: 965_200 },
      costPresentation: { mode: 'actual' as const },
    }));
    const catalog = jest.fn(async () => ({
      agentId: 'main',
      profiles: [],
      groups: [
        {
          id: 'core',
          label: 'Core',
          source: 'core' as const,
          tools: [
            { id: 'read', label: 'Read', description: '', source: 'core' as const, defaultProfiles: [] },
            { id: 'read', label: 'Read', description: '', source: 'core' as const, defaultProfiles: [] },
            { id: 'write', label: 'Write', description: '', source: 'core' as const, defaultProfiles: [] },
          ],
        },
      ],
    }));
    const listDevices = jest.fn(async () => ({ pending: [{ requestId: 'device-one', deviceId: 'one' }], paired: [] }));
    const pairRequests = jest.fn(async () => ({
      pending: [
        { requestId: 'node-one', nodeId: 'one' },
        { requestId: 'node-two', nodeId: 'two' },
      ],
      nodes: [],
    }));
    const management = {
      models: { list: listModels },
      skills: { status: skillStatus },
      cron: { list: cronList, heartbeat: { get: jest.fn(), set: jest.fn(), last: lastHeartbeat } },
      agents: { files: { list: listFiles } },
      usage: { cost },
      tools: { catalog, save: jest.fn() },
      devices: { list: listDevices },
      nodes: { pairRequests },
    } as unknown as ManagementOperations;
    const adapter = createMockAdapter({
      connection,
      agents: [agent],
      management,
      initialState: 'ready',
    });
    const now = new Date(2026, 8, 5, 12, 0, 0).getTime();

    await expect(loadAgentSettingsSummary(adapter, agent, now)).resolves.toEqual({
      modelCount: 2,
      installedSkillCount: 3,
      cronJobCount: 6,
      cronFailureCount: 2,
      hasCronFailure: true,
      lastHeartbeatAt: 1_700_000_000_000,
      fileCount: 3,
      todayCostUsd: 1.25,
      todayTokens: 965_200,
      toolCount: 2,
      pendingConnectionCount: 3,
    });
    expect(skillStatus).toHaveBeenCalledWith('main');
    expect(listFiles).toHaveBeenCalledWith('main');
    expect(lastHeartbeat).toHaveBeenCalledTimes(1);
    expect(cronList).toHaveBeenCalledWith({ includeDisabled: true, limit: 200, offset: 0 });
    expect(cost).toHaveBeenCalledWith({ startDate: '2026-09-05', endDate: '2026-09-05', agentId: 'main' });
    expect(catalog).toHaveBeenCalledWith('main');
  });

  it('skips unsupported operations and keeps partial successes when another read fails', async () => {
    const status = jest.fn(async () => {
      throw new Error('unavailable');
    });
    const catalog = jest.fn(async () => ({ agentId: 'main', profiles: [], groups: [] }));
    const adapter = createMockAdapter({
      connection: { ...connection, backendKind: 'hermes' },
      capabilities: {
        ...Object.fromEntries(Object.keys(CAPABILITY_MATRIX.openclaw).map((key) => [key, false])),
        skills: true,
        tools: false,
      },
      agents: [agent],
      management: {
        skills: { status },
        tools: { catalog, save: jest.fn() },
      },
      initialState: 'ready',
    });

    await expect(loadAgentSettingsSummary(adapter, agent)).resolves.toEqual({});
    expect(status).toHaveBeenCalledTimes(1);
    expect(catalog).not.toHaveBeenCalled();
  });

  it('keeps tokens but drops the dollar figure when the backend cannot price today', async () => {
    const cost = jest.fn(async () => ({
      totals: { totalCost: 0, totalTokens: 4_200 },
      costPresentation: { mode: 'unknown' as const },
    }));
    const adapter = createMockAdapter({
      connection,
      agents: [agent],
      management: { usage: { cost } } as unknown as ManagementOperations,
      initialState: 'ready',
    });

    const summary = await loadAgentSettingsSummary(adapter, agent);
    expect(summary.todayCostUsd).toBeUndefined();
    expect(summary.todayTokens).toBe(4_200);
  });

  it('formats a local calendar date without a UTC boundary shift', () => {
    const timestamp = new Date(2026, 0, 2, 0, 30, 0).getTime();
    expect(formatLocalDate(timestamp)).toBe('2026-01-02');
  });
});
