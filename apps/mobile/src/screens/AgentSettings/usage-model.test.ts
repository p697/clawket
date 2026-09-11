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
