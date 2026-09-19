export type ModelCostValue = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type ModelCostEditorState = {
  editable: boolean;
  hasExistingOverride: boolean;
  source: 'configured' | 'catalog' | 'none';
  blockReason?: 'provider_missing';
  cost: ModelCostValue;
};

export type ExplicitConfiguredModel = {
  provider: string;
  modelId: string;
  modelName: string;
};

type ConfigObject = Record<string, unknown>;
type ModelEntry = {
  id?: unknown;
  name?: unknown;
  cost?: unknown;
};

const ZERO_COST: ModelCostValue = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function resolveCostValue(value: unknown): ModelCostValue | null {
  if (!isRecord(value)) {
    return null;
  }
  const input = toFiniteNumber(value.input);
  const output = toFiniteNumber(value.output);
  const cacheRead = toFiniteNumber(value.cacheRead);
  const cacheWrite = toFiniteNumber(value.cacheWrite);
  if (input === null || output === null || cacheRead === null || cacheWrite === null) {
    return null;
  }
  return { input, output, cacheRead, cacheWrite };
}

function findProviderConfig(config: ConfigObject | null | undefined, provider: string): Record<string, unknown> | null {
  const providers = config?.models;
  if (!isRecord(providers)) return null;
  const providerMap = providers.providers;
  if (!isRecord(providerMap)) return null;
  const providerEntry = providerMap[provider];
  return isRecord(providerEntry) ? providerEntry : null;
}

function findModelEntry(config: ConfigObject | null | undefined, provider: string, modelId: string): ModelEntry | null {
  const providerConfig = findProviderConfig(config, provider);
  const models = providerConfig?.models;
  if (!Array.isArray(models)) return null;
  const match = models.find((entry) => isRecord(entry) && entry.id === modelId);
  return isRecord(match) ? match : null;
}

function readAgentDefaults(config: ConfigObject | null | undefined): Record<string, unknown> | null {
  const agents = config?.agents;
  if (!isRecord(agents)) return null;
  const defaults = agents.defaults;
  return isRecord(defaults) ? defaults : null;
}

/** The `agents.defaults.models` map: the legacy allowlist, per-model metadata on a migrated Gateway. */
function readConfiguredModelAllowlist(config: ConfigObject | null | undefined): Record<string, unknown> | null {
  const models = readAgentDefaults(config)?.models;
  return isRecord(models) ? models : null;
}

function normalizeAllowlistKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * OpenClaw (2026-07-18, "make per-agent allowlists explicit") moved the model
 * allowlist from the keys of `agents.defaults.models` — now per-model metadata
 * only — to `agents.defaults.modelPolicy.allow`. A config that carries the
 * `modelPolicy` object or the `meta.migrations.modelPolicyAllowlist` marker
 * follows the policy semantics; any other config still restricts through the
 * legacy map, and a Gateway that predates the policy rejects the unknown key.
 */
export type ModelAllowlistMode = 'policy' | 'legacy';

export const MODEL_POLICY_ALLOW_CONFIG_PATH = 'agents.defaults.modelPolicy.allow';

export function resolveModelAllowlistMode(config: ConfigObject | null | undefined): ModelAllowlistMode {
  if (isRecord(readAgentDefaults(config)?.modelPolicy)) return 'policy';
  const meta = config?.meta;
  const migrations = isRecord(meta) ? meta.migrations : null;
  return isRecord(migrations) && migrations.modelPolicyAllowlist === true ? 'policy' : 'legacy';
}

/** `agents.defaults.modelPolicy.allow` entries in config order, or `null` when the array is absent. */
export function readModelPolicyAllow(config: ConfigObject | null | undefined): string[] | null {
  const policy = readAgentDefaults(config)?.modelPolicy;
  if (!isRecord(policy) || !Array.isArray(policy.allow)) return null;
  return policy.allow
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

/**
 * A policy entry is an exact `provider/model` reference or a `provider/*`
 * (`provider/prefix/*`) wildcard that matches on segment boundaries.
 */
export function matchesAllowlistEntry(entry: string, reference: string): boolean {
  const needle = normalizeAllowlistKey(reference);
  const pattern = normalizeAllowlistKey(entry);
  if (pattern.endsWith('/*')) return needle.startsWith(pattern.slice(0, -1));
  return pattern === needle;
}

function isAllowlistWildcard(entry: string): boolean {
  return entry.trim().endsWith('/*');
}

/** The refs the Gateway actually restricts by: policy entries or the legacy map keys. */
function readEffectiveAllowlistRefs(config: ConfigObject | null | undefined): string[] {
  if (resolveModelAllowlistMode(config) === 'policy') return readModelPolicyAllow(config) ?? [];
  const allowlist = readConfiguredModelAllowlist(config);
  if (!allowlist) return [];
  return Object.keys(allowlist)
    .map((key) => key.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

export function listExplicitProviders(config: ConfigObject | null | undefined): string[] {
  const providers = config?.models;
  if (!isRecord(providers)) return [];
  const providerMap = providers.providers;
  if (!isRecord(providerMap)) return [];
  return Object.keys(providerMap)
    .map((provider) => provider.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

export function listExplicitConfiguredModels(config: ConfigObject | null | undefined): ExplicitConfiguredModel[] {
  const providers = config?.models;
  if (!isRecord(providers)) return [];
  const providerMap = providers.providers;
  if (!isRecord(providerMap)) return [];

  const rows: ExplicitConfiguredModel[] = [];
  for (const [provider, providerEntry] of Object.entries(providerMap)) {
    if (!isRecord(providerEntry) || !Array.isArray(providerEntry.models)) {
      continue;
    }
    for (const model of providerEntry.models) {
      if (!isRecord(model)) {
        continue;
      }
      const modelId = typeof model.id === 'string' ? model.id.trim() : '';
      if (!modelId) {
        continue;
      }
      const modelName = typeof model.name === 'string' && model.name.trim()
        ? model.name.trim()
        : modelId;
      rows.push({
        provider,
        modelId,
        modelName,
      });
    }
  }

  return rows.sort((a, b) => {
    const providerCompare = a.provider.localeCompare(b.provider);
    if (providerCompare !== 0) return providerCompare;
    return a.modelName.localeCompare(b.modelName);
  });
}

/** An empty policy `allow` or legacy map permits every model. */
export function hasExplicitModelAllowlist(config: ConfigObject | null | undefined): boolean {
  return readEffectiveAllowlistRefs(config).length > 0;
}

/** Policy entries keep their config order (wildcards included); legacy keys are sorted. */
export function listConfiguredModelAllowlistRefs(config: ConfigObject | null | undefined): string[] {
  return readEffectiveAllowlistRefs(config);
}

export function isModelInAllowlist(config: ConfigObject | null | undefined, provider: string, modelId: string): boolean {
  const reference = `${provider}/${modelId}`;
  return readEffectiveAllowlistRefs(config).some((entry) => matchesAllowlistEntry(entry, reference));
}

function hasConfiguredModelMetadata(config: ConfigObject | null | undefined, provider: string, modelId: string): boolean {
  const allowlist = readConfiguredModelAllowlist(config);
  if (!allowlist) return false;
  const targetKey = normalizeAllowlistKey(`${provider}/${modelId}`);
  return Object.keys(allowlist).some((key) => normalizeAllowlistKey(key) === targetKey);
}

export function hasConfiguredModel(config: ConfigObject | null | undefined, provider: string, modelId: string): boolean {
  return !!findModelEntry(config, provider, modelId);
}

export function resolveModelCostEditorState(params: {
  config: ConfigObject | null | undefined;
  provider: string;
  modelId: string;
  catalogCost?: ModelCostValue | null;
}): ModelCostEditorState {
  const providerConfig = findProviderConfig(params.config, params.provider);
  if (!providerConfig) {
    return {
      editable: false,
      hasExistingOverride: false,
      source: params.catalogCost ? 'catalog' : 'none',
      blockReason: 'provider_missing',
      cost: params.catalogCost ?? ZERO_COST,
    };
  }

  const modelEntry = findModelEntry(params.config, params.provider, params.modelId);
  const configuredCost = resolveCostValue(modelEntry?.cost);
  if (configuredCost) {
    return {
      editable: true,
      hasExistingOverride: true,
      source: 'configured',
      cost: configuredCost,
    };
  }

  return {
    editable: true,
    hasExistingOverride: false,
    source: params.catalogCost ? 'catalog' : 'none',
    cost: params.catalogCost ?? ZERO_COST,
  };
}

export function buildModelCostPatch(params: {
  config: ConfigObject | null | undefined;
  provider: string;
  modelId: string;
  modelName: string;
  cost: ModelCostValue;
}): Record<string, unknown> | null {
  const providerConfig = findProviderConfig(params.config, params.provider);
  if (!providerConfig) {
    return null;
  }

  const existingEntry = findModelEntry(params.config, params.provider, params.modelId);
  const patchEntry: Record<string, unknown> = {
    id: params.modelId,
    cost: {
      input: params.cost.input,
      output: params.cost.output,
      cacheRead: params.cost.cacheRead,
      cacheWrite: params.cost.cacheWrite,
    },
  };

  if (!existingEntry) {
    patchEntry.name = params.modelName;
  }

  return {
    models: {
      providers: {
        [params.provider]: {
          models: [patchEntry],
        },
      },
    },
  };
}

export function buildAddModelPatch(params: {
  config: ConfigObject | null | undefined;
  provider: string;
  modelId: string;
  modelName: string;
}): Record<string, unknown> | null {
  const providerConfig = findProviderConfig(params.config, params.provider);
  const isExplicitProvider = !!providerConfig;

  if (isExplicitProvider && hasConfiguredModel(params.config, params.provider, params.modelId)) {
    return null;
  }

  const patch: Record<string, unknown> = {};

  if (isExplicitProvider) {
    patch.models = {
      providers: {
        [params.provider]: {
          models: [
            {
              id: params.modelId,
              name: params.modelName,
            },
          ],
        },
      },
    };
  }

  const restricted = hasExplicitModelAllowlist(params.config);
  if (!isExplicitProvider || restricted) {
    const ref = `${params.provider}/${params.modelId}`;
    const allowed = isModelInAllowlist(params.config, params.provider, params.modelId);
    const hasMetadata = hasConfiguredModelMetadata(params.config, params.provider, params.modelId);
    // Legacy: the map key is what the Gateway lists. Policy: the map entry is
    // the model's metadata and `allow` decides whether it is usable.
    const policy = resolveModelAllowlistMode(params.config) === 'policy';
    const alreadyListed = policy ? hasMetadata && (!restricted || allowed) : allowed;
    if (alreadyListed) {
      if (!isExplicitProvider) return null;
    } else {
      const defaults: Record<string, unknown> = {};
      if (!hasMetadata) {
        const entry: Record<string, unknown> = {};
        if (params.modelName && params.modelName !== params.modelId) {
          entry.alias = params.modelName;
        }
        defaults.models = { [ref]: entry };
      }
      if (policy && restricted && !allowed) {
        defaults.modelPolicy = { allow: [...(readModelPolicyAllow(params.config) ?? []), ref] };
      }
      patch.agents = { defaults };
    }
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

export type ModelAllowlistChangeInput = {
  provider: string;
  modelId: string;
  enabled: boolean;
};

export function buildModelAllowlistPatch(params: {
  config: ConfigObject | null | undefined;
  provider: string;
  modelId: string;
  enabled: boolean;
}): Record<string, unknown> | null {
  return buildBatchModelAllowlistPatch({
    config: params.config,
    changes: [{ provider: params.provider, modelId: params.modelId, enabled: params.enabled }],
  });
}

/**
 * Policy configs rewrite `agents.defaults.modelPolicy.allow` as a whole (the
 * Gateway replaces string arrays; shrinking one needs the path in
 * `replacePaths`). A wildcard that covers a model being disabled gives way to
 * explicit refs — the change set enumerates every catalog model, so the other
 * models under it stay enabled. Newly allowed refs also get an
 * `agents.defaults.models` metadata entry, as OpenClaw's own picker writes;
 * disabling keeps metadata, only the legacy map deletes the key.
 */
export function buildBatchModelAllowlistPatch(params: {
  config: ConfigObject | null | undefined;
  changes: ModelAllowlistChangeInput[];
}): Record<string, unknown> | null {
  if (resolveModelAllowlistMode(params.config) === 'policy') {
    return buildModelPolicyAllowPatch(params.config, params.changes);
  }

  const modelsPatch: Record<string, {} | null> = {};

  for (const change of params.changes) {
    const key = `${change.provider}/${change.modelId}`;
    const inAllowlist = isModelInAllowlist(params.config, change.provider, change.modelId);
    if (change.enabled === inAllowlist) {
      continue;
    }
    modelsPatch[key] = change.enabled ? {} : null;
  }

  if (Object.keys(modelsPatch).length === 0) {
    return null;
  }

  return {
    agents: {
      defaults: {
        models: modelsPatch,
      },
    },
  };
}

function buildModelPolicyAllowPatch(
  config: ConfigObject | null | undefined,
  changes: ModelAllowlistChangeInput[],
): Record<string, unknown> | null {
  const existing = readModelPolicyAllow(config) ?? [];
  // The last change for a reference wins, like the legacy key patch.
  const desired = new Map<string, ModelAllowlistChangeInput>();
  for (const change of changes) desired.set(normalizeAllowlistKey(`${change.provider}/${change.modelId}`), change);
  const disabled = [...desired.values()]
    .filter((change) => !change.enabled)
    .map((change) => `${change.provider}/${change.modelId}`);
  const nextAllow = existing.filter((entry) => !disabled.some((ref) => (
    isAllowlistWildcard(entry) ? matchesAllowlistEntry(entry, ref) : normalizeAllowlistKey(entry) === normalizeAllowlistKey(ref)
  )));
  const metadata: Record<string, {}> = {};
  for (const change of desired.values()) {
    if (!change.enabled) continue;
    const ref = `${change.provider}/${change.modelId}`;
    if (nextAllow.some((entry) => matchesAllowlistEntry(entry, ref))) continue;
    nextAllow.push(ref);
    if (!hasConfiguredModelMetadata(config, change.provider, change.modelId)) metadata[ref] = {};
  }

  const unchanged = existing.length === nextAllow.length
    && existing.every((entry, index) => normalizeAllowlistKey(entry) === normalizeAllowlistKey(nextAllow[index]!));
  if (unchanged) {
    return null;
  }

  return {
    agents: {
      defaults: {
        modelPolicy: { allow: nextAllow },
        ...(Object.keys(metadata).length > 0 ? { models: metadata } : {}),
      },
    },
  };
}

/** True when a batch allowlist patch rewrites `agents.defaults.modelPolicy.allow`. */
export function patchRewritesModelPolicyAllow(patch: Record<string, unknown> | null): boolean {
  const agents = patch?.agents;
  const defaults = isRecord(agents) ? agents.defaults : null;
  const policy = isRecord(defaults) ? defaults.modelPolicy : null;
  return isRecord(policy) && Array.isArray(policy.allow);
}

export function areModelCostsEqual(a: ModelCostValue, b: ModelCostValue): boolean {
  return (
    a.input === b.input
    && a.output === b.output
    && a.cacheRead === b.cacheRead
    && a.cacheWrite === b.cacheWrite
  );
}
