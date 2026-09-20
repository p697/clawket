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
  cronJobModel,
  cronModelLabel,
  filterAgentCronRuns,
  loadAgentCronJobs,
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

  it('parses common schedules and builds isolated agent-turn create payloads for every Agent', () => {
    const draft = { name: ' Brief ', schedule: { kind: 'every' as const, everyMs: 1_800_000 }, prompt: ' Do it ', enabled: true };
    // The default Agent no longer creates main-session system events (owner decision 2026-09-19).
    const created = buildCronJobCreate(draft, mainAgent);
    expect(created).toMatchObject({
      name: 'Brief',
      sessionTarget: 'isolated',
      payload: { kind: 'agentTurn', message: 'Do it' },
    });
    expect(created.agentId).toBeUndefined();
    expect('model' in created.payload).toBe(false);
    expect(buildCronJobCreate(draft, childAgent)).toMatchObject({
      agentId: 'writer',
      sessionTarget: 'isolated',
      payload: { kind: 'agentTurn', message: 'Do it' },
    });
    expect(buildCronJobCreate({ ...draft, model: ' anthropic/claude-haiku-4-5 ' }, mainAgent).payload)
      .toEqual({ kind: 'agentTurn', message: 'Do it', model: 'anthropic/claude-haiku-4-5' });
    expect(buildCronJobCreate({ ...draft, model: '   ' }, mainAgent).payload)
      .toEqual({ kind: 'agentTurn', message: 'Do it' });
  });

  it('validates drafts, preserves payload kind while editing, and retains the existing payload', () => {
    expect(validateCronDraft({ ...cronDraftFromJob(), name: '' }))
      .toBe('Task name is required.');
    const existing = job();
    const draft = { ...cronDraftFromJob(existing), prompt: 'Updated', enabled: false };
    expect(buildCronJobPatch(draft, existing)).toMatchObject({
      enabled: false,
      payload: { kind: 'systemEvent', text: 'Updated' },
    });
  });

  it('patches the agent-turn model only when it changes and clears it with null', () => {
    const isolated = job({
      sessionTarget: 'isolated',
      payload: { kind: 'agentTurn', message: 'Summarize today', model: 'anthropic/claude-sonnet-4-5', thinking: 'low' },
    });
    const draft = cronDraftFromJob(isolated);
    expect(draft.model).toBe('anthropic/claude-sonnet-4-5');
    // Unchanged (whitespace-only differences included): no model key on the wire.
    expect(buildCronJobPatch({ ...draft, model: ' anthropic/claude-sonnet-4-5 ' }, isolated).payload)
      .toEqual({ kind: 'agentTurn', message: 'Summarize today', model: 'anthropic/claude-sonnet-4-5', thinking: 'low' });
    expect(buildCronJobPatch({ ...draft, model: 'openai/gpt-5' }, isolated).payload)
      .toMatchObject({ model: 'openai/gpt-5', thinking: 'low' });
    // Clearing sends `null` (OpenClaw contract), never an empty string.
    expect(buildCronJobPatch({ ...draft, model: '' }, isolated).payload).toMatchObject({ model: null });
    expect(buildCronJobPatch({ ...draft, model: undefined }, isolated).payload).toMatchObject({ model: null });
    const plain = job({ sessionTarget: 'isolated', payload: { kind: 'agentTurn', message: 'Summarize today' } });
    expect('model' in buildCronJobPatch({ ...cronDraftFromJob(plain), model: '' }, plain).payload!).toBe(false);
    expect(buildCronJobPatch({ ...cronDraftFromJob(plain), model: 'openai/gpt-5' }, plain).payload).toMatchObject({ model: 'openai/gpt-5' });
  });

  it('reads the per-job model and labels it from the catalog', () => {
    expect(cronJobModel(job())).toBeUndefined();
    expect(cronJobModel(job({ payload: { kind: 'agentTurn', message: 'x' } }))).toBeUndefined();
    expect(cronJobModel(job({ payload: { kind: 'agentTurn', message: 'x', model: '  ' } }))).toBeUndefined();
    expect(cronJobModel(job({ payload: { kind: 'agentTurn', message: 'x', model: ' openai/gpt-5 ' } }))).toBe('openai/gpt-5');
    const models = [
      { id: 'gpt-5', name: 'GPT-5', provider: 'openai' },
      { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic' },
    ];
    expect(cronModelLabel('OpenAI/GPT-5', models)).toBe('GPT-5');
    expect(cronModelLabel('anthropic/claude-haiku-4-5', models)).toBe('Claude Haiku 4.5');
    expect(cronModelLabel('gpt-5', models)).toBe('GPT-5');
    expect(cronModelLabel('ollama/llama3', models)).toBe('llama3');
    expect(cronModelLabel('sonnet', [])).toBe('sonnet');
  });

  it('filters run records to loaded jobs and sorts newest first', () => {
    expect(filterAgentCronRuns([
      { ts: 1, jobId: 'daily', action: 'finished', status: 'ok' },
      { ts: 3, jobId: 'other', action: 'finished', status: 'error' },
      { ts: 2, jobId: 'daily', action: 'finished', status: 'error' },
    ], [job()]).map((entry) => entry.ts)).toEqual([2, 1]);
  });
});
