import {
  listGatewayModelRefs,
  loadGatewayModelPickerOptions,
  loadGatewayModelsConfigBundle,
} from './gateway-models';

describe('gateway-models', () => {
  it('deduplicates and sorts model refs', () => {
    expect(listGatewayModelRefs([
      { provider: 'openai', id: 'gpt-4.1', name: 'GPT 4.1' },
      { provider: 'anthropic', id: 'claude-3.7', name: 'Claude 3.7' },
      { provider: 'openai', id: 'gpt-4.1', name: 'GPT 4.1 duplicate' },
    ])).toEqual([
      'anthropic/claude-3.7',
      'openai/gpt-4.1',
    ]);
  });

  it('loads models and config as one bundle', async () => {
    const gateway = {
      listModels: jest.fn().mockResolvedValue([
        { provider: 'openai', id: 'gpt-4.1', name: 'GPT 4.1' },
      ]),
      getConfig: jest.fn().mockResolvedValue({
        config: { models: { default: 'openai/gpt-4.1' } },
        hash: 'cfg_hash',
      }),
    };

    await expect(loadGatewayModelsConfigBundle(gateway)).resolves.toEqual({
      models: [{ provider: 'openai', id: 'gpt-4.1', name: 'GPT 4.1' }],
      config: { models: { default: 'openai/gpt-4.1' } },
      configHash: 'cfg_hash',
    });
  });

  it('maps gateway models to model picker options', async () => {
    const gateway = {
      listModels: jest.fn().mockResolvedValue([
        { provider: 'openai', id: 'gpt-4.1', name: 'GPT 4.1' },
        { provider: 'anthropic', id: 'claude-3.7', name: 'Claude 3.7' },
      ]),
    };

    await expect(loadGatewayModelPickerOptions(gateway)).resolves.toEqual([
      { provider: 'openai', id: 'gpt-4.1', name: 'GPT 4.1' },
      { provider: 'anthropic', id: 'claude-3.7', name: 'Claude 3.7' },
    ]);
  });
});
