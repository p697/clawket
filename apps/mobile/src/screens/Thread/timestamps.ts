/** YouMind-style quiet time groups; all values are local-device milliseconds. */
export const THREAD_TIME_GAP_MS = 3 * 60_000;

const formatters = new Map<string, Intl.DateTimeFormat>();
function format(date: Date, locale: string | undefined, variant: string, options: Intl.DateTimeFormatOptions): string {
  const key = `${locale || ''}:${variant}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale || undefined, options);
    formatters.set(key, formatter);
  }
  return formatter.format(date);
}

export function localDayNumber(timestamp: number): number {
  const date = new Date(timestamp);
  // Calendar arithmetic, so DST days need not contain exactly 24 hours.
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

export function formatThreadTimestamp(timestamp: number, locale?: string, nowMs = Date.now(), yesterdayLabel?: string): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0 || !Number.isFinite(new Date(timestamp).getTime())) return '';
  const date = new Date(timestamp);
  const now = new Date(nowMs);
  const days = localDayNumber(nowMs) - localDayNumber(timestamp);
  const time = format(date, locale, 'clock', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  if (days === 0) return time;
  // Hermes on supported devices may omit Intl.RelativeTimeFormat entirely.
  // The view supplies the existing i18next translation; otherwise use a date.
  if (days === 1 && yesterdayLabel) return `${yesterdayLabel} ${time}`;
  if (days > 1 && days < 7 && date.getFullYear() === now.getFullYear()) {
    return `${format(date, locale, 'weekday', { weekday: 'long' })} ${time}`;
  }
  const withYear = date.getFullYear() !== now.getFullYear();
  return `${format(date, locale, withYear ? 'date-year' : 'date', {
    ...(withYear ? { year: 'numeric' } : {}), month: 'long', day: 'numeric',
  })} ${time}`;
}

/** Clock label for a bubble; shares the separator formatter cache and its 24-hour cycle. */
export function formatThreadClockTime(timestamp: number | null | undefined, locale?: string): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0 || !Number.isFinite(new Date(timestamp).getTime())) return '';
  return format(new Date(timestamp), locale, 'clock', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}
