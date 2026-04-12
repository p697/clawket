import { loadGatewayUsageDashboardBundle } from './gateway-usage-dashboard';

describe('gateway-usage-dashboard', () => {
  it('loads usage and cost summary as one bundle', async () => {
    const gateway = {
      fetchUsage: jest.fn().mockResolvedValue({
        sessions: [{ key: 'agent:main:session-1' }],
      }),
      fetchCostSummary: jest.fn().mockResolvedValue({
        totals: { totalCost: 12.3, totalTokens: 456 },
      }),
    };

    await expect(loadGatewayUsageDashboardBundle(gateway, {
      startDate: '2026-04-10',
      endDate: '2026-04-10',
    })).resolves.toEqual({
      usageResult: { sessions: [{ key: 'agent:main:session-1' }] },
      costSummary: { totals: { totalCost: 12.3, totalTokens: 456 } },
    });
  });
});
