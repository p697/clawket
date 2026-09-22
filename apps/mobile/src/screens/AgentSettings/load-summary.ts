import { resolveCostPresentation } from '../../services/usage-cost-presentation';
import type {
  AgentAdapter,
  AgentDescriptor,
} from '@clawket/agent-protocol';
import { CronFailureAckService } from '../../services/cron-failure-acks';
import { unacknowledgedCronFailures } from './cron-failures';
import { cronJobBelongsToAgent } from './cron-model';
import type { AgentSettingsSummary } from './model';

export async function loadAgentSettingsSummary(
  adapter: AgentAdapter,
  agent: AgentDescriptor,
  now: number = Date.now(),
  onProgress?: (summary: AgentSettingsSummary) => void,
): Promise<AgentSettingsSummary> {
  const summary: MutableSummary = {};
  const management = adapter.management;
  const tasks: Array<Promise<void>> = [];

  if (adapter.capabilities.models && management?.models?.list) {
    tasks.push(ignoreFailure(async () => {
      const models = await management.models?.list?.();
      if (models) summary.modelCount = models.length;
    }));
  }

  if (adapter.capabilities.skills && management?.skills?.status) {
    tasks.push(ignoreFailure(async () => {
      const status = await management.skills?.status?.(agent.agentId);
      if (status) summary.installedSkillCount = status.skills.length;
    }));
  }

  if (adapter.capabilities.cron && management?.cron?.list) {
    tasks.push(ignoreFailure(async () => {
      Object.assign(summary, await loadAgentCronSummary(adapter, agent));
    }));
  }

  if (adapter.capabilities.heartbeat && management?.cron?.heartbeat?.last) {
    tasks.push(ignoreFailure(async () => {
      const status = await management.cron?.heartbeat?.last?.();
      if (status) summary.lastHeartbeatAt = status.lastHeartbeatAt;
    }));
  }

  if (adapter.capabilities.files && management?.agents?.files?.list) {
    tasks.push(ignoreFailure(async () => {
      const files = await management.agents?.files?.list?.(agent.agentId);
      if (files) summary.fileCount = files.length;
    }));
  }

  if (adapter.capabilities.cost && management?.usage?.cost) {
    tasks.push(ignoreFailure(async () => {
      const date = formatLocalDate(now);
      const result = await management.usage?.cost?.({ startDate: date, endDate: date, agentId: agent.agentId });
      const total = result?.totals?.totalCost;
      // An "unknown" presentation means the backend counted tokens but could not price them.
      const mode = resolveCostPresentation(null, result ?? null)?.mode;
      summary.todayCostMode = mode;
      summary.todayCostUsd = mode === 'unknown' || mode === 'included' || (mode === 'mixed' && !(total && total > 0)) ? undefined : total;
      const tokens = result?.totals?.totalTokens;
      if (tokens !== undefined) summary.todayTokens = tokens;
    }));
  }

  if (adapter.capabilities.tools && management?.tools?.catalog) {
    tasks.push(ignoreFailure(async () => {
      const catalog = await management.tools?.catalog(agent.agentId);
      if (!catalog) return;
      summary.toolCount = new Set(
        catalog.groups.flatMap((group) => group.tools.map((tool) => tool.id)),
      ).size;
    }));
  }

  if (adapter.capabilities.devices && management?.devices?.list) {
    tasks.push(ignoreFailure(async () => {
      const result = await management.devices?.list?.();
      if (result) incrementPending(summary, result.pending.length);
    }));
  }

  if (adapter.capabilities.nodes && management?.nodes?.pairRequests) {
    tasks.push(ignoreFailure(async () => {
      const result = await management.nodes?.pairRequests?.();
      if (result) incrementPending(summary, result.pending.length);
    }));
  }

  await Promise.all(tasks.map(async (task) => {
    await task;
    onProgress?.({ ...summary });
  }));
  return summary;
}

export function formatLocalDate(timestamp: number): string {
  const date = new Date(timestamp);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export type AgentCronSummary = Pick<AgentSettingsSummary, 'cronJobCount' | 'cronFailureCount' | 'hasCronFailure'>;

/**
 * The Cron jobs card: the job total plus the failures this Agent's user has not seen yet. Read on
 * its own after the Runs tab acknowledges failures so the badge clears without reloading the page.
 */
export async function loadAgentCronSummary(
  adapter: AgentAdapter,
  agent: AgentDescriptor,
): Promise<AgentCronSummary> {
  const list = adapter.management?.cron?.list;
  if (!list) return {};
  const [result, acknowledged] = await Promise.all([
    list({ includeDisabled: true, limit: 200, offset: 0 }),
    CronFailureAckService.read(agent.connectionId, agent.agentId),
  ]);
  const jobs = result.jobs.filter((job) => cronJobBelongsToAgent(job, agent));
  const cronFailureCount = unacknowledgedCronFailures(jobs, acknowledged).length;
  return { cronJobCount: result.total, cronFailureCount, hasCronFailure: cronFailureCount > 0 };
}

type MutableSummary = {
  -readonly [Key in keyof AgentSettingsSummary]: AgentSettingsSummary[Key];
};

function incrementPending(summary: MutableSummary, count: number): void {
  summary.pendingConnectionCount = (summary.pendingConnectionCount ?? 0) + count;
}

async function ignoreFailure(load: () => Promise<void>): Promise<void> {
  try {
    await load();
  } catch {
    // Summary values are optional; section pages remain reachable after a partial failure.
  }
}
