import { publicRevenueCatConfig, resolvePublicRevenueCatConfig } from '../config/public';

export type ProFeature =
  | 'gatewayConnections'
  | 'configBackups'
  | 'agents'
  | 'coreFileEditing'
  | 'logs'
  | 'usage'
  | 'messageHistory'
  | 'settingsMembershipPreview';

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

export function canAddGatewayConnection(configCount: number, isPro: boolean): boolean {
  return isPro || configCount < 1;
}

export function canAddAgent(agentCount: number, isPro: boolean): boolean {
  return isPro || agentCount < 2;
}

export function canUseAgent(agentId: string, isPro: boolean): boolean {
  void agentId;
  void isPro;
  return true;
}

export function resolvePreviewPaywallFeature(): ProFeature {
  return SETTINGS_MEMBERSHIP_PREVIEW_FEATURE;
}

export function normalizeAccessibleAgentId(agentId: string | null | undefined, isPro: boolean): string {
  void isPro;
  const trimmed = agentId?.trim();
  if (!trimmed) return DEFAULT_FREE_AGENT_ID;
  return trimmed;
}
