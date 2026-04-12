import { loadGatewayToolsConfigBundle } from './gateway-tools';

describe('gateway-tools', () => {
  it('loads tools catalog and config as one bundle', async () => {
    const gateway = {
      fetchToolsCatalog: jest.fn().mockResolvedValue({
        agentId: 'main',
        profiles: [],
        groups: [{ id: 'core', label: 'Core', source: 'core', tools: [] }],
      }),
      getConfig: jest.fn().mockResolvedValue({
        config: { agents: { list: [] } },
        hash: 'tools_hash',
      }),
    };

    await expect(loadGatewayToolsConfigBundle(gateway, 'main')).resolves.toEqual({
      catalog: {
        agentId: 'main',
        profiles: [],
        groups: [{ id: 'core', label: 'Core', source: 'core', tools: [] }],
      },
      config: { agents: { list: [] } },
      configHash: 'tools_hash',
    });
    expect(gateway.fetchToolsCatalog).toHaveBeenCalledWith('main');
    expect(gateway.getConfig).toHaveBeenCalled();
  });
});
