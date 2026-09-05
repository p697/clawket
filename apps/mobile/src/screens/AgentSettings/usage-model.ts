import type {
  CostSummary,
  UsageModelEntry,
  UsageResult,
  UsageTotals,
} from '@clawket/agent-protocol';

export type UsageRangeKey = 'today' | '7d' | '30d';

export type UsageSummary = Readonly<{
  totals: UsageTotals | null;
  messages: number;
  toolCalls: number;
  uniqueTools: number;
  sessions: number;
  daily: ReadonlyArray<Readonly<{ date: string; tokens: number; cost: number }>>;
  topModels: ReadonlyArray<UsageModelEntry>;
}>;

export function getUsageDateRange(
  key: UsageRangeKey,
  now = new Date(),
): Readonly<{ startDate: string; endDate: string }> {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  if (key === '7d') start.setDate(start.getDate() - 6);
  if (key === '30d') start.setDate(start.getDate() - 29);
  return { startDate: formatIsoDate(start), endDate: formatIsoDate(end) };
}

export function buildUsageSummary(
  usage: UsageResult | null,
  cost: CostSummary | null,
): UsageSummary {
  const totals = cost?.totals ?? usage?.totals ?? null;
  const messages = usage?.aggregates?.messages.total ?? 0;
  const tools = usage?.aggregates?.tools;
  const costDaily = cost?.daily ?? [];
  const usageDaily = usage?.aggregates?.daily ?? [];
  const daily = costDaily.length
    ? costDaily.map((entry) => ({
      date: entry.date,
      tokens: entry.totalTokens,
      cost: entry.totalCost,
    }))
    : usageDaily.map((entry) => ({
      date: entry.date,
      tokens: entry.tokens,
      cost: entry.cost,
    }));
  return {
    totals,
    messages,
    toolCalls: tools?.totalCalls ?? 0,
    uniqueTools: tools?.uniqueTools ?? 0,
    sessions: usage?.sessions?.filter((entry) => entry.usage !== null).length ?? 0,
    daily: [...daily].sort((left, right) => right.date.localeCompare(left.date)),
    topModels: [...(usage?.aggregates?.byModel ?? [])]
      .sort((left, right) => right.totals.totalTokens - left.totals.totalTokens)
      .slice(0, 5),
  };
}

export function hasUsageData(summary: UsageSummary): boolean {
  return Boolean(
    summary.totals?.totalTokens
    || summary.totals?.totalCost
    || summary.messages
    || summary.toolCalls
    || summary.sessions
    || summary.daily.length,
  );
}

export function formatUsageTokens(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value >= 1_000_000) return `${trimTrailingZero(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimTrailingZero(value / 1_000)}K`;
  return String(Math.round(value));
}

export function formatUsageCost(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value >= 100) return `$${value.toFixed(0)}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
}

function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function trimTrailingZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}
