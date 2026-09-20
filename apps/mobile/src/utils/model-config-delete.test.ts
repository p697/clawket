import {
  analyzeModelDeletion,
  buildDeleteModelConfig,
} from './model-config-delete';

describe('model-config-delete', () => {
  it('blocks deletion when the model is not explicitly configured', () => {
    const result = analyzeModelDeletion({
      config: {},
      provider: 'openai',
      modelId: 'gpt-5.4',
    });

    expect(result.canDelete).toBe(false);
    expect(result.hasConfiguredModel).toBe(false);
    expect(result.hasAllowlistEntry).toBe(false);
    expect(result.hasPolicyAllowEntry).toBe(false);
    expect(result.blocks).toEqual([
      {
        path: 'models.providers',
        reason: 'model_not_configured',
      },
    ]);
  });

  it('blocks deletion when the model is used as a primary reference', () => {
    const result = analyzeModelDeletion({
      config: {
        models: {
          providers: {
            openai: {
              baseUrl: 'https://api.openai.com/v1',
              models: [{ id: 'gpt-5.4', name: 'GPT 5.4' }],
            },
          },
        },
        agents: {
          defaults: {
            model: { primary: 'openai/gpt-5.4' },
          },
        },
      },
      provider: 'openai',
      modelId: 'gpt-5.4',
    });

    expect(result.canDelete).toBe(false);
    expect(result.blocks).toEqual([
      {
        path: 'agents.defaults.model.primary',
        reason: 'defaults_primary',
      },
    ]);
  });

  it('removes the configured model, allowlist entry, and fallback references when safe', () => {
    const result = buildDeleteModelConfig({
      config: {
        models: {
          providers: {
            openai: {
              baseUrl: 'https://api.openai.com/v1',
              models: [
                { id: 'gpt-5.4', name: 'GPT 5.4' },
                { id: 'gpt-5.5', name: 'GPT 5.5' },
              ],
            },
          },
        },
        agents: {
          defaults: {
            models: {
              'openai/gpt-5.4': { alias: 'fast-gpt' },
            },
            model: {
              primary: 'openai/gpt-5.5',
              fallbacks: ['openai/gpt-5.4', 'fast-gpt'],
            },
            imageModel: {
              fallbacks: ['fast-gpt'],
            },
            subagents: {
              model: {
                fallbacks: ['openai/gpt-5.4'],
              },
            },
          },
          list: [
            {
              id: 'writer',
              model: {
                primary: 'openai/gpt-5.5',
                fallbacks: ['fast-gpt'],
              },
              subagents: {
                model: {
                  fallbacks: ['openai/gpt-5.4'],
                },
              },
            },
          ],
        },
      },
      provider: 'openai',
      modelId: 'gpt-5.4',
    });

    expect(result.analysis.canDelete).toBe(true);
    expect(result.analysis.hasConfiguredModel).toBe(true);
    expect(result.analysis.hasAllowlistEntry).toBe(true);
    expect(result.nextConfig).not.toBeNull();
    expect(result.nextConfig?.models).toEqual({
      providers: {
        openai: {
          baseUrl: 'https://api.openai.com/v1',
          models: [{ id: 'gpt-5.5', name: 'GPT 5.5' }],
        },
      },
    });
    expect(result.nextConfig?.agents).toEqual({
      defaults: {
        models: {},
        model: {
          primary: 'openai/gpt-5.5',
          fallbacks: [],
        },
        imageModel: {
          fallbacks: [],
        },
        subagents: {
          model: {
            fallbacks: [],
          },
        },
      },
      list: [
        {
          id: 'writer',
          model: {
            primary: 'openai/gpt-5.5',
            fallbacks: [],
          },
          subagents: {
            model: {
              fallbacks: [],
            },
          },
        },
      ],
    });
  });

  it('blocks deletion when a hook or channel override still references the model alias', () => {
    const result = analyzeModelDeletion({
      config: {
        models: {
          providers: {
            openai: {
              baseUrl: 'https://api.openai.com/v1',
              models: [{ id: 'gpt-5.4', name: 'GPT 5.4' }],
            },
          },
        },
        agents: {
          defaults: {
            models: {
              'openai/gpt-5.4': { alias: 'fast-gpt' },
            },
          },
        },
        channels: {
          modelByChannel: {
            slack: {
              ops: 'fast-gpt',
            },
          },
        },
        hooks: {
          mappings: [{ id: 'build-failures', model: 'openai/gpt-5.4' }],
        },
      },
      provider: 'openai',
      modelId: 'gpt-5.4',
    });

    expect(result.canDelete).toBe(false);
    expect(result.blocks).toEqual([
      {
        path: 'channels.modelByChannel.slack.ops',
        reason: 'channel_model_override',
        detail: 'slack/ops',
      },
      {
        path: 'hooks.mappings.0.model',
        reason: 'hook_mapping_model',
        detail: 'build-failures',
      },
    ]);
  });

  it('treats allowlist-only models as deletable without explicit provider config', () => {
    const result = buildDeleteModelConfig({
      config: {
        agents: {
          defaults: {
            models: {
              'openai/gpt-5.4': {},
            },
          },
        },
      },
      provider: 'openai',
      modelId: 'gpt-5.4',
    });

    expect(result.analysis.canDelete).toBe(true);
    expect(result.analysis.hasConfiguredModel).toBe(false);
    expect(result.analysis.hasAllowlistEntry).toBe(true);
    expect(result.analysis.cleanup).toEqual([
      {
        path: 'agents.defaults.models.openai/gpt-5.4',
        action: 'remove_allowlist_entry',
      },
    ]);
    expect(result.nextConfig).toEqual({
      agents: {
        defaults: {
          models: {},
        },
      },
    });
  });

  // Owner report 2026-09-19: a model deleted from the metadata map stayed in
  // the catalog as a synthetic lowercase row because `modelPolicy.allow`
  // (OpenClaw ≥ 2026-07-18) still named it, and the row could not be deleted.
  it('treats a model referenced only by modelPolicy.allow as deletable and strips it from every policy', () => {
    const result = buildDeleteModelConfig({
      config: {
        meta: { migrations: { modelPolicyAllowlist: true } },
        agents: {
          defaults: {
            models: { 'openai/gpt-5.5': { agentRuntime: { id: 'codex' } } },
            modelPolicy: { allow: ['anthropic/claude-opus-5', 'openai/gpt-5.4', 'openai/gpt-5.5', 'openrouter/*'] },
          },
          list: [
            { id: 'writer', modelPolicy: { allow: ['OpenAI/GPT-5.4', 'openai/*'] } },
            { id: 'reader', modelPolicy: {} },
          ],
        },
      },
      provider: 'openai',
      modelId: 'gpt-5.4',
    });

    expect(result.analysis.canDelete).toBe(true);
    expect(result.analysis.hasConfiguredModel).toBe(false);
    expect(result.analysis.hasAllowlistEntry).toBe(false);
    expect(result.analysis.hasPolicyAllowEntry).toBe(true);
    expect(result.analysis.cleanup).toEqual([
      { path: 'agents.defaults.modelPolicy.allow', action: 'remove_policy_allow_entry' },
      { path: 'agents.list.0.modelPolicy.allow', action: 'remove_policy_allow_entry' },
    ]);
    expect(result.nextConfig?.agents).toEqual({
      defaults: {
        models: { 'openai/gpt-5.5': { agentRuntime: { id: 'codex' } } },
        modelPolicy: { allow: ['anthropic/claude-opus-5', 'openai/gpt-5.5', 'openrouter/*'] },
      },
      list: [
        { id: 'writer', modelPolicy: { allow: ['openai/*'] } },
        { id: 'reader', modelPolicy: {} },
      ],
    });
  });

  it('removes the policy entry by alias alongside the metadata map entry', () => {
    const result = buildDeleteModelConfig({
      config: {
        agents: {
          defaults: {
            models: { 'openai/gpt-5.4': { alias: 'fast-gpt' } },
            modelPolicy: { allow: ['fast-gpt', 'openai/gpt-5.5'] },
          },
        },
      },
      provider: 'openai',
      modelId: 'gpt-5.4',
    });

    expect(result.analysis.cleanup).toEqual([
      { path: 'agents.defaults.models.openai/gpt-5.4', action: 'remove_allowlist_entry' },
      { path: 'agents.defaults.modelPolicy.allow', action: 'remove_policy_allow_entry' },
    ]);
    expect(result.nextConfig).toEqual({
      agents: { defaults: { models: {}, modelPolicy: { allow: ['openai/gpt-5.5'] } } },
    });
  });

  it('leaves a provider wildcard alone and reports a catalog-only model as not configured', () => {
    const result = analyzeModelDeletion({
      config: {
        agents: { defaults: { modelPolicy: { allow: ['openai/*'] } } },
      },
      provider: 'openai',
      modelId: 'gpt-5.4',
    });

    expect(result.canDelete).toBe(false);
    expect(result.hasPolicyAllowEntry).toBe(false);
    expect(result.blocks).toEqual([{ path: 'models.providers', reason: 'model_not_configured' }]);
  });
});
