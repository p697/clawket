import type { CostSummary, UsageResult } from '../types';

type GatewayUsageDashboardGateway = {
  fetchUsage(range: { startDate: string; endDate: string }): Promise<UsageResult>;
  fetchCostSummary(range: { startDate: string; endDate: string }): Promise<CostSummary>;
};

export type GatewayUsageDashboardBundle = {
  usageResult: UsageResult | null;
  costSummary: CostSummary | null;
};

export async function loadGatewayUsageDashboardBundle(
  gateway: GatewayUsageDashboardGateway,
  range: { startDate: string; endDate: string },
): Promise<GatewayUsageDashboardBundle> {
  const [usageResult, costSummary] = await Promise.all([
    gateway.fetchUsage(range),
    gateway.fetchCostSummary(range),
  ]);

  return {
    usageResult: usageResult ?? null,
    costSummary: costSummary ?? null,
  };
}
