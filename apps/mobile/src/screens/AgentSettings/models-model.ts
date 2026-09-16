import type {
  AgentDescriptor,
  Capabilities,
  ModelAllowlistChange,
  ModelCatalogModel,
  ModelCatalogState,
  ModelCatalogWrite,
  ModelInfo,
  ModelSelectionState,
  ModelSelectionWrite,
  ModelsOperations,
} from '@clawket/agent-protocol';
import { modelReference } from '../../utils/model-catalog';

/**
 * `manage`: OpenClaw — Gateway config defaults, allowlist, add / delete /
 * cost live on this page. `select`: Hermes and local-model — the backend
 * exposes one global current model and nothing else to edit.
 */
export type ModelsMode = 'manage' | 'select';

export type ModelsDraft = Readonly<{
  primary: string;
  fallbacks: ReadonlyArray<string>;
  thinkingDefault: string;
  /** `null` mirrors an absent Gateway allowlist: every model is enabled. */
  allowlist: ReadonlyArray<string> | null;
}>;

export type ModelsBundle = Readonly<{
  mode: ModelsMode;
  catalog: ModelCatalogState | null;
  selection: ModelSelectionState | null;
  draft: ModelsDraft;
}>;

export type AgentModelRow = Readonly<{
  key: string;
  id: string;
  name: string;
  provider: string;
  reference: string;
  /** `manage` rows only: allowlist state in the draft. */
  enabled?: boolean;
  /** The default model (`manage`) or the backend's current model (`select`). */
  current: boolean;
  fallbackIndex: number;
  model: ModelInfo | ModelCatalogModel;
}>;

export type AgentModelGroup = Readonly<{
  provider: string;
  explicit: boolean;
  baseUrl?: string;
  api?: string;
  rows: ReadonlyArray<AgentModelRow>;
}>;

const EMPTY_DRAFT: ModelsDraft = { primary: '', fallbacks: [], thinkingDefault: '', allowlist: null };

export function canManageModels(
  capabilities: Pick<Capabilities, 'models' | 'modelManage'>,
  operations: ModelsOperations | undefined,
): boolean {
  return capabilities.models && capabilities.modelManage === true && Boolean(operations?.getCatalog);
}

export async function loadModelsBundle(
  operations: ModelsOperations | undefined,
  capabilities: Pick<Capabilities, 'models' | 'modelManage'>,
): Promise<ModelsBundle> {
  if (canManageModels(capabilities, operations)) {
    const catalog = await operations!.getCatalog!();
    return {
      mode: 'manage',
      catalog,
      selection: null,
      draft: {
        primary: catalog.defaults.primary,
        fallbacks: [...catalog.defaults.fallbacks],
        thinkingDefault: catalog.defaults.thinkingDefault,
        allowlist: catalog.allowlist ? [...catalog.allowlist] : null,
      },
    };
  }
  let selection = operations?.getSelection ? await operations.getSelection() : null;
  if ((!selection || selection.models.length === 0) && operations?.list) {
    const models = await operations.list();
    selection = {
      currentModel: selection?.currentModel ?? '',
      currentProvider: selection?.currentProvider ?? '',
      currentBaseUrl: selection?.currentBaseUrl ?? '',
      models,
      ...(selection?.providers ? { providers: selection.providers } : {}),
      ...(selection?.note !== undefined ? { note: selection.note } : {}),
    };
  }
  return { mode: 'select', catalog: null, selection, draft: EMPTY_DRAFT };
}

function normalizeReference(value: string): string {
  return value.trim().toLowerCase();
}

function sameList(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameSet(left: ReadonlyArray<string> | null, right: ReadonlyArray<string> | null): boolean {
  if (left === null || right === null) return left === right;
  const normalized = (values: ReadonlyArray<string>) => [...new Set(values.map(normalizeReference))].sort();
  return sameList(normalized(left), normalized(right));
}

export function isModelsDraftDirty(bundle: ModelsBundle): boolean {
  if (bundle.mode !== 'manage' || !bundle.catalog) return false;
  const { defaults, allowlist } = bundle.catalog;
  return bundle.draft.primary !== defaults.primary
    || !sameList(bundle.draft.fallbacks, defaults.fallbacks)
    || bundle.draft.thinkingDefault !== defaults.thinkingDefault
    || !sameSet(bundle.draft.allowlist, allowlist);
}

export function listCatalogModels(catalog: ModelCatalogState | null): ModelCatalogModel[] {
  return catalog ? catalog.providers.flatMap((provider) => provider.models) : [];
}

export function isModelEnabled(draft: ModelsDraft, reference: string): boolean {
  if (draft.allowlist === null) return true;
  const needle = normalizeReference(reference);
  return draft.allowlist.some((entry) => normalizeReference(entry) === needle);
}

/**
 * Turning a model off while the Gateway has no allowlist materializes one
 * that keeps every other catalog model enabled, so the list never silently
 * shrinks to a single entry.
 */
export function toggleModelEnabled(
  draft: ModelsDraft,
  catalog: ModelCatalogState | null,
  reference: string,
  enabled: boolean,
): ModelsDraft {
  const needle = normalizeReference(reference);
  if (draft.allowlist === null) {
    if (enabled) return draft;
    const others = listCatalogModels(catalog)
      .map((model) => modelReference(model.provider, model.id))
      .filter((entry) => normalizeReference(entry) !== needle);
    return { ...draft, allowlist: others };
  }
  const without = draft.allowlist.filter((entry) => normalizeReference(entry) !== needle);
  return { ...draft, allowlist: enabled ? [...without, reference] : without };
}

export function setDraftPrimary(draft: ModelsDraft, reference: string): ModelsDraft {
  const primary = reference.trim();
  return {
    ...draft,
    primary,
    fallbacks: draft.fallbacks.filter((entry) => normalizeReference(entry) !== normalizeReference(primary)),
  };
}

export function addDraftFallback(draft: ModelsDraft, reference: string): ModelsDraft {
  const next = reference.trim();
  if (!next || normalizeReference(next) === normalizeReference(draft.primary)) return draft;
  if (draft.fallbacks.some((entry) => normalizeReference(entry) === normalizeReference(next))) return draft;
  return { ...draft, fallbacks: [...draft.fallbacks, next] };
}

export function removeDraftFallback(draft: ModelsDraft, index: number): ModelsDraft {
  return { ...draft, fallbacks: draft.fallbacks.filter((_, position) => position !== index) };
}

export function moveDraftFallbackUp(draft: ModelsDraft, index: number): ModelsDraft {
  if (index <= 0 || index >= draft.fallbacks.length) return draft;
  const fallbacks = [...draft.fallbacks];
  const [entry] = fallbacks.splice(index, 1);
  fallbacks.splice(index - 1, 0, entry!);
  return { ...draft, fallbacks };
}

export function buildModelsCatalogWrite(bundle: ModelsBundle): ModelCatalogWrite {
  const write: ModelCatalogWrite = {};
  if (bundle.mode !== 'manage' || !bundle.catalog) return write;
  const { defaults, allowlist } = bundle.catalog;
  const { draft } = bundle;
  if (draft.primary !== defaults.primary
    || !sameList(draft.fallbacks, defaults.fallbacks)
    || draft.thinkingDefault !== defaults.thinkingDefault) {
    write.defaults = {
      primary: draft.primary,
      fallbacks: [...draft.fallbacks],
      thinkingDefault: draft.thinkingDefault,
    };
  }
  if (!sameSet(draft.allowlist, allowlist)) {
    const changes: ModelAllowlistChange[] = listCatalogModels(bundle.catalog).map((model) => ({
      provider: model.provider,
      modelId: model.id,
      enabled: isModelEnabled(draft, modelReference(model.provider, model.id)),
    }));
    write.allowlist = changes;
  }
  return write;
}

function matchesQuery(needle: string, ...values: string[]): boolean {
  return !needle || values.some((value) => value.toLowerCase().includes(needle));
}

function isCurrentSelection(model: ModelInfo, state: ModelSelectionState): boolean {
  const currentModel = normalizeReference(state.currentModel);
  const currentProvider = normalizeReference(state.currentProvider);
  const provider = normalizeReference(model.provider);
  const candidates = [model.id, model.name, provider && model.id ? `${provider}/${model.id}` : '']
    .map(normalizeReference)
    .filter(Boolean);
  return candidates.includes(currentModel)
    && (!currentProvider || !provider || currentProvider === provider);
}

export function buildAgentModelGroups(bundle: ModelsBundle | null, query = ''): ReadonlyArray<AgentModelGroup> {
  if (!bundle) return [];
  const needle = query.trim().toLowerCase();
  if (bundle.mode === 'manage') {
    if (!bundle.catalog) return [];
    const primary = normalizeReference(bundle.draft.primary);
    const fallbacks = bundle.draft.fallbacks.map(normalizeReference);
    return bundle.catalog.providers
      .map((provider) => ({
        provider: provider.slug,
        explicit: provider.explicit,
        ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
        ...(provider.api ? { api: provider.api } : {}),
        rows: provider.models
          .filter((model) => matchesQuery(needle, model.name, model.id, model.provider))
          .map((model): AgentModelRow => {
            const reference = modelReference(model.provider, model.id);
            const normalized = normalizeReference(reference);
            return {
              key: `${model.provider}:${model.id}`,
              id: model.id,
              name: model.name,
              provider: model.provider,
              reference,
              enabled: isModelEnabled(bundle.draft, reference),
              current: normalized === primary,
              fallbackIndex: fallbacks.indexOf(normalized),
              model,
            };
          }),
      }))
      .filter((group) => group.rows.length > 0 || (!needle && group.explicit));
  }
  const selection = bundle.selection;
  if (!selection) return [];
  const grouped = new Map<string, AgentModelRow[]>();
  for (const model of selection.models) {
    const id = model.id.trim() || model.name.trim();
    if (!id) continue;
    const provider = model.provider.trim();
    const name = model.name.trim() || id;
    if (!matchesQuery(needle, name, id, provider)) continue;
    const key = `${provider}:${id}`;
    const rows = grouped.get(provider) ?? [];
    if (rows.some((row) => row.key === key)) continue;
    rows.push({
      key,
      id,
      name,
      provider,
      reference: modelReference(provider, id),
      current: isCurrentSelection(model, selection),
      fallbackIndex: -1,
      model,
    });
    grouped.set(provider, rows);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([provider, rows]) => ({
      provider,
      explicit: false,
      rows: rows.sort((left, right) => (
        Number(right.current) - Number(left.current) || left.name.localeCompare(right.name)
      )),
    }));
}

export function findModelRow(groups: ReadonlyArray<AgentModelGroup>, key: string | null): AgentModelRow | null {
  if (!key) return null;
  for (const group of groups) {
    const row = group.rows.find((candidate) => candidate.key === key);
    if (row) return row;
  }
  return null;
}

export function buildModelSelectionWrite(
  row: Pick<AgentModelRow, 'id' | 'provider'>,
  capabilities: Pick<Capabilities, 'modelPerSession'>,
  agent: AgentDescriptor,
): ModelSelectionWrite {
  if (!capabilities.modelPerSession) {
    return {
      model: row.id,
      ...(row.provider ? { provider: row.provider } : {}),
      scope: 'global',
      sessionKey: null,
    };
  }
  return {
    model: row.id,
    ...(row.provider ? { provider: row.provider } : {}),
    scope: 'session',
    sessionKey: agent.mainSessionKey,
  };
}

export function formatContextWindow(value: number | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

export function formatModelCost(cost: ModelInfo['cost']): string | undefined {
  if (!cost) return undefined;
  if (![cost.input, cost.output].every((value) => Number.isFinite(value) && value >= 0)) {
    return undefined;
  }
  return `$${formatCostNumber(cost.input)} / $${formatCostNumber(cost.output)}`;
}

export function formatCostNumber(value: number): string {
  if (value >= 0.01) return value.toFixed(2);
  return value.toFixed(4);
}

export function displayModelName(reference: string, groups: ReadonlyArray<AgentModelGroup>): string {
  const needle = normalizeReference(reference);
  for (const group of groups) {
    const row = group.rows.find((candidate) => normalizeReference(candidate.reference) === needle);
    if (row) return row.name;
  }
  const slash = reference.indexOf('/');
  return slash >= 0 ? reference.slice(slash + 1) : reference;
}
