import {
  buildModelCatalogPatch,
  buildModelCatalogState,
  modelReference,
} from './model-catalog';

const config = {
  agents: {
    defaults: {
      model: { primary: 'openai/gpt-5', fallbacks: ['anthropic/sonnet'] },
      thinkingDefault: 'medium',
      models: { 'openai/gpt-5': {}, 'anthropic/sonnet': { alias: 'Sonnet' } },
    },
  },
  models: {
    providers: {
      openai: {
        baseUrl: 'https://api.openai.com/v1',
        api: 'openai-responses',
        models: [
          { id: 'gpt-5', name: 'GPT-5', cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0 } },
          { id: 'config-only', name: 'Config only' },
        ],
      },
      empty: { baseUrl: 'https://empty.example.com' },
    },
  },
};

const catalog = [
  { id: 'gpt-5', name: 'GPT-5', provider: 'openai', contextWindow: 200_000 },
  { id: 'sonnet', name: 'Sonnet', provider: 'anthropic', reasoning: true },
];

describe('model-catalog', () => {
  it('merges the live catalog with configured models, providers and allowlist', () => {
    const state = buildModelCatalogState(config, catalog);
    expect(state.defaults).toEqual({
      primary: 'openai/gpt-5',
      fallbacks: ['anthropic/sonnet'],
      thinkingDefault: 'medium',
    });
    expect(state.allowlist).toEqual(['anthropic/sonnet', 'openai/gpt-5']);
    expect(state.providers.map((provider) => provider.slug)).toEqual(['anthropic', 'empty', 'openai']);
    expect(state.providers[0]).toMatchObject({ explicit: false, models: [{ id: 'sonnet', configured: false, costOverridden: false }] });
    expect(state.providers[1]).toMatchObject({ explicit: true, baseUrl: 'https://empty.example.com', models: [] });
    expect(state.providers[2]).toMatchObject({
      explicit: true,
      baseUrl: 'https://api.openai.com/v1',
      api: 'openai-responses',
    });
    expect(state.providers[2]?.models).toEqual([
      { id: 'config-only', name: 'Config only', provider: 'openai', configured: true, costOverridden: false },
      {
        id: 'gpt-5', name: 'GPT-5', provider: 'openai', contextWindow: 200_000,
        configured: true, costOverridden: true, cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0 },
      },
    ]);
  });

  it('treats a missing allowlist as open and tolerates an empty config', () => {
    const state = buildModelCatalogState(null, [{ id: '', name: 'Nameless', provider: 'x' }, { id: ' ', name: '', provider: 'x' }]);
    expect(state.allowlist).toBeNull();
    expect(state.defaults).toEqual({ primary: '', fallbacks: [], thinkingDefault: '' });
    expect(state.providers).toEqual([{ slug: 'x', explicit: false, models: [{ id: 'Nameless', name: 'Nameless', provider: 'x', configured: false, costOverridden: false }] }]);
    expect(modelReference('openai', 'gpt')).toBe('openai/gpt');
    expect(modelReference('', 'gpt')).toBe('gpt');
    expect(modelReference('openai', 'other/gpt')).toBe('other/gpt');
  });

  it('builds one patch for defaults and allowlist changes and keeps defaults allowlisted', () => {
    const patch = buildModelCatalogPatch(config, {
      defaults: { primary: 'openai/config-only', fallbacks: ['openai/gpt-5', 'openai/config-only'], thinkingDefault: '' },
      allowlist: [
        { provider: 'anthropic', modelId: 'sonnet', enabled: false },
        { provider: 'openai', modelId: 'gpt-5', enabled: true },
      ],
    });
    expect(patch).toEqual({
      patch: {
        agents: {
          defaults: {
            model: { primary: 'openai/config-only', fallbacks: ['openai/gpt-5'] },
            thinkingDefault: null,
            models: { 'anthropic/sonnet': null, 'openai/config-only': {} },
          },
        },
      },
      replacePaths: ['agents.defaults.model.fallbacks'],
    });
  });

  it('asks the Gateway for array consent only when an existing fallback list is rewritten', () => {
    const shrink = buildModelCatalogPatch(config, {
      defaults: { primary: 'openai/gpt-5', fallbacks: [], thinkingDefault: 'medium' },
    });
    expect(shrink).toEqual({
      patch: { agents: { defaults: { model: { primary: 'openai/gpt-5', fallbacks: null } } } },
      replacePaths: ['agents.defaults.model.fallbacks'],
    });
    const allowlistOnly = buildModelCatalogPatch(config, {
      allowlist: [{ provider: 'openai', modelId: 'config-only', enabled: true }],
    });
    expect(allowlistOnly?.replacePaths).toEqual([]);
    const noArrayYet = buildModelCatalogPatch({ agents: { defaults: { model: { primary: 'openai/gpt-5' } } } }, {
      defaults: { primary: 'openai/gpt-5', fallbacks: ['anthropic/sonnet'], thinkingDefault: '' },
    });
    expect(noArrayYet).toEqual({
      patch: { agents: { defaults: { model: { primary: 'openai/gpt-5', fallbacks: ['anthropic/sonnet'] } } } },
      replacePaths: [],
    });
  });

  it('returns null when nothing changes and clears defaults with null leaves', () => {
    expect(buildModelCatalogPatch(config, {
      defaults: { primary: 'openai/gpt-5', fallbacks: ['anthropic/sonnet'], thinkingDefault: 'medium' },
      allowlist: [{ provider: 'openai', modelId: 'gpt-5', enabled: true }],
    })).toBeNull();
    expect(buildModelCatalogPatch(config, {})).toBeNull();
    expect(buildModelCatalogPatch(config, {
      defaults: { primary: '', fallbacks: [], thinkingDefault: 'medium' },
    })).toEqual({ patch: { agents: { defaults: { model: null } } }, replacePaths: ['agents.defaults.model.fallbacks'] });
    expect(buildModelCatalogPatch(null, {
      defaults: { primary: 'openai/gpt-5', fallbacks: [], thinkingDefault: 'low' },
    })).toEqual({
      patch: { agents: { defaults: { model: { primary: 'openai/gpt-5', fallbacks: null }, thinkingDefault: 'low' } } },
      replacePaths: [],
    });
  });
});
