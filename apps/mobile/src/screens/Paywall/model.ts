import type { ProPaywallPackage, ProPurchaseFailureReason } from '../../services/pro-subscription';
import type { ProFeature } from '../../utils/pro';

export type PaywallTrigger = ProFeature | 'launch';
export type PaywallMode = 'purchase' | 'threePointZeroIntro';
export type PaywallHero = 'connections' | 'agents' | 'manage' | 'logsFiles' | 'search' | 'generic';
export type PaywallBenefitKind = 'connections' | 'agents' | 'manage' | 'logsFiles' | 'search' | 'combined';
export type PaywallTitleKey =
  | 'Clawket 3.0'
  | 'Every Agent in your pocket'
  | 'Bring every Agent into the roster'
  | 'Fix your OpenClaw from your phone'
  | 'Read logs and edit files without going back to your computer'
  | 'Find any message again';
export type PaywallSubtitleKey =
  | 'Your agent control tower, rebuilt.'
  | 'OpenClaw and Hermes together, ready whenever you are.'
  | 'Agents beyond main are a Pro feature.'
  | '{{feature}} is a Pro feature.'
  | 'Message details across sessions are a Pro feature.';
export type PaywallSubtitleFeatureKey =
  | 'Permissions'
  | 'Config backups'
  | 'Configuration'
  | 'Diagnostics';
export type PaywallActionKey =
  | 'adding another connection'
  | 'with this Agent'
  | 'managing OpenClaw'
  | 'viewing logs'
  | 'editing this file'
  | 'opening this message';
export type PaywallBenefitKey =
  | 'Fix OpenClaw from your phone'
  | 'Logs, files, and search'
  | 'Unlimited connections and Agents'
  | 'One-tap permission and diagnostic fixes'
  | 'Unlimited connections'
  | 'Unlimited Agents'
  | 'Logs and file editing'
  | 'Search across sessions and favorites'
  | 'Every Agent and session in one roster'
  | 'OpenClaw and Hermes side by side'
  | 'Search across every conversation'
  | 'Manage, diagnose, and repair from your phone';
export type PaywallFailureMessageKey =
  | 'Your purchase is pending approval.'
  | 'Unable to load subscription options right now.'
  | 'Unable to restore your purchases right now.'
  | 'Unable to complete your purchase right now.';

export type PaywallContent = Readonly<{
  hero: PaywallHero;
  titleKey: PaywallTitleKey;
  subtitleKey: PaywallSubtitleKey | null;
  subtitleFeatureKey: PaywallSubtitleFeatureKey | null;
  actionKey: PaywallActionKey | null;
  benefits: readonly Readonly<{ kind: PaywallBenefitKind; labelKey: PaywallBenefitKey }>[];
}>;

export type ThreePointZeroIntroContent = Readonly<{
  hero: 'generic';
  titleKey: 'Clawket 3.0';
  subtitleKey: 'Your agent control tower, rebuilt.';
  benefits: readonly Readonly<{ kind: PaywallBenefitKind; labelKey: PaywallBenefitKey }>[];
}>;

const REPAIR_BENEFIT = {
  kind: 'manage',
  labelKey: 'Fix OpenClaw from your phone',
} as const;

const LOGS_BENEFIT = {
  kind: 'logsFiles',
  labelKey: 'Logs, files, and search',
} as const;

const COMBINED_BENEFIT = {
  kind: 'combined',
  labelKey: 'Unlimited connections and Agents',
} as const;

function contextualBenefits(
  first: Readonly<{ kind: PaywallBenefitKind; labelKey: PaywallBenefitKey }>,
): PaywallContent['benefits'] {
  const candidates = [first, REPAIR_BENEFIT, LOGS_BENEFIT, COMBINED_BENEFIT];
  const seen = new Set<PaywallBenefitKind>();
  return candidates.filter((benefit) => {
    const duplicateCategory = benefit.kind === 'combined'
      ? seen.has('combined') || (seen.has('connections') && seen.has('agents'))
      : seen.has(benefit.kind)
        || (benefit.kind === 'logsFiles' && seen.has('search'))
        || (benefit.kind === 'search' && seen.has('logsFiles'));
    if (duplicateCategory) return false;
    seen.add(benefit.kind);
    return true;
  }).slice(0, 3);
}

function manageContent(featureKey: PaywallSubtitleFeatureKey): PaywallContent {
  return {
    hero: 'manage',
    titleKey: 'Fix your OpenClaw from your phone',
    subtitleKey: '{{feature}} is a Pro feature.',
    subtitleFeatureKey: featureKey,
    actionKey: 'managing OpenClaw',
    benefits: contextualBenefits({
      kind: 'manage',
      labelKey: 'One-tap permission and diagnostic fixes',
    }),
  };
}

export function resolvePaywallContent(trigger: PaywallTrigger | null): PaywallContent {
  switch (trigger) {
    case 'gatewayConnections':
      return {
        hero: 'connections',
        titleKey: 'Every Agent in your pocket',
        subtitleKey: 'OpenClaw and Hermes together, ready whenever you are.',
        subtitleFeatureKey: null,
        actionKey: 'adding another connection',
        benefits: contextualBenefits({ kind: 'connections', labelKey: 'Unlimited connections' }),
      };
    case 'agents':
      return {
        hero: 'agents',
        titleKey: 'Bring every Agent into the roster',
        subtitleKey: 'Agents beyond main are a Pro feature.',
        subtitleFeatureKey: null,
        actionKey: 'with this Agent',
        benefits: contextualBenefits({ kind: 'agents', labelKey: 'Unlimited Agents' }),
      };
    case 'openclawPermissions':
      return manageContent('Permissions');
    case 'configBackups':
    case 'configBackupCreate':
    case 'configBackupRestore':
      return manageContent('Config backups');
    case 'configManage':
      return manageContent('Configuration');
    case 'openclawDiagnostics':
      return manageContent('Diagnostics');
    case 'coreFileEditing':
    case 'logs':
      return {
        hero: 'logsFiles',
        titleKey: 'Read logs and edit files without going back to your computer',
        subtitleKey: null,
        subtitleFeatureKey: null,
        actionKey: trigger === 'logs' ? 'viewing logs' : 'editing this file',
        benefits: contextualBenefits({ kind: 'logsFiles', labelKey: 'Logs and file editing' }),
      };
    case 'messageHistory':
      return {
        hero: 'search',
        titleKey: 'Find any message again',
        subtitleKey: 'Message details across sessions are a Pro feature.',
        subtitleFeatureKey: null,
        actionKey: 'opening this message',
        benefits: contextualBenefits({ kind: 'search', labelKey: 'Search across sessions and favorites' }),
      };
    case 'appIcons':
    case 'settingsMembershipPreview':
    case 'usage':
    case 'launch':
    case null:
    default:
      return {
        hero: 'generic',
        titleKey: 'Every Agent in your pocket',
        subtitleKey: null,
        subtitleFeatureKey: null,
        actionKey: null,
        benefits: contextualBenefits({ kind: 'combined', labelKey: 'Unlimited connections and Agents' }),
      };
  }
}

export const THREE_POINT_ZERO_INTRO_CONTENT: ThreePointZeroIntroContent = {
  hero: 'generic',
  titleKey: 'Clawket 3.0',
  subtitleKey: 'Your agent control tower, rebuilt.',
  benefits: [
    { kind: 'agents', labelKey: 'Every Agent and session in one roster' },
    { kind: 'connections', labelKey: 'OpenClaw and Hermes side by side' },
    { kind: 'search', labelKey: 'Search across every conversation' },
    { kind: 'manage', labelKey: 'Manage, diagnose, and repair from your phone' },
  ],
};

const PACKAGE_ORDER: Readonly<Record<string, number>> = {
  ANNUAL: 0,
  LIFETIME: 1,
  MONTHLY: 2,
};

export function orderPaywallPackages(packages: readonly ProPaywallPackage[]): ProPaywallPackage[] {
  return [...packages].sort((left, right) => (
    (PACKAGE_ORDER[left.packageType] ?? 99) - (PACKAGE_ORDER[right.packageType] ?? 99)
  ));
}

export function calculateAnnualSavings(packages: readonly ProPaywallPackage[]): number | null {
  const annualPrice = packages.find((item) => item.packageType === 'ANNUAL')?.price;
  const monthlyPrice = packages.find((item) => item.packageType === 'MONTHLY')?.price;
  if (annualPrice == null || monthlyPrice == null || monthlyPrice <= 0) return null;
  const savings = ((monthlyPrice * 12) - annualPrice) / (monthlyPrice * 12);
  if (!Number.isFinite(savings) || savings <= 0) return null;
  return Math.min(99, Math.round(savings * 100));
}

export function shouldShowPaywallSocialProof(packages: readonly ProPaywallPackage[]): boolean {
  return packages[0]?.offeringMetadata?.socialProof ?? true;
}

export function paywallFailureMessageKey(
  reason: ProPurchaseFailureReason | null,
  operation: 'purchase' | 'restore' | null,
): PaywallFailureMessageKey | null {
  if (!reason || reason === 'cancelled') return null;
  if (reason === 'pending') return 'Your purchase is pending approval.';
  if (reason === 'offerings_unavailable') return 'Unable to load subscription options right now.';
  return operation === 'restore'
    ? 'Unable to restore your purchases right now.'
    : 'Unable to complete your purchase right now.';
}
