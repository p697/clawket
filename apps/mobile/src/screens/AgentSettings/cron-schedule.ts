import { Cron } from 'croner';
import type { CronSchedule } from '@clawket/agent-protocol';

export type Frequency = 'daily' | 'weekly' | 'interval' | 'once' | 'custom';
export type IntervalUnit = 'minutes' | 'hours' | 'days';
export type ScheduleDraft = Readonly<{
  frequency: Frequency;
  hour: number;
  minute: number;
  weekdays: readonly number[];
  amount: string;
  unit: IntervalUnit;
  atMs: number;
  timezone: string;
  expression: string;
  source?: CronSchedule;
}>;
const UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };

export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** Recognize only schedules that can round-trip through the visual controls. */
export function scheduleDraft(schedule?: CronSchedule, timezone = '', now = Date.now()): ScheduleDraft {
  const base: ScheduleDraft = {
    frequency: 'daily', hour: 9, minute: 0, weekdays: [1], amount: '6', unit: 'hours',
    atMs: now + 3_600_000, timezone, expression: '0 9 * * *', source: schedule,
  };
  if (!schedule) return base;
  if (schedule.kind === 'at') return { ...base, frequency: 'once', atMs: Date.parse(schedule.at) };
  if (schedule.kind === 'every') {
    const unit = schedule.everyMs % UNIT_MS.days === 0 ? 'days'
      : schedule.everyMs % UNIT_MS.hours === 0 ? 'hours' : 'minutes';
    return { ...base, frequency: 'interval', amount: String(schedule.everyMs / UNIT_MS[unit]), unit };
  }
  const custom = { ...base, frequency: 'custom' as const, timezone: schedule.tz ?? '', expression: schedule.expr };
  const fields = schedule.expr.trim().split(/\s+/);
  if (fields.length !== 5 || !/^\d+$/.test(fields[0]) || !/^\d+$/.test(fields[1])
    || fields[2] !== '*' || fields[3] !== '*') return custom;
  const minute = Number(fields[0]);
  const hour = Number(fields[1]);
  if (minute > 59 || hour > 23) return custom;
  if (fields[4] === '*') return { ...custom, frequency: 'daily', hour, minute };
  const weekdays = parseWeekdays(fields[4]);
  return weekdays ? { ...custom, frequency: 'weekly', hour, minute, weekdays } : custom;
}

function parseWeekdays(value: string): number[] | null {
  const result = new Set<number>();
  for (const item of value.split(',')) {
    if (!/^\d(?:-\d)?$/.test(item)) return null;
    const [start, end = start] = item.split('-').map(Number);
    if (start > 7 || end > 7 || end < start) return null;
    for (let day = start; day <= end; day++) result.add(day % 7);
  }
  return result.size ? [...result].sort((a, b) => a - b) : null;
}

export function scheduleFromDraft(draft: ScheduleDraft): CronSchedule {
  if (draft.source) {
    const original = scheduleDraft(draft.source);
    // Dormant fields (e.g. timezone on an interval) do not change its semantics.
    const keys: (keyof ScheduleDraft)[] = draft.frequency === 'interval' ? ['frequency', 'amount', 'unit']
      : draft.frequency === 'once' ? ['frequency', 'atMs']
      : draft.frequency === 'custom' ? ['frequency', 'expression', 'timezone']
      : ['frequency', 'hour', 'minute', 'timezone', ...(draft.frequency === 'weekly' ? ['weekdays' as const] : [])];
    if (keys.every(key => JSON.stringify(original[key]) === JSON.stringify(draft[key]))) return draft.source;
  }
  if (draft.frequency === 'interval') return {
    ...(draft.source?.kind === 'every' ? draft.source : {}),
    kind: 'every', everyMs: Number(draft.amount) * UNIT_MS[draft.unit],
  };
  if (draft.frequency === 'once') return { kind: 'at', at: Number.isFinite(draft.atMs) ? new Date(draft.atMs).toISOString() : '' };
  const expr = draft.frequency === 'custom' ? draft.expression.trim()
    : `${draft.minute} ${draft.hour} * * ${draft.frequency === 'weekly' ? [...draft.weekdays].sort((a, b) => a - b).join(',') : '*'}`;
  const { tz: _timezone, ...previous } = draft.source?.kind === 'cron' ? draft.source : { kind: 'cron' as const, expr: '' };
  return { ...previous, kind: 'cron', expr, ...(draft.timezone.trim() ? { tz: draft.timezone.trim() } : {}) };
}

export function validateSchedule(schedule: CronSchedule, now = Date.now()): 'Invalid schedule.' | 'Choose a future date.' | null {
  if (schedule.kind === 'at') return Number.isFinite(Date.parse(schedule.at)) && Date.parse(schedule.at) > now
    ? null : 'Choose a future date.';
  if (schedule.kind === 'every') return Number.isSafeInteger(schedule.everyMs) && schedule.everyMs >= 60_000
    ? null : 'Invalid schedule.';
  // Portable five-field syntax only for new/changed rules. Existing custom rules
  // are retained untouched by the draft model, including backend extensions.
  if (schedule.expr.length > 256 || schedule.expr.trim().split(/\s+/).length !== 5
    || !/^[\dA-Za-z*\/,\-\s]+$/.test(schedule.expr)) return 'Invalid schedule.';
  try {
    const cron = new Cron(schedule.expr, { timezone: schedule.tz || 'UTC', paused: true });
    const next = cron.nextRun(new Date(now));
    cron.stop();
    return next ? null : 'Invalid schedule.';
  } catch {
    return 'Invalid schedule.';
  }
}

/** Estimates only. An absent cron timezone means the remote scheduler's zone is unknown. */
export function upcomingRuns(schedule: CronSchedule, now = Date.now()): Date[] {
  if (schedule.kind === 'at') return Date.parse(schedule.at) > now ? [new Date(schedule.at)] : [];
  if (schedule.kind === 'every') {
    if (validateSchedule(schedule, now)) return [];
    const anchor = schedule.anchorMs ?? now;
    const first = anchor > now ? anchor : anchor + (Math.floor((now - anchor) / schedule.everyMs) + 1) * schedule.everyMs;
    return [0, 1, 2].map(index => new Date(first + index * schedule.everyMs));
  }
  if (!schedule.tz || validateSchedule(schedule, now)) return [];
  try {
    const cron = new Cron(schedule.expr, { timezone: schedule.tz, paused: true });
    const dates = cron.nextRuns(3, new Date(now));
    cron.stop();
    return dates;
  } catch {
    return [];
  }
}

export function formatCronDate(timestamp: number | undefined, locale?: string, timezone?: string): string {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return '—';
  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', ...(timezone ? { timeZone: timezone } : {}),
    }).format(timestamp);
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}
