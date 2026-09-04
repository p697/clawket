import type {
  AgentAdapter,
  AgentDescriptor,
  CronJob,
} from '@clawket/agent-protocol';
import type { AgentSettingsSummary } from './model';

export async function loadAgentSettingsSummary(
  adapter: AgentAdapter,
  agent: AgentDescriptor,
  now: number = Date.now(),
): Promise<AgentSettingsSummary> {
  const summary: MutableSummary = {};
  const management = adapter.management;
  const tasks: Array<Promise<void>> = [];

  if (adapter.capabilities.models && management?.models?.getSelection) {
    tasks.push(ignoreFailure(async () => {
      const selection = await management.models?.getSelection?.();
      if (selection) summary.currentModel = selection.currentModel;
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
      const result = await management.cron?.list?.({
        includeDisabled: true,
        limit: 200,
        offset: 0,
      });
      if (!result) return;
      summary.cronJobCount = result.total;
      summary.hasCronFailure = result.jobs.some(hasCronFailure);
    }));
  }

  if (adapter.capabilities.cost && management?.usage?.cost) {
    tasks.push(ignoreFailure(async () => {
      const date = formatLocalDate(now);
      const result = await management.usage?.cost?.({ startDate: date, endDate: date });
      const total = result?.totals?.totalCost;
      if (total !== undefined) summary.todayCostUsd = total;
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

  await Promise.all(tasks);
  return summary;
}

export function formatLocalDate(timestamp: number): string {
  const date = new Date(timestamp);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function hasCronFailure(job: CronJob): boolean {
  return job.state.lastRunStatus === 'error'
    || job.state.lastStatus === 'error'
    || Boolean(job.state.lastError)
    || (job.state.consecutiveErrors ?? 0) > 0;
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
