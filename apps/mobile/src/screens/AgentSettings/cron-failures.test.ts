import type { CronJob } from '@clawket/agent-protocol';
import {
  cronFailureRunEntry,
  cronFailureSignature,
  failedCronJobs,
  isCronJobFailed,
  unacknowledgedCronFailures,
} from './cron-failures';

function job(id: string, state: CronJob['state'], patch: Partial<CronJob> = {}): CronJob {
  return {
    id,
    name: `Job ${id}`,
    enabled: true,
    createdAtMs: 1,
    updatedAtMs: 50,
    schedule: { kind: 'every', everyMs: 60_000 },
    sessionTarget: 'isolated',
    wakeMode: 'now',
    payload: { kind: 'agentTurn', message: 'run' },
    state,
    ...patch,
  };
}

describe('cron failures', () => {
  it('treats only an errored last run as a failure, on either status field', () => {
    expect(isCronJobFailed(job('a', { lastRunStatus: 'error' }))).toBe(true);
    expect(isCronJobFailed(job('b', { lastStatus: 'error' }))).toBe(true);
    // The current run status wins over the legacy field.
    expect(isCronJobFailed(job('c', { lastRunStatus: 'ok', lastStatus: 'error' }))).toBe(false);
    // Error text or a streak without an errored status is not a failure the Runs tab can show.
    expect(isCronJobFailed(job('d', { lastRunStatus: 'skipped', lastError: 'window closed' }))).toBe(false);
    expect(isCronJobFailed(job('e', { consecutiveErrors: 2 }))).toBe(false);
    expect(isCronJobFailed(job('f', {}))).toBe(false);
    expect(failedCronJobs([job('a', { lastRunStatus: 'error' }), job('f', {})]).map((item) => item.id)).toEqual(['a']);
  });

  it('signs a failure by job and run so a later failure alerts again', () => {
    expect(cronFailureSignature(job('daily', { lastRunStatus: 'error', lastRunAtMs: 100 }))).toBe('daily@100');
    expect(cronFailureSignature(job('daily', { lastRunStatus: 'error' }))).toBe('daily@0');

    const jobs = [
      job('seen', { lastRunStatus: 'error', lastRunAtMs: 100 }),
      job('again', { lastRunStatus: 'error', lastRunAtMs: 300 }),
      job('new', { lastRunStatus: 'error', lastRunAtMs: 200 }),
      job('fine', { lastRunStatus: 'ok', lastRunAtMs: 400 }),
    ];
    const acknowledged = new Set(['seen@100', 'again@100', 'fine@400']);
    expect(unacknowledgedCronFailures(jobs, acknowledged).map((item) => item.id)).toEqual(['again', 'new']);
    expect(unacknowledgedCronFailures(jobs, new Set()).map((item) => item.id)).toEqual(['seen', 'again', 'new']);
  });

  it('rebuilds the failed run record from job state', () => {
    expect(cronFailureRunEntry(job('daily', {
      lastRunStatus: 'error',
      lastRunAtMs: 100,
      lastError: 'model quota',
      lastDurationMs: 1_500,
      lastDeliveryStatus: 'not-delivered',
      lastDelivered: false,
      lastDeliveryError: 'channel offline',
    }, { payload: { kind: 'agentTurn', message: 'run', model: 'openai/gpt-5 ' } }))).toEqual({
      ts: 100,
      jobId: 'daily',
      jobName: 'Job daily',
      action: 'finished',
      status: 'error',
      error: 'model quota',
      runAtMs: 100,
      durationMs: 1_500,
      deliveryStatus: 'not-delivered',
      delivered: false,
      deliveryError: 'channel offline',
      model: 'openai/gpt-5',
    });
    // Without a run timestamp the record falls back to the job's own update time.
    expect(cronFailureRunEntry(job('weekly', { lastStatus: 'error' }, {
      payload: { kind: 'systemEvent', text: 'ping' },
    }))).toEqual({
      ts: 50,
      jobId: 'weekly',
      jobName: 'Job weekly',
      action: 'finished',
      status: 'error',
    });
  });
});
