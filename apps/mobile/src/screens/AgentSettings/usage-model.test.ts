import type { CostSummary, UsageResult, UsageTotals } from '@clawket/agent-protocol';
import {
  buildUsageSummary,
  formatUsageCost,
  formatUsageTokens,
  getUsageDateRange,
  hasUsageData,
} from './usage-model';

const totals: UsageTotals = {
  input: 800,
  output: 200,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 1_000,
  totalCost: 1.25,
  inputCost: 0.5,
  outputCost: 0.75,
  cacheReadCost: 0,
  cacheWriteCost: 0,
  missingCostEntries: 0,
};

const usage: UsageResult = {
  totals: { ...totals, totalCost: 1 },
  sessions: [{ key: 'main', usage: { totalTokens: 1_000, totalCost: 1 } }],
  aggregates: {
    messages: { total: 4, user: 2, assistant: 2, toolCalls: 3, toolResults: 3, errors: 0 },
    tools: { totalCalls: 3, uniqueTools: 2, tools: [] },
    byModel: [{ provider: 'openai', model: 'gpt-5', count: 4, totals }],
    byProvider: [],
    byAgent: [],
    byChannel: [],
    daily: [{ date: '2026-09-04', tokens: 900, cost: 1, messages: 4, toolCalls: 3, errors: 0 }],
  },
};

const cost: CostSummary = {
  totals,
  daily: [{ date: '2026-09-05', ...totals }],
};

describe('Agent usage model', () => {
  it('builds deterministic local date ranges', () => {
    const now = new Date(2026, 8, 5, 12);
    expect(getUsageDateRange('today', now)).toEqual({ startDate: '2026-09-05', endDate: '2026-09-05' });
    expect(getUsageDateRange('7d', now)).toEqual({ startDate: '2026-08-30', endDate: '2026-09-05' });
  });

  it('prefers authoritative cost totals and daily rows while retaining usage metrics', () => {
    const summary = buildUsageSummary(usage, cost);
    expect(summary.totals).toEqual(totals);
    expect(summary.messages).toBe(4);
    expect(summary.toolCalls).toBe(3);
    expect(summary.sessions).toBe(1);
    expect(summary.daily).toEqual([
      { date: '2026-09-05', tokens: 1_000, cost: 1.25 },
      { date: '2026-09-04', tokens: 900, cost: 1 },
    ]);
    expect(hasUsageData(summary)).toBe(true);
    expect(hasUsageData(buildUsageSummary(null, null))).toBe(false);
  });

  it('does not replace measured usage with zero-token billing totals', () => {
    const zeroTokens = { ...totals, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
    const summary = buildUsageSummary(usage, {
      totals: zeroTokens, daily: [{ date: '2026-09-04', ...zeroTokens }],
    });
    expect(summary.totals?.totalTokens).toBe(1000);
    expect(summary.totals?.input).toBe(800);
    expect(summary.totals?.totalCost).toBe(1.25);
    expect(summary.daily).toEqual([{ date: '2026-09-04', tokens: 900, cost: 1.25 }]);
  });

  it('formats compact token and cost values', () => {
    expect(formatUsageTokens(1_250)).toBe('1.3K');
    expect(formatUsageTokens(2_000_000)).toBe('2M');
    expect(formatUsageCost(1.25)).toBe('$1.25');
    expect(formatUsageCost(0.01234)).toBe('$0.0123');
  });
});

describe('Agent usage presentation model', () => {
  const {
    buildUsageDailySeries,
    buildUsageSegments,
    computeCacheHitRate,
    formatUsageDayLabel,
    rankUsageModels,
    resolveUsageMeasure,
  } = jest.requireActual<typeof import('./usage-model')>('./usage-model');

  it('leads with dollars only for a priced, non-zero range', () => {
    const priced = buildUsageSummary(usage, cost);
    expect(resolveUsageMeasure(priced, true)).toBe('cost');
    expect(resolveUsageMeasure(priced, false)).toBe('tokens');
    expect(resolveUsageMeasure(buildUsageSummary(usage, { ...cost, costPresentation: { mode: 'unknown' } }), true)).toBe('tokens');
    expect(resolveUsageMeasure(buildUsageSummary(usage, { ...cost, costPresentation: { mode: 'included' } }), true)).toBe('tokens');
    const free = buildUsageSummary({ ...usage, totals: { ...totals, totalCost: 0 } }, { totals: { ...totals, totalCost: 0 } });
    expect(resolveUsageMeasure(free, true)).toBe('tokens');
  });

  it('orders priced segments by token price and token segments by flow', () => {
    expect(buildUsageSegments(totals, 'cost').map((segment) => segment.key)).toEqual(['output', 'input', 'cacheWrite', 'cacheRead']);
    expect(buildUsageSegments(totals, 'tokens')).toEqual([
      { key: 'input', value: 800 },
      { key: 'output', value: 200 },
      { key: 'cacheRead', value: 0 },
      { key: 'cacheWrite', value: 0 },
    ]);
    expect(buildUsageSegments(null, 'cost')).toEqual([]);
  });

  it('computes the cache hit rate from prompt tokens only', () => {
    expect(computeCacheHitRate({ ...totals, input: 12_400, cacheRead: 58_900 })).toBe(83);
    expect(computeCacheHitRate({ ...totals, input: 0, cacheRead: 0 })).toBeNull();
    expect(computeCacheHitRate(null)).toBeNull();
  });

  it('pads the daily series to the full range and marks today', () => {
    const summary = buildUsageSummary(usage, cost);
    const series = buildUsageDailySeries(summary.daily, { startDate: '2026-09-03', endDate: '2026-09-05' }, 'tokens', '2026-09-05');
    expect(series).toEqual([
      { date: '2026-09-03', value: 0, today: false },
      { date: '2026-09-04', value: 900, today: false },
      { date: '2026-09-05', value: 1_000, today: true },
    ]);
    expect(buildUsageDailySeries(summary.daily, { startDate: '2026-09-04', endDate: '2026-09-05' }, 'cost', '2026-09-05').map((point) => point.value))
      .toEqual([1, 1.25]);
    expect(buildUsageDailySeries(summary.daily, { startDate: 'bad', endDate: '2026-09-05' }, 'cost', '2026-09-05')).toEqual([]);
    expect(formatUsageDayLabel('2026-09-05')).toBe('9/5');
    expect(formatUsageDayLabel('nope')).toBe('nope');
  });

  it('ranks models by the leading measure and formats a zero cost plainly', () => {
    const cheap = { provider: 'openai', model: 'mini', count: 9, totals: { ...totals, totalTokens: 5_000, totalCost: 0.1 } };
    const ranked = rankUsageModels([cheap, { provider: 'openai', model: 'gpt-5', count: 4, totals }], 'cost');
    expect(ranked.map((entry) => entry.model)).toEqual(['gpt-5', 'mini']);
    expect(rankUsageModels(ranked, 'tokens').map((entry) => entry.model)).toEqual(['mini', 'gpt-5']);
    expect(formatUsageCost(0)).toBe('$0.00');
  });
});
