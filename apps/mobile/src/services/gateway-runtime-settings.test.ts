import {
  DEFAULT_GATEWAY_RUNTIME_SETTINGS,
  loadGatewayRuntimeSettingsBundle,
} from './gateway-runtime-settings';

describe('gateway-runtime-settings service', () => {
  it('returns defaults when config is not readable', async () => {
    const gateway = {
      listModels: jest.fn().mockResolvedValue([
        { provider: 'openai', id: 'gpt-4.1', name: 'GPT 4.1' },
      ]),
      getConfig: jest.fn(),
    };

    await expect(loadGatewayRuntimeSettingsBundle(gateway, {
      canReadConfig: false,
      canListModels: true,
    })).resolves.toEqual({
      settings: DEFAULT_GATEWAY_RUNTIME_SETTINGS,
      configHash: null,
      availableModels: ['openai/gpt-4.1'],
    });
  });

  it('loads parsed runtime settings and model refs', async () => {
    const gateway = {
      listModels: jest.fn().mockResolvedValue([
        { provider: 'openai', id: 'gpt-4.1', name: 'GPT 4.1' },
        { provider: 'anthropic', id: 'claude-3.7', name: 'Claude 3.7' },
      ]),
      getConfig: jest.fn().mockResolvedValue({
        config: {
          agents: {
            defaults: {
              heartbeat: {
                every: '30m',
                session: 'heartbeat',
                model: 'openai/gpt-4.1',
                activeHours: {
                  start: '09:00',
                  end: '18:00',
                  timezone: 'Asia/Shanghai',
                },
              },
              model: {
                primary: 'openai/gpt-4.1',
                fallbacks: ['anthropic/claude-3.7'],
              },
              thinkingDefault: 'medium',
            },
          },
        },
        hash: 'runtime_hash',
      }),
    };

    await expect(loadGatewayRuntimeSettingsBundle(gateway, {
      canReadConfig: true,
      canListModels: true,
    })).resolves.toEqual({
      settings: {
        heartbeatEvery: '30m',
        heartbeatActiveStart: '09:00',
        heartbeatActiveEnd: '18:00',
        heartbeatActiveTimezone: 'Asia/Shanghai',
        heartbeatSession: 'heartbeat',
        heartbeatModel: 'openai/gpt-4.1',
        defaultModel: 'openai/gpt-4.1',
        fallbackModels: ['anthropic/claude-3.7'],
        thinkingDefault: 'medium',
      },
      configHash: 'runtime_hash',
      availableModels: ['anthropic/claude-3.7', 'openai/gpt-4.1'],
    });
  });
});
