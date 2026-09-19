type ConfigObject = Record<string, unknown>;

export type ModelDeleteBlock = {
  path: string;
  reason:
    | 'model_not_configured'
    | 'defaults_primary'
    | 'defaults_image_primary'
    | 'defaults_pdf_primary'
    | 'defaults_heartbeat_model'
    | 'defaults_compaction_model'
    | 'defaults_memory_search_model'
    | 'defaults_subagents_primary'
    | 'agent_primary'
    | 'agent_heartbeat_model'
    | 'agent_subagents_primary'
    | 'channel_model_override'
    | 'hook_mapping_model'
    | 'hook_gmail_model';
  detail?: string;
};

export type ModelDeleteCleanup = {
  path: string;
  action:
    | 'remove_configured_model'
    | 'remove_allowlist_entry'
    | 'remove_policy_allow_entry'
    | 'remove_defaults_fallback'
    | 'remove_defaults_image_fallback'
    | 'remove_defaults_pdf_fallback'
    | 'remove_defaults_subagents_fallback'
    | 'remove_agent_fallback'
    | 'remove_agent_subagents_fallback';
  detail?: string;
};

export type ModelDeleteAnalysis = {
  canDelete: boolean;
  hasConfiguredModel: boolean;
  /** A key in the `agents.defaults.models` map (legacy allowlist, metadata on a policy config). */
  hasAllowlistEntry: boolean;
  /** An exact reference in `agents.defaults.modelPolicy.allow` or an Agent's `modelPolicy.allow`. */
  hasPolicyAllowEntry: boolean;
  blocks: ModelDeleteBlock[];
  cleanup: ModelDeleteCleanup[];
};

export type ModelDeleteResult = {
  analysis: ModelDeleteAnalysis;
  nextConfig: ConfigObject | null;
};

type AgentModelLike = {
  primary?: unknown;
  fallbacks?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneConfig<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeModelRef(provider: string, modelId: string): string {
  return normalizeToken(`${provider}/${modelId}`);
}

function findProviderConfig(config: ConfigObject | null | undefined, provider: string): Record<string, unknown> | null {
  const models = config?.models;
  if (!isRecord(models)) return null;
  const providers = models.providers;
  if (!isRecord(providers)) return null;
  const providerEntry = providers[provider];
  return isRecord(providerEntry) ? providerEntry : null;
}

function findConfiguredModelEntry(config: ConfigObject | null | undefined, provider: string, modelId: string): Record<string, unknown> | null {
  const providerConfig = findProviderConfig(config, provider);
  if (!providerConfig || !Array.isArray(providerConfig.models)) return null;
  const match = providerConfig.models.find((entry) => isRecord(entry) && entry.id === modelId);
  return isRecord(match) ? match : null;
}

function getModelAlias(config: ConfigObject | null | undefined, provider: string, modelId: string): string | null {
  const defaults = isRecord(config?.agents) && isRecord(config.agents.defaults)
    ? config.agents.defaults
    : null;
  const modelMap = defaults && isRecord(defaults.models) ? defaults.models : null;
  const key = `${provider}/${modelId}`;
  if (!modelMap) return null;

  for (const [entryKey, entryValue] of Object.entries(modelMap)) {
    if (normalizeToken(entryKey) !== normalizeToken(key) || !isRecord(entryValue)) {
      continue;
    }
    const alias = typeof entryValue.alias === 'string' ? entryValue.alias.trim() : '';
    return alias || null;
  }
  return null;
}

function matchesTarget(raw: unknown, matchers: Set<string>): boolean {
  return typeof raw === 'string' && matchers.has(normalizeToken(raw));
}

function toAgentModelLike(raw: unknown): AgentModelLike | null {
  if (typeof raw === 'string') {
    return { primary: raw };
  }
  return isRecord(raw) ? raw : null;
}

function collectFallbackIndexes(raw: unknown, matchers: Set<string>): number[] {
  const model = toAgentModelLike(raw);
  if (!model || !Array.isArray(model.fallbacks)) {
    return [];
  }
  const indexes: number[] = [];
  model.fallbacks.forEach((value, index) => {
    if (matchesTarget(value, matchers)) {
      indexes.push(index);
    }
  });
  return indexes;
}

function removeFallbacks(raw: unknown, matchers: Set<string>): unknown {
  if (typeof raw === 'string') {
    return raw;
  }
  if (!isRecord(raw) || !Array.isArray(raw.fallbacks)) {
    return raw;
  }
  return {
    ...raw,
    fallbacks: raw.fallbacks.filter((value) => !matchesTarget(value, matchers)),
  };
}

function hasAllowlistEntry(config: ConfigObject | null | undefined, provider: string, modelId: string): boolean {
  const agents = isRecord(config?.agents) ? config.agents : null;
  const defaults = agents && isRecord(agents.defaults) ? agents.defaults : null;
  const models = defaults && isRecord(defaults.models) ? defaults.models : null;
  if (!models) return false;
  const targetKey = normalizeModelRef(provider, modelId);
  return Object.keys(models).some((key) => normalizeToken(key) === targetKey);
}

function removeAllowlistEntry(nextConfig: ConfigObject, provider: string, modelId: string): boolean {
  const agents = isRecord(nextConfig.agents) ? nextConfig.agents : null;
  const defaults = agents && isRecord(agents.defaults) ? agents.defaults : null;
  const models = defaults && isRecord(defaults.models) ? defaults.models : null;
  if (!models) return false;
  const targetKey = normalizeModelRef(provider, modelId);
  for (const key of Object.keys(models)) {
    if (normalizeToken(key) === targetKey) {
      delete models[key];
      return true;
    }
  }
  return false;
}

/**
 * `modelPolicy.allow` arrays that name the model exactly (or by its alias), at
 * the defaults and on each Agent entry. Wildcards such as `openai/*` are
 * provider-wide and stay untouched.
 */
function listPolicyAllowPaths(config: ConfigObject | null | undefined, matchers: Set<string>): string[] {
  const paths: string[] = [];
  const agents = isRecord(config?.agents) ? config.agents : null;
  const defaults = agents && isRecord(agents.defaults) ? agents.defaults : null;
  const holdsMatch = (policy: unknown): boolean => (
    isRecord(policy) && Array.isArray(policy.allow) && policy.allow.some((entry) => matchesTarget(entry, matchers))
  );
  if (defaults && holdsMatch(defaults.modelPolicy)) {
    paths.push('agents.defaults.modelPolicy.allow');
  }
  const agentList = agents && Array.isArray(agents.list) ? agents.list : [];
  agentList.forEach((entry, index) => {
    if (isRecord(entry) && holdsMatch(entry.modelPolicy)) {
      paths.push(`agents.list.${index}.modelPolicy.allow`);
    }
  });
  return paths;
}

function removePolicyAllowEntries(policy: unknown, matchers: Set<string>): unknown {
  if (!isRecord(policy) || !Array.isArray(policy.allow)) {
    return policy;
  }
  return { ...policy, allow: policy.allow.filter((entry) => !matchesTarget(entry, matchers)) };
}

function removeConfiguredModel(nextConfig: ConfigObject, provider: string, modelId: string): boolean {
  const providerConfig = findProviderConfig(nextConfig, provider);
  if (!providerConfig || !Array.isArray(providerConfig.models)) {
    return false;
  }
  const models = providerConfig.models as unknown[];
  const previousLength = models.length;
  providerConfig.models = models.filter(
    (entry) => !(isRecord(entry) && entry.id === modelId),
  );
  return (providerConfig.models as unknown[]).length !== previousLength;
}

export function analyzeModelDeletion(params: {
  config: ConfigObject | null | undefined;
  provider: string;
  modelId: string;
}): ModelDeleteAnalysis {
  const configuredModel = findConfiguredModelEntry(params.config, params.provider, params.modelId);
  const inAllowlist = hasAllowlistEntry(params.config, params.provider, params.modelId);

  const alias = getModelAlias(params.config, params.provider, params.modelId);
  const matchers = new Set([normalizeModelRef(params.provider, params.modelId)]);
  if (alias) {
    matchers.add(normalizeToken(alias));
  }
  const policyAllowPaths = listPolicyAllowPaths(params.config, matchers);

  if (!configuredModel && !inAllowlist && policyAllowPaths.length === 0) {
    return {
      canDelete: false,
      hasConfiguredModel: false,
      hasAllowlistEntry: false,
      hasPolicyAllowEntry: false,
      blocks: [{ path: 'models.providers', reason: 'model_not_configured' }],
      cleanup: [],
    };
  }

  const blocks: ModelDeleteBlock[] = [];
  const cleanup: ModelDeleteCleanup[] = [];

  const agents = isRecord(params.config?.agents) ? params.config.agents : null;
  const defaults = agents && isRecord(agents.defaults) ? agents.defaults : null;
  const agentList = agents && Array.isArray(agents.list) ? agents.list : [];

  if (defaults) {
    if (matchesTarget(toAgentModelLike(defaults.model)?.primary, matchers)) {
      blocks.push({ path: 'agents.defaults.model.primary', reason: 'defaults_primary' });
    }
    collectFallbackIndexes(defaults.model, matchers).forEach(() => {
      cleanup.push({ path: 'agents.defaults.model.fallbacks', action: 'remove_defaults_fallback' });
    });
    if (matchesTarget(toAgentModelLike(defaults.imageModel)?.primary, matchers)) {
      blocks.push({ path: 'agents.defaults.imageModel.primary', reason: 'defaults_image_primary' });
    }
    collectFallbackIndexes(defaults.imageModel, matchers).forEach(() => {
      cleanup.push({ path: 'agents.defaults.imageModel.fallbacks', action: 'remove_defaults_image_fallback' });
    });
    if (matchesTarget(toAgentModelLike(defaults.pdfModel)?.primary, matchers)) {
      blocks.push({ path: 'agents.defaults.pdfModel.primary', reason: 'defaults_pdf_primary' });
    }
    collectFallbackIndexes(defaults.pdfModel, matchers).forEach(() => {
      cleanup.push({ path: 'agents.defaults.pdfModel.fallbacks', action: 'remove_defaults_pdf_fallback' });
    });
    if (isRecord(defaults.heartbeat) && matchesTarget(defaults.heartbeat.model, matchers)) {
      blocks.push({ path: 'agents.defaults.heartbeat.model', reason: 'defaults_heartbeat_model' });
    }
    if (isRecord(defaults.compaction) && matchesTarget(defaults.compaction.model, matchers)) {
      blocks.push({ path: 'agents.defaults.compaction.model', reason: 'defaults_compaction_model' });
    }
    if (isRecord(defaults.memorySearch) && matchesTarget(defaults.memorySearch.model, matchers)) {
      blocks.push({ path: 'agents.defaults.memorySearch.model', reason: 'defaults_memory_search_model' });
    }
    if (isRecord(defaults.subagents)) {
      if (matchesTarget(toAgentModelLike(defaults.subagents.model)?.primary, matchers)) {
        blocks.push({ path: 'agents.defaults.subagents.model.primary', reason: 'defaults_subagents_primary' });
      }
      collectFallbackIndexes(defaults.subagents.model, matchers).forEach(() => {
        cleanup.push({ path: 'agents.defaults.subagents.model.fallbacks', action: 'remove_defaults_subagents_fallback' });
      });
    }
  }

  agentList.forEach((entry, index) => {
    if (!isRecord(entry)) return;
    const agentId = typeof entry.id === 'string' ? entry.id : `#${index + 1}`;
    if (matchesTarget(toAgentModelLike(entry.model)?.primary, matchers)) {
      blocks.push({
        path: `agents.list.${index}.model.primary`,
        reason: 'agent_primary',
        detail: agentId,
      });
    }
    collectFallbackIndexes(entry.model, matchers).forEach(() => {
      cleanup.push({
        path: `agents.list.${index}.model.fallbacks`,
        action: 'remove_agent_fallback',
        detail: agentId,
      });
    });
    if (isRecord(entry.heartbeat) && matchesTarget(entry.heartbeat.model, matchers)) {
      blocks.push({
        path: `agents.list.${index}.heartbeat.model`,
        reason: 'agent_heartbeat_model',
        detail: agentId,
      });
    }
    if (isRecord(entry.subagents)) {
      if (matchesTarget(toAgentModelLike(entry.subagents.model)?.primary, matchers)) {
        blocks.push({
          path: `agents.list.${index}.subagents.model.primary`,
          reason: 'agent_subagents_primary',
          detail: agentId,
        });
      }
      collectFallbackIndexes(entry.subagents.model, matchers).forEach(() => {
        cleanup.push({
          path: `agents.list.${index}.subagents.model.fallbacks`,
          action: 'remove_agent_subagents_fallback',
          detail: agentId,
        });
      });
    }
  });

  const channels = isRecord(params.config?.channels) ? params.config.channels : null;
  const modelByChannel = channels && isRecord(channels.modelByChannel) ? channels.modelByChannel : null;
  if (modelByChannel) {
    for (const [providerId, channelMap] of Object.entries(modelByChannel)) {
      if (!isRecord(channelMap)) continue;
      for (const [channelId, modelRef] of Object.entries(channelMap)) {
        if (matchesTarget(modelRef, matchers)) {
          blocks.push({
            path: `channels.modelByChannel.${providerId}.${channelId}`,
            reason: 'channel_model_override',
            detail: `${providerId}/${channelId}`,
          });
        }
      }
    }
  }

  const hooks = isRecord(params.config?.hooks) ? params.config.hooks : null;
  const mappings = hooks && Array.isArray(hooks.mappings) ? hooks.mappings : [];
  mappings.forEach((mapping, index) => {
    if (isRecord(mapping) && matchesTarget(mapping.model, matchers)) {
      blocks.push({
        path: `hooks.mappings.${index}.model`,
        reason: 'hook_mapping_model',
        detail: typeof mapping.id === 'string' ? mapping.id : `#${index + 1}`,
      });
    }
  });
  if (hooks && isRecord(hooks.gmail) && matchesTarget(hooks.gmail.model, matchers)) {
    blocks.push({ path: 'hooks.gmail.model', reason: 'hook_gmail_model' });
  }

  for (const path of [...policyAllowPaths].reverse()) {
    cleanup.unshift({ path, action: 'remove_policy_allow_entry' });
  }
  if (configuredModel) {
    cleanup.unshift(
      { path: `models.providers.${params.provider}.models`, action: 'remove_configured_model' },
    );
  }
  if (inAllowlist) {
    cleanup.unshift(
      { path: `agents.defaults.models.${params.provider}/${params.modelId}`, action: 'remove_allowlist_entry' },
    );
  }

  return {
    canDelete: blocks.length === 0,
    hasConfiguredModel: !!configuredModel,
    hasAllowlistEntry: inAllowlist,
    hasPolicyAllowEntry: policyAllowPaths.length > 0,
    blocks,
    cleanup,
  };
}

export function buildDeleteModelConfig(params: {
  config: ConfigObject | null | undefined;
  provider: string;
  modelId: string;
}): ModelDeleteResult {
  const analysis = analyzeModelDeletion(params);
  if (!analysis.canDelete || !params.config) {
    return { analysis, nextConfig: null };
  }

  const nextConfig = cloneConfig(params.config);
  removeConfiguredModel(nextConfig, params.provider, params.modelId);
  removeAllowlistEntry(nextConfig, params.provider, params.modelId);

  const agents = isRecord(nextConfig.agents) ? nextConfig.agents : null;
  const defaults = agents && isRecord(agents.defaults) ? agents.defaults : null;
  const alias = getModelAlias(params.config, params.provider, params.modelId);
  const matchers = new Set([normalizeModelRef(params.provider, params.modelId)]);
  if (alias) {
    matchers.add(normalizeToken(alias));
  }

  if (defaults) {
    if (defaults.model !== undefined) {
      defaults.model = removeFallbacks(defaults.model, matchers);
    }
    if (defaults.imageModel !== undefined) {
      defaults.imageModel = removeFallbacks(defaults.imageModel, matchers);
    }
    if (defaults.pdfModel !== undefined) {
      defaults.pdfModel = removeFallbacks(defaults.pdfModel, matchers);
    }
    if (isRecord(defaults.subagents) && defaults.subagents.model !== undefined) {
      defaults.subagents.model = removeFallbacks(defaults.subagents.model, matchers);
    }
    if (defaults.modelPolicy !== undefined) {
      defaults.modelPolicy = removePolicyAllowEntries(defaults.modelPolicy, matchers);
    }
  }

  if (agents && Array.isArray(agents.list)) {
    agents.list = agents.list.map((entry) => {
      if (!isRecord(entry)) return entry;
      const nextEntry = { ...entry };
      if (nextEntry.model !== undefined) {
        nextEntry.model = removeFallbacks(nextEntry.model, matchers);
      }
      if (isRecord(nextEntry.subagents) && nextEntry.subagents.model !== undefined) {
        nextEntry.subagents = {
          ...nextEntry.subagents,
          model: removeFallbacks(nextEntry.subagents.model, matchers),
        };
      }
      if (nextEntry.modelPolicy !== undefined) {
        nextEntry.modelPolicy = removePolicyAllowEntries(nextEntry.modelPolicy, matchers);
      }
      return nextEntry;
    });
  }

  return { analysis, nextConfig };
}
