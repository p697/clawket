import type { UsageModelEntry } from '../types';

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatCompactTokenCount(n: number): string {
  if (n >= 1_000_000) {
    const value = n / 1_000_000;
    return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const value = n / 1_000;
    return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}K`;
  }
  return String(n);
}

export function formatSessionContextLabel(params: {
  totalTokens?: number;
  totalTokensFresh?: boolean;
  contextTokens?: number;
}): string | null {
  const contextTokens = params.contextTokens;
  if (!(typeof contextTokens === 'number') || !Number.isFinite(contextTokens) || contextTokens <= 0) {
    return null;
  }

  const totalTokens = params.totalTokens;
  const hasFreshTotal = params.totalTokensFresh !== false
    && typeof totalTokens === 'number'
    && Number.isFinite(totalTokens)
    && totalTokens >= 0;

  if (!hasFreshTotal) {
    return `Max ${formatCompactTokenCount(contextTokens)}`;
  }

  return `${formatCompactTokenCount(totalTokens)} / ${formatCompactTokenCount(contextTokens)}`;
}

export function formatCost(n: number, decimals = 2): string {
  return `$${n.toFixed(decimals)}`;
}

export function formatDayLabel(dateStr: string): string {
  // dateStr = "YYYY-MM-DD"
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return dateStr;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(date.valueOf())) return dateStr;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function pct(part: number, total: number): number {
  return total === 0 ? 0 : (part / total) * 100;
}

export function filterModelsByExcludedProvider(
  models: UsageModelEntry[],
  excludedProvider: string,
): UsageModelEntry[] {
  const excluded = excludedProvider.trim().toLowerCase();
  if (!excluded) return models;
  return models.filter((entry) => (entry.provider ?? '').trim().toLowerCase() !== excluded);
}
