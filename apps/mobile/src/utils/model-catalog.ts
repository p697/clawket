import type {
  ModelCatalogModel,
  ModelCatalogProvider,
  ModelCatalogState,
  ModelCatalogWrite,
  ModelInfo,
} from '@clawket/agent-protocol';
import { sanitizeFallbackModels } from './fallback-models';
import { parseGatewayRuntimeSettings } from './gateway-settings';
import {
  buildBatchModelAllowlistPatch,
  hasExplicitModelAllowlist,
  listConfiguredModelAllowlistRefs,
  listExplicitConfiguredModels,
  listExplicitProviders,
  MODEL_POLICY_ALLOW_CONFIG_PATH,
  patchRewritesModelPolicyAllow,
  readModelPolicyAllow,
} from './model-cost-config';

type ConfigObject = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function providerConfig(config: ConfigObject | null, slug: string): Record<string, unknown> | null {
  const models = isRecord(config?.models) ? config.models : null;
  const providers = models && isRecord(models.providers) ? models.providers : null;
  const entry = providers?.[slug];
  return isRecord(entry) ? entry : null;
}

function configuredModelEntry(
  config: ConfigObject | null,
  slug: string,
  modelId: string,
): Record<string, unknown> | null {
  const provider = providerConfig(config, slug);
  if (!provider || !Array.isArray(provider.models)) return null;
  const entry = provider.models.find((item) => isRecord(item) && readString(item.id) === modelId);
  return isRecord(entry) ? entry : null;
}

function readCost(value: unknown): ModelInfo['cost'] | undefined {
  if (!isRecord(value)) return undefined;
  const fields = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;
  const cost = {} as NonNullable<ModelInfo['cost']>;
  for (const field of fields) {
    const number = value[field];
    if (typeof number !== 'number' || !Number.isFinite(number)) return undefined;
    cost[field] = number;
  }
  return cost;
}

export function modelReference(provider: string, modelId: string): string {
  const id = modelId.trim();
  if (id.includes('/')) return id;
  const slug = provider.trim();
  return slug ? `${slug}/${id}` : id;
}

/**
 * Merges the live `models.list` catalog with Gateway config: explicitly
 * configured models that the catalog omits, provider declarations, cost
 * overrides, the allowlist and the Agent defaults.
 */
export function buildModelCatalogState(
  config: ConfigObject | null,
  catalog: ReadonlyArray<ModelInfo>,
): ModelCatalogState {
  const settings = parseGatewayRuntimeSettings(config);
  const providers = new Map<string, ModelCatalogModel[]>();
  const seen = new Set<string>();

  const push = (model: ModelInfo) => {
    const slug = model.provider.trim();
    const id = model.id.trim() || model.name.trim();
    if (!id) return;
    const key = `${slug}/${id}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const entry = configuredModelEntry(config, slug, id);
    const overrideCost = entry ? readCost(entry.cost) : undefined;
    const row: ModelCatalogModel = {
      ...model,
      id,
      name: model.name.trim() || id,
      provider: slug,
      configured: entry !== null,
      costOverridden: overrideCost !== undefined,
      ...(overrideCost ? { cost: overrideCost } : {}),
    };
    const rows = providers.get(slug) ?? [];
    rows.push(row);
    providers.set(slug, rows);
  };

  for (const model of catalog) push(model);
  for (const model of listExplicitConfiguredModels(config)) {
    push({ id: model.modelId, name: model.modelName, provider: model.provider });
  }
  for (const slug of listExplicitProviders(config)) {
    if (!providers.has(slug)) providers.set(slug, []);
  }

  const result: ModelCatalogProvider[] = [...providers.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([slug, models]) => {
      const declared = providerConfig(config, slug);
      const baseUrl = readString(declared?.baseUrl);
      const api = readString(declared?.api);
      return {
        slug,
        explicit: declared !== null,
        ...(baseUrl ? { baseUrl } : {}),
        ...(api ? { api } : {}),
        models: models.sort((left, right) => left.name.localeCompare(right.name)),
      };
    });

  return {
    defaults: {
      primary: settings.defaultModel,
      fallbacks: settings.fallbackModels,
      thinkingDefault: settings.thinkingDefault,
    },
    allowlist: hasExplicitModelAllowlist(config) ? listConfiguredModelAllowlistRefs(config) : null,
    providers: result,
  };
}

function mergePatch(target: ConfigObject, source: ConfigObject): ConfigObject {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    target[key] = isRecord(existing) && isRecord(value) ? mergePatch({ ...existing }, value) : value;
  }
  return target;
}

export const FALLBACKS_CONFIG_PATH = 'agents.defaults.model.fallbacks';

export type ModelCatalogPatch = Readonly<{
  patch: ConfigObject;
  /**
   * Gateway `config.patch` refuses to shrink or delete an existing array unless
   * the exact path is listed here; this save rewrites only the fallback list
   * and, on a policy config, `agents.defaults.modelPolicy.allow`.
   */
  replacePaths: ReadonlyArray<string>;
}>;

function hasFallbacksArray(config: ConfigObject | null): boolean {
  const agents = isRecord(config?.agents) ? config.agents : null;
  const defaults = agents && isRecord(agents.defaults) ? agents.defaults : null;
  const model = defaults && isRecord(defaults.model) ? defaults.model : null;
  return Array.isArray(model?.fallbacks);
}

/**
 * One `config.patch` body for the defaults and allowlist changes of a save.
 * Returns `null` when nothing differs from the current config. A `null` leaf
 * removes the key; the primary and fallbacks are added to an existing
 * allowlist so the defaults can never be blocked by it.
 */
export function buildModelCatalogPatch(
  config: ConfigObject | null,
  write: ModelCatalogWrite,
): ModelCatalogPatch | null {
  const patch: ConfigObject = {};
  const replacePaths: string[] = [];
  const current = parseGatewayRuntimeSettings(config);
  const allowlistChanges = write.allowlist ? [...write.allowlist] : [];

  if (write.defaults) {
    const primary = write.defaults.primary.trim();
    const fallbacks = sanitizeFallbackModels(write.defaults.fallbacks, { primaryModel: primary });
    const thinkingDefault = write.defaults.thinkingDefault.trim();
    const defaults: ConfigObject = {};
    if (primary !== current.defaultModel || fallbacks.join('\n') !== current.fallbackModels.join('\n')) {
      defaults.model = primary
        ? { primary, fallbacks: fallbacks.length > 0 ? fallbacks : null }
        : null;
      if (hasFallbacksArray(config)) replacePaths.push(FALLBACKS_CONFIG_PATH);
    }
    if (thinkingDefault !== current.thinkingDefault) {
      defaults.thinkingDefault = thinkingDefault || null;
    }
    if (Object.keys(defaults).length > 0) patch.agents = { defaults };
    if (hasExplicitModelAllowlist(config)) {
      for (const reference of [primary, ...fallbacks]) {
        const slash = reference.indexOf('/');
        if (slash <= 0) continue;
        allowlistChanges.push({
          provider: reference.slice(0, slash),
          modelId: reference.slice(slash + 1),
          enabled: true,
        });
      }
    }
  }

  const allowlistPatch = allowlistChanges.length > 0
    ? buildBatchModelAllowlistPatch({ config, changes: allowlistChanges })
    : null;
  if (allowlistPatch) {
    mergePatch(patch, allowlistPatch);
    if (patchRewritesModelPolicyAllow(allowlistPatch) && readModelPolicyAllow(config) !== null) {
      replacePaths.push(MODEL_POLICY_ALLOW_CONFIG_PATH);
    }
  }
  return Object.keys(patch).length > 0 ? { patch, replacePaths } : null;
}
