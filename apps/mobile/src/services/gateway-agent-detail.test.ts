import { loadGatewayAgentDetailBundle } from './gateway-agent-detail';

describe('gateway-agent-detail', () => {
  it('merges agent list, identity file, identity endpoint, and config into one bundle', async () => {
    const gateway = {
      listAgents: jest.fn().mockResolvedValue({
        defaultId: 'main',
        mainKey: 'main',
        agents: [{ id: 'agent-1', name: 'Fallback Name' }],
      }),
      fetchIdentity: jest.fn().mockResolvedValue({
        name: 'Identity Name',
        emoji: '🤖',
        avatar: '/avatar.png',
      }),
      getAgentFile: jest.fn().mockResolvedValue({
        content: [
          '# IDENTITY.md - Who Am I?',
          '',
          '- **Name:** File Name',
          '- **Vibe:** Calm and helpful',
          '- **Theme:** Ocean',
        ].join('\n'),
      }),
      getConfig: jest.fn().mockResolvedValue({
        hash: 'cfg_hash',
        config: {
          agents: {
            list: [
              {
                id: 'agent-1',
                identity: {
                  theme: 'Config Theme',
                  avatar: 'config-avatar.png',
                },
                model: {
                  primary: 'openai/gpt-4.1',
                  fallbacks: ['openai/gpt-4o-mini'],
                },
              },
            ],
          },
        },
      }),
      listModels: jest.fn(),
    };

    await expect(loadGatewayAgentDetailBundle(gateway, 'agent-1')).resolves.toEqual({
      agent: { id: 'agent-1', name: 'Fallback Name' },
      mainKey: 'main',
      configHash: 'cfg_hash',
      agentIndex: 0,
      identityFileContent: [
        '# IDENTITY.md - Who Am I?',
        '',
        '- **Name:** File Name',
        '- **Vibe:** Calm and helpful',
        '- **Theme:** Ocean',
      ].join('\n'),
      identityProfile: {
        name: 'File Name',
        emoji: '🤖',
        creature: '',
        vibe: 'Calm and helpful',
        theme: 'Ocean',
        avatar: 'config-avatar.png',
      },
      form: {
        name: 'File Name',
        emoji: '🤖',
        vibe: 'Calm and helpful',
        model: 'openai/gpt-4.1',
        fallbacks: ['openai/gpt-4o-mini'],
      },
    });
  });
});
