import type { ProSubscriptionSnapshot } from '../pro-subscription';
import { posthogClient } from './posthog';

export type AnalyticsSubscriptionProperties = {
  subscription_status: 'free' | 'pro';
  subscription_type: 'none' | 'monthly' | 'yearly' | 'lifetime' | 'unknown';
  subscription_tenure_bucket: 'none' | 'unknown' | 'lt_7d' | '7_30d' | '31_90d' | '91_180d' | '181_365d' | 'gt_365d';
  is_pro: boolean;
  /** Kept for one 3.0 transition release. */
  is_premium: boolean;
};

let currentSubscriptionProperties: AnalyticsSubscriptionProperties = {
  subscription_status: 'free',
  subscription_type: 'none',
  subscription_tenure_bucket: 'none',
  is_pro: false,
  is_premium: false,
};

function resolveSubscriptionType(snapshot: ProSubscriptionSnapshot | null): AnalyticsSubscriptionProperties['subscription_type'] {
  if (!snapshot?.isActive) return 'none';

  const raw = [snapshot.productPlanIdentifier, snapshot.productIdentifier]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();

  if (!raw) return 'unknown';
  if (raw.includes('lifetime') || raw.includes('buyout') || raw.includes('forever') || raw.includes('permanent')) return 'lifetime';
  if (raw.includes('year') || raw.includes('annual')) return 'yearly';
  if (raw.includes('month')) return 'monthly';
  return 'unknown';
}

function resolveSubscriptionTenureBucket(
  snapshot: ProSubscriptionSnapshot | null,
  nowMs: number,
): AnalyticsSubscriptionProperties['subscription_tenure_bucket'] {
  if (!snapshot?.isActive) return 'none';

  const startedAt = Date.parse(snapshot.originalPurchaseDate ?? '');
  if (Number.isNaN(startedAt)) return 'unknown';

  const elapsedDays = Math.max(0, Math.floor((nowMs - startedAt) / 86_400_000));

  if (elapsedDays < 7) return 'lt_7d';
  if (elapsedDays < 31) return '7_30d';
  if (elapsedDays < 91) return '31_90d';
  if (elapsedDays < 181) return '91_180d';
  if (elapsedDays < 366) return '181_365d';
  return 'gt_365d';
}

export function buildAnalyticsSubscriptionProperties(
  snapshot: ProSubscriptionSnapshot | null,
  nowMs: number = Date.now(),
): AnalyticsSubscriptionProperties {
  if (!snapshot?.isActive) {
    return {
      subscription_status: 'free',
      subscription_type: 'none',
      subscription_tenure_bucket: 'none',
      is_pro: false,
      is_premium: false,
    };
  }

  return {
    subscription_status: 'pro',
    subscription_type: resolveSubscriptionType(snapshot),
    subscription_tenure_bucket: resolveSubscriptionTenureBucket(snapshot, nowMs),
    is_pro: true,
    is_premium: true,
  };
}

export function getAnalyticsSubscriptionProperties(): AnalyticsSubscriptionProperties {
  return currentSubscriptionProperties;
}

export function syncAnalyticsSubscriptionContext(snapshot: ProSubscriptionSnapshot | null): void {
  currentSubscriptionProperties = buildAnalyticsSubscriptionProperties(snapshot);
  posthogClient?.setPersonProperties(currentSubscriptionProperties, undefined, false);
  void posthogClient?.register(currentSubscriptionProperties).catch(() => {});
}
