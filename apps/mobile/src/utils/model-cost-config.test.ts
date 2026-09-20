import {
  areModelCostsEqual,
  buildAddModelPatch,
  buildBatchModelAllowlistPatch,
  buildModelAllowlistPatch,
  buildModelCostPatch,
  hasConfiguredModel,
  hasExplicitModelAllowlist,
  isModelInAllowlist,
  listConfiguredModelAllowlistRefs,
  listExplicitConfiguredModels,
  listExplicitProviders,
  matchesAllowlistEntry,
  patchRewritesModelPolicyAllow,
  readModelPolicyAllow,
  resolveModelAllowlistMode,
  resolveModelCostEditorState,
  type ModelCostValue,
} from './model-cost-config';

const CATALOG_COST: ModelCostValue = {
  input: 1.25,
  output: 5,
  cacheRead: 0.25,
  cacheWrite: 1.5,
};

describe('model-cost-config', () => {
  it('lists explicit providers in sorted order', () => {
    expect(listExplicitProviders({
      models: {
        providers: {
          zed: { baseUrl: 'https://z.example.com', models: [] },
          openai: { baseUrl: 'https://api.openai.com/v1', models: [] },
        },
      },
    })).toEqual(['openai', 'zed']);
  });

  it('lists explicitly configured models', () => {
    expect(listExplicitConfiguredModels({
      models: {
        providers: {
          openai: {
            baseUrl: 'https://api.openai.com/v1',
            models: [{ id: 'gpt-5', name: 'GPT-5' }],
          },
          anthropic: {
            baseUrl: 'https://api.anthropic.com',
            models: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' }],
          },
        },
      },
    })).toEqual([
      { provider: 'anthropic', modelId: 'claude-sonnet-4-6', modelName: 'Claude Sonnet 4.6' },
      { provider: 'openai', modelId: 'gpt-5', modelName: 'GPT-5' },
    ]);
  });

  it('uses configured override when model exists in provider config', () => {
    const state = resolveModelCostEditorState({
      config: {
        models: {
          providers: {
            openai: {
              baseUrl: 'https://api.openai.com/v1',
              models: [
                {
                  id: 'gpt-5',
                  name: 'GPT-5',
                  cost: CATALOG_COST,
                },
              ],
            },
          },
        },
      },
      provider: 'openai',
      modelId: 'gpt-5',
      catalogCost: null,
    });

    expect(state).toEqual({
      editable: true,
      hasExistingOverride: true,
      source: 'configured',
      cost: CATALOG_COST,
    });
  });

  it('falls back to catalog cost for configured provider without explicit model override', () => {
    const state = resolveModelCostEditorState({
      config: {
        models: {
          providers: {
            openai: {
              baseUrl: 'https://api.openai.com/v1',
              models: [],
            },
          },
        },
      },
      provider: 'openai',
      modelId: 'gpt-5',
      catalogCost: CATALOG_COST,
    });

    expect(state).toEqual({
      editable: true,
      hasExistingOverride: false,
      source: 'catalog',
      cost: CATALOG_COST,
    });
  });

  it('blocks editing when provider is not explicitly configured', () => {
    const state = resolveModelCostEditorState({
      config: {
        models: {
          providers: {},
        },
      },
      provider: 'openai',
      modelId: 'gpt-5',
      catalogCost: CATALOG_COST,
    });

    expect(state).toEqual({
      editable: false,
      hasExistingOverride: false,
      source: 'catalog',
      blockReason: 'provider_missing',
      cost: CATALOG_COST,
    });
  });

  it('builds a minimal merge patch for an existing model', () => {
    const patch = buildModelCostPatch({
      config: {
        models: {
          providers: {
            openai: {
              baseUrl: 'https://api.openai.com/v1',
              models: [{ id: 'gpt-5', name: 'GPT-5' }],
            },
          },
        },
      },
      provider: 'openai',
      modelId: 'gpt-5',
      modelName: 'GPT-5',
      cost: CATALOG_COST,
    });

    expect(patch).toEqual({
      models: {
        providers: {
          openai: {
            models: [
              {
                id: 'gpt-5',
                cost: CATALOG_COST,
              },
            ],
          },
        },
      },
    });
  });

  it('adds the name when creating a new model override in an existing provider', () => {
    const patch = buildModelCostPatch({
      config: {
        models: {
          providers: {
            openai: {
              baseUrl: 'https://api.openai.com/v1',
              models: [],
            },
          },
        },
      },
      provider: 'openai',
      modelId: 'gpt-5',
      modelName: 'GPT-5',
      cost: CATALOG_COST,
    });

    expect(patch).toEqual({
      models: {
        providers: {
          openai: {
            models: [
              {
                id: 'gpt-5',
                name: 'GPT-5',
                cost: CATALOG_COST,
              },
            ],
          },
        },
      },
    });
  });

  it('refuses to build a patch when provider config is missing', () => {
    const patch = buildModelCostPatch({
      config: { models: { providers: {} } },
      provider: 'openai',
      modelId: 'gpt-5',
      modelName: 'GPT-5',
      cost: CATALOG_COST,
    });

    expect(patch).toBeNull();
  });

  it('detects whether a model already exists in the explicit provider config', () => {
    expect(hasConfiguredModel({
      models: {
        providers: {
          openai: {
            baseUrl: 'https://api.openai.com/v1',
            models: [{ id: 'gpt-5', name: 'GPT-5' }],
          },
        },
      },
    }, 'openai', 'gpt-5')).toBe(true);

    expect(hasConfiguredModel({
      models: {
        providers: {
          openai: {
            baseUrl: 'https://api.openai.com/v1',
            models: [{ id: 'gpt-5', name: 'GPT-5' }],
          },
        },
      },
    }, 'openai', 'gpt-5-mini')).toBe(false);
  });

  it('tracks raw allowlist membership independently of effective visibility', () => {
    const config = {
      agents: {
        defaults: {
          models: {
            'openai/gpt-5': {},
          },
        },
      },
    };

    expect(hasExplicitModelAllowlist(config)).toBe(true);
    expect(listConfiguredModelAllowlistRefs(config)).toEqual(['openai/gpt-5']);
    expect(isModelInAllowlist(config, 'openai', 'gpt-5')).toBe(true);
    expect(isModelInAllowlist(config, 'openai', 'gpt-5.4-pro')).toBe(false);
  });

  it('builds a minimal patch for adding a new model to an explicit provider', () => {
    const patch = buildAddModelPatch({
      config: {
        models: {
          providers: {
            openai: {
              baseUrl: 'https://api.openai.com/v1',
              models: [{ id: 'gpt-5', name: 'GPT-5' }],
            },
          },
        },
      },
      provider: 'openai',
      modelId: 'gpt-5.4-pro',
      modelName: 'GPT-5.4 Pro',
    });

    expect(patch).toEqual({
      models: {
        providers: {
          openai: {
            models: [
              {
                id: 'gpt-5.4-pro',
                name: 'GPT-5.4 Pro',
              },
            ],
          },
        },
      },
    });
  });

  it('adds the new model to agents.defaults.models when a non-empty allowlist already exists', () => {
    const patch = buildAddModelPatch({
      config: {
        models: {
          providers: {
            openai: {
              baseUrl: 'https://api.openai.com/v1',
              models: [{ id: 'gpt-5', name: 'GPT-5' }],
            },
          },
        },
        agents: {
          defaults: {
            models: {
              'openai/gpt-5': {},
            },
          },
        },
      },
      provider: 'openai',
      modelId: 'gpt-5.4-pro',
      modelName: 'GPT-5.4 Pro',
    });

    expect(patch).toEqual({
      models: {
        providers: {
          openai: {
            models: [
              {
                id: 'gpt-5.4-pro',
                name: 'GPT-5.4 Pro',
              },
            ],
          },
        },
      },
      agents: {
        defaults: {
          models: {
            'openai/gpt-5.4-pro': { alias: 'GPT-5.4 Pro' },
          },
        },
      },
    });
  });

  it('refuses to add a duplicate model to an explicit provider', () => {
    const patch = buildAddModelPatch({
      config: {
        models: {
          providers: {
            openai: {
              baseUrl: 'https://api.openai.com/v1',
              models: [{ id: 'gpt-5', name: 'GPT-5' }],
            },
          },
        },
      },
      provider: 'openai',
      modelId: 'gpt-5',
      modelName: 'GPT-5',
    });

    expect(patch).toBeNull();
  });

  it('builds a patch for enabling a model in the allowlist', () => {
    const patch = buildModelAllowlistPatch({
      config: {
        agents: {
          defaults: {
            models: {
              'openai/gpt-5': {},
            },
          },
        },
      },
      provider: 'openai',
      modelId: 'gpt-5.4-pro',
      enabled: true,
    });

    expect(patch).toEqual({
      agents: {
        defaults: {
          models: {
            'openai/gpt-5.4-pro': {},
          },
        },
      },
    });
  });

  it('builds a patch for disabling a model in the allowlist', () => {
    const patch = buildModelAllowlistPatch({
      config: {
        agents: {
          defaults: {
            models: {
              'openai/gpt-5.4-pro': {},
            },
          },
        },
      },
      provider: 'openai',
      modelId: 'gpt-5.4-pro',
      enabled: false,
    });

    expect(patch).toEqual({
      agents: {
        defaults: {
          models: {
            'openai/gpt-5.4-pro': null,
          },
        },
      },
    });
  });

  it('does not build an allowlist patch when the membership is unchanged', () => {
    expect(buildModelAllowlistPatch({
      config: {
        agents: {
          defaults: {
            models: {
              'openai/gpt-5': {},
            },
          },
        },
      },
      provider: 'openai',
      modelId: 'gpt-5',
      enabled: true,
    })).toBeNull();
  });

  it('builds a single batch patch for mixed allowlist changes', () => {
    const patch = buildBatchModelAllowlistPatch({
      config: {
        agents: {
          defaults: {
            models: {
              'openai/gpt-5': {},
              'anthropic/claude-sonnet-4-6': {},
            },
          },
        },
      },
      changes: [
        { provider: 'openai', modelId: 'gpt-5', enabled: false },
        { provider: 'openai', modelId: 'gpt-5.4-pro', enabled: true },
        { provider: 'anthropic', modelId: 'claude-sonnet-4-6', enabled: true },
      ],
    });

    expect(patch).toEqual({
      agents: {
        defaults: {
          models: {
            'openai/gpt-5': null,
            'openai/gpt-5.4-pro': {},
          },
        },
      },
    });
  });

  it('skips a batch allowlist patch when every membership is unchanged', () => {
    expect(buildBatchModelAllowlistPatch({
      config: {
        agents: {
          defaults: {
            models: {
              'openai/gpt-5': {},
            },
          },
        },
      },
      changes: [
        { provider: 'openai', modelId: 'gpt-5', enabled: true },
      ],
    })).toBeNull();
  });

  it('compares model costs exactly', () => {
    expect(areModelCostsEqual(CATALOG_COST, { ...CATALOG_COST })).toBe(true);
    expect(areModelCostsEqual(CATALOG_COST, { ...CATALOG_COST, output: 6 })).toBe(false);
  });
});

/**
 * OpenClaw ≥ 2026-07-18: `agents.defaults.modelPolicy.allow` is the allowlist
 * and `agents.defaults.models` is per-model metadata only.
 */
describe('model-cost-config · modelPolicy allowlist', () => {
  const policyConfig = {
    meta: { migrations: { modelPolicyAllowlist: true } },
    agents: {
      defaults: {
        models: {
          'openai/gpt-5.5': { agentRuntime: { id: 'codex' } },
          'anthropic/claude-opus-4-8': { agentRuntime: { id: 'claude-cli' } },
        },
        modelPolicy: { allow: ['openai/gpt-5.4', 'openai/gpt-5.5', 'openrouter/*'] },
      },
    },
  };

  it('detects the policy semantics from the modelPolicy object or the migration marker', () => {
    expect(resolveModelAllowlistMode(policyConfig)).toBe('policy');
    expect(resolveModelAllowlistMode({ agents: { defaults: { modelPolicy: {} } } })).toBe('policy');
    expect(resolveModelAllowlistMode({ meta: { migrations: { modelPolicyAllowlist: true } } })).toBe('policy');
    expect(resolveModelAllowlistMode({ agents: { defaults: { models: { 'openai/gpt-5': {} } } } })).toBe('legacy');
    expect(resolveModelAllowlistMode({ meta: { migrations: { modelPolicyAllowlist: 'yes' } } })).toBe('legacy');
    expect(resolveModelAllowlistMode(null)).toBe('legacy');
  });

  it('reads the policy entries in config order and ignores the metadata map keys', () => {
    expect(readModelPolicyAllow(policyConfig)).toEqual(['openai/gpt-5.4', 'openai/gpt-5.5', 'openrouter/*']);
    expect(readModelPolicyAllow({ agents: { defaults: { modelPolicy: { allow: [' a/b ', 3, ''] } } } })).toEqual(['a/b']);
    expect(readModelPolicyAllow({ agents: { defaults: { modelPolicy: {} } } })).toBeNull();
    expect(hasExplicitModelAllowlist(policyConfig)).toBe(true);
    expect(listConfiguredModelAllowlistRefs(policyConfig)).toEqual(['openai/gpt-5.4', 'openai/gpt-5.5', 'openrouter/*']);
    // A key in the metadata map alone no longer allows the model.
    expect(isModelInAllowlist(policyConfig, 'anthropic', 'claude-opus-4-8')).toBe(false);
    expect(isModelInAllowlist(policyConfig, 'openai', 'gpt-5.4')).toBe(true);
    expect(isModelInAllowlist(policyConfig, 'OpenAI', 'GPT-5.4')).toBe(true);
    expect(isModelInAllowlist(policyConfig, 'openrouter', 'google/gemini-3.8-flash')).toBe(true);
    expect(isModelInAllowlist(policyConfig, 'openrouterx', 'model')).toBe(false);
  });

  it('treats an empty or absent policy allow as open even when the metadata map has keys', () => {
    const open = { agents: { defaults: { models: { 'openai/gpt-5': {} }, modelPolicy: { allow: [] } } } };
    expect(hasExplicitModelAllowlist(open)).toBe(false);
    expect(listConfiguredModelAllowlistRefs(open)).toEqual([]);
    expect(isModelInAllowlist(open, 'openai', 'gpt-5')).toBe(false);
    const marked = { meta: { migrations: { modelPolicyAllowlist: true } }, agents: { defaults: { models: { 'openai/gpt-5': {} } } } };
    expect(hasExplicitModelAllowlist(marked)).toBe(false);
  });

  it('matches exact references case-insensitively and wildcards on segment boundaries', () => {
    expect(matchesAllowlistEntry('openai/gpt-5.4', 'OpenAI/GPT-5.4')).toBe(true);
    expect(matchesAllowlistEntry('openai/gpt-5.4', 'openai/gpt-5.4-mini')).toBe(false);
    expect(matchesAllowlistEntry('openai/*', 'openai/gpt-5.4')).toBe(true);
    expect(matchesAllowlistEntry('openrouter/openai/*', 'openrouter/openai/gpt-5.6-luna')).toBe(true);
    expect(matchesAllowlistEntry('openrouter/openai/*', 'openrouter/google/gemini')).toBe(false);
    expect(matchesAllowlistEntry('open/*', 'openai/gpt-5.4')).toBe(false);
  });

  it('rewrites the policy allow list and keeps metadata when disabling', () => {
    const patch = buildBatchModelAllowlistPatch({
      config: policyConfig,
      changes: [
        { provider: 'openai', modelId: 'gpt-5.5', enabled: false },
        { provider: 'openai', modelId: 'gpt-5.4', enabled: true },
      ],
    });
    expect(patch).toEqual({
      agents: { defaults: { modelPolicy: { allow: ['openai/gpt-5.4', 'openrouter/*'] } } },
    });
    expect(patchRewritesModelPolicyAllow(patch)).toBe(true);
    expect(patchRewritesModelPolicyAllow({ agents: { defaults: { models: { 'openai/gpt-5': null } } } })).toBe(false);
  });

  it('appends newly allowed refs with a metadata entry, as the OpenClaw picker does', () => {
    expect(buildBatchModelAllowlistPatch({
      config: policyConfig,
      changes: [
        { provider: 'anthropic', modelId: 'claude-opus-4-8', enabled: true },
        { provider: 'deepseek', modelId: 'deepseek-flash', enabled: true },
        { provider: 'openrouter', modelId: 'google/gemini-3.8-flash', enabled: true },
      ],
    })).toEqual({
      agents: {
        defaults: {
          modelPolicy: { allow: ['openai/gpt-5.4', 'openai/gpt-5.5', 'openrouter/*', 'anthropic/claude-opus-4-8', 'deepseek/deepseek-flash'] },
          models: { 'deepseek/deepseek-flash': {} },
        },
      },
    });
  });

  it('expands a wildcard into explicit refs when one of its models is disabled', () => {
    expect(buildBatchModelAllowlistPatch({
      config: policyConfig,
      changes: [
        { provider: 'openrouter', modelId: 'google/gemini-3.8-flash', enabled: false },
        { provider: 'openrouter', modelId: 'qwen/qwen3.8-flash', enabled: true },
        { provider: 'openai', modelId: 'gpt-5.4', enabled: true },
      ],
    })).toEqual({
      agents: {
        defaults: {
          modelPolicy: { allow: ['openai/gpt-5.4', 'openai/gpt-5.5', 'openrouter/qwen/qwen3.8-flash'] },
          models: { 'openrouter/qwen/qwen3.8-flash': {} },
        },
      },
    });
  });

  it('skips a policy patch when every membership is unchanged', () => {
    expect(buildBatchModelAllowlistPatch({
      config: policyConfig,
      changes: [
        { provider: 'openai', modelId: 'gpt-5.4', enabled: true },
        { provider: 'openrouter', modelId: 'x/y', enabled: true },
        { provider: 'anthropic', modelId: 'claude-opus-4-8', enabled: false },
      ],
    })).toBeNull();
    expect(buildModelAllowlistPatch({ config: policyConfig, provider: 'openai', modelId: 'gpt-5.4', enabled: false })).toEqual({
      agents: { defaults: { modelPolicy: { allow: ['openai/gpt-5.5', 'openrouter/*'] } } },
    });
  });

  it('adds a model to the policy allow list and the metadata map', () => {
    expect(buildAddModelPatch({ config: policyConfig, provider: 'anthropic', modelId: 'claude-sonnet-5', modelName: 'Sonnet 5' })).toEqual({
      agents: {
        defaults: {
          models: { 'anthropic/claude-sonnet-5': { alias: 'Sonnet 5' } },
          modelPolicy: { allow: ['openai/gpt-5.4', 'openai/gpt-5.5', 'openrouter/*', 'anthropic/claude-sonnet-5'] },
        },
      },
    });
    // Metadata exists but the policy no longer allows it: only the policy changes.
    expect(buildAddModelPatch({ config: policyConfig, provider: 'anthropic', modelId: 'claude-opus-4-8', modelName: 'claude-opus-4-8' })).toEqual({
      agents: {
        defaults: {
          modelPolicy: { allow: ['openai/gpt-5.4', 'openai/gpt-5.5', 'openrouter/*', 'anthropic/claude-opus-4-8'] },
        },
      },
    });
    // Allowed by a wildcard without metadata: only the metadata entry is added.
    expect(buildAddModelPatch({ config: policyConfig, provider: 'openrouter', modelId: 'x/y', modelName: 'x/y' })).toEqual({
      agents: { defaults: { models: { 'openrouter/x/y': {} } } },
    });
    // Allowed and described already.
    expect(buildAddModelPatch({ config: policyConfig, provider: 'openai', modelId: 'gpt-5.5', modelName: 'GPT-5.5' })).toBeNull();
  });

  it('adds a model to an explicit provider on an open policy config without touching the policy', () => {
    const config = {
      ...policyConfig,
      agents: { defaults: { models: {}, modelPolicy: { allow: [] } } },
      models: { providers: { openai: { baseUrl: 'https://api.openai.com/v1', models: [{ id: 'gpt-5', name: 'GPT-5' }] } } },
    };
    expect(buildAddModelPatch({ config, provider: 'openai', modelId: 'gpt-5.4', modelName: 'GPT-5.4' })).toEqual({
      models: { providers: { openai: { models: [{ id: 'gpt-5.4', name: 'GPT-5.4' }] } } },
    });
    expect(buildAddModelPatch({ config, provider: 'anthropic', modelId: 'claude-sonnet-5', modelName: 'Sonnet 5' })).toEqual({
      agents: { defaults: { models: { 'anthropic/claude-sonnet-5': { alias: 'Sonnet 5' } } } },
    });
  });
});
