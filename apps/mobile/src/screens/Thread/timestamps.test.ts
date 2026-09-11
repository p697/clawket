import type { UiMessage } from '../../types/chat';
import { buildThreadTimelineItems, groupThreadTools } from './model';
import { formatThreadTimestamp, THREAD_TIME_GAP_MS } from './timestamps';

const at = (day: number, hour = 12, minute = 0) => new Date(2026, 8, day, hour, minute).getTime();
const message = (id: string, timestampMs?: number, role: UiMessage['role'] = 'assistant'): UiMessage => ({ id, timestampMs, role, text: id });
function rows(messages: UiMessage[]) {
  return buildThreadTimelineItems({ messages: [...messages].reverse(), runs: [], locale: 'zh-Hans', nowMs: at(7), yesterdayLabel: '昨天' }).reverse();
}
function separators(messages: UiMessage[]) {
  return rows(messages).filter((row) => row.type === 'date');
}

describe('Thread time grouping', () => {
  it('marks the first message and exactly three-minute gaps, not continuous activity', () => {
    const start = at(7);
    const items = [message('a', start), message('b', start + 120_000), message('c', start + 240_000), message('d', start + 240_000 + THREAD_TIME_GAP_MS)];
    expect(separators(items).map((row) => row.key)).toEqual(['date:message:a', 'date:message:d']);
    expect(rows(items).map((row) => row.key)).toEqual(['date:message:a', 'message:a', 'message:b', 'message:c', 'date:message:d', 'message:d']);
  });

  it('marks midnight even when less than three minutes have passed', () => {
    expect(separators([message('a', at(6, 23, 59)), message('b', at(7, 0, 0))]).map((row) => row.label)).toEqual(['昨天 23:59', '00:00']);
  });

  it('ignores system and invalid timestamps without inventing message times', () => {
    const items = [message('unknown'), message('a', at(7)), message('system', at(7, 12, 4), 'system'), ...[0, NaN, Infinity, -1, 1e20].map((time, i) => message(`invalid-${i}`, time)), message('b', at(7, 12, 5))];
    expect(separators(items).map((row) => row.key)).toEqual(['date:message:a', 'date:message:b']);
    expect(rows(items).filter((row) => row.type === 'message')).toHaveLength(items.length);
  });

  it('preserves keys across timestamp corrections and pagination', () => {
    const initial = separators([message('a', at(7)), message('b', at(7, 13))]);
    const corrected = separators([message('a', at(7) + 1_000), message('b', at(7, 13))]);
    expect(corrected.map((row) => row.key)).toEqual(initial.map((row) => row.key));
    const paged = rows([message('older', at(6)), message('a', at(7)), message('b', at(7, 13))]);
    expect(paged.slice(-4).map((row) => row.key)).toEqual(rows([message('a', at(7)), message('b', at(7, 13))]).map((row) => row.key));
  });

  it('keeps tool grouping and expansion around time boundaries', () => {
    const timeline = buildThreadTimelineItems({ messages: [message('b', at(7, 12, 1), 'tool'), message('a', at(7), 'tool')], runs: [] });
    expect(groupThreadTools(timeline, new Set()).map((row) => row.key)).toEqual(['tools:a', 'date:message:a']);
    expect(groupThreadTools(timeline, new Set(['tools:a'])).map((row) => row.key)).toEqual(['message:b', 'message:a', 'tools:a', 'date:message:a']);
  });

  it('keeps equal or backwards timestamps in source order', () => {
    expect(separators([message('a', at(7)), message('b', at(7)), message('c', at(7) - 1000)])).toHaveLength(1);
  });
});

describe('Thread local time labels', () => {
  it('uses today, yesterday, weekday, date and year as history ages', () => {
    const label = (time: number) => formatThreadTimestamp(time, 'zh-Hans', at(7), '昨天');
    expect(label(at(7, 8, 5))).toBe('08:05');
    expect(label(at(6, 8, 5))).toBe('昨天 08:05');
    expect(label(at(5, 8, 5))).toBe('星期六 08:05');
    expect(label(new Date(2026, 7, 30, 8, 5).getTime())).toBe('8月30日 08:05');
    expect(label(new Date(2025, 7, 30, 8, 5).getTime())).toBe('2025年8月30日 08:05');
    expect(label(at(8, 8, 5))).toBe('9月8日 08:05');
  });

  it.each(['en', 'zh-Hans', 'ja', 'ko', 'de', 'es'])('uses the %s catalog without RelativeTimeFormat', (locale) => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, 'RelativeTimeFormat')!;
    Object.defineProperty(Intl, 'RelativeTimeFormat', { configurable: true, value: undefined });
    try {
      const yesterday = require(`../../i18n/locales/${locale}/common.json`).Yesterday;
      expect(formatThreadTimestamp(at(6), locale, at(7), yesterday)).toBe(`${yesterday} 12:00`);
      const timeline = buildThreadTimelineItems({ messages: [message('yesterday', at(6))], runs: [], locale, nowMs: at(7), yesterdayLabel: yesterday });
      expect(timeline.find((row) => row.type === 'date')).toMatchObject({ label: `${yesterday} 12:00` });
    } finally {
      Object.defineProperty(Intl, 'RelativeTimeFormat', descriptor);
    }
  });

  it('uses an explicit date if no translated yesterday label is supplied', () => {
    expect(formatThreadTimestamp(at(6), 'zh-Hans', at(7))).toBe('9月6日 12:00');
  });

  it.each([0, NaN, Infinity, -1, 1e20])('rejects invalid dates: %s', (time) => {
    expect(formatThreadTimestamp(time)).toBe('');
  });
});
