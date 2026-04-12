import { loadGatewayHermesConsoleDashboard } from './gateway-hermes-console-dashboard';

describe('gateway-hermes-console-dashboard', () => {
  it('loads the Hermes console dashboard bundle from shared gateway helpers', async () => {
    const gateway = {
      fetchIdentity: jest.fn().mockResolvedValue({ name: 'Hermes', emoji: '🪽' }),
      getCurrentModelState: jest.fn().mockResolvedValue({
        currentModel: 'openai/gpt-4.1-mini',
        currentProvider: 'custom:openrouter-local',
        currentBaseUrl: 'http://127.0.0.1:65535/v1',
        note: null,
      }),
      listSessions: jest.fn().mockResolvedValue([
        { key: 'main', updatedAt: 1775836000000 },
      ]),
      listAgentFiles: jest.fn().mockResolvedValue([
        { name: 'MEMORY.md' },
        { name: 'USER.md' },
      ]),
      getSkillsStatus: jest.fn().mockResolvedValue({
        workspaceDir: '/tmp/hermes',
        managedSkillsDir: '/tmp/hermes/skills',
        skills: [
          { skillKey: 'alpha', createdAtMs: 1775836000000 },
          { skillKey: 'beta', createdAtMs: 1775837000000 },
        ],
      }),
      fetchUsage: jest.fn().mockResolvedValue({
        totals: { totalTokens: 12345, totalCost: 0 } as any,
      }),
      fetchCostSummary: jest.fn().mockResolvedValue({
        totals: { totalTokens: 12345, totalCost: 0 } as any,
        costPresentation: { mode: 'included' },
      }),
      listHermesCronJobs: jest.fn().mockResolvedValue([
        { id: 'job-1', name: 'Morning digest' },
      ]),
      listHermesCronOutputs: jest.fn().mockResolvedValue([
        { jobId: 'job-1', fileName: '2026-04-11T09-00-00.md', createdAt: 1775837100000 },
      ]),
      request: jest.fn().mockResolvedValue({
        status: 'ok',
        ts: 1775836044000,
        hermesApiReachable: true,
      }),
      listAgents: jest.fn().mockResolvedValue({
        defaultId: 'main',
        mainKey: 'main',
        agents: [{ id: 'main', name: 'Hermes' }],
      }),
    };

    await expect(loadGatewayHermesConsoleDashboard(gateway, 'main')).resolves.toEqual({
      identity: { name: 'Hermes', emoji: '🪽' },
      modelState: {
        currentModel: 'openai/gpt-4.1-mini',
        currentProvider: 'custom:openrouter-local',
        currentBaseUrl: 'http://127.0.0.1:65535/v1',
        note: null,
      },
      modelCount: null,
      sessions: [{ key: 'main', updatedAt: 1775836000000 }],
      files: [{ name: 'MEMORY.md' }, { name: 'USER.md' }],
      skills: {
        workspaceDir: '/tmp/hermes',
        managedSkillsDir: '/tmp/hermes/skills',
        skills: [
          { skillKey: 'alpha', createdAtMs: 1775836000000 },
          { skillKey: 'beta', createdAtMs: 1775837000000 },
        ],
      },
      usage: {
        totals: { totalTokens: 12345, totalCost: 0 },
      },
      cost: {
        totals: { totalTokens: 12345, totalCost: 0 },
        costPresentation: { mode: 'included' },
      },
      cronJobs: [
        { id: 'job-1', name: 'Morning digest' },
      ],
      cronOutputs: [
        { jobId: 'job-1', fileName: '2026-04-11T09-00-00.md', createdAt: 1775837100000 },
      ],
      heartbeat: {
        status: 'ok',
        ts: 1775836044000,
        hermesApiReachable: true,
      },
      agents: {
        defaultId: 'main',
        mainKey: 'main',
        agents: [{ id: 'main', name: 'Hermes' }],
      },
    });
  });
});
