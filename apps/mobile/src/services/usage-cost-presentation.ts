import type { CostPresentation, CostSummary, UsageResult } from '../types/usage';

/** Backend completeness signals take precedence over a plausible-looking dollar subtotal. */
export function resolveCostPresentation(usage: UsageResult | null, cost: CostSummary | null): CostPresentation | null {
  const presentation = cost?.costPresentation ?? usage?.costPresentation ?? null;
  const missing = Math.max(cost?.totals?.missingCostEntries ?? 0, usage?.totals?.missingCostEntries ?? 0);
  const total = cost?.totals?.totalCost ?? usage?.totals?.totalCost ?? 0;
  if (presentation?.mode === 'unknown') return presentation;
  if (missing > 0) return { ...presentation, mode: total > 0 ? 'mixed' : 'unknown' };
  return presentation;
}
