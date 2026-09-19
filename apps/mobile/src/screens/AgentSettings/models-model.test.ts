import type {
  AgentDescriptor,
  ModelCatalogState,
  ModelSelectionState,
  ModelsOperations,
} from '@clawket/agent-protocol';
import {
  addDraftFallback,
  buildAgentModelGroups,
  buildModelsCatalogWrite,
  buildModelSelectionWrite,
  canManageModels,
  displayModelName,
  findModelRow,
  formatContextWindow,
  formatModelCost,
  isModelsDraftDirty,
  loadModelsBundle,
  moveDraftFallbackUp,
  removeDraftFallback,
  setDraftPrimary,
  toggleModelEnabled,
  type ModelsBundle,
} from './models-model';

const agent: AgentDescriptor = {
  connectionId: 'studio',
  agentId: 'main',
  name: 'Main',
  isMain: true,
  mainSessionKey: 'agent:main:main',
};

const catalog: ModelCatalogState = {
  defaults: { primary: 'openai/gpt-5', fallbacks: ['anthropic/sonnet'], thinkingDefault: 'medium' },
  allowlist: null,
  providers: [
    {
      slug: 'anthropic',
      explicit: false,
      models: [{ id: 'sonnet', name: 'Sonnet', provider: 'anthropic', reasoning: true, configured: false, costOverridden: false }],
    },
    { slug: 'empty', explicit: true, baseUrl: 'https://empty.example.com', models: [] },
    {
      slug: 'openai',
      explicit: true,
      models: [
        {
          id: 'gpt-5', name: 'GPT-5', provider: 'openai', contextWindow: 200_000, configured: true, costOverridden: true,
          cost: { input: 0.0025, output: 1.5, cacheRead: 0, cacheWrite: 0 },
        },
        { id: 'mini', name: 'Mini', provider: 'openai', configured: false, costOverridden: false },
      ],
    },
  ],
};

const selection: ModelSelectionState = {
  currentModel: 'gpt-5',
  currentProvider: 'openai',
  currentBaseUrl: '',
  models: [
    { id: 'sonnet', name: 'Sonnet', provider: 'anthropic' },
    { id: 'gpt-5', name: 'GPT-5', provider: 'openai' },
    { id: 'mini', name: 'Mini', provider: 'openai' },
    { id: 'mini', name: 'Mini duplicate', provider: 'openai' },
    { id: '', name: '', provider: 'openai' },
  ],
};

function manageBundle(overrides: Partial<ModelsBundle['draft']> = {}, state = catalog): ModelsBundle {
  return {
    mode: 'manage',
    catalog: state,
    selection: null,
    draft: {
      primary: state.defaults.primary,
      fallbacks: [...state.defaults.fallbacks],
      thinkingDefault: state.defaults.thinkingDefault,
      allowlist: state.allowlist,
      ...overrides,
    },
  };
}

describe('Agent models model', () => {
  it('loads the manage bundle only when the capability and operation both exist', async () => {
    const getCatalog = jest.fn(async () => catalog);
    const getSelection = jest.fn(async () => selection);
    const operations: ModelsOperations = { getCatalog, getSelection };
    expect(canManageModels({ models: true, modelManage: true }, operations)).toBe(true);
    expect(canManageModels({ models: true, modelManage: false }, operations)).toBe(false);
    expect(canManageModels({ models: true, modelManage: true }, { getSelection })).toBe(false);

    const managed = await loadModelsBundle(operations, { models: true, modelManage: true });
    expect(managed.mode).toBe('manage');
    expect(managed.draft).toEqual({
      primary: 'openai/gpt-5', fallbacks: ['anthropic/sonnet'], thinkingDefault: 'medium', allowlist: null,
    });
    expect(getSelection).not.toHaveBeenCalled();

    const selected = await loadModelsBundle(operations, { models: true, modelManage: false });
    expect(selected.mode).toBe('select');
    expect(selected.selection).toBe(selection);
    expect(getCatalog).toHaveBeenCalledTimes(1);
  });

  it('falls back to the plain list when a backend has no selection state', async () => {
    const list = jest.fn(async () => selection.models);
    const empty = await loadModelsBundle(
      { getSelection: async () => ({ ...selection, models: [] }), list },
      { models: true, modelManage: false },
    );
    expect(empty.selection?.models).toEqual(selection.models);
    expect(empty.selection?.currentModel).toBe('gpt-5');
    const none = await loadModelsBundle(undefined, { models: false, modelManage: false });
    expect(none).toMatchObject({ mode: 'select', selection: null });
  });

  it('groups manage rows with enable state, default and fallback markers', () => {
    const groups = buildAgentModelGroups(manageBundle());
    expect(groups.map((group) => group.provider)).toEqual(['anthropic', 'empty', 'openai']);
    expect(groups[1]).toMatchObject({ explicit: true, baseUrl: 'https://empty.example.com', rows: [] });
    expect(groups[2]?.rows.map((row) => [row.id, row.enabled, row.current, row.fallbackIndex])).toEqual([
      ['gpt-5', true, true, -1],
      ['mini', true, false, -1],
    ]);
    expect(groups[0]?.rows[0]).toMatchObject({ reference: 'anthropic/sonnet', fallbackIndex: 0 });
    expect(buildAgentModelGroups(manageBundle(), 'sonnet').map((group) => group.provider)).toEqual(['anthropic']);
    expect(buildAgentModelGroups(manageBundle({ allowlist: ['OpenAI/GPT-5'] }))[2]?.rows.map((row) => row.enabled))
      .toEqual([true, false]);
    expect(buildAgentModelGroups(null)).toEqual([]);
    expect(buildAgentModelGroups({ ...manageBundle(), catalog: null })).toEqual([]);
  });

  it('groups select rows by provider, promotes the current model and drops duplicates', () => {
    const bundle: ModelsBundle = { mode: 'select', catalog: null, selection, draft: manageBundle().draft };
    const groups = buildAgentModelGroups(bundle);
    expect(groups.map((group) => group.provider)).toEqual(['anthropic', 'openai']);
    expect(groups[1]?.rows.map((row) => [row.id, row.current])).toEqual([['gpt-5', true], ['mini', false]]);
    expect(groups[1]?.rows[0]?.enabled).toBeUndefined();
    expect(buildAgentModelGroups(bundle, 'mini')[0]?.rows).toHaveLength(1);
    expect(buildAgentModelGroups({ ...bundle, selection: null })).toEqual([]);
    expect(findModelRow(groups, 'openai:mini')?.name).toBe('Mini');
    expect(findModelRow(groups, null)).toBeNull();
    expect(findModelRow(groups, 'missing')).toBeNull();
  });

  it('materializes an allowlist when the first model is disabled and edits it afterwards', () => {
    const bundle = manageBundle();
    const disabled = toggleModelEnabled(bundle.draft, catalog, 'openai/mini', false);
    expect(disabled.allowlist).toEqual(['anthropic/sonnet', 'openai/gpt-5']);
    expect(toggleModelEnabled(bundle.draft, catalog, 'openai/mini', true)).toBe(bundle.draft);
    const enabled = toggleModelEnabled(disabled, catalog, 'openai/mini', true);
    expect(enabled.allowlist).toEqual(['anthropic/sonnet', 'openai/gpt-5', 'openai/mini']);
    expect(toggleModelEnabled(enabled, catalog, 'OpenAI/Mini', false).allowlist).toEqual(['anthropic/sonnet', 'openai/gpt-5']);
  });

  it('honors provider wildcards in the allowlist and expands one when a model under it is disabled', () => {
    const wildcard = manageBundle({ allowlist: ['openai/*'] });
    const rows = buildAgentModelGroups(wildcard).flatMap((group) => group.rows);
    expect(rows.map((row) => [row.key, row.enabled])).toEqual([
      ['anthropic:sonnet', false],
      ['openai:gpt-5', true],
      ['openai:mini', true],
    ]);
    expect(toggleModelEnabled(wildcard.draft, catalog, 'openai/gpt-5', true)).toBe(wildcard.draft);
    const expanded = toggleModelEnabled(wildcard.draft, catalog, 'openai/mini', false);
    expect(expanded.allowlist).toEqual(['openai/gpt-5']);
    expect(isModelsDraftDirty({ ...wildcard, draft: expanded })).toBe(true);
    expect(buildModelsCatalogWrite({ ...wildcard, draft: expanded })).toEqual({
      allowlist: [
        { provider: 'anthropic', modelId: 'sonnet', enabled: false },
        { provider: 'openai', modelId: 'gpt-5', enabled: true },
        { provider: 'openai', modelId: 'mini', enabled: false },
      ],
    });
    const mixed = manageBundle({ allowlist: ['anthropic/sonnet', 'openai/*'] });
    expect(toggleModelEnabled(mixed.draft, catalog, 'anthropic/sonnet', false).allowlist).toEqual(['openai/*']);
  });

  it('edits defaults and fallbacks without duplicates or the primary itself', () => {
    const draft = manageBundle().draft;
    const primary = setDraftPrimary(draft, 'anthropic/sonnet');
    expect(primary).toEqual({ ...draft, primary: 'anthropic/sonnet', fallbacks: [] });
    expect(addDraftFallback(draft, 'openai/gpt-5')).toBe(draft);
    expect(addDraftFallback(draft, 'Anthropic/Sonnet')).toBe(draft);
    expect(addDraftFallback(draft, '  ')).toBe(draft);
    const added = addDraftFallback(draft, 'openai/mini');
    expect(added.fallbacks).toEqual(['anthropic/sonnet', 'openai/mini']);
    expect(moveDraftFallbackUp(added, 1).fallbacks).toEqual(['openai/mini', 'anthropic/sonnet']);
    expect(moveDraftFallbackUp(added, 0)).toBe(added);
    expect(moveDraftFallbackUp(added, 5)).toBe(added);
    expect(removeDraftFallback(added, 0).fallbacks).toEqual(['openai/mini']);
  });

  it('detects dirty drafts and writes only the changed parts', () => {
    expect(isModelsDraftDirty(manageBundle())).toBe(false);
    expect(isModelsDraftDirty({ mode: 'select', catalog: null, selection, draft: manageBundle().draft })).toBe(false);
    expect(buildModelsCatalogWrite(manageBundle())).toEqual({});
    expect(buildModelsCatalogWrite({ mode: 'select', catalog: null, selection, draft: manageBundle().draft })).toEqual({});

    const thinking = manageBundle({ thinkingDefault: 'high' });
    expect(isModelsDraftDirty(thinking)).toBe(true);
    expect(buildModelsCatalogWrite(thinking)).toEqual({
      defaults: { primary: 'openai/gpt-5', fallbacks: ['anthropic/sonnet'], thinkingDefault: 'high' },
    });

    const allowlist = manageBundle({ allowlist: ['openai/gpt-5'] });
    expect(isModelsDraftDirty(allowlist)).toBe(true);
    expect(buildModelsCatalogWrite(allowlist)).toEqual({
      allowlist: [
        { provider: 'anthropic', modelId: 'sonnet', enabled: false },
        { provider: 'openai', modelId: 'gpt-5', enabled: true },
        { provider: 'openai', modelId: 'mini', enabled: false },
      ],
    });

    const configured = { ...catalog, allowlist: ['openai/gpt-5', 'anthropic/sonnet'] };
    expect(isModelsDraftDirty(manageBundle({ allowlist: ['ANTHROPIC/sonnet', 'openai/gpt-5'] }, configured))).toBe(false);
    expect(isModelsDraftDirty(manageBundle({ fallbacks: [] }, configured))).toBe(true);
  });

  it('keeps the global write shape for select backends and formats display values', () => {
    expect(buildModelSelectionWrite({ id: 'gpt-5', provider: 'openai' }, { modelPerSession: false }, agent)).toEqual({
      model: 'gpt-5', provider: 'openai', scope: 'global', sessionKey: null,
    });
    expect(buildModelSelectionWrite({ id: 'gpt-5', provider: '' }, { modelPerSession: true }, agent)).toEqual({
      model: 'gpt-5', scope: 'session', sessionKey: 'agent:main:main',
    });
    expect(formatModelCost(catalog.providers[2]!.models[0]!.cost)).toBe('$0.0025 / $1.50');
    expect(formatModelCost(undefined)).toBeUndefined();
    expect(formatModelCost({ input: -1, output: 1, cacheRead: 0, cacheWrite: 0 })).toBeUndefined();
    expect(formatContextWindow(200_000)).toBe('200K');
    expect(formatContextWindow(1_000_000)).toBe('1M');
    expect(formatContextWindow(1_500_000)).toBe('1.5M');
    expect(formatContextWindow(512)).toBe('512');
    expect(formatContextWindow(0)).toBeUndefined();
    const groups = buildAgentModelGroups(manageBundle());
    expect(displayModelName('OpenAI/gpt-5', groups)).toBe('GPT-5');
    expect(displayModelName('other/unknown', groups)).toBe('unknown');
    expect(displayModelName('bare', groups)).toBe('bare');
  });
});
