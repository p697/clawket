import type {
  AgentDescriptor,
  Capabilities,
  ModelInfo,
  ModelSelectionState,
  ModelSelectionWrite,
} from '@clawket/agent-protocol';

export type AgentModelRow = Readonly<{
  key: string;
  id: string;
  name: string;
  provider: string;
  current: boolean;
  cost?: ModelInfo['cost'];
}>;

export type AgentModelGroup = Readonly<{
  provider: string;
  rows: ReadonlyArray<AgentModelRow>;
}>;

export function buildAgentModelGroups(
  state: ModelSelectionState | null,
  query = '',
): ReadonlyArray<AgentModelGroup> {
  if (!state) return [];
  const needle = query.trim().toLowerCase();
  const rows = new Map<string, AgentModelRow>();

  for (const model of state.models) {
    const id = model.id.trim() || model.name.trim();
    const provider = model.provider.trim();
    if (!id) continue;
    const key = `${provider}:${id}`;
    const name = model.name.trim() || id;
    const row = {
      key,
      id,
      name,
      provider,
      current: isCurrentModel(model, state),
      ...(model.cost ? { cost: model.cost } : {}),
    } satisfies AgentModelRow;
    if (needle && !`${name}\n${id}\n${provider}`.toLowerCase().includes(needle)) continue;
    rows.set(key, row);
  }

  const grouped = new Map<string, AgentModelRow[]>();
  for (const row of rows.values()) {
    const key = row.provider;
    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([provider, providerRows]) => ({
      provider,
      rows: providerRows.sort((left, right) => (
        Number(right.current) - Number(left.current)
        || left.name.localeCompare(right.name)
      )),
    }));
}

export function buildModelSelectionWrite(
  row: AgentModelRow,
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

export function formatModelCost(cost: ModelInfo['cost']): string | undefined {
  if (!cost) return undefined;
  if (![cost.input, cost.output].every((value) => Number.isFinite(value) && value >= 0)) {
    return undefined;
  }
  return `$${formatCostNumber(cost.input)} / $${formatCostNumber(cost.output)}`;
}

function isCurrentModel(model: ModelInfo, state: ModelSelectionState): boolean {
  const currentModel = state.currentModel.trim().toLowerCase();
  const currentProvider = state.currentProvider.trim().toLowerCase();
  const provider = model.provider.trim().toLowerCase();
  const candidates = [
    model.id,
    model.name,
    provider && model.id ? `${provider}/${model.id}` : '',
  ].map((value) => value.trim().toLowerCase()).filter(Boolean);
  return candidates.includes(currentModel)
    && (!currentProvider || !provider || currentProvider === provider);
}

function formatCostNumber(value: number): string {
  if (value >= 1) return value.toFixed(2);
  if (value >= 0.01) return value.toFixed(2);
  return value.toFixed(4);
}
