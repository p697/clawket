import {
  createDefaultLogLevelFilters,
  filterLogEntries,
  formatLogTime,
  mergeLogLines,
  parseLogLine,
} from './logs-model';

describe('Agent Settings log model', () => {
  it('preserves plain and malformed log lines', () => {
    expect(parseLogLine('')).toEqual({ raw: '', message: '' });
    expect(parseLogLine('plain text log line')).toEqual({
      raw: 'plain text log line',
      message: 'plain text log line',
    });
    expect(parseLogLine('{invalid json}')).toEqual({
      raw: '{invalid json}',
      message: '{invalid json}',
    });
  });

  it('extracts structured metadata, context, and messages', () => {
    const context = JSON.stringify({ subsystem: 'gateway' });
    expect(parseLogLine(JSON.stringify({
      time: '2024-01-15T10:00:00Z',
      _meta: { logLevelName: 'ERROR' },
      '0': context,
      '1': 'request failed',
    }))).toEqual(expect.objectContaining({
      time: '2024-01-15T10:00:00Z',
      level: 'error',
      subsystem: 'gateway',
      message: 'request failed',
    }));
    expect(parseLogLine(JSON.stringify({
      _meta: { date: '2024-01-15T11:00:00Z', level: 'WARN', name: 'bridge' },
      message: 'slow request',
    }))).toEqual(expect.objectContaining({
      time: '2024-01-15T11:00:00Z',
      level: 'warn',
      subsystem: 'bridge',
      message: 'slow request',
    }));
    expect(parseLogLine(JSON.stringify({
      '0': JSON.stringify({ module: 'auth' }),
      '1': 'signed in',
    }))).toEqual(expect.objectContaining({ subsystem: 'auth', message: 'signed in' }));
  });

  it('treats unknown levels and missing messages safely', () => {
    expect(parseLogLine(JSON.stringify({
      _meta: { logLevelName: 'NOTICE' },
      message: 'notice',
    })).level).toBeNull();
    const raw = JSON.stringify({ someKey: 123 });
    expect(parseLogLine(raw).message).toBe(raw);
  });

  it('bounds appended pages and resets when the server rotates the log', () => {
    const first = mergeLogLines([], ['one', 'two'], true, 3);
    expect(first.map((entry) => entry.message)).toEqual(['one', 'two']);
    const appended = mergeLogLines(first, ['three', 'four'], false, 3);
    expect(appended.map((entry) => entry.message)).toEqual(['two', 'three', 'four']);
    expect(mergeLogLines(appended, ['rotated'], true, 3)).toEqual([
      { raw: 'rotated', message: 'rotated' },
    ]);
  });

  it('filters by level and searches message, subsystem, and raw content', () => {
    const entries = [
      parseLogLine(JSON.stringify({
        _meta: { logLevelName: 'INFO', name: 'gateway' },
        message: 'ready',
      })),
      parseLogLine(JSON.stringify({
        _meta: { logLevelName: 'ERROR', name: 'bridge' },
        message: 'closed',
      })),
      parseLogLine('unstructured'),
    ];
    expect(filterLogEntries(entries, 'bridge', createDefaultLogLevelFilters()))
      .toHaveLength(1);
    expect(filterLogEntries(entries, 'ready', {
      ...createDefaultLogLevelFilters(),
      info: false,
    })).toHaveLength(0);
    expect(filterLogEntries(entries, '', {
      trace: false,
      debug: false,
      info: false,
      warn: false,
      error: false,
      fatal: false,
    })).toHaveLength(0);
  });

  it('formats ISO, embedded, absent, and malformed timestamps', () => {
    expect(formatLogTime('2024-01-15T10:20:30Z')).toBe('10:20:30');
    expect(formatLogTime('prefix 12:34:56 suffix')).toBe('12:34:56');
    expect(formatLogTime()).toBe('--:--:--');
    expect(formatLogTime('not a date')).toBe('--:--:--');
  });
});
