import {
  loadGatewayHermesModelSelection,
  saveGatewayHermesModelSelection,
} from './gateway-hermes-model-selection';

describe('gateway-hermes-model-selection', () => {
  it('loads current Hermes model selection state', async () => {
    const gateway = {
      getModelSelectionState: jest.fn().mockResolvedValue({
        currentModel: 'openai/gpt-4.1-mini',
        currentProvider: 'openrouter',
        currentBaseUrl: 'https://openrouter.ai/api/v1',
        note: 'Hermes model changes apply globally.',
        models: [{ id: 'openai/gpt-4.1-mini', name: 'openai/gpt-4.1-mini', provider: 'openrouter' }],
        providers: [{ slug: 'openrouter', name: 'OpenRouter', isCurrent: true, models: ['openai/gpt-4.1-mini'], totalModels: 1 }],
      }),
      setModelSelection: jest.fn(),
    };

    await expect(loadGatewayHermesModelSelection(gateway)).resolves.toEqual({
      currentModel: 'openai/gpt-4.1-mini',
      currentProvider: 'openrouter',
      currentBaseUrl: 'https://openrouter.ai/api/v1',
      note: 'Hermes model changes apply globally.',
      models: [{ id: 'openai/gpt-4.1-mini', name: 'openai/gpt-4.1-mini', provider: 'openrouter' }],
      providers: [{ slug: 'openrouter', name: 'OpenRouter', isCurrent: true, models: ['openai/gpt-4.1-mini'], totalModels: 1 }],
    });
  });

  it('saves Hermes model selection globally', async () => {
    const gateway = {
      getModelSelectionState: jest.fn(),
      setModelSelection: jest.fn().mockResolvedValue({
        ok: true,
        scope: 'global',
        currentModel: 'moonshot-v1-8k',
        currentProvider: 'moonshot',
        currentBaseUrl: 'https://api.moonshot.ai/v1',
        note: null,
        models: [{ id: 'moonshot-v1-8k', name: 'moonshot-v1-8k', provider: 'moonshot' }],
        providers: [{ slug: 'moonshot', name: 'Moonshot', isCurrent: true, models: ['moonshot-v1-8k'], totalModels: 1 }],
      }),
    };

    await expect(saveGatewayHermesModelSelection(gateway, {
      model: 'moonshot-v1-8k',
      provider: 'moonshot',
    })).resolves.toEqual({
      currentModel: 'moonshot-v1-8k',
      currentProvider: 'moonshot',
      currentBaseUrl: 'https://api.moonshot.ai/v1',
      note: null,
      models: [{ id: 'moonshot-v1-8k', name: 'moonshot-v1-8k', provider: 'moonshot' }],
      providers: [{ slug: 'moonshot', name: 'Moonshot', isCurrent: true, models: ['moonshot-v1-8k'], totalModels: 1 }],
    });

    expect(gateway.setModelSelection).toHaveBeenCalledWith({
      model: 'moonshot-v1-8k',
      provider: 'moonshot',
      scope: 'global',
    });
  });
});
