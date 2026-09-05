import type {
  AgentDescriptor,
  CronJob,
  CronJobCreate,
  CronJobPatch,
  CronOperations,
  CronRunLogEntry,
  CronSchedule,
} from '@clawket/agent-protocol';

const PAGE_LIMIT = 100;
const MAX_PAGES = 30;

export type CronDraft = Readonly<{
  name: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
}>;

export type CronDraftError = 'Task name is required.' | 'Schedule is required.' | 'Prompt is required.';

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
    schedule: job ? formatCronSchedule(job.schedule) : '',
    prompt: job ? cronPayloadText(job) : '',
    enabled: job?.enabled ?? true,
  };
}

export function validateCronDraft(draft: CronDraft): CronDraftError | null {
  if (!draft.name.trim()) return 'Task name is required.';
  if (!draft.schedule.trim()) return 'Schedule is required.';
  if (!draft.prompt.trim()) return 'Prompt is required.';
  return null;
}

export function buildCronJobCreate(
  draft: CronDraft,
  agent: AgentDescriptor,
): CronJobCreate {
  const prompt = draft.prompt.trim();
  return {
    ...(agent.isMain ? {} : { agentId: agent.agentId }),
    name: draft.name.trim(),
    enabled: draft.enabled,
    schedule: parseCronSchedule(draft.schedule),
    sessionTarget: agent.isMain ? 'main' : 'isolated',
    wakeMode: 'now',
    payload: agent.isMain
      ? { kind: 'systemEvent', text: prompt }
      : { kind: 'agentTurn', message: prompt },
    delivery: { mode: 'none' },
  };
}

export function buildCronJobPatch(draft: CronDraft, job: CronJob): CronJobPatch {
  const prompt = draft.prompt.trim();
  return {
    name: draft.name.trim(),
    enabled: draft.enabled,
    schedule: parseCronSchedule(draft.schedule),
    payload: job.payload.kind === 'systemEvent'
      ? { kind: 'systemEvent', text: prompt }
      : { ...job.payload, message: prompt },
  };
}

export function parseCronSchedule(input: string): CronSchedule {
  const value = input.trim();
  const duration = value.match(/^(?:every\s+)?(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i);
  if (duration) {
    const amount = Number(duration[1]);
    const unit = duration[2]?.toLowerCase() ?? 'm';
    const multiplier = unit.startsWith('d')
      ? 86_400_000
      : unit.startsWith('h')
        ? 3_600_000
        : 60_000;
    return { kind: 'every', everyMs: Math.max(1, Math.round(amount * multiplier)) };
  }
  if (/^\d{4}-\d{2}-\d{2}(?:T|\s)/.test(value) && Number.isFinite(Date.parse(value))) {
    return { kind: 'at', at: new Date(value).toISOString() };
  }
  return { kind: 'cron', expr: value };
}

export function formatCronSchedule(schedule: CronSchedule): string {
  if (schedule.kind === 'cron') {
    return schedule.tz ? `${schedule.expr} · ${schedule.tz}` : schedule.expr;
  }
  if (schedule.kind === 'at') return schedule.at;
  const minutes = schedule.everyMs / 60_000;
  if (minutes % 1_440 === 0) return `every ${minutes / 1_440}d`;
  if (minutes % 60 === 0) return `every ${minutes / 60}h`;
  return `every ${minutes}m`;
}

export function cronPayloadText(job: CronJob): string {
  return job.payload.kind === 'systemEvent' ? job.payload.text : job.payload.message;
}

export function cronJobStatus(job: CronJob): 'Failed' | 'Running' | 'Enabled' | 'Disabled' {
  if (job.state.runningAtMs) return 'Running';
  if ((job.state.lastRunStatus ?? job.state.lastStatus) === 'error') return 'Failed';
  return job.enabled ? 'Enabled' : 'Disabled';
}

export function cronRunStatus(entry: CronRunLogEntry): 'Succeeded' | 'Failed' | 'Skipped' {
  if (entry.status === 'ok') return 'Succeeded';
  if (entry.status === 'error') return 'Failed';
  return 'Skipped';
}
