import { useEffect } from 'react';
import { Platform } from 'react-native';
import type { ConnectionDescriptor } from '@clawket/agent-protocol';
import { useAppTheme } from '../theme';
import { posthogClient } from '../services/analytics/posthog';
import {
  buildAnalyticsSuperProperties,
  REMOVED_ANALYTICS_PERSON_PROPERTIES,
  REMOVED_ANALYTICS_SUPER_PROPERTIES,
} from '../services/analytics/super-properties';
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
  const { accentId, mode } = useAppTheme();

  useEffect(() => {
    const client = posthogClient;
    if (!client || typeof client.unregister !== 'function') return;
    void Promise.all(
      REMOVED_ANALYTICS_SUPER_PROPERTIES.map((property) => client.unregister(property)),
    ).catch(() => {});
  }, []);

  useEffect(() => {
    const client = posthogClient;
    if (!client) return;
    let cancelled = false;

    StorageService.getIdentity()
      .then((identity) => {
        if (cancelled || !identity?.deviceId) return;
        client.identify(identity.deviceId);
        if (typeof client.unsetPersonProperties === 'function') {
          client.unsetPersonProperties([...REMOVED_ANALYTICS_PERSON_PROPERTIES], false);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const client = posthogClient;
    if (!client) return;
    void client.register(buildAnalyticsSuperProperties({
      platform: Platform.OS === 'android' ? 'android' : 'ios',
      connections,
      activeConnectionId,
      isPro,
      graceActive,
      themeMode: mode,
      themeAccentId: accentId,
    })).catch(() => {});
  }, [
    accentId,
    activeConnectionId,
    connections,
    graceActive,
    isPro,
    mode,
  ]);
}
