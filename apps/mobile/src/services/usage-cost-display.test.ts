import {
  resolveDashboardCostDisplay,
  resolveUsageCostSummaryDisplay,
  resolveUsageSessionCostLabel,
} from './usage-cost-display';

describe('usage-cost-display', () => {
  const t = ((key: string) => key) as any;

  it('shows included cost as subscription-covered', () => {
    const result = resolveUsageCostSummaryDisplay({
      usageResult: null,
      costSummary: {
        totals: { totalCost: 0, totalTokens: 123 } as any,
        costPresentation: { mode: 'included' },
      },
      t,
    });

    expect(result).toMatchObject({
      valueLabel: '$0.00',
      subtitle: 'View usage details',
      bannerTitle: null,
    });
  });

  it('uses the same subtitle for unknown cost presentation', () => {
    const result = resolveUsageCostSummaryDisplay({
      usageResult: null,
      costSummary: {
        totals: { totalCost: 0, totalTokens: 123 } as any,
        costPresentation: { mode: 'unknown' },
      },
      t,
    });

    expect(result).toMatchObject({
      valueLabel: 'Unknown',
      subtitle: 'View usage details',
      bannerTitle: 'Cost unavailable',
    });
  });

  it('shows included sessions without a dollar value', () => {
    expect(resolveUsageSessionCostLabel({
      session: {
        key: 'sess_1',
        usage: { totalTokens: 100, totalCost: 0, costStatus: 'included' },
      },
      t,
    })).toBe('Included');
  });

  it('marks dashboard cost as estimated when presentation says estimated', () => {
    expect(resolveDashboardCostDisplay({
      usageResult: null,
      costSummary: { costPresentation: { mode: 'estimated' } } as any,
      fallbackCostLabel: '$12.30',
      t,
    })).toEqual({
      valueLabel: '$12.30',
      badge: 'Estimated',
    });
  });

  it('keeps dashboard included cost as a dollar value', () => {
    expect(resolveDashboardCostDisplay({
      usageResult: null,
      costSummary: { costPresentation: { mode: 'included' } } as any,
      fallbackCostLabel: '$0.00',
      t,
    })).toEqual({
      valueLabel: '$0.00',
      badge: null,
    });
  });
});
