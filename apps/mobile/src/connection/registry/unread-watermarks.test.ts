import type { SessionDescriptor } from '@clawket/agent-protocol';

import type { DashboardCacheEntry } from '../../services/storage';
import {
  UnreadWatermarks,
  isSessionUnread,
  summarizeSessionSignals,
  type WatermarkCacheStorage,
} from './unread-watermarks';

const actions = { rename: true, reset: true, delete: true, pin: true };

function session(
  key: string,
  updatedAt: number | null,
  patch: Partial<SessionDescriptor> = {},
): SessionDescriptor {
  return {
    connectionId: 'connection-1',
    agentId: 'main',
    key,
    kind: 'main',
    title: key,
    updatedAt,
    hasActiveRun: false,
    attention: null,
    allowedActions: actions,
    ...patch,
  };
}

class MemoryCacheStorage implements WatermarkCacheStorage {
  readonly entries = new Map<string, DashboardCacheEntry<unknown>>();

  async getDashboardCache<T>(scopeKey: string): Promise<DashboardCacheEntry<T> | null> {
    return (this.entries.get(scopeKey) as DashboardCacheEntry<T> | undefined) ?? null;
  }

  async setDashboardCache<T>(scopeKey: string, entry: DashboardCacheEntry<T>): Promise<void> {
    this.entries.set(scopeKey, entry as DashboardCacheEntry<unknown>);
  }
}

describe('unread session signals', () => {
  it('uses a strict timestamp boundary and disables unread for cached connections', () => {
    expect(isSessionUnread(session('new', 101), { new: 100 })).toBe(true);
    expect(isSessionUnread(session('equal', 100), { equal: 100 })).toBe(false);
    expect(isSessionUnread(session('old', 99), { old: 100 })).toBe(false);
    expect(isSessionUnread(session('missing', null), {})).toBe(false);
    expect(isSessionUnread(session('cached', 101), {}, false)).toBe(false);
  });

  it('does not turn cron or subagent runs into ordinary unread rows', () => {
    expect(isSessionUnread(session('cron', 100, { kind: 'cron' }), {})).toBe(false);
    expect(isSessionUnread(session('subagent', 100, { kind: 'subagent' }), {})).toBe(false);
    expect(isSessionUnread(session('active-main', 100, { hasActiveRun: true }), {})).toBe(true);
  });

  it('reads unread from the human activity clock, not from record housekeeping', () => {
    // A heartbeat poll moved `updatedAt` past the watermark; nobody wrote to the user.
    expect(isSessionUnread(session('heartbeat', 900, { lastActivityAt: 100 }), { heartbeat: 100 })).toBe(false);
    expect(isSessionUnread(session('never', 900, { lastActivityAt: null }), {})).toBe(false);
    expect(isSessionUnread(session('reply', 900, { lastActivityAt: 101 }), { reply: 100 })).toBe(true);
  });

  it('measures lastActivityAt across human sessions only, on the activity clock', () => {
    const summary = summarizeSessionSignals([
      session('main', 900, { lastActivityAt: 100 }),
      session('dm', 50, { kind: 'direct', lastActivityAt: 150 }),
      session('cron', 5_000, { kind: 'cron' }),
      session('sub', 6_000, { kind: 'subagent', lastActivityAt: 7_000 }),
    ], {});

    expect(summary.lastActivityAt).toBe(150);
  });

  it('aggregates unique unread and attention sessions with deterministic priority', () => {
    const summary = summarizeSessionSignals([
      session('ordinary', 40),
      session('cron-failed', 50, { kind: 'cron', attention: 'cron_failed' }),
      session('error', 60, { attention: 'error' }),
      session('approval', 70, { attention: 'approval' }),
      session('approval', 70, { attention: 'approval' }),
      session('unknown-time', null),
    ], { ordinary: 39, error: 60 });

    expect(summary).toEqual({
      unreadCount: 2,
      unreadSessionKeys: ['ordinary', 'approval'],
      attentionCount: 3,
      attentionSessionKeys: ['cron-failed', 'error', 'approval'],
      attention: 'approval',
      lastActivityAt: 70,
    });
  });
});

describe('UnreadWatermarks', () => {
  it('persists monotonic watermarks and serializes concurrent updates', async () => {
    const storage = new MemoryCacheStorage();
    const watermarks = new UnreadWatermarks({ storage, now: () => 500 });

    await Promise.all([
      watermarks.markRead('connection-1', 'first', 100),
      watermarks.markRead('connection-1', 'second', 200),
      watermarks.markRead('connection-1', 'first', 50),
    ]);

    await expect(watermarks.get('connection-1')).resolves.toEqual({
      first: 100,
      second: 200,
    });
    expect([...storage.entries.values()][0]).toMatchObject({
      version: 2,
      savedAt: 500,
      connectionStateAtSave: 'local-watermark',
      data: {
        version: 1,
        connectionId: 'connection-1',
        values: { first: 100, second: 200 },
      },
    });
  });

  it('advances on a successful prompt or opened thread without moving backward', async () => {
    const watermarks = new UnreadWatermarks({
      storage: new MemoryCacheStorage(),
      now: () => 300,
    });
    const current = session('main', 250);

    await watermarks.markPromptSucceeded(current);
    await watermarks.markOpened(current, 275);

    await expect(watermarks.get('connection-1')).resolves.toEqual({ main: 300 });
  });

  it('supports the default timestamp paths for direct, session, prompt, and open advances', async () => {
    const watermarks = new UnreadWatermarks({
      storage: new MemoryCacheStorage(),
      now: () => 400,
    });

    await watermarks.markRead('connection-1', 'direct');
    await watermarks.markSessionRead(session('observed', 250));
    await watermarks.markSessionRead(session('unobserved', null));
    await watermarks.markPromptSucceeded(session('prompt-null', null));
    await watermarks.markOpened(session('open-null', null));
    // The activity clock wins over `updatedAt` when the adapter reports it,
    // including a Gateway clock that runs ahead of the phone.
    await watermarks.markSessionRead(session('activity', 900, { lastActivityAt: 260 }));
    await watermarks.markOpened(session('open-ahead', 900, { lastActivityAt: 450 }));

    await expect(watermarks.get('connection-1')).resolves.toEqual({
      direct: 400,
      observed: 250,
      unobserved: 400,
      'prompt-null': 400,
      'open-null': 400,
      activity: 260,
      'open-ahead': 450,
    });
  });

  it('marks only valid observations from the requested connection', async () => {
    const watermarks = new UnreadWatermarks({ storage: new MemoryCacheStorage() });

    await watermarks.markManyRead('connection-1', [
      session('valid', 10),
      session('null', null),
      session('other', 30, { connectionId: 'connection-2' }),
      session('activity', 40, { lastActivityAt: 20 }),
      session('no-activity', 50, { lastActivityAt: null }),
    ]);

    await expect(watermarks.get('connection-1')).resolves.toEqual({ valid: 10, activity: 20 });
  });

  it('fails closed on corrupt persisted values and clears a connection by overwriting them', async () => {
    const storage = new MemoryCacheStorage();
    storage.entries.set('connection-registry:unread-watermarks:v1:connection-1', {
      version: 2,
      cacheKey: 'connection-registry:unread-watermarks:v1:connection-1',
      savedAt: 1,
      source: 'network',
      connectionStateAtSave: 'local-watermark',
      data: {
        version: 1,
        connectionId: 'connection-1',
        values: { invalid: -1 },
      },
    });
    const watermarks = new UnreadWatermarks({ storage, now: () => 20 });

    await expect(watermarks.get('connection-1')).resolves.toEqual({});
    await watermarks.markRead('connection-1', 'valid', 10);
    await watermarks.clearConnection('connection-1');
    await watermarks.clearConnection('');
    await expect(watermarks.get('connection-1')).resolves.toEqual({});
    await expect(watermarks.markRead('', 'key', 1)).rejects.toThrow();
    await expect(watermarks.markRead('connection-1', 'key', Number.NaN)).rejects.toThrow();
    await expect(watermarks.markManyRead('', [])).rejects.toThrow();

    storage.entries.set('connection-registry:unread-watermarks:v1:wrong-version', {
      version: 2,
      cacheKey: 'connection-registry:unread-watermarks:v1:wrong-version',
      savedAt: 1,
      source: 'network',
      connectionStateAtSave: 'local-watermark',
      data: { version: 2, connectionId: 'wrong-version', values: {} },
    });
    await expect(watermarks.get('wrong-version')).resolves.toEqual({});
  });
});
