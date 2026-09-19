import type { CronJob, CronRunLogEntry } from '@clawket/agent-protocol';

/**
 * A job whose most recent run ended in an error. This is the job's current state, shared by the
 * job row, the Runs tab and the profile badge; it clears only when the backend records a later
 * run that did not fail. `lastError` and `consecutiveErrors` alone do not count: a skipped run can
 * carry an error text, and the badge must match the red rows the Runs tab can actually show.
 */
export function isCronJobFailed(job: Pick<CronJob, 'state'>): boolean {
  return (job.state.lastRunStatus ?? job.state.lastStatus) === 'error';
}

export function failedCronJobs(jobs: ReadonlyArray<CronJob>): ReadonlyArray<CronJob> {
  return jobs.filter(isCronJobFailed);
}

/**
 * Identity of one failure for acknowledgement: the job plus the run that failed. A later failure
 * of the same job gets a new signature, so the profile badge returns; a job with no run timestamp
 * is acknowledged once until the backend reports one.
 */
export function cronFailureSignature(job: Pick<CronJob, 'id' | 'state'>): string {
  return `${job.id}@${job.state.lastRunAtMs ?? 0}`;
}

/** Failed jobs the user has not yet seen on the Runs tab: the profile badge counts these. */
export function unacknowledgedCronFailures(
  jobs: ReadonlyArray<CronJob>,
  acknowledged: ReadonlySet<string>,
): ReadonlyArray<CronJob> {
  return failedCronJobs(jobs).filter((job) => !acknowledged.has(cronFailureSignature(job)));
}

/**
 * The failed run as the run-record sheet expects it, rebuilt from job state so it can be shown
 * ahead of the paginated history, which may not contain it yet.
 */
export function cronFailureRunEntry(job: CronJob): CronRunLogEntry {
  const runAtMs = job.state.lastRunAtMs;
  const model = job.payload.kind === 'agentTurn' ? job.payload.model?.trim() || undefined : undefined;
  return {
    ts: runAtMs ?? job.updatedAtMs,
    jobId: job.id,
    jobName: job.name,
    action: 'finished',
    status: 'error',
    ...(job.state.lastError ? { error: job.state.lastError } : {}),
    ...(runAtMs !== undefined ? { runAtMs } : {}),
    ...(job.state.lastDurationMs !== undefined ? { durationMs: job.state.lastDurationMs } : {}),
    ...(job.state.lastDeliveryStatus ? { deliveryStatus: job.state.lastDeliveryStatus } : {}),
    ...(job.state.lastDelivered !== undefined ? { delivered: job.state.lastDelivered } : {}),
    ...(job.state.lastDeliveryError ? { deliveryError: job.state.lastDeliveryError } : {}),
    ...(model ? { model } : {}),
  };
}
