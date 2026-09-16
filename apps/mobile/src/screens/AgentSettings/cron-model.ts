import type {
  AgentDescriptor,
  CronJob,
  CronJobCreate,
  CronJobPatch,
  CronOperations,
  CronRunLogEntry,
  CronSchedule,
  CronDelivery,
} from '@clawket/agent-protocol';

import { validateSchedule } from './cron-schedule';

const PAGE_LIMIT = 100;
const MAX_PAGES = 30;

export type CronDraft = Readonly<{
  name: string;
  schedule: CronSchedule;
  prompt: string;
  enabled: boolean;
  description?: string;
  model?: string;
  delivery?: CronDelivery;
}>;

export type CronDraftError = 'Task name is required.' | 'Prompt is required.' | 'Invalid schedule.' | 'Choose a future date.';

export async function loadAgentCronJobs(
  operations: CronOperations | undefined,
  agent: AgentDescriptor,
): Promise<ReadonlyArray<CronJob>> {
  if (!operations?.list) return [];
  const jobs: CronJob[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await operations.list({
      includeDisabled: true,
      limit: PAGE_LIMIT,
      offset,
      sortBy: 'nextRunAtMs',
      sortDir: 'asc',
    });
    jobs.push(...result.jobs);
    if (!result.hasMore || result.nextOffset === null) break;
    offset = result.nextOffset;
  }
  return jobs.filter((job) => cronJobBelongsToAgent(job, agent));
}

export function cronJobBelongsToAgent(job: CronJob, agent: AgentDescriptor): boolean {
  const jobAgentId = job.agentId?.trim();
  if (jobAgentId) return jobAgentId === agent.agentId;
  return agent.isMain;
}

export function filterAgentCronRuns(
  entries: ReadonlyArray<CronRunLogEntry>,
  jobs: ReadonlyArray<CronJob>,
): ReadonlyArray<CronRunLogEntry> {
  const allowedIds = new Set(jobs.map((job) => job.id));
  return entries
    .filter((entry) => allowedIds.has(entry.jobId))
    .sort((left, right) => right.ts - left.ts);
}

export function cronDraftFromJob(job?: CronJob | null): CronDraft {
  return {
    name: job?.name ?? '',
    schedule: job?.schedule ?? { kind: 'cron', expr: '0 9 * * *' },
    prompt: job ? cronPayloadText(job) : '',
    enabled: job?.enabled ?? true,
    description: job?.description ?? '',
    model: job?.payload.kind === 'agentTurn' ? job.payload.model : undefined,
    delivery: job?.delivery,
  };
}

export function validateCronDraft(draft: CronDraft, now = Date.now(), original?: CronJob | null): CronDraftError | null {
  if (!draft.name.trim()) return 'Task name is required.';
  if (!draft.prompt.trim()) return 'Prompt is required.';
  return original && JSON.stringify(original.schedule) === JSON.stringify(draft.schedule)
    ? null : validateSchedule(draft.schedule, now);
}

export function buildCronJobCreate(
  draft: CronDraft,
  agent: AgentDescriptor,
): CronJobCreate {
  const prompt = draft.prompt.trim();
  return {
    ...(agent.isMain ? {} : { agentId: agent.agentId }),
    name: draft.name.trim(),
    ...(draft.description?.trim() ? { description: draft.description.trim() } : {}),
    enabled: draft.enabled,
    schedule: draft.schedule,
    sessionTarget: agent.isMain ? 'main' : 'isolated',
    wakeMode: 'now',
    payload: agent.isMain
      ? { kind: 'systemEvent', text: prompt }
      : { kind: 'agentTurn', message: prompt, ...(draft.model?.trim() ? { model: draft.model.trim() } : {}) },
    delivery: draft.delivery ?? { mode: 'none' },
  };
}

export function buildCronJobPatch(draft: CronDraft, job: CronJob): CronJobPatch {
  const prompt = draft.prompt.trim();
  return {
    name: draft.name.trim(),
    ...(draft.description !== (job.description ?? '') ? { description: draft.description?.trim() ?? '' } : {}),
    ...(JSON.stringify(draft.delivery) !== JSON.stringify(job.delivery) ? { delivery: draft.delivery } : {}),
    enabled: draft.enabled,
    ...(JSON.stringify(draft.schedule) === JSON.stringify(job.schedule) ? {} : { schedule: draft.schedule }),
    payload: job.payload.kind === 'systemEvent'
      ? { ...job.payload, text: prompt }
      : { ...job.payload, message: prompt, ...(draft.model !== job.payload.model ? { model: draft.model?.trim() ?? '' } : {}) },
  };
}

export function cronPayloadText(job: CronJob): string {
  return job.payload.kind === 'systemEvent' ? job.payload.text : job.payload.message;
}

export function cronRunStatus(entry: CronRunLogEntry): 'Succeeded' | 'Failed' | 'Skipped' | 'Unknown' {
  if (entry.status === 'ok') return 'Succeeded';
  if (entry.status === 'error') return 'Failed';
  return entry.status === 'skipped' ? 'Skipped' : 'Unknown';
}
