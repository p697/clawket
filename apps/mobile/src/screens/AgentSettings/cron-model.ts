import type {
  AgentDescriptor,
  CronJob,
  CronJobCreate,
  CronJobPatch,
  CronOperations,
  CronRunLogEntry,
  CronSchedule,
  CronDelivery,
  ModelInfo,
} from '@clawket/agent-protocol';

import { explicitModelReference, modelReference } from '../../utils/model-catalog';
import { validateSchedule } from './cron-schedule';

const PAGE_LIMIT = 100;
const MAX_PAGES = 30;

export type CronDraft = Readonly<{
  name: string;
  schedule: CronSchedule;
  prompt: string;
  enabled: boolean;
  description?: string;
  /** `provider/model` override for `agentTurn` jobs; empty follows the Agent default. */
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

/** OpenClaw exposes its own monitors through cron.list but rejects client edits/removal. */
export function isSystemOwnedCronJob(job: CronJob): boolean {
  const kind: string = job.payload.kind;
  return kind === 'heartbeat' || kind === 'skillCollectionReview';
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
  const model = draft.model?.trim();
  // Every new job is an isolated agent turn, for the default Agent too (owner
  // decision 2026-09-19, matching the OpenClaw Control UI, CLI and agent tool):
  // it carries a per-job model and records the resolved model in run history.
  // Existing main-session system events stay readable and editable.
  return {
    ...(agent.isMain ? {} : { agentId: agent.agentId }),
    name: draft.name.trim(),
    ...(draft.description?.trim() ? { description: draft.description.trim() } : {}),
    enabled: draft.enabled,
    schedule: draft.schedule,
    sessionTarget: 'isolated',
    wakeMode: 'now',
    payload: { kind: 'agentTurn', message: prompt, ...(model ? { model } : {}) },
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
      // `null` clears the override on the wire; an empty string would be stored verbatim.
      : { ...job.payload, message: prompt, ...(cronModelChanged(draft.model, job.payload.model) ? { model: draft.model?.trim() || null } : {}) },
  };
}

function cronModelChanged(next: string | undefined, current: string | undefined): boolean {
  return (next?.trim() ?? '') !== (current?.trim() ?? '');
}

export function cronPayloadText(job: CronJob): string {
  if (isSystemOwnedCronJob(job)) return '';
  return job.payload.kind === 'systemEvent' ? job.payload.text : job.payload.message;
}

/** The per-job model override; `undefined` when the job follows the Agent default or the main session. */
export function cronJobModel(job: Pick<CronJob, 'payload'>): string | undefined {
  return job.payload.kind === 'agentTurn' ? job.payload.model?.trim() || undefined : undefined;
}

/** Catalog display name for a `provider/model` reference, else the reference without its provider. */
export function cronModelLabel(reference: string, models: ReadonlyArray<ModelInfo>): string {
  const needle = reference.trim().toLowerCase();
  const match = models.find((model) => modelReference(model.provider, model.id).toLowerCase() === needle
    || explicitModelReference(model.provider, model.id).toLowerCase() === needle
    || model.id.trim().toLowerCase() === needle);
  if (match) return match.name || match.id;
  const slash = reference.indexOf('/');
  return slash >= 0 ? reference.slice(slash + 1) : reference;
}

export function cronRunStatus(entry: CronRunLogEntry): 'Succeeded' | 'Failed' | 'Skipped' | 'Unknown' {
  if (entry.status === 'ok') return 'Succeeded';
  if (entry.status === 'error') return 'Failed';
  return entry.status === 'skipped' ? 'Skipped' : 'Unknown';
}
