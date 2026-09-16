import { scheduleDraft, scheduleFromDraft, upcomingRuns, validateSchedule } from './cron-schedule';
import { buildCronJobPatch, cronDraftFromJob, validateCronDraft } from './cron-model';
import type { CronJob, CronSchedule } from '@clawket/agent-protocol';

const now = Date.parse('2026-09-14T00:00:00Z');
describe('structured Cron schedules', () => {
  it.each<CronSchedule>([
    { kind: 'cron', expr: '0 9 * * *', tz: 'Asia/Tokyo', staggerMs: 3500 },
    { kind: 'cron', expr: '0 9 * * 1-5', tz: 'America/New_York' },
    { kind: 'cron', expr: '0 9 * * 1,3,5' },
    { kind: 'cron', expr: '0 9 28-31 * *', tz: 'Europe/London' },
    { kind: 'cron', expr: '0 9 1 * MON' },
    { kind: 'cron', expr: '0 0 9 * * *' },
    { kind: 'every', everyMs: 3_600_000, anchorMs: now - 1000 },
    { kind: 'at', at: '2026-12-31T19:00:00+09:00' },
  ])('losslessly retains existing rule %j', schedule => {
    expect(scheduleFromDraft(scheduleDraft(schedule))).toEqual(schedule);
  });

  it('does not coerce monthly or extended rules into daily/weekly schedules', () => {
    for (const expr of ['0 9 1 * *', '0 9 * 1 *', '0 9 1 * MON', '0 0 9 * * *', '*/10 * * * *']) {
      expect(scheduleDraft({ kind: 'cron', expr }).frequency).toBe('custom');
    }
  });

  it('builds multi-day schedules and keeps separate timezone and stagger metadata', () => {
    const input: CronSchedule = { kind: 'cron', expr: '0 9 * * *', tz: 'Asia/Tokyo', staggerMs: 8000 };
    expect(scheduleFromDraft({ ...scheduleDraft(input), frequency: 'weekly', weekdays: [5, 1, 3], hour: 16, minute: 30 }))
      .toEqual({ kind: 'cron', expr: '30 16 * * 1,3,5', tz: 'Asia/Tokyo', staggerMs: 8000 });
  });

  it('validates future dates, positive intervals and portable custom rules', () => {
    expect(validateSchedule({ kind: 'at', at: new Date(now - 1).toISOString() }, now)).toBe('Choose a future date.');
    expect(validateSchedule({ kind: 'at', at: 'invalid' }, now)).toBe('Choose a future date.');
    for (const everyMs of [0, -1, NaN, Infinity, 59_000]) expect(validateSchedule({ kind: 'every', everyMs }, now)).toBe('Invalid schedule.');
    for (const expr of ['bad', '60 9 * * *', '0 24 * * *', '0 9 31 2 *', '*/0 * * * *', '0 0 9 * * *']) {
      expect(validateSchedule({ kind: 'cron', expr }, now)).toBe('Invalid schedule.');
    }
    expect(validateSchedule({ kind: 'cron', expr: '0 9 * * *', tz: 'Not/AZone' }, now)).toBe('Invalid schedule.');
    expect(validateSchedule({ kind: 'cron', expr: '0 9 * * 1,3,5', tz: 'Asia/Tokyo' }, now)).toBeNull();
  });

  it('computes upcoming runs in their named timezone and preserves interval anchors', () => {
    expect(upcomingRuns({ kind: 'cron', expr: '0 9 * * *', tz: 'Asia/Tokyo' }, now).map(date => date.toISOString()))
      .toEqual(['2026-09-15T00:00:00.000Z', '2026-09-16T00:00:00.000Z', '2026-09-17T00:00:00.000Z']);
    expect(upcomingRuns({ kind: 'every', everyMs: 3_600_000, anchorMs: now - 1000 }, now)[0].getTime()).toBe(now + 3_599_000);
    expect(upcomingRuns({ kind: 'cron', expr: '0 9 * * *' }, now)).toEqual([]);
    expect(upcomingRuns({ kind: 'at', at: new Date(now + 60_000).toISOString() }, now)).toHaveLength(1);
  });

  it('matches the scheduler’s DST roll-forward policy at the spring gap', () => {
    const dates = upcomingRuns({ kind: 'cron', expr: '30 2 * * *', tz: 'America/New_York' }, Date.parse('2026-03-08T06:00:00Z'));
    // OpenClaw also uses Croner 10.0.1: the missing 02:30 rolls to 03:30.
    expect(dates[0].toISOString()).toBe('2026-03-08T07:30:00.000Z');
    expect(dates[1].toISOString()).toBe('2026-03-09T06:30:00.000Z');
  });

  it('allows renaming an old one-time task without rescheduling or losing advanced fields', () => {
    const job: CronJob = { id: 'one', name: 'Old', enabled: false, createdAtMs: 1, updatedAtMs: 1,
      schedule: { kind: 'at', at: '2020-01-01T00:00:00Z' }, sessionTarget: 'isolated', wakeMode: 'next-heartbeat',
      payload: { kind: 'agentTurn', message: 'Task', model: 'configured/model', timeoutSeconds: 180 },
      delivery: { mode: 'announce', channel: 'telegram', to: 'target', bestEffort: true }, deleteAfterRun: true, state: {} };
    const draft = { ...cronDraftFromJob(job), name: 'Renamed' };
    expect(validateCronDraft(draft, now, job)).toBeNull();
    const patch = buildCronJobPatch(draft, job);
    expect(patch).not.toHaveProperty('schedule');
    expect(patch).not.toHaveProperty('delivery');
    expect(patch.payload).toEqual(job.payload);
    expect({ ...job, ...patch }).toMatchObject({ deleteAfterRun: true, wakeMode: 'next-heartbeat', sessionTarget: 'isolated' });
  });
});
