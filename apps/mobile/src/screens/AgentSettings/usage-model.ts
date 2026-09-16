import type {
  CostPresentation,
  CostSummary,
  UsageModelEntry,
  UsageResult,
  UsageTotals,
} from '@clawket/agent-protocol';

export type UsageToolEntry = Readonly<{ name: string; count: number }>;

export type UsageRangeKey = 'today' | '7d' | '30d';

export const USAGE_RANGE_KEYS: ReadonlyArray<UsageRangeKey> = ['today', '7d', '30d'];

export type UsageDateRange = Readonly<{ startDate: string; endDate: string }>;

/** Which number leads the page: dollars when the backend priced the range, tokens otherwise. */
export type UsageMeasure = 'cost' | 'tokens';

export type UsageSegmentKey = 'input' | 'output' | 'cacheRead' | 'cacheWrite';

export type UsageSegment = Readonly<{ key: UsageSegmentKey; value: number }>;

export type UsageDailyPoint = Readonly<{ date: string; value: number; today: boolean }>;

export type UsageSummary = Readonly<{
  totals: UsageTotals | null;
  messages: number;
  toolCalls: number;
  uniqueTools: number;
  sessions: number;
  daily: ReadonlyArray<Readonly<{ date: string; tokens: number; cost: number }>>;
  topModels: ReadonlyArray<UsageModelEntry>;
  topTools: ReadonlyArray<UsageToolEntry>;
  presentation: CostPresentation | null;
}>;

export const USAGE_TOP_MODELS = 5;
export const USAGE_TOP_TOOLS = 5;

export function getUsageDateRange(
  key: UsageRangeKey,
  now = new Date(),
): UsageDateRange {
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
  const totals = usage?.totals && cost?.totals ? {
    ...cost.totals,
    input: usage.totals.input,
    output: usage.totals.output,
    cacheRead: usage.totals.cacheRead,
    cacheWrite: usage.totals.cacheWrite,
    totalTokens: usage.totals.totalTokens,
  } : usage?.totals ?? cost?.totals ?? null;
  const messages = usage?.aggregates?.messages.total ?? 0;
  const tools = usage?.aggregates?.tools;
  const costDaily = cost?.daily ?? [];
  const usageDaily = usage?.aggregates?.daily ?? [];
  const dailyByDate = new Map(usageDaily.map((entry) => [entry.date, {
      date: entry.date,
      tokens: entry.tokens,
      cost: entry.cost,
    }]));
  for (const entry of costDaily) {
    dailyByDate.set(entry.date, {
      date: entry.date,
      tokens: dailyByDate.get(entry.date)?.tokens ?? entry.totalTokens,
      cost: entry.totalCost,
    });
  }
  return {
    totals,
    messages,
    toolCalls: tools?.totalCalls ?? 0,
    uniqueTools: tools?.uniqueTools ?? 0,
    sessions: usage?.sessions?.filter((entry) => entry.usage !== null).length ?? 0,
    daily: [...dailyByDate.values()].sort((left, right) => right.date.localeCompare(left.date)),
    topModels: [...(usage?.aggregates?.byModel ?? [])]
      .sort((left, right) => right.totals.totalTokens - left.totals.totalTokens)
      .slice(0, USAGE_TOP_MODELS),
    topTools: [...(tools?.tools ?? [])]
      .filter((entry) => entry.count > 0)
      .sort((left, right) => right.count - left.count)
      .slice(0, USAGE_TOP_TOOLS),
    presentation: cost?.costPresentation ?? usage?.costPresentation ?? null,
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

/**
 * Dollars lead only when the backend priced the range and the range actually
 * cost something; an `unknown` or `included` presentation, or a $0 range, falls
 * back to tokens so the page never leads with a meaningless `$0.00`.
 */
export function resolveUsageMeasure(summary: UsageSummary, canShowCost: boolean): UsageMeasure {
  if (!canShowCost) return 'tokens';
  const mode = summary.presentation?.mode;
  if (mode === 'unknown' || mode === 'included') return 'tokens';
  return (summary.totals?.totalCost ?? 0) > 0 ? 'cost' : 'tokens';
}

/** Priced segments run from the most to the least expensive token class. */
export function buildUsageSegments(totals: UsageTotals | null, measure: UsageMeasure): ReadonlyArray<UsageSegment> {
  if (!totals) return [];
  if (measure === 'cost') {
    return [
      { key: 'output', value: safeNumber(totals.outputCost) },
      { key: 'input', value: safeNumber(totals.inputCost) },
      { key: 'cacheWrite', value: safeNumber(totals.cacheWriteCost) },
      { key: 'cacheRead', value: safeNumber(totals.cacheReadCost) },
    ];
  }
  return [
    { key: 'input', value: safeNumber(totals.input) },
    { key: 'output', value: safeNumber(totals.output) },
    { key: 'cacheRead', value: safeNumber(totals.cacheRead) },
    { key: 'cacheWrite', value: safeNumber(totals.cacheWrite) },
  ];
}

/** Share of prompt tokens served from cache, as a whole percentage; null when nothing was prompted. */
export function computeCacheHitRate(totals: UsageTotals | null): number | null {
  if (!totals) return null;
  const denominator = safeNumber(totals.input) + safeNumber(totals.cacheRead);
  if (denominator <= 0) return null;
  return Math.round((safeNumber(totals.cacheRead) / denominator) * 100);
}

/** One point per calendar day in the range, missing days padded with zero so bar counts stay fixed. */
export function buildUsageDailySeries(
  daily: UsageSummary['daily'],
  range: UsageDateRange,
  measure: UsageMeasure,
  today: string,
): ReadonlyArray<UsageDailyPoint> {
  const byDate = new Map(daily.map((entry) => [entry.date, entry]));
  const points: UsageDailyPoint[] = [];
  const cursor = parseIsoDate(range.startDate);
  const end = parseIsoDate(range.endDate);
  if (!cursor || !end) return points;
  while (cursor.getTime() <= end.getTime()) {
    const date = formatIsoDate(cursor);
    const entry = byDate.get(date);
    points.push({
      date,
      value: entry ? safeNumber(measure === 'cost' ? entry.cost : entry.tokens) : 0,
      today: date === today,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return points;
}

export function usageModelValue(entry: UsageModelEntry, measure: UsageMeasure): number {
  return safeNumber(measure === 'cost' ? entry.totals.totalCost : entry.totals.totalTokens);
}

export function rankUsageModels(
  models: ReadonlyArray<UsageModelEntry>,
  measure: UsageMeasure,
): ReadonlyArray<UsageModelEntry> {
  return [...models]
    .sort((left, right) => usageModelValue(right, measure) - usageModelValue(left, measure))
    .slice(0, USAGE_TOP_MODELS);
}

export function formatUsageValue(value: number, measure: UsageMeasure): string {
  return measure === 'cost' ? formatUsageCost(value) : formatUsageTokens(value);
}

export function formatUsageTokens(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value >= 1_000_000) return `${trimTrailingZero(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimTrailingZero(value / 1_000)}K`;
  return String(Math.round(value));
}

export function formatUsageCost(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value === 0) return '$0.00';
  if (value >= 100) return `$${value.toFixed(0)}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
}

/** Short numeric day label (`9/16`) that reads the same in every locale. */
export function formatUsageDayLabel(date: string): string {
  const parsed = parseIsoDate(date);
  if (!parsed) return date;
  return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
}

export function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeNumber(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function trimTrailingZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}
