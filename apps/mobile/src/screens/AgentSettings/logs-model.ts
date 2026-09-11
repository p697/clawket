export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type LogEntry = Readonly<{
  raw: string;
  time?: string | null;
  level?: LogLevel | null;
  subsystem?: string | null;
  message?: string | null;
}>;

export type LogLevelFilters = Readonly<Record<LogLevel, boolean>>;

export const LOG_LEVELS = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
] as const satisfies ReadonlyArray<LogLevel>;

const LEVELS_SET = new Set<string>(LOG_LEVELS);

export function createDefaultLogLevelFilters(): LogLevelFilters {
  return {
    trace: true,
    debug: true,
    info: true,
    warn: true,
    error: true,
    fatal: true,
  };
}

export function parseLogLine(line: string): LogEntry {
  if (!line.trim()) return { raw: line, message: line };
  try {
    const object = JSON.parse(line) as Record<string, unknown>;
    const meta = object._meta && typeof object._meta === 'object'
      ? object._meta as Record<string, unknown>
      : null;
    const time = typeof object.time === 'string'
      ? object.time
      : typeof meta?.date === 'string'
        ? meta.date
        : null;
    const level = normalizeLevel(meta?.logLevelName ?? meta?.level);
    const contextCandidate = typeof object['0'] === 'string'
      ? object['0']
      : typeof meta?.name === 'string'
        ? meta.name
        : null;
    const context = parseMaybeJson(contextCandidate);
    let subsystem = context && typeof context.subsystem === 'string'
      ? context.subsystem
      : context && typeof context.module === 'string'
        ? context.module
        : null;
    if (!subsystem && contextCandidate && contextCandidate.length < 120) {
      subsystem = contextCandidate;
    }
    const message = typeof object['1'] === 'string'
      ? object['1']
      : !context && typeof object['0'] === 'string'
        ? object['0']
        : typeof object.message === 'string'
          ? object.message
          : line;
    return { raw: line, time, level, subsystem, message };
  } catch {
    return { raw: line, message: line };
  }
}

export function mergeLogLines(
  current: ReadonlyArray<LogEntry>,
  lines: ReadonlyArray<string>,
  reset: boolean,
  limit: number,
): ReadonlyArray<LogEntry> {
  const incoming = lines.map(parseLogLine);
  const combined = reset ? incoming : [...current, ...incoming];
  return combined.length > limit ? combined.slice(-limit) : combined;
}

export function filterLogEntries(
  entries: ReadonlyArray<LogEntry>,
  query: string,
  levels: LogLevelFilters,
): ReadonlyArray<LogEntry> {
  const normalizedQuery = query.trim().toLowerCase();
  const anyLevelEnabled = LOG_LEVELS.some((level) => levels[level]);
  return entries.filter((entry) => {
    if (entry.level && !levels[entry.level]) return false;
    if (!entry.level && !anyLevelEnabled) return false;
    if (!normalizedQuery) return true;
    return `${entry.message ?? ''}\n${entry.subsystem ?? ''}\n${entry.raw}`
      .toLowerCase()
      .includes(normalizedQuery);
  });
}

export function formatLogTime(value?: string | null): string {
  if (!value) return '--:--:--';
  const direct = value.match(/\d{2}:\d{2}:\d{2}/)?.[0];
  if (direct) return direct;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

function normalizeLevel(value: unknown): LogLevel | null {
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase();
  return LEVELS_SET.has(normalized) ? normalized as LogLevel : null;
}

function parseMaybeJson(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
