import {
  parseGatewayToolSettings,
  type GatewayToolSettings,
} from '../utils/gateway-tool-settings';

type GatewayToolSettingsGateway = {
  getConfig(): Promise<{ config: Record<string, unknown> | null; hash: string | null }>;
};

export const DEFAULT_GATEWAY_TOOL_SETTINGS: GatewayToolSettings = {
  webSearchEnabled: true,
  webFetchEnabled: true,
  execSecurity: 'deny',
  execAsk: 'on-miss',
  mediaImageEnabled: true,
  mediaAudioEnabled: true,
  mediaVideoEnabled: true,
  linksEnabled: true,
};

export type GatewayToolSettingsBundle = {
  settings: GatewayToolSettings;
  configHash: string | null;
};

export async function loadGatewayToolSettingsBundle(
  gateway: GatewayToolSettingsGateway,
): Promise<GatewayToolSettingsBundle> {
  const configPayload = await gateway.getConfig();
  return {
    settings: parseGatewayToolSettings(configPayload.config),
    configHash: configPayload.hash,
  };
}
