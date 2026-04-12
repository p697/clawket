import type { ChannelsStatusResult } from '../types';
import { parseDmScope, type DmScope } from '../utils/gateway-settings';

type GatewayChannelsGateway = {
  getChannelsStatus(params?: { probe?: boolean; timeoutMs?: number }): Promise<ChannelsStatusResult>;
  getConfig(): Promise<{ config: Record<string, unknown> | null; hash: string | null }>;
};

export type GatewayChannelsBundleConfig = {
  dmScope: DmScope;
  configHash: string | null;
};

export type GatewayChannelsBundle = {
  channelsStatus: ChannelsStatusResult;
  // `config` is null when `getConfig()` itself rejected. Channels status still
  // loaded successfully, so callers that can tolerate a missing config (e.g.
  // the initial list load) should keep their previous dm-scope / config-hash
  // state. Callers that require a fresh config (e.g. after patching it)
  // should treat `null` as a hard error.
  config: GatewayChannelsBundleConfig | null;
};

export async function loadGatewayChannelsBundle(
  gateway: GatewayChannelsGateway,
): Promise<GatewayChannelsBundle> {
  const [channelsResult, configResult] = await Promise.allSettled([
    gateway.getChannelsStatus({ probe: false }),
    gateway.getConfig(),
  ]);

  if (channelsResult.status !== 'fulfilled') {
    throw channelsResult.reason;
  }

  return {
    channelsStatus: channelsResult.value,
    config: configResult.status === 'fulfilled'
      ? {
          dmScope: parseDmScope(configResult.value.config),
          configHash: configResult.value.hash,
        }
      : null,
  };
}
