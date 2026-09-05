import type {
  AgentDescriptor,
  ModelSelectionState,
} from '@clawket/agent-protocol';
import {
  buildAgentModelGroups,
  buildModelSelectionWrite,
  formatModelCost,
} from './models-model';

const agent: AgentDescriptor = {
  connectionId: 'studio',
  agentId: 'main',
  name: 'Main',
  isMain: true,
  mainSessionKey: 'agent:main:main',
};

const selection: ModelSelectionState = {
  currentModel: 'gpt-5',
  currentProvider: 'openai',
  currentBaseUrl: '',
  models: [
    { id: 'sonnet', name: 'Sonnet', provider: 'anthropic' },
    {
      id: 'gpt-5',
      name: 'GPT-5',
      provider: 'openai',
      cost: { input: 0.0025, output: 1.5, cacheRead: 0, cacheWrite: 0 },
    },
    { id: 'mini', name: 'Mini', provider: 'openai' },
  ],
};

describe('Agent models model', () => {
  it('groups, filters, and promotes the current model without backend checks', () => {
    const groups = buildAgentModelGroups(selection);
    expect(groups.map((group) => group.provider)).toEqual(['anthropic', 'openai']);
    expect(groups[1]?.rows.map((row) => row.id)).toEqual(['gpt-5', 'mini']);
    expect(groups[1]?.rows[0]?.current).toBe(true);
    expect(buildAgentModelGroups(selection, 'sonnet')[0]?.rows).toHaveLength(1);
  });

  it('uses session scope only when the capability permits it', () => {
    const row = buildAgentModelGroups(selection)[1]!.rows[0]!;
    expect(buildModelSelectionWrite(row, { modelPerSession: true }, agent)).toEqual({
      model: 'gpt-5',
      provider: 'openai',
      scope: 'session',
      sessionKey: 'agent:main:main',
    });
    expect(buildModelSelectionWrite(row, { modelPerSession: false }, agent)).toEqual({
      model: 'gpt-5',
      provider: 'openai',
      scope: 'global',
      sessionKey: null,
    });
  });

  it('formats valid input/output costs and rejects invalid values', () => {
    expect(formatModelCost(selection.models[1]!.cost)).toBe('$0.0025 / $1.50');
    expect(formatModelCost(undefined)).toBeUndefined();
    expect(formatModelCost({ input: -1, output: 1, cacheRead: 0, cacheWrite: 0 }))
      .toBeUndefined();
  });
});
