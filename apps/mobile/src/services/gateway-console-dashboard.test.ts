import { loadGatewayConsoleDashboardBundle } from './gateway-console-dashboard';

describe('gateway-console-dashboard', () => {
  it('loads console dashboard resources through capability-gated helpers', async () => {
    const gateway = {
      getBackendCapabilities: jest.fn().mockReturnValue({
        consoleDiscover: true,
        consoleClawHub: true,
        consoleFiles: true,
        consoleChannels: false,
        consoleCron: true,
        consoleSkills: false,
        modelCatalog: true,
        consoleUsage: true,
        consoleCost: false,
        consoleNodes: true,
        configRead: true,
        consoleTools: true,
        consoleAgentList: true,
        consoleAgentDetail: true,
        consoleAgentSessionsBoard: true,
        consoleHeartbeat: true,
      }),
      fetchIdentity: jest.fn().mockResolvedValue({ name: 'Agent', emoji: '🤖' }),
      listAgentFiles: jest.fn().mockResolvedValue([{ name: 'AGENTS.md' }]),
      getChannelsStatus: jest.fn(),
      listCronJobs: jest.fn().mockResolvedValue({ jobs: [{ id: 'job-1' }] }),
      getSkillsStatus: jest.fn(),
      listModels: jest.fn().mockResolvedValue([{ id: 'gpt-4.1' }, { id: 'gpt-4o-mini' }]),
      listSessions: jest.fn().mockResolvedValue([{ key: 'agent:main:session-1' }]),
      fetchUsage: jest.fn().mockResolvedValue({ sessions: [] }),
      request: jest.fn().mockResolvedValue({ ts: 123 }),
      fetchCostSummary: jest.fn(),
      listAgents: jest.fn().mockResolvedValue({ agents: [{ id: 'main' }] }),
      listNodes: jest.fn().mockResolvedValue({ nodes: [{ id: 'node-1' }] }),
      listNodePairRequests: jest.fn().mockResolvedValue({ pending: [{ id: 'pair-1' }] }),
      listDevices: jest.fn().mockResolvedValue({ paired: [{ id: 'device-1' }], pending: [] }),
      getConfig: jest.fn().mockResolvedValue({ config: { model: 'openai/gpt-4.1' }, hash: 'cfg_hash' }),
      fetchToolsCatalog: jest.fn().mockResolvedValue({ groups: [{ tools: [{ id: 'tool-1' }] }] }),
    };

    await expect(loadGatewayConsoleDashboardBundle(gateway, 'main', '2026-04-10')).resolves.toEqual({
      capabilities: gateway.getBackendCapabilities(),
      identity: { name: 'Agent', emoji: '🤖' },
      files: [{ name: 'AGENTS.md' }],
      channels: null,
      cron: { jobs: [{ id: 'job-1' }] },
      skills: null,
      modelCount: 2,
      sessions: [{ key: 'agent:main:session-1' }],
      usage: { sessions: [] },
      lastHeartbeat: { ts: 123 },
      cost: null,
      agents: { agents: [{ id: 'main' }] },
      nodes: { nodes: [{ id: 'node-1' }] },
      nodePairs: { pending: [{ id: 'pair-1' }] },
      devices: { paired: [{ id: 'device-1' }], pending: [] },
      config: { config: { model: 'openai/gpt-4.1' }, hash: 'cfg_hash' },
      tools: { groups: [{ tools: [{ id: 'tool-1' }] }] },
    });

    expect(gateway.getChannelsStatus).not.toHaveBeenCalled();
    expect(gateway.getSkillsStatus).not.toHaveBeenCalled();
    expect(gateway.fetchCostSummary).not.toHaveBeenCalled();
    expect(gateway.listModels).toHaveBeenCalledTimes(1);
    expect(gateway.request).toHaveBeenCalledWith('last-heartbeat', {});
  });
});
