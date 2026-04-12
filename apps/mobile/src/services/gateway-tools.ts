import type { ToolsCatalogResult } from '../types';

type GatewayToolsGateway = {
  fetchToolsCatalog(agentId?: string): Promise<ToolsCatalogResult>;
  getConfig(): Promise<{ config: Record<string, unknown> | null; hash: string | null }>;
};

export type GatewayToolsConfigBundle = {
  catalog: ToolsCatalogResult;
  config: Record<string, unknown> | null;
  configHash: string | null;
};

export async function loadGatewayToolsConfigBundle(
  gateway: GatewayToolsGateway,
  agentId: string,
): Promise<GatewayToolsConfigBundle> {
  const [catalog, configResult] = await Promise.all([
    gateway.fetchToolsCatalog(agentId),
    gateway.getConfig(),
  ]);
  return {
    catalog,
    config: configResult.config,
    configHash: configResult.hash,
  };
}
