import type {
  AgentDescriptor,
  CronJob,
  CronOperations,
} from '@clawket/agent-protocol';
import {
  buildCronJobCreate,
  buildCronJobPatch,
  cronDraftFromJob,
  cronJobBelongsToAgent,
  cronJobStatus,
  filterAgentCronRuns,
  formatCronSchedule,
  loadAgentCronJobs,
  parseCronSchedule,
  validateCronDraft,
} from './cron-model';

const mainAgent: AgentDescriptor = {
  connectionId: 'studio',
  agentId: 'main',
  name: 'Main',
  isMain: true,
  mainSessionKey: 'agent:main:main',
};

const childAgent: AgentDescriptor = {
  ...mainAgent,
  agentId: 'writer',
  name: 'Writer',
  isMain: false,
  mainSessionKey: 'agent:writer:main',
};

function job(patch: Partial<CronJob> = {}): CronJob {
  return {
    id: 'daily',
    name: 'Daily brief',
    enabled: true,
    createdAtMs: 1,
    updatedAtMs: 1,
    schedule: { kind: 'every', everyMs: 3_600_000 },
    sessionTarget: 'main',
    wakeMode: 'now',
    payload: { kind: 'systemEvent', text: 'Summarize today' },
    state: {},
    ...patch,
  };
}

describe('Agent cron model', () => {
  it('loads paginated jobs and keeps only the active agent jobs', async () => {
    const list = jest.fn()
      .mockResolvedValueOnce({
        jobs: [job(), job({ id: 'writer', agentId: 'writer' })],
        total: 3,
        offset: 0,
        limit: 2,
        hasMore: true,
        nextOffset: 2,
      })
      .mockResolvedValueOnce({
        jobs: [job({ id: 'other', agentId: 'other' })],
        total: 3,
        offset: 2,
        limit: 2,
        hasMore: false,
        nextOffset: null,
      });

    await expect(loadAgentCronJobs({ list } as CronOperations, childAgent))
      .resolves.toEqual([job({ id: 'writer', agentId: 'writer' })]);
    expect(list).toHaveBeenCalledTimes(2);
    expect(cronJobBelongsToAgent(job(), mainAgent)).toBe(true);
    expect(cronJobBelongsToAgent(job(), childAgent)).toBe(false);
  });

  it('parses common schedules and builds backend-neutral create payloads', () => {
    expect(parseCronSchedule('every 2h')).toEqual({ kind: 'every', everyMs: 7_200_000 });
    expect(parseCronSchedule('0 9 * * *')).toEqual({ kind: 'cron', expr: '0 9 * * *' });
    expect(formatCronSchedule({ kind: 'every', everyMs: 86_400_000 })).toBe('every 1d');

    const draft = { name: ' Brief ', schedule: '30m', prompt: ' Do it ', enabled: true };
    expect(buildCronJobCreate(draft, mainAgent)).toMatchObject({
      name: 'Brief',
      sessionTarget: 'main',
      payload: { kind: 'systemEvent', text: 'Do it' },
    });
    expect(buildCronJobCreate(draft, childAgent)).toMatchObject({
      agentId: 'writer',
      sessionTarget: 'isolated',
      payload: { kind: 'agentTurn', message: 'Do it' },
    });
  });

  it('validates drafts, preserves payload kind while editing, and derives statuses', () => {
    expect(validateCronDraft({ name: '', schedule: '', prompt: '', enabled: true }))
      .toBe('Task name is required.');
    const existing = job();
    const draft = { ...cronDraftFromJob(existing), prompt: 'Updated', enabled: false };
    expect(buildCronJobPatch(draft, existing)).toMatchObject({
      enabled: false,
      payload: { kind: 'systemEvent', text: 'Updated' },
    });
    expect(cronJobStatus(job({ state: { lastRunStatus: 'error' } }))).toBe('Failed');
    expect(cronJobStatus(job({ enabled: false }))).toBe('Disabled');
  });

  it('filters run records to loaded jobs and sorts newest first', () => {
    expect(filterAgentCronRuns([
      { ts: 1, jobId: 'daily', action: 'finished', status: 'ok' },
      { ts: 3, jobId: 'other', action: 'finished', status: 'error' },
      { ts: 2, jobId: 'daily', action: 'finished', status: 'error' },
    ], [job()]).map((entry) => entry.ts)).toEqual([2, 1]);
  });
});
