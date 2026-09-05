import { useEffect } from 'react';
import { Platform } from 'react-native';
import type { ConnectionDescriptor } from '@clawket/agent-protocol';
import { useAppTheme } from '../theme';
import { posthogClient } from '../services/analytics/posthog';
import { StorageService } from '../services/storage';

type Args = {
  connections: ReadonlyArray<ConnectionDescriptor>;
  activeConnectionId: string | null;
  isPro: boolean;
  graceActive?: boolean;
};

export function usePostHogIdentity({
  connections,
  activeConnectionId,
  isPro,
  graceActive = false,
}: Args): void {
  const { accentId, mode, resolvedScheme } = useAppTheme();
  const activeConnection = connections.find((connection) => connection.id === activeConnectionId) ?? null;
  const backendKinds = [...new Set(connections.map((connection) => connection.backendKind))]
    .sort()
    .join(',');

  useEffect(() => {
    const client = posthogClient;
    if (!client) return;
    let cancelled = false;

    StorageService.getIdentity()
      .then((identity) => {
        if (cancelled || !identity?.deviceId) return;
        return client.identify(identity.deviceId, {
          device_id: identity.deviceId,
          device_identity_created_at: identity.createdAt,
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const client = posthogClient;
    if (!client) return;
    void client.register({
      app_platform: Platform.OS,
      connection_count: connections.length,
      backend_kinds: backendKinds,
      active_backend: activeConnection?.backendKind ?? 'unconfigured',
      active_transport: activeConnection?.transportKind ?? 'unconfigured',
      is_pro: isPro,
      is_premium: isPro,
      grace_active: graceActive,
      // Kept for one transition release; active_backend/active_transport replace it.
      gateway_mode: activeConnection
        ? `${activeConnection.backendKind}:${activeConnection.transportKind}`
        : 'unconfigured',
      has_gateway_config: connections.length > 0,
      theme_accent_id: accentId,
      theme_mode: mode,
      theme_scheme: resolvedScheme,
    }).catch(() => {});
  }, [
    accentId,
    activeConnection?.backendKind,
    activeConnection?.transportKind,
    backendKinds,
    connections.length,
    graceActive,
    isPro,
    mode,
    resolvedScheme,
  ]);
}
