import type { GatewayCurrentModelState } from './gateway-backend-operations';
import type { CostSummary, UsageResult } from '../types';
import type { SkillStatusReport } from '../types';
import type { HermesCronJob, HermesCronOutputEntry } from '../types/hermes-cron';

type GatewayIdentity = {
  name?: string;
  emoji?: string;
};

type GatewaySessionSummary = {
  key: string;
  sessionId?: string;
  title?: string;
  label?: string;
  updatedAt?: number | null;
  lastMessagePreview?: string;
};

type GatewayAgentsListResult = {
  agents?: Array<{ id: string; name?: string }>;
  defaultId?: string;
  mainKey?: string;
};

type GatewayHeartbeatSnapshot = {
  status?: string;
  ts?: number;
  hermesApiReachable?: boolean;
};

type GatewayHermesConsoleDashboardGateway = {
  fetchIdentity(agentId?: string): Promise<GatewayIdentity>;
  getCurrentModelState(): Promise<GatewayCurrentModelState>;
  listSessions(opts?: { limit?: number }): Promise<GatewaySessionSummary[]>;
  listAgentFiles(agentId?: string): Promise<Array<{ name: string }>>;
  getSkillsStatus(agentId?: string): Promise<SkillStatusReport>;
  fetchUsage(range: { startDate: string; endDate: string }): Promise<UsageResult>;
  fetchCostSummary(range: { startDate: string; endDate: string }): Promise<CostSummary>;
  listHermesCronJobs(params?: { includeDisabled?: boolean }): Promise<HermesCronJob[]>;
  listHermesCronOutputs(params?: { jobId?: string; limit?: number }): Promise<HermesCronOutputEntry[]>;
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  listAgents(): Promise<GatewayAgentsListResult>;
};

export type GatewayHermesConsoleDashboardBundle = {
  identity: GatewayIdentity | null;
  modelState: GatewayCurrentModelState | null;
  modelCount: number | null;
  sessions: GatewaySessionSummary[] | null;
  files: Array<{ name: string }> | null;
  skills: SkillStatusReport | null;
  usage: UsageResult | null;
  cost: CostSummary | null;
  cronJobs: HermesCronJob[] | null;
  cronOutputs: HermesCronOutputEntry[] | null;
  heartbeat: GatewayHeartbeatSnapshot | null;
  agents: GatewayAgentsListResult | null;
};

function settledValue<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === 'fulfilled' ? result.value : null;
}

function getTodayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function loadGatewayHermesConsoleDashboard(
  gateway: GatewayHermesConsoleDashboardGateway,
  agentId: string,
): Promise<GatewayHermesConsoleDashboardBundle> {
  const today = getTodayDateStr();
  const [
    identityResult,
    modelStateResult,
    sessionResult,
    filesResult,
    skillsResult,
    usageResult,
    costResult,
    cronJobsResult,
    cronOutputsResult,
    heartbeatResult,
    agentsResult,
  ] = await Promise.allSettled([
    gateway.fetchIdentity(agentId),
    gateway.getCurrentModelState(),
    gateway.listSessions({ limit: 100 }),
    gateway.listAgentFiles(agentId),
    gateway.getSkillsStatus(agentId),
    gateway.fetchUsage({ startDate: today, endDate: today }),
    gateway.fetchCostSummary({ startDate: today, endDate: today }),
    gateway.listHermesCronJobs({ includeDisabled: true }),
    gateway.listHermesCronOutputs({ limit: 200 }),
    gateway.request('last-heartbeat', {}) as Promise<GatewayHeartbeatSnapshot>,
    gateway.listAgents(),
  ]);
  const modelState = settledValue(modelStateResult);

  return {
    identity: settledValue(identityResult),
    modelState,
    modelCount: null,
    sessions: settledValue(sessionResult),
    files: settledValue(filesResult),
    skills: settledValue(skillsResult),
    usage: settledValue(usageResult),
    cost: settledValue(costResult),
    cronJobs: settledValue(cronJobsResult),
    cronOutputs: settledValue(cronOutputsResult),
    heartbeat: settledValue(heartbeatResult),
    agents: settledValue(agentsResult),
  };
}
