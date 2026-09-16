import type { AgentDescriptor, ConnectionDescriptor } from '@clawket/agent-protocol';

import { publicRevenueCatConfig, resolvePublicRevenueCatConfig } from '../config/public';

export type ProFeature =
  | 'gatewayConnections'
  | 'appIcons'
  | 'configBackups'
  | 'configManage'
  /** @deprecated Use configBackups. Kept for one release while callers migrate. */
  | 'configBackupCreate'
  /** @deprecated Use configBackups. Kept for one release while callers migrate. */
  | 'configBackupRestore'
  | 'openclawDiagnostics'
  | 'openclawPermissions'
  | 'agents'
  | 'coreFileEditing'
  | 'logs'
  | 'modelManage'
  | 'usage'
  | 'messageHistory'
  | 'sessionHistory'
  | 'launch'
  | 'settingsMembershipPreview';

export type CanonicalProFeature = Exclude<
  ProFeature,
  'configBackupCreate' | 'configBackupRestore'
>;

export type Entitlement = Readonly<{
  isPro: boolean;
  graceUntil: number | null;
  now: number;
  freeConnectionId: string | null;
}>;

export const FREE_CONNECTION_LIMIT = 1;
export const FREE_CONNECTION_SWITCH_INTERVAL_MS = 24 * 60 * 60 * 1_000;
export const FIRST_3_0_GRACE_PERIOD_MS = 14 * 24 * 60 * 60 * 1_000;
export const DEFAULT_FREE_AGENT_ID = 'main';
export const SETTINGS_MEMBERSHIP_PREVIEW_FEATURE: ProFeature = 'settingsMembershipPreview';

const STATIC_UNLOCK_PRO = process.env.EXPO_PUBLIC_UNLOCK_PRO;

export function resolveProAccessEnabled(
  envValue: string | undefined | null = STATIC_UNLOCK_PRO,
  env?: NodeJS.ProcessEnv,
): boolean {
  const revenueCatEnabled = env ? resolvePublicRevenueCatConfig(env).enabled : publicRevenueCatConfig.enabled;
  if (!revenueCatEnabled) return true;
  if (!envValue) return false;
  const normalized = envValue.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export function normalizeProFeature(feature: ProFeature): CanonicalProFeature {
  if (feature === 'configBackupCreate' || feature === 'configBackupRestore') {
    return 'configBackups';
  }
  return feature;
}

export function isGraceActive(entitlement: Entitlement): boolean {
  return entitlement.graceUntil !== null && entitlement.now < entitlement.graceUntil;
}

function legacyEntitlement(isPro: boolean): Entitlement {
  return {
    isPro,
    graceUntil: null,
    now: 0,
    freeConnectionId: null,
  };
}

export function canAddGatewayConnection(
  connectionCount: number,
  entitlement: Entitlement | boolean,
): boolean {
  const resolved = typeof entitlement === 'boolean' ? legacyEntitlement(entitlement) : entitlement;
  return resolved.isPro || connectionCount < FREE_CONNECTION_LIMIT;
}

export function canUseConnection(
  connection: Pick<ConnectionDescriptor, 'id'>,
  entitlement: Entitlement,
): boolean {
  if (entitlement.isPro) return true;
  if (connection.id === entitlement.freeConnectionId) return true;
  return isGraceActive(entitlement);
}

export function canUseAgent(
  agent: Pick<AgentDescriptor, 'agentId' | 'isMain'>,
  connection: Pick<ConnectionDescriptor, 'id'>,
  entitlement: Entitlement,
): boolean;
/** @deprecated Pass AgentDescriptor, ConnectionDescriptor, and Entitlement. */
export function canUseAgent(agentId: string, isPro: boolean): boolean;
export function canUseAgent(
  agentOrId: Pick<AgentDescriptor, 'agentId' | 'isMain'> | string,
  connectionOrIsPro: Pick<ConnectionDescriptor, 'id'> | boolean,
  entitlement?: Entitlement,
): boolean {
  if (typeof agentOrId === 'string') {
    return connectionOrIsPro === true || agentOrId.trim() === DEFAULT_FREE_AGENT_ID;
  }
  if (typeof connectionOrIsPro === 'boolean' || !entitlement) return false;
  if (!canUseConnection(connectionOrIsPro, entitlement)) return false;
  if (entitlement.isPro || agentOrId.isMain) return true;
  return isGraceActive(entitlement);
}

export function canCreateAgent(entitlement: Pick<Entitlement, 'isPro'>): boolean {
  return entitlement.isPro;
}

/** @deprecated Agent creation is Pro-only; use canCreateAgent. */
export function canAddAgent(
  _agentCount: number,
  entitlement: Pick<Entitlement, 'isPro'> | boolean,
): boolean {
  return canCreateAgent(
    typeof entitlement === 'boolean' ? legacyEntitlement(entitlement) : entitlement,
  );
}

export function resolvePreviewPaywallFeature(): ProFeature {
  return SETTINGS_MEMBERSHIP_PREVIEW_FEATURE;
}

/**
 * Transitional navigation normalization. Access decisions must use the
 * descriptor-aware canUseAgent helper so grace and backend main identities are
 * preserved.
 */
export function normalizeAccessibleAgentId(agentId: string | null | undefined, isPro: boolean): string {
  void isPro;
  const trimmed = agentId?.trim();
  if (!trimmed) return DEFAULT_FREE_AGENT_ID;
  return trimmed;
}
