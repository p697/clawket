import { formatConsoleHeartbeatAge, heartbeatMinutesAgo, parseLastHeartbeat } from './console-heartbeat';

describe('formatConsoleHeartbeatAge', () => {
  it('keeps existing localized keys for locales that do not need compact formatting', () => {
    expect(formatConsoleHeartbeatAge(28, 'en')).toEqual({
      key: '{{count}}m ago',
      count: 28,
    });
    expect(formatConsoleHeartbeatAge(135, 'zh-Hans')).toEqual({
      key: '{{count}}h ago',
      count: 2,
    });
  });

  it('returns compact text for Spanish locales', () => {
    expect(formatConsoleHeartbeatAge(28, 'es')).toEqual({
      key: '{{count}}m ago',
      count: 28,
      compactText: '28 m',
    });
    expect(formatConsoleHeartbeatAge(135, 'es-ES')).toEqual({
      key: '{{count}}h ago',
      count: 2,
      compactText: '2 h',
    });
  });

  it('returns compact text for German locales', () => {
    expect(formatConsoleHeartbeatAge(28, 'de')).toEqual({
      key: '{{count}}m ago',
      count: 28,
      compactText: '28 m',
    });
    expect(formatConsoleHeartbeatAge(1440, 'de-DE')).toEqual({
      key: '{{count}}d ago',
      count: 1,
      compactText: '1 d',
    });
  });

  it('preserves just-now behavior across locales', () => {
    expect(formatConsoleHeartbeatAge(0, 'es')).toEqual({ key: 'just now' });
    expect(formatConsoleHeartbeatAge(0, 'de')).toEqual({ key: 'just now' });
    expect(formatConsoleHeartbeatAge(0, 'en')).toEqual({ key: 'just now' });
  });
});

describe('parseLastHeartbeat', () => {
  it('accepts the timestamp field names Gateways have used', () => {
    expect(parseLastHeartbeat({ lastHeartbeatAt: 1_700_000_000_000 })).toEqual({ lastHeartbeatAt: 1_700_000_000_000 });
    expect(parseLastHeartbeat({ ts: 1_700_000_000_001 })).toEqual({ lastHeartbeatAt: 1_700_000_000_001 });
    expect(parseLastHeartbeat({ timestamp: 1_700_000_000_002 })).toEqual({ lastHeartbeatAt: 1_700_000_000_002 });
  });

  it('counts only completed heartbeat turns as activity', () => {
    expect(parseLastHeartbeat({ ts: 1_700_000_000_000, status: 'sent' })).toEqual({ lastHeartbeatAt: 1_700_000_000_000 });
    expect(parseLastHeartbeat({ ts: 1_700_000_000_000, status: 'ok-empty' })).toEqual({ lastHeartbeatAt: 1_700_000_000_000 });
    expect(parseLastHeartbeat({ ts: 1_700_000_000_000, status: 'ok-token' })).toEqual({ lastHeartbeatAt: 1_700_000_000_000 });
    expect(parseLastHeartbeat({ ts: 1_700_000_000_000, status: 'skipped', reason: 'alerts-disabled' })).toEqual({ lastHeartbeatAt: null });
    expect(parseLastHeartbeat({ ts: 1_700_000_000_000, status: 'failed' })).toEqual({ lastHeartbeatAt: null });
  });

  it('treats missing, malformed or non-positive payloads as no heartbeat', () => {
    expect(parseLastHeartbeat(null)).toEqual({ lastHeartbeatAt: null });
    expect(parseLastHeartbeat('later')).toEqual({ lastHeartbeatAt: null });
    expect(parseLastHeartbeat({ ts: '1700000000000' })).toEqual({ lastHeartbeatAt: null });
    expect(parseLastHeartbeat({ ts: 0 })).toEqual({ lastHeartbeatAt: null });
    expect(parseLastHeartbeat({ ts: Number.NaN })).toEqual({ lastHeartbeatAt: null });
  });
});

describe('heartbeatMinutesAgo', () => {
  it('floors whole minutes and never returns a negative age', () => {
    const now = 1_700_000_000_000;
    expect(heartbeatMinutesAgo(now - 19 * 60_000 - 30_000, now)).toBe(19);
    expect(heartbeatMinutesAgo(now + 5_000, now)).toBe(0);
    expect(heartbeatMinutesAgo(null, now)).toBeNull();
    expect(heartbeatMinutesAgo(undefined, now)).toBeNull();
    expect(heartbeatMinutesAgo(0, now)).toBeNull();
  });
});
