import { resolveCostPresentation } from './usage-cost-presentation';
import type { CostSummary } from '../types/usage';

const summary = (totalCost: number, missingCostEntries: number): CostSummary => ({
  totals: { totalCost, missingCostEntries } as CostSummary['totals'],
});

it('marks the recorded Lucy subtotal as partial without requiring Hermes metadata', () => {
  expect(resolveCostPresentation(null, summary(0.258672624, 19))).toEqual({ mode: 'mixed' });
});
it('does not present unpriced usage as free', () => {
  expect(resolveCostPresentation(null, summary(0, 19))).toEqual({ mode: 'unknown' });
});
it('retains missing-price evidence from either response', () => {
  expect(resolveCostPresentation(summary(0.25, 3), summary(0.25, 0))).toEqual({ mode: 'mixed' });
});
it.each(['included', 'estimated', 'actual', 'unknown', 'mixed'] as const)('preserves Hermes %s semantics', (mode) => {
  expect(resolveCostPresentation(null, { ...summary(0, 0), costPresentation: { mode } })).toEqual({ mode });
});
it('keeps a genuine zero and legacy complete prices valid', () => {
  expect(resolveCostPresentation(null, summary(0, 0))).toBeNull();
  expect(resolveCostPresentation(null, summary(1, 0))).toBeNull();
});

it('honors an explicit unavailable-price status even if a stale amount is present', () => {
  expect(resolveCostPresentation(null, { ...summary(1, 2), costPresentation: { mode: 'unknown' } })).toEqual({ mode: 'unknown' });
});
