import type { ConnectionDescriptor } from '@clawket/agent-protocol';
import type { AccentColorId, ThemeMode } from '../../types';

export type AnalyticsSuperProperties = {
  app_platform: 'ios' | 'android';
  connection_count: number;
  backend_kinds: string;
  active_backend: ConnectionDescriptor['backendKind'] | 'unconfigured';
  active_transport: ConnectionDescriptor['transportKind'] | 'unconfigured';
  is_pro: boolean;
  /** Kept for one 3.0 transition release. */
  is_premium: boolean;
  theme_mode: ThemeMode;
  theme_accent_id: AccentColorId;
  grace_active: boolean;
  /** Kept for one 3.0 transition release. */
  gateway_mode: string;
};

export const REMOVED_ANALYTICS_SUPER_PROPERTIES = Object.freeze([
  'current_agent_id',
  'has_gateway_config',
  'theme_scheme',
] as const);

export const REMOVED_ANALYTICS_PERSON_PROPERTIES = Object.freeze([
  'device_id',
  'device_identity_created_at',
] as const);

export function buildAnalyticsSuperProperties(input: {
  platform: 'ios' | 'android';
  connections: ReadonlyArray<ConnectionDescriptor>;
  activeConnectionId: string | null;
  isPro: boolean;
  graceActive: boolean;
  themeMode: ThemeMode;
  themeAccentId: AccentColorId;
}): AnalyticsSuperProperties {
  const activeConnection = input.connections.find(
    (connection) => connection.id === input.activeConnectionId,
  ) ?? null;
  const backendKindSet = new Set(input.connections.map((connection) => connection.backendKind));
  const backendKinds = (['openclaw', 'hermes', 'youmind', 'pi'] as const)
    .filter((backendKind) => backendKindSet.has(backendKind))
    .join(',');

  return {
    app_platform: input.platform,
    connection_count: input.connections.length,
    backend_kinds: backendKinds,
    active_backend: activeConnection?.backendKind ?? 'unconfigured',
    active_transport: activeConnection?.transportKind ?? 'unconfigured',
    is_pro: input.isPro,
    is_premium: input.isPro,
    theme_mode: input.themeMode,
    theme_accent_id: input.themeAccentId,
    grace_active: input.graceActive,
    gateway_mode: activeConnection
      ? `${activeConnection.backendKind}:${activeConnection.transportKind}`
      : 'unconfigured',
  };
}
