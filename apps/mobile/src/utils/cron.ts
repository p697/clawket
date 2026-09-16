import type { CronRunStatus, CronSchedule } from '../types';

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function humanDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '0m';
  if (durationMs % DAY_MS === 0) return `${Math.round(durationMs / DAY_MS)}d`;
  if (durationMs % HOUR_MS === 0) return `${Math.round(durationMs / HOUR_MS)}h`;
  if (durationMs % MINUTE_MS === 0) return `${Math.round(durationMs / MINUTE_MS)}m`;
  if (durationMs >= MINUTE_MS) return `${(durationMs / MINUTE_MS).toFixed(1)}m`;
  if (durationMs >= SECOND_MS) return `${(durationMs / SECOND_MS).toFixed(1)}s`;
  return `${Math.round(durationMs)}ms`;
}

function formatRelativeAmount(amount: number, unit: string): string {
  return `${amount}${unit}`;
}

export function formatRelativeTime(timestampMs: number): string {
  if (!Number.isFinite(timestampMs)) return '—';
  const now = Date.now();
  const diff = timestampMs - now;
  const absDiff = Math.abs(diff);
  const future = diff > 0;

  if (absDiff < 45 * SECOND_MS) return 'just now';

  let value: string;
  if (absDiff < HOUR_MS) {
    value = formatRelativeAmount(Math.round(absDiff / MINUTE_MS), 'm');
  } else if (absDiff < DAY_MS) {
    value = formatRelativeAmount(Math.round(absDiff / HOUR_MS), 'h');
  } else {
    value = formatRelativeAmount(Math.round(absDiff / DAY_MS), 'd');
  }

  return future ? `in ${value}` : `${value} ago`;
}

export function formatCronSchedule(schedule: CronSchedule): string {
  if (schedule.kind === 'at') {
    const atMs = Date.parse(schedule.at);
    return Number.isFinite(atMs)
      ? `One-time: ${new Date(atMs).toLocaleString()}`
      : `One-time: ${schedule.at}`;
  }
  if (schedule.kind === 'every') {
    return `Every ${humanDuration(schedule.everyMs)}`;
  }
  return schedule.tz ? `${schedule.expr} (${schedule.tz})` : schedule.expr;
}

// ---------------------------------------------------------------------------
// Human-readable, i18n-aware schedule description
// ---------------------------------------------------------------------------

type TFn = (key: string, opts?: Record<string, string | number>) => string;

function translateWeekday(day: number, t: TFn): string {
  if (day === 1) return t('weekday_Mon', { ns: 'settings' });
  if (day === 2) return t('weekday_Tue', { ns: 'settings' });
  if (day === 3) return t('weekday_Wed', { ns: 'settings' });
  if (day === 4) return t('weekday_Thu', { ns: 'settings' });
  if (day === 5) return t('weekday_Fri', { ns: 'settings' });
  if (day === 6) return t('weekday_Sat', { ns: 'settings' });
  return t('weekday_Sun', { ns: 'settings' });
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Convert a CronSchedule into a single human-readable sentence,
 * using the provided i18n `t` function (settings namespace).
 */
export function describeScheduleHuman(schedule: CronSchedule, t: TFn): string {
  // --- "at" (one-time) ---
  if (schedule.kind === 'at') {
    const ms = Date.parse(schedule.at);
    if (!Number.isFinite(ms)) return schedule.at;
    const d = new Date(ms);
    const datetime = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    return t('schedule_once_at', { ns: 'settings', datetime });
  }

  // --- "every" (interval) ---
  if (schedule.kind === 'every') {
    const ms = schedule.everyMs;
    if (ms > 0 && ms % DAY_MS === 0) {
      return t('schedule_every_n_days', { ns: 'settings', count: ms / DAY_MS });
    }
    if (ms > 0 && ms % HOUR_MS === 0) {
      return t('schedule_every_n_hours', { ns: 'settings', count: ms / HOUR_MS });
    }
    if (ms > 0 && ms % MINUTE_MS === 0) {
      return t('schedule_every_n_minutes', { ns: 'settings', count: ms / MINUTE_MS });
    }
    // sub-minute or fractional
    return t('schedule_every_n_minutes', {
      ns: 'settings',
      count: Number((ms / MINUTE_MS).toFixed(1)),
    });
  }

  // --- "cron" expression ---
  return describeCronScheduleHuman(schedule.expr, t);
}

/**
 * Best-effort human description of a 5-field cron expression with i18n.
 * Falls back to the raw expression for complex patterns.
 */
function describeCronScheduleHuman(expr: string, t: TFn): string {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return expr;

  const [minF, hourF, domF, monF, dowF] = fields;

  // Every N minutes: */N * * * *
  if (minF.startsWith('*/') && hourF === '*' && domF === '*' && monF === '*' && dowF === '*') {
    const step = Number(minF.slice(2));
    if (Number.isFinite(step) && step > 0) {
      return step === 1
        ? t('schedule_every_minute', { ns: 'settings' })
        : t('schedule_every_n_minutes', { ns: 'settings', count: step });
    }
  }

  // Every minute: * * * * *
  if (minF === '*' && hourF === '*' && domF === '*' && monF === '*' && dowF === '*') {
    return t('schedule_every_minute', { ns: 'settings' });
  }

  // Try to extract a single HH:MM time
  const min = Number(minF);
  const hour = Number(hourF);
  const hasSimpleTime = Number.isInteger(min) && Number.isInteger(hour)
    && min >= 0 && min <= 59 && hour >= 0 && hour <= 23;

  if (hasSimpleTime) {
    const time = `${pad2(hour)}:${pad2(min)}`;

    // Daily: M H * * *
    if (domF === '*' && monF === '*' && dowF === '*') {
      return t('schedule_daily_at', { ns: 'settings', time });
    }

    // Weekly single day: M H * * D (D is a single digit)
    if (domF === '*' && monF === '*' && /^[0-7]$/.test(dowF)) {
      const weekday = translateWeekday(Number(dowF), t);
      return t('schedule_weekday_at', { ns: 'settings', weekday, time });
    }

    // Weekly multi-day: M H * * 1,3,5
    if (domF === '*' && monF === '*' && /^[0-7](,[0-7])+$/.test(dowF)) {
      const days = dowF.split(',').map((d) => translateWeekday(Number(d), t));
      const weekday = days.join(', ');
      return t('schedule_weekday_at', { ns: 'settings', weekday, time });
    }

    // A visual weekly schedule may select several independent weekdays.
    if (domF === '*' && monF === '*' && /^[0-7](?:,[0-7])+$/.test(dowF)) {
      const weekday = [...new Set(dowF.split(',').map(day => Number(day) % 7))]
        .map(day => translateWeekday(day, t)).join(', ');
      return t('schedule_weekday_at', { ns: 'settings', weekday, time });
    }

    // Weekday range: M H * * 1-5
    if (domF === '*' && monF === '*' && /^[0-7]-[0-7]$/.test(dowF)) {
      const [start, end] = dowF.split('-').map(Number);
      const startDay = translateWeekday(start, t);
      const endDay = translateWeekday(end, t);
      const weekday = `${startDay}–${endDay}`;
      return t('schedule_weekday_at', { ns: 'settings', weekday, time });
    }
  }

  // Fallback: use the English describeCronExpression
  const { valid, description } = describeCronExpression(expr);
  return valid ? description : expr;
}

export function formatRunStatusSymbol(status?: CronRunStatus): string {
  if (status === 'ok') return '✓';
  if (status === 'error') return '✗';
  if (status === 'skipped') return '⊘';
  return '—';
}

export function formatDurationMs(durationMs?: number): string {
  if (durationMs === undefined || !Number.isFinite(durationMs)) return '—';
  if (durationMs >= SECOND_MS) return `${(durationMs / SECOND_MS).toFixed(1)}s`;
  return `${Math.round(durationMs)}ms`;
}

export function formatTimestamp(ms?: number): string {
  if (ms === undefined || !Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString();
}

export function truncateText(text: string, max = 140): string {
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

// ---------------------------------------------------------------------------
// Cron expression description & validation
// ---------------------------------------------------------------------------

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type ParsedField = {
  kind: 'wildcard';
} | {
  kind: 'step';
  base: 'wildcard' | { start: number; end: number };
  step: number;
} | {
  kind: 'list';
  values: number[];
} | {
  kind: 'range';
  start: number;
  end: number;
};

function parseField(field: string, min: number, max: number, name: string): ParsedField | string {
  // Wildcard
  if (field === '*') return { kind: 'wildcard' };

  // Step: */n or start-end/n
  if (field.includes('/')) {
    const [basePart, stepPart] = field.split('/');
    const step = Number(stepPart);
    if (!Number.isInteger(step) || step <= 0) return `${name}: invalid step value "${stepPart}"`;
    if (basePart === '*') {
      return { kind: 'step', base: 'wildcard', step };
    }
    if (basePart.includes('-')) {
      const [s, e] = basePart.split('-').map(Number);
      if (!Number.isInteger(s) || !Number.isInteger(e)) return `${name}: invalid range "${basePart}"`;
      if (s < min || s > max || e < min || e > max) return `${name} must be ${min}\u2013${max}`;
      return { kind: 'step', base: { start: s, end: e }, step };
    }
    return `${name}: invalid step base "${basePart}"`;
  }

  // List: 1,3,5
  if (field.includes(',')) {
    const parts = field.split(',');
    const values: number[] = [];
    for (const p of parts) {
      const n = Number(p);
      if (!Number.isInteger(n)) return `${name}: invalid value "${p}"`;
      if (n < min || n > max) return `${name} must be ${min}\u2013${max}`;
      values.push(n);
    }
    return { kind: 'list', values };
  }

  // Range: 1-5
  if (field.includes('-')) {
    const [s, e] = field.split('-').map(Number);
    if (!Number.isInteger(s) || !Number.isInteger(e)) return `${name}: invalid range "${field}"`;
    if (s < min || s > max || e < min || e > max) return `${name} must be ${min}\u2013${max}`;
    return { kind: 'range', start: s, end: e };
  }

  // Single number
  const n = Number(field);
  if (!Number.isInteger(n)) return `${name}: invalid value "${field}"`;
  if (n < min || n > max) return `${name} must be ${min}\u2013${max}`;
  return { kind: 'list', values: [n] };
}

function describeMinuteHour(minute: ParsedField, hour: ParsedField): string {
  const mWild = minute.kind === 'wildcard';
  const hWild = hour.kind === 'wildcard';

  // Every minute
  if (mWild && hWild) return 'Every minute';

  // Step on minute, wildcard hour
  if (minute.kind === 'step' && minute.base === 'wildcard' && hWild) {
    return `Every ${minute.step} minutes`;
  }

  // Specific minute + specific hour → "At HH:MM"
  if (minute.kind === 'list' && minute.values.length === 1 &&
      hour.kind === 'list' && hour.values.length === 1) {
    const mm = String(minute.values[0]).padStart(2, '0');
    const hh = String(hour.values[0]).padStart(2, '0');
    return `At ${hh}:${mm}`;
  }

  // Specific minute + hour list → "At minute MM, at HH and HH"
  if (minute.kind === 'list' && minute.values.length === 1 && hour.kind === 'list') {
    const mm = String(minute.values[0]).padStart(2, '0');
    const hours = hour.values.map((h) => String(h).padStart(2, '0'));
    return `At minute ${mm}, at ${hours.join(' and ')}`;
  }

  // Specific minute + hour range
  if (minute.kind === 'list' && minute.values.length === 1 && hour.kind === 'range') {
    const mm = String(minute.values[0]).padStart(2, '0');
    return `At minute ${mm}, ${String(hour.start).padStart(2, '0')} through ${String(hour.end).padStart(2, '0')}`;
  }

  // Step on minute, specific hour
  if (minute.kind === 'step' && minute.base === 'wildcard' && hour.kind === 'list') {
    const hours = hour.values.map((h) => String(h).padStart(2, '0'));
    return `Every ${minute.step} minutes, at hour ${hours.join(' and ')}`;
  }

  // Wildcard minute, specific hour
  if (mWild && hour.kind === 'list') {
    const hours = hour.values.map((h) => String(h).padStart(2, '0'));
    return `Every minute, at hour ${hours.join(' and ')}`;
  }

  // Fallback: build generic phrases
  const mPart = describeFieldGeneric(minute, 'minute');
  const hPart = describeFieldGeneric(hour, 'hour');
  return `${mPart}, ${hPart}`;
}

function describeFieldGeneric(field: ParsedField, label: string): string {
  if (field.kind === 'wildcard') return `every ${label}`;
  if (field.kind === 'step') {
    if (field.base === 'wildcard') return `every ${field.step} ${label}s`;
    return `every ${field.step} ${label}s from ${field.base.start} through ${field.base.end}`;
  }
  if (field.kind === 'range') return `${label} ${field.start} through ${field.end}`;
  return `${label} ${field.values.join(', ')}`;
}

function describeDom(dom: ParsedField): string | null {
  if (dom.kind === 'wildcard') return null;
  if (dom.kind === 'list' && dom.values.length === 1) return `on day ${dom.values[0]} of every month`;
  if (dom.kind === 'list') return `on days ${dom.values.join(', ')} of every month`;
  if (dom.kind === 'range') return `on days ${dom.start} through ${dom.end} of every month`;
  if (dom.kind === 'step') {
    if (dom.base === 'wildcard') return `every ${dom.step} days`;
    return `every ${dom.step} days from ${dom.base.start} through ${dom.base.end}`;
  }
  return null;
}

function describeMonth(month: ParsedField): string | null {
  if (month.kind === 'wildcard') return null;
  if (month.kind === 'list') {
    const names = month.values.map((v) => MONTH_NAMES[v - 1]);
    return `in ${names.join(' and ')}`;
  }
  if (month.kind === 'range') {
    return `${MONTH_NAMES[month.start - 1]} through ${MONTH_NAMES[month.end - 1]}`;
  }
  if (month.kind === 'step') return describeFieldGeneric(month, 'month');
  return null;
}

function normalizeDow(n: number): number {
  return n === 7 ? 0 : n;
}

function describeDow(dow: ParsedField): string | null {
  if (dow.kind === 'wildcard') return null;
  if (dow.kind === 'list') {
    const names = dow.values.map((v) => DOW_NAMES[normalizeDow(v)]);
    return names.join(' and ');
  }
  if (dow.kind === 'range') {
    return `${DOW_NAMES[normalizeDow(dow.start)]} through ${DOW_NAMES[normalizeDow(dow.end)]}`;
  }
  if (dow.kind === 'step') return describeFieldGeneric(dow, 'day-of-week');
  return null;
}

export function describeCronExpression(expr: string): { valid: boolean; description: string } {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return { valid: false, description: `Expected 5 fields, got ${fields.length}` };
  }

  const minute = parseField(fields[0], 0, 59, 'Minute');
  if (typeof minute === 'string') return { valid: false, description: minute };

  const hour = parseField(fields[1], 0, 23, 'Hour');
  if (typeof hour === 'string') return { valid: false, description: hour };

  const dom = parseField(fields[2], 1, 31, 'Day-of-month');
  if (typeof dom === 'string') return { valid: false, description: dom };

  const month = parseField(fields[3], 1, 12, 'Month');
  if (typeof month === 'string') return { valid: false, description: month };

  const dow = parseField(fields[4], 0, 7, 'Day-of-week');
  if (typeof dow === 'string') return { valid: false, description: dow };

  const parts: string[] = [];

  // Time part
  const timePart = describeMinuteHour(minute, hour);
  parts.push(timePart);

  // Day-of-month
  const domPart = describeDom(dom);
  if (domPart) parts.push(domPart);

  // Month
  const monthPart = describeMonth(month);
  if (monthPart) parts.push(monthPart);

  // Day-of-week
  const dowPart = describeDow(dow);
  if (dowPart) parts.push(dowPart);

  // If only time part and nothing else specific, add "every day" for non-every-minute
  if (parts.length === 1 && timePart !== 'Every minute' && !timePart.startsWith('Every ')) {
    parts.push('every day');
  }

  return { valid: true, description: parts.join(', ') };
}
