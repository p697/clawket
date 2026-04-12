import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useAppTheme } from '../theme';
import { posthogClient } from '../services/analytics/posthog';
import { resolveGatewayBackendKind, resolveGatewayTransportKind } from '../services/gateway-backends';
import { StorageService } from '../services/storage';
import type { GatewayConfig } from '../types';

type Args = {
  config: GatewayConfig | null;
  currentAgentId: string;
};

function resolveGatewayMode(config: GatewayConfig | null): string {
  if (!config?.url) return 'unconfigured';
  return `${resolveGatewayBackendKind(config)}:${resolveGatewayTransportKind(config)}`;
}

export function usePostHogIdentity({ config, currentAgentId }: Args): void {
  const { accentId, mode, resolvedScheme } = useAppTheme();

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
      current_agent_id: currentAgentId,
      gateway_mode: resolveGatewayMode(config),
      has_gateway_config: Boolean(config?.url),
      theme_accent_id: accentId,
      theme_mode: mode,
      theme_scheme: resolvedScheme,
    }).catch(() => {});
  }, [accentId, config?.backendKind, config?.transportKind, config?.mode, config?.url, currentAgentId, mode, resolvedScheme]);
}
