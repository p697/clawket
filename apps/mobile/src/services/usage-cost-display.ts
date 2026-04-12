import type { TFunction } from 'i18next';
import type { CostPresentation, CostSummary, UsageResult, UsageSessionEntry } from '../types/usage';
import { formatCost } from '../utils/usage-format';

function resolvePresentation(
  usageResult: UsageResult | null,
  costSummary: CostSummary | null,
): CostPresentation | null {
  return costSummary?.costPresentation ?? usageResult?.costPresentation ?? null;
}

export function resolveUsageCostSummaryDisplay(params: {
  usageResult: UsageResult | null;
  costSummary: CostSummary | null;
  t: TFunction<'console'>;
}): {
  valueLabel: string;
  subtitle: string | null;
  bannerTitle: string | null;
  bannerBody: string | null;
} {
  const { usageResult, costSummary, t } = params;
  const presentation = resolvePresentation(usageResult, costSummary);
  const totalCost = costSummary?.totals?.totalCost ?? usageResult?.totals?.totalCost ?? 0;
  const subtitle = t('View usage details');

  switch (presentation?.mode) {
    case 'included':
      return {
        valueLabel: formatCost(totalCost),
        subtitle,
        bannerTitle: null,
        bannerBody: null,
      };
    case 'unknown':
      return {
        valueLabel: t('Unknown'),
        subtitle,
        bannerTitle: t('Cost unavailable'),
        bannerBody: t('Hermes tracked token usage, but it could not determine a reliable dollar cost for this route.'),
      };
    case 'mixed':
      return {
        valueLabel: totalCost > 0 ? formatCost(totalCost) : t('Mixed'),
        subtitle,
        bannerTitle: t('Mixed cost sources'),
        bannerBody: t('This range mixes priced usage with included or unpriced routes, so the dollar total is only a partial view.'),
      };
    case 'actual':
      return {
        valueLabel: formatCost(totalCost),
        subtitle,
        bannerTitle: null,
        bannerBody: null,
      };
    case 'estimated':
      return {
        valueLabel: formatCost(totalCost),
        subtitle,
        bannerTitle: t('Estimated cost'),
        bannerBody: t('Hermes is showing an estimate for this route rather than a reconciled bill.'),
      };
    case 'currency':
    default:
      return {
        valueLabel: formatCost(totalCost),
        subtitle,
        bannerTitle: null,
        bannerBody: null,
      };
  }
}

export function resolveUsageSessionCostLabel(params: {
  session: UsageSessionEntry;
  t: TFunction<'console'>;
}): string {
  const { session, t } = params;
  const totalCost = session.usage?.totalCost ?? 0;
  const costStatus = (session.usage?.costStatus ?? '').trim().toLowerCase();

  if (costStatus === 'included') return t('Included');
  if (costStatus === 'unknown') return t('Unknown');
  if (costStatus === 'estimated' && totalCost <= 0) return t('Estimated');
  return formatCost(totalCost);
}

export function resolveDashboardCostDisplay(params: {
  usageResult: UsageResult | null;
  costSummary: CostSummary | null;
  fallbackCostLabel: string | null;
  t: TFunction<'console'>;
}): {
  valueLabel: string | null;
  badge: string | null;
} {
  const { usageResult, costSummary, fallbackCostLabel, t } = params;
  const presentation = resolvePresentation(usageResult, costSummary);

  switch (presentation?.mode) {
    case 'included':
      return { valueLabel: fallbackCostLabel, badge: null };
    case 'unknown':
      return { valueLabel: t('Unknown'), badge: t('Unpriced') };
    case 'estimated':
      return { valueLabel: fallbackCostLabel, badge: t('Estimated') };
    case 'mixed':
      return { valueLabel: fallbackCostLabel ?? t('Mixed'), badge: t('Partial') };
    default:
      return { valueLabel: fallbackCostLabel, badge: null };
  }
}
