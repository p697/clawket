import { CAPABILITY_MATRIX, type BackendKind, type Capabilities } from '@clawket/agent-protocol';
import type { ProPaywallPackage, ProPurchaseFailureReason } from '../../services/pro-subscription';
import type { ProFeature } from '../../utils/pro';

export type PaywallTrigger = ProFeature | 'launch';
export type PaywallMode = 'purchase';
export type PaywallHero = 'connections' | 'agents' | 'manage' | 'logsFiles' | 'search' | 'generic';
export type PaywallBenefitKind = 'connections' | 'agents' | 'manage' | 'logsFiles' | 'search' | 'combined' | 'memory' | 'sessions' | 'usage';
export type PaywallTitleKey =
  | 'Search and bulk export'
  | 'Skill and memory versions'
  | 'Edit your Agent’s memory and files'
  | 'More possibilities with your Agents'
  | 'Explore your Agent conversations'
  | 'Every Agent in your pocket'
  | 'Bring every Agent into the roster'
  | 'Fix your OpenClaw from your phone'
  | 'Read logs and edit files without going back to your computer'
  | 'Choose which models your Agent uses'
  | 'Find any message again'
  | 'Every conversation, in full'
  | 'See where every token goes';
export type PaywallSubtitleKey =
  | 'Use the Agents on all your computers from one app.'
  | 'Agents beyond main are a Pro feature.'
  | '{{feature}} is a Pro feature.'
  | 'Message details across sessions are a Pro feature.'
  | 'Read complete channel, task and subagent conversations, and reply where supported.'
  | '7-day and 30-day usage, cost and trends are a Pro feature.';
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
  | 'managing models'
  | 'opening this message'
  | 'viewing usage trends';
export type PaywallBenefitKey =
  | 'Search and bulk export'
  | 'Skill and memory versions'
  | 'Choose which models your Agent uses'
  | 'Conversations across channels and tasks'
  | 'Continue the conversations on your computer'
  | "Shape your Agent's personality and memory"
  | 'Configure, back up and diagnose your Agents'
  | 'More Agents, unlimited connections'
  | 'Fix OpenClaw from your phone'
  | 'Logs, files, and search'
  | 'Unlimited connections and Agents'
  | 'One-tap permission and diagnostic fixes'
  | 'Unlimited connections'
  | 'Unlimited Agents'
  | 'Logs and file editing'
  | 'Search across sessions and favorites'
  | '7- and 30-day usage and cost trends';
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

const REPAIR_BENEFIT = {
  kind: 'manage',
  labelKey: 'Configure, back up and diagnose your Agents',
} as const;

const SESSION_BENEFIT = { kind: 'sessions', labelKey: 'Conversations across channels and tasks' } as const;
const MEMORY_BENEFIT = { kind: 'memory', labelKey: 'Skill and memory versions' } as const;

const COMBINED_BENEFIT = {
  kind: 'combined',
  labelKey: 'More Agents, unlimited connections',
} as const;

const NATIVE_SESSION_BENEFIT = { kind: 'sessions', labelKey: 'Continue the conversations on your computer' } as const;
const CONNECTIONS_BENEFIT = { kind: 'connections', labelKey: 'Unlimited connections' } as const;

type PaywallBenefit = PaywallContent['benefits'][number];

/**
 * The backends of the user's saved connections. The supporting benefits name only what those
 * backends can do (product review 2026-11-11: a Codex-only user read "manage OpenClaw config,
 * backups and logs"). No saved connection, or an unknown one, keeps the full list.
 */
export type PaywallScope = Readonly<{ backends?: ReadonlyArray<BackendKind> }>;

function scopedCapabilities(scope: PaywallScope | undefined): ReadonlyArray<Capabilities> {
  const capabilities: Capabilities[] = [];
  for (const backend of new Set(scope?.backends ?? [])) {
    const row = CAPABILITY_MATRIX[backend];
    // An unrecognised backend proves nothing about what the user can use.
    if (!row) return [];
    capabilities.push(row);
  }
  return capabilities;
}

/** A supporting benefit as these backends offer it, or null when none of them does. */
function scopeSupportingBenefit(
  benefit: PaywallBenefit,
  capabilities: ReadonlyArray<Capabilities>,
): PaywallBenefit | null {
  if (capabilities.length === 0) return benefit;
  const any = (test: (row: Capabilities) => boolean): boolean => capabilities.some(test);
  if (benefit === REPAIR_BENEFIT) {
    return any((row) => row.configManage || row.diagnostics || row.backups) ? benefit : null;
  }
  if (benefit === MEMORY_BENEFIT) return any((row) => row.files) ? benefit : null;
  if (benefit === COMBINED_BENEFIT) return any((row) => row.agents) ? benefit : CONNECTIONS_BENEFIT;
  if (benefit === SESSION_BENEFIT) {
    if (!any((row) => row.sessions)) return null;
    // Channel and scheduled-task conversations exist only where the backend has them; the coding
    // Agents keep their conversations on the computer.
    return any((row) => row.channels || row.cron) ? benefit : NATIVE_SESSION_BENEFIT;
  }
  return benefit;
}

function contextualBenefits(
  first: PaywallBenefit,
  scope?: PaywallScope,
  options: Readonly<{ scopeFirst?: boolean }> = {},
): PaywallContent['benefits'] {
  const capabilities = scopedCapabilities(scope);
  // The first line is what the user just reached for; only the generic wall leads with a supporting one.
  const lead = options.scopeFirst ? scopeSupportingBenefit(first, capabilities) : first;
  const candidates = [lead, COMBINED_BENEFIT, SESSION_BENEFIT, MEMORY_BENEFIT, REPAIR_BENEFIT]
    .flatMap((benefit, index): PaywallBenefit[] => {
      if (!benefit) return [];
      const scoped = index === 0 ? benefit : scopeSupportingBenefit(benefit, capabilities);
      return scoped ? [scoped] : [];
    });
  const seen = new Set<PaywallBenefitKind>();
  return candidates.filter((benefit) => {
    const duplicateCategory = benefit.kind === 'combined'
      ? seen.has('combined') || seen.has('connections') || seen.has('agents')
      : seen.has(benefit.kind)
        || (benefit.kind === 'logsFiles' && seen.has('search'))
        || (benefit.kind === 'search' && seen.has('logsFiles'));
    if (duplicateCategory) return false;
    seen.add(benefit.kind);
    return true;
  }).slice(0, 4);
}

function manageContent(featureKey: PaywallSubtitleFeatureKey, scope?: PaywallScope): PaywallContent {
  return {
    hero: 'manage',
    titleKey: 'Fix your OpenClaw from your phone',
    subtitleKey: '{{feature}} is a Pro feature.',
    subtitleFeatureKey: featureKey,
    actionKey: 'managing OpenClaw',
    benefits: contextualBenefits({
      kind: 'manage',
      labelKey: 'One-tap permission and diagnostic fixes',
    }, scope),
  };
}

export function resolvePaywallContent(trigger: PaywallTrigger | null, scope?: PaywallScope): PaywallContent {
  switch (trigger) {
    case 'gatewayConnections':
      return {
        hero: 'connections',
        titleKey: 'Every Agent in your pocket',
        subtitleKey: 'Use the Agents on all your computers from one app.',
        subtitleFeatureKey: null,
        actionKey: 'adding another connection',
        benefits: contextualBenefits({ kind: 'connections', labelKey: 'Unlimited connections' }, scope),
      };
    case 'agents':
      return {
        hero: 'agents',
        titleKey: 'Bring every Agent into the roster',
        subtitleKey: 'Agents beyond main are a Pro feature.',
        subtitleFeatureKey: null,
        actionKey: 'with this Agent',
        benefits: [
          { kind: 'agents', labelKey: 'Unlimited Agents' },
          { kind: 'connections', labelKey: 'Unlimited connections' },
          SESSION_BENEFIT,
          MEMORY_BENEFIT,
        ],
      };
    case 'openclawPermissions':
      return manageContent('Permissions', scope);
    case 'configBackups':
    case 'configBackupCreate':
    case 'configBackupRestore':
      return manageContent('Config backups', scope);
    case 'configManage':
      return manageContent('Configuration', scope);
    case 'openclawDiagnostics':
      return manageContent('Diagnostics', scope);
    case 'coreFileEditing':
      return {
        hero: 'logsFiles',
        titleKey: 'Edit your Agent’s memory and files',
        subtitleKey: null,
        subtitleFeatureKey: null,
        actionKey: 'editing this file',
        benefits: contextualBenefits(MEMORY_BENEFIT, scope),
      };
    case 'logs':
      return {
        hero: 'logsFiles',
        titleKey: 'Read logs and edit files without going back to your computer',
        subtitleKey: null,
        subtitleFeatureKey: null,
        actionKey: 'viewing logs',
        benefits: contextualBenefits({ kind: 'logsFiles', labelKey: 'Logs and file editing' }, scope),
      };
    case 'modelManage':
      return {
        hero: 'manage',
        titleKey: 'Choose which models your Agent uses',
        subtitleKey: null,
        subtitleFeatureKey: null,
        actionKey: 'managing models',
        benefits: contextualBenefits({
          kind: 'manage',
          labelKey: 'Choose which models your Agent uses',
        }, scope),
      };
    case 'sessionHistory':
      return {
        hero: 'agents',
        titleKey: 'Explore your Agent conversations',
        subtitleKey: 'Read complete channel, task and subagent conversations, and reply where supported.',
        subtitleFeatureKey: null,
        actionKey: null,
        benefits: contextualBenefits(SESSION_BENEFIT, scope, { scopeFirst: true }),
      };
    case 'archiveTools':
      return { hero: 'search', titleKey: 'Search and bulk export', subtitleKey: null, subtitleFeatureKey: null, actionKey: null,
        benefits: contextualBenefits({ kind: 'search', labelKey: 'Search and bulk export' }, scope) };
    case 'documentVersions':
      return { hero: 'logsFiles', titleKey: 'Skill and memory versions', subtitleKey: null, subtitleFeatureKey: null, actionKey: null,
        benefits: contextualBenefits(MEMORY_BENEFIT, scope) };
    case 'messageHistory':
      return {
        hero: 'search',
        titleKey: 'Find any message again',
        subtitleKey: 'Message details across sessions are a Pro feature.',
        subtitleFeatureKey: null,
        actionKey: 'opening this message',
        benefits: contextualBenefits({ kind: 'search', labelKey: 'Search across sessions and favorites' }, scope),
      };
    case 'usage':
      return {
        hero: 'generic',
        titleKey: 'See where every token goes',
        subtitleKey: '7-day and 30-day usage, cost and trends are a Pro feature.',
        subtitleFeatureKey: null,
        actionKey: 'viewing usage trends',
        benefits: contextualBenefits({ kind: 'usage', labelKey: '7- and 30-day usage and cost trends' }, scope),
      };
    case 'appIcons':
    case 'settingsMembershipPreview':
    case 'launch':
    case null:
    default:
      return {
        hero: 'generic',
        titleKey: 'More possibilities with your Agents',
        subtitleKey: null,
        subtitleFeatureKey: null,
        actionKey: null,
        benefits: contextualBenefits(SESSION_BENEFIT, scope, { scopeFirst: true }),
      };
  }
}

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
