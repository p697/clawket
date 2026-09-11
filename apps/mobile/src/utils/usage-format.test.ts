import { filterModelsByExcludedProvider, formatCompactTokenCount, formatCost, formatDayLabel, formatSessionContextLabel, formatTokens, pct } from './usage-format';
import type { UsageTotals } from '../types';

describe('formatTokens', () => {
  it('returns raw number below 1000', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1)).toBe('1');
  });

  it('formats thousands with K suffix', () => {
    expect(formatTokens(1000)).toBe('1.0K');
    expect(formatTokens(1500)).toBe('1.5K');
    expect(formatTokens(999_999)).toBe('1000.0K');
  });

  it('formats millions with M suffix', () => {
    expect(formatTokens(1_000_000)).toBe('1.0M');
    expect(formatTokens(2_500_000)).toBe('2.5M');
    expect(formatTokens(10_000_000)).toBe('10.0M');
  });

  it('handles negative numbers', () => {
    expect(formatTokens(-1)).toBe('-1');
    expect(formatTokens(-1500)).toBe('-1500');
  });
});

describe('formatCompactTokenCount', () => {
  it('omits trailing decimals for round values', () => {
    expect(formatCompactTokenCount(999)).toBe('999');
    expect(formatCompactTokenCount(1000)).toBe('1K');
    expect(formatCompactTokenCount(1500)).toBe('1.5K');
    expect(formatCompactTokenCount(160_000)).toBe('160K');
    expect(formatCompactTokenCount(1_000_000)).toBe('1M');
  });
});

describe('formatSessionContextLabel', () => {
  it('formats fresh session usage', () => {
    expect(formatSessionContextLabel({
      totalTokens: 160_000,
      totalTokensFresh: true,
      contextTokens: 200_000,
    })).toBe('160K / 200K');
  });

  it('falls back to max-only when usage is stale', () => {
    expect(formatSessionContextLabel({
      totalTokens: 160_000,
      totalTokensFresh: false,
      contextTokens: 200_000,
    })).toBe('Max 200K');
  });

  it('returns null without a context limit', () => {
    expect(formatSessionContextLabel({
      totalTokens: 160_000,
      totalTokensFresh: true,
    })).toBeNull();
  });
});

describe('formatCost', () => {
  it('formats with default 2 decimal places', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(1.5)).toBe('$1.50');
    expect(formatCost(100)).toBe('$100.00');
  });

  it('respects custom decimals', () => {
    expect(formatCost(1.23456, 4)).toBe('$1.2346');
    expect(formatCost(5, 0)).toBe('$5');
  });

  it('handles negative values', () => {
    expect(formatCost(-1.5)).toBe('$-1.50');
  });
});

describe('formatDayLabel', () => {
  it('formats valid YYYY-MM-DD date string', () => {
    const result = formatDayLabel('2024-01-15');
    // The app follows the device locale; Chinese Windows does not spell January "Jan".
    expect(result).toBe(new Date(Date.UTC(2024, 0, 15)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  });

  it('returns input for invalid format', () => {
    expect(formatDayLabel('not-a-date')).toBe('not-a-date');
    expect(formatDayLabel('2024/01/15')).toBe('2024/01/15');
    expect(formatDayLabel('')).toBe('');
  });

  it('handles out-of-range month/day by JS Date overflow', () => {
    // JS Date overflows 9999-99-99 to a valid date, so it formats it
    const result = formatDayLabel('9999-99-99');
    expect(typeof result).toBe('string');
    expect(result).not.toBe('');
  });
});

describe('pct', () => {
  it('computes percentage', () => {
    expect(pct(50, 100)).toBe(50);
    expect(pct(1, 4)).toBe(25);
  });

  it('returns 0 when total is 0', () => {
    expect(pct(10, 0)).toBe(0);
    expect(pct(0, 0)).toBe(0);
  });

  it('handles values exceeding total', () => {
    expect(pct(200, 100)).toBe(200);
  });
});

describe('filterModelsByExcludedProvider', () => {
  it('filters out models from excluded provider with case-insensitive match', () => {
    const totals: UsageTotals = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      totalCost: 0,
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheWriteCost: 0,
      missingCostEntries: 0,
    };
    const models = [
      { provider: 'openclaw', model: 'foo', count: 1, totals },
      { provider: 'OpenClaw', model: 'bar', count: 1, totals },
      { provider: 'openai', model: 'gpt-5', count: 1, totals },
      { provider: undefined, model: 'unknown', count: 1, totals },
    ];

    const result = filterModelsByExcludedProvider(models, 'openclaw');

    expect(result).toHaveLength(2);
    expect(result[0].provider).toBe('openai');
    expect(result[1].provider).toBeUndefined();
  });

  it('returns original list when excluded provider is empty', () => {
    const totals: UsageTotals = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      totalCost: 0,
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheWriteCost: 0,
      missingCostEntries: 0,
    };
    const models = [{ provider: 'openclaw', model: 'foo', count: 1, totals }];
    const result = filterModelsByExcludedProvider(models, '   ');
    expect(result).toBe(models);
  });
});
