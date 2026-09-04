import { GatewayClient } from '../../connection/protocol';
import type { CronJob } from '../../types';

const PAGE_LIMIT = 100;
const MAX_PAGES = 30;

function normalizeAgentId(agentId: string | undefined): string {
  return agentId?.trim() ?? '';
}

export function isCronJobForAgent(job: CronJob, currentAgentId: string): boolean {
  const targetAgentId = normalizeAgentId(currentAgentId);
  const jobAgentId = normalizeAgentId(job.agentId);
  if (jobAgentId) return jobAgentId === targetAgentId;
  // Jobs without explicit agentId belong to the default/main agent.
  return targetAgentId === 'main';
}

export async function fetchAllCronJobs(gateway: GatewayClient, currentAgentId?: string): Promise<CronJob[]> {
  const jobs: CronJob[] = [];
  let offset = 0;

  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
    const page = await gateway.listCronJobs({
      includeDisabled: true,
      limit: PAGE_LIMIT,
      offset,
      sortBy: 'nextRunAtMs',
      sortDir: 'asc',
    });
    jobs.push(...page.jobs);
    if (!page.hasMore || page.nextOffset === null) break;
    offset = page.nextOffset;
  }

  if (!currentAgentId) return jobs;
  return jobs.filter((job) => isCronJobForAgent(job, currentAgentId));
}

export async function findCronJobById(
  gateway: GatewayClient,
  jobId: string,
  currentAgentId?: string,
): Promise<CronJob | null> {
  let offset = 0;

  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
    const page = await gateway.listCronJobs({
      includeDisabled: true,
      limit: PAGE_LIMIT,
      offset,
    });
    const found = page.jobs.find((job) => job.id === jobId);
    if (found) {
      if (!currentAgentId || isCronJobForAgent(found, currentAgentId)) return found;
      return null;
    }
    if (!page.hasMore || page.nextOffset === null) break;
    offset = page.nextOffset;
  }

  return null;
}
