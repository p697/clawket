import type { GatewayBackendCapabilities } from './gateway-backends';
import type { AgentsListResult } from '../types/agent';
import type { CronListResult } from '../types/cron';
import type { SkillStatusReport } from '../types/skills';
import type { CostSummary, UsageResult } from '../types/usage';
import type {
  ChannelsStatusResult,
  DevicePairListResult,
  NodeListResult,
  NodePairListResult,
  SessionInfo,
  ToolsCatalogResult,
} from '../types';

type GatewayIdentity = {
  name?: string;
  emoji?: string;
};

type GatewayConsoleDashboardGateway = {
  getBackendCapabilities(): GatewayBackendCapabilities;
  fetchIdentity(agentId?: string): Promise<GatewayIdentity>;
  listAgentFiles(agentId?: string): Promise<unknown[]>;
  getChannelsStatus(): Promise<ChannelsStatusResult>;
  listCronJobs(): Promise<CronListResult>;
  getSkillsStatus(agentId?: string): Promise<SkillStatusReport>;
  listModels(): Promise<unknown[]>;
  listSessions(): Promise<SessionInfo[]>;
  fetchUsage(range: { startDate: string; endDate: string }): Promise<UsageResult>;
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  fetchCostSummary(range: { startDate: string; endDate: string }): Promise<CostSummary>;
  listAgents(): Promise<AgentsListResult>;
  listNodes(): Promise<NodeListResult>;
  listNodePairRequests(): Promise<NodePairListResult>;
  listDevices(): Promise<DevicePairListResult>;
  getConfig(): Promise<{ config: Record<string, unknown> | null; hash: string | null }>;
  fetchToolsCatalog(agentId?: string): Promise<ToolsCatalogResult>;
};

export type GatewayConsoleDashboardBundle = {
  capabilities: GatewayBackendCapabilities;
  identity: GatewayIdentity | null;
  files: unknown[] | null;
  channels: ChannelsStatusResult | null;
  cron: CronListResult | null;
  skills: SkillStatusReport | null;
  modelCount: number | null;
  sessions: SessionInfo[] | null;
  usage: UsageResult | null;
  lastHeartbeat: unknown;
  cost: CostSummary | null;
  agents: AgentsListResult | null;
  nodes: NodeListResult | null;
  nodePairs: NodePairListResult | null;
  devices: DevicePairListResult | null;
  config: { config: Record<string, unknown> | null; hash: string | null } | null;
  tools: ToolsCatalogResult | null;
};

function settledValue<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === 'fulfilled' ? result.value : null;
}

export async function loadGatewayConsoleDashboardBundle(
  gateway: GatewayConsoleDashboardGateway,
  agentId: string,
  today: string,
): Promise<GatewayConsoleDashboardBundle> {
  const capabilities = gateway.getBackendCapabilities();
  const settledResults = await Promise.allSettled([
    gateway.fetchIdentity(agentId),
    capabilities.consoleFiles ? gateway.listAgentFiles(agentId) : Promise.resolve(null),
    capabilities.consoleChannels ? gateway.getChannelsStatus() : Promise.resolve(null),
    capabilities.consoleCron ? gateway.listCronJobs() : Promise.resolve(null),
    capabilities.consoleSkills ? gateway.getSkillsStatus(agentId) : Promise.resolve(null),
    capabilities.modelCatalog ? gateway.listModels() : Promise.resolve(null),
    gateway.listSessions(),
    capabilities.consoleUsage ? gateway.fetchUsage({ startDate: today, endDate: today }) : Promise.resolve(null),
    gateway.request('last-heartbeat', {}),
    capabilities.consoleCost ? gateway.fetchCostSummary({ startDate: today, endDate: today }) : Promise.resolve(null),
    gateway.listAgents(),
    capabilities.consoleNodes ? gateway.listNodes() : Promise.resolve(null),
    capabilities.consoleNodes ? gateway.listNodePairRequests() : Promise.resolve(null),
    capabilities.consoleNodes ? gateway.listDevices() : Promise.resolve(null),
    capabilities.configRead ? gateway.getConfig() : Promise.resolve(null),
    capabilities.consoleTools ? gateway.fetchToolsCatalog(agentId) : Promise.resolve(null),
  ]);

  const [
    identityResult,
    fileResult,
    channelResult,
    cronResult,
    skillResult,
    modelResult,
    sessionResult,
    usageResult,
    heartbeatResult,
    costResult,
    agentsResult,
    nodesResult,
    nodePairResult,
    devicesResult,
    configResult,
    toolCatalogResult,
  ] = settledResults;

  const models = settledValue(modelResult);

  return {
    capabilities,
    identity: settledValue(identityResult),
    files: settledValue(fileResult),
    channels: settledValue(channelResult),
    cron: settledValue(cronResult),
    skills: settledValue(skillResult),
    modelCount: Array.isArray(models) ? models.length : null,
    sessions: settledValue(sessionResult),
    usage: settledValue(usageResult),
    lastHeartbeat: settledValue(heartbeatResult),
    cost: settledValue(costResult),
    agents: settledValue(agentsResult),
    nodes: settledValue(nodesResult),
    nodePairs: settledValue(nodePairResult),
    devices: settledValue(devicesResult),
    config: settledValue(configResult),
    tools: settledValue(toolCatalogResult),
  };
}
