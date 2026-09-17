import type {
  AgentDescriptor,
  ConnectionDescriptor,
  SessionDescriptor,
} from '@clawket/agent-protocol';

import type { DashboardCacheEntry } from '../../services/storage';
import {
  RosterCache,
  aggregateRoster,
  flattenRoster,
  type RosterCacheStorage,
} from './roster-cache';

const actions = { rename: true, reset: true, delete: true, pin: true };

function connection(id: string, createdAt: number): ConnectionDescriptor {
  return {
    id,
    backendKind: 'openclaw',
    transportKind: 'relay',
    label: id,
    createdAt,
    isFreeSlot: id === 'a',
  };
}

function agent(connectionId: string, agentId: string): AgentDescriptor {
  return {
    connectionId,
    agentId,
    name: agentId.toUpperCase(),
    isMain: agentId === 'main',
    mainSessionKey: `${agentId}:main`,
  };
}

function session(
  connectionId: string,
  agentId: string,
  key: string,
  updatedAt: number | null,
  patch: Partial<SessionDescriptor> = {},
): SessionDescriptor {
  return {
    connectionId,
    agentId,
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

class MemoryCacheStorage implements RosterCacheStorage {
  readonly entries = new Map<string, DashboardCacheEntry<unknown>>();

  async getDashboardCache<T>(scopeKey: string): Promise<DashboardCacheEntry<T> | null> {
    return (this.entries.get(scopeKey) as DashboardCacheEntry<T> | undefined) ?? null;
  }

  async setDashboardCache<T>(scopeKey: string, entry: DashboardCacheEntry<T>): Promise<void> {
    this.entries.set(scopeKey, entry as DashboardCacheEntry<unknown>);
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('RosterCache', () => {
  it('round-trips a credential-free tier-zero snapshot through StorageService primitives', async () => {
    const storage = new MemoryCacheStorage();
    const cache = new RosterCache({ storage, now: () => 500 });
    const agents = [{ ...agent('connection-1', 'main'), emoji: '🪽' }];
    const sessions = [
      session('connection-1', 'main', 'main:main', 100, {
        preview: 'Latest answer',
        source: 'native',
        lastActivityAt: 80,
      }),
      session('connection-1', 'main', 'main:quiet', 100, { lastActivityAt: null }),
      session('connection-1', 'main', 'main:legacy', 100),
    ];

    const saved = await cache.set('connection-1', agents, sessions, 'ready');
    const loaded = await cache.get('connection-1');

    expect(saved).toEqual(loaded);
    expect(loaded).toMatchObject({
      connectionId: 'connection-1',
      savedAt: 500,
      connectionStateAtSave: 'ready',
      agents: [{ agentId: 'main', emoji: '🪽' }],
      sessions: [
        { key: 'main:main', preview: 'Latest answer', source: 'native', lastActivityAt: 80 },
        { key: 'main:quiet', lastActivityAt: null },
        { key: 'main:legacy' },
      ],
    });
    // A cache written before the field existed must keep meaning "unknown".
    expect(loaded?.sessions[2]).not.toHaveProperty('lastActivityAt');
    expect(JSON.stringify([...storage.entries.values()])).not.toMatch(/token|password|bootstrap/i);
  });

  it('rewrites cached Agents in place without refreshing the save time or state', async () => {
    const storage = new MemoryCacheStorage();
    let now = 500;
    const cache = new RosterCache({ storage, now: () => now });
    await cache.set('connection-1', [agent('connection-1', 'main')], [session('connection-1', 'main', 'main:main', 100)], 'idle');
    now = 900;

    const updated = await cache.updateAgents('connection-1', (agents) => agents.map((entry) => (
      entry.name === 'MAIN' ? { ...entry, name: 'Studio' } : entry
    )));
    expect(updated).toMatchObject({ savedAt: 500, connectionStateAtSave: 'idle', agents: [{ name: 'Studio' }] });
    expect(await cache.get('connection-1')).toEqual(updated);
    expect(await cache.updateAgents('missing', (agents) => agents)).toBeNull();
    await expect(cache.updateAgents('connection-1', () => [agent('other', 'main')]))
      .rejects.toThrow('cross-connection');
    expect((await cache.get('connection-1'))?.agents[0]?.name).toBe('Studio');
  });

  it('rejects a malformed activity timestamp instead of caching it', async () => {
    const cache = new RosterCache({ storage: new MemoryCacheStorage() });

    await expect(cache.set('connection-1', [agent('connection-1', 'main')], [
      session('connection-1', 'main', 'main:main', 100, {
        lastActivityAt: 'yesterday' as unknown as number,
      }),
    ])).rejects.toThrow('cross-connection');
  });

  it('rejects cross-connection or duplicate descriptors instead of poisoning the cache', async () => {
    const cache = new RosterCache({ storage: new MemoryCacheStorage() });

    await expect(cache.set('connection-1', [agent('connection-2', 'main')], [])).rejects.toThrow(
      'cross-connection',
    );
    await expect(cache.set('connection-1', [
      agent('connection-1', 'main'),
      agent('connection-1', 'main'),
    ], [])).rejects.toThrow('cross-connection');
    await expect(cache.set('connection-1', [agent('connection-1', 'main')], [
      session('connection-1', 'main', 'duplicate', 1),
      session('connection-1', 'main', 'duplicate', 2),
    ])).rejects.toThrow('cross-connection');
  });

  it('ignores corrupt payloads and overwrites deleted snapshots with a tombstone', async () => {
    const storage = new MemoryCacheStorage();
    const cache = new RosterCache({ storage, now: () => 200 });
    await cache.set('connection-1', [agent('connection-1', 'main')], [], 'offline');
    await cache.remove('connection-1');
    await expect(cache.get('connection-1')).resolves.toBeNull();

    storage.entries.set('connection-registry:roster-cache:v1:connection-2', {
      version: 2,
      cacheKey: 'connection-registry:roster-cache:v1:connection-2',
      savedAt: 1,
      source: 'network',
      connectionStateAtSave: 'ready',
      data: { version: 1, connectionId: 'connection-2', agents: [{}], sessions: [] },
    });
    await expect(cache.get('connection-2')).resolves.toBeNull();
    await expect(cache.get('')).resolves.toBeNull();
  });

  it('loads multiple existing snapshots without placeholders for missing connections', async () => {
    const storage = new MemoryCacheStorage();
    const cache = new RosterCache({ storage, now: () => 100 });
    await cache.set('a', [agent('a', 'main')], []);
    await cache.set('b', [agent('b', 'main')], []);

    const snapshots = await cache.getMany(['a', 'missing', 'b']);

    expect(snapshots.map((snapshot) => snapshot.connectionId)).toEqual(['a', 'b']);
  });

  it('serializes writes so a newer roster snapshot cannot be overwritten by a slow prior write', async () => {
    const storage = new MemoryCacheStorage();
    const cache = new RosterCache({ storage, now: () => 100 });
    const firstWrite = deferred<void>();
    const originalSet = storage.setDashboardCache.bind(storage);
    const setDashboardCache = jest.spyOn(storage, 'setDashboardCache')
      .mockImplementationOnce(async (scopeKey, entry) => {
        await firstWrite.promise;
        await originalSet(scopeKey, entry);
      })
      .mockImplementation(originalSet);

    const older = cache.set('a', [agent('a', 'main')], [
      session('a', 'main', 'main:main', 10, { preview: 'older' }),
    ]);
    await Promise.resolve();
    const newer = cache.set('a', [agent('a', 'main')], [
      session('a', 'main', 'main:main', 20, { preview: 'newer' }),
    ]);

    expect(setDashboardCache).toHaveBeenCalledTimes(1);
    firstWrite.resolve();
    await Promise.all([older, newer]);

    await expect(cache.get('a')).resolves.toMatchObject({
      sessions: [expect.objectContaining({ updatedAt: 20, preview: 'newer' })],
    });
  });

  it('serializes removal behind an in-flight write so the tombstone remains final', async () => {
    const storage = new MemoryCacheStorage();
    const cache = new RosterCache({ storage, now: () => 100 });
    const firstWrite = deferred<void>();
    const originalSet = storage.setDashboardCache.bind(storage);
    const setDashboardCache = jest.spyOn(storage, 'setDashboardCache')
      .mockImplementationOnce(async (scopeKey, entry) => {
        await firstWrite.promise;
        await originalSet(scopeKey, entry);
      })
      .mockImplementation(originalSet);

    const write = cache.set('a', [agent('a', 'main')], [
      session('a', 'main', 'main:main', 10),
    ]);
    await Promise.resolve();
    const removal = cache.remove('a');

    expect(setDashboardCache).toHaveBeenCalledTimes(1);
    firstWrite.resolve();
    await Promise.all([write, removal]);

    expect(setDashboardCache).toHaveBeenCalledTimes(2);
    await expect(cache.get('a')).resolves.toBeNull();
  });
});

describe('aggregateRoster', () => {
  it('orders groups and Agents by human activity only, keeping unread and attention as badges', () => {
    const groups = aggregateRoster([
      {
        connection: connection('a', 1),
        source: 'live',
        syncedAt: 100,
        agents: [agent('a', 'quiet'), agent('a', 'main')],
        sessions: [
          session('a', 'quiet', 'quiet:main', 500, { preview: 'quiet but recent' }),
          session('a', 'main', 'main:main', 200, { preview: 'unread main' }),
          session('a', 'main', 'main:channel', 600, { kind: 'channel', preview: 'recent channel' }),
        ],
        watermarks: {
          'quiet:main': 500,
          'main:main': 100,
          'main:channel': 600,
        },
      },
      {
        connection: connection('b', 2),
        source: 'cache',
        syncedAt: 90,
        agents: [agent('b', 'main')],
        sessions: [session('b', 'main', 'main:main', 10, { attention: 'cron_failed' })],
        watermarks: {},
      },
      {
        connection: connection('c', 3),
        source: 'cache',
        syncedAt: 80,
        agents: [agent('c', 'main')],
        sessions: [session('c', 'main', 'main:main', 1_000)],
        watermarks: {},
      },
    ], 'a');

    // `c` is the most recent even though `a` holds the only unread session.
    expect(groups.map((group) => group.connection.id)).toEqual(['c', 'a', 'b']);
    expect(groups[1].agents.map((entry) => entry.agent.agentId)).toEqual(['main', 'quiet']);
    expect(groups[1].agents[0]).toMatchObject({
      preview: 'unread main',
      lastActivityAt: 600,
      unreadCount: 1,
      hasUnread: true,
    });
    expect(groups[1].agents[0].unreadSessionKeys).toEqual(expect.arrayContaining(['main:main']));
    expect(groups[0].agents[0].unreadSessionKeys).toEqual([]);
    expect(groups[2].unreadCount).toBe(0);
    expect(groups[0]).toMatchObject({
      attentionCount: 0,
      unreadCount: 0,
      source: 'cache',
    });
    expect(groups[2].agents[0]).toMatchObject({ attentionCount: 0, attention: null });
    expect(flattenRoster(groups).map((entry) => entry.agent.connectionId)).toEqual(['c', 'a', 'a', 'b']);
  });

  it('does not move or unread-mark an Agent whose record was only touched by housekeeping', () => {
    const build = (mainUpdatedAt: number) => aggregateRoster([{
      connection: connection('a', 1),
      source: 'live',
      syncedAt: 100,
      agents: [agent('a', 'main'), agent('a', 'other')],
      sessions: [
        // Heartbeat polls move `updatedAt` but never `lastActivityAt`.
        session('a', 'main', 'main:main', mainUpdatedAt, { lastActivityAt: 300 }),
        session('a', 'other', 'other:main', 400, { lastActivityAt: 400 }),
      ],
      watermarks: { 'main:main': 300, 'other:main': 400 },
    }], 'a');

    const before = build(300);
    const afterHeartbeat = build(9_000);

    expect(afterHeartbeat[0].agents.map((entry) => entry.agent.agentId)).toEqual(['other', 'main']);
    expect(afterHeartbeat[0].agents.map((entry) => entry.agent.agentId))
      .toEqual(before[0].agents.map((entry) => entry.agent.agentId));
    expect(afterHeartbeat[0].agents[1]).toMatchObject({ lastActivityAt: 300, hasUnread: false, unreadCount: 0 });
    expect(afterHeartbeat[0].lastActivityAt).toBe(400);
  });

  it('counts only sessions a person takes part in as activity', () => {
    const groups = aggregateRoster([{
      connection: connection('a', 1),
      source: 'live',
      syncedAt: 100,
      agents: [agent('a', 'busy'), agent('a', 'chatty')],
      sessions: [
        session('a', 'busy', 'busy:main', 100),
        session('a', 'busy', 'busy:cron', 5_000, { kind: 'cron' }),
        session('a', 'busy', 'busy:sub', 6_000, { kind: 'subagent' }),
        session('a', 'chatty', 'chatty:main', 200),
        session('a', 'chatty', 'chatty:dm', 250, { kind: 'direct' }),
      ],
      watermarks: {},
    }], 'a');

    expect(groups[0].agents.map((entry) => entry.agent.agentId)).toEqual(['chatty', 'busy']);
    expect(groups[0].agents.map((entry) => entry.lastActivityAt)).toEqual([250, 100]);
  });

  it('keeps the same order whether a group is live or cached', () => {
    const inputs = (source: 'live' | 'cache') => [{
      connection: connection('a', 1),
      source,
      syncedAt: 100,
      agents: [agent('a', 'read'), agent('a', 'unread')],
      sessions: [
        session('a', 'read', 'read:main', 900),
        session('a', 'unread', 'unread:main', 100),
      ],
      watermarks: { 'read:main': 900 },
    }];

    const order = (source: 'live' | 'cache') => aggregateRoster(inputs(source), 'a')[0].agents
      .map((entry) => entry.agent.agentId);

    expect(order('live')).toEqual(['read', 'unread']);
    expect(order('cache')).toEqual(order('live'));
  });

  it('adds backend subtitle metadata at the registry boundary', () => {
    const youmindConnection: ConnectionDescriptor = {
      ...connection('sprite', 1),
      backendKind: 'youmind',
      transportKind: 'https',
    };
    const groups = aggregateRoster([{
      connection: youmindConnection,
      source: 'live',
      syncedAt: 100,
      agents: [agent('sprite', 'main')],
      sessions: [session('sprite', 'main', 'main:main', 100)],
    }], 'sprite');

    expect(groups[0].agents[0].subtitle).toEqual({ kind: 'backend', label: 'YouMind' });
  });

  it('suppresses unread for a cached active connection and ignores cross-connection live rows', () => {
    const groups = aggregateRoster([{
      connection: connection('a', 1),
      source: 'cache',
      syncedAt: 1,
      agents: [agent('a', 'main'), agent('other', 'leak')],
      sessions: [
        session('a', 'main', 'main:main', 100),
        session('other', 'main', 'foreign', 200, { attention: 'approval' }),
      ],
      watermarks: {},
    }], 'a');

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ unreadCount: 0, attentionCount: 0 });
    expect(groups[0].agents.map((entry) => entry.agent.agentId)).toEqual(['main']);
  });
});

it.each(['openclaw', 'hermes', 'youmind'] as const)('counts only canonical main-chat unread for %s', (backendKind) => {
  const input = {
    connection: { ...connection('a', 1), backendKind },
    source: 'live' as const,
    syncedAt: 200,
    agents: [agent('a', 'main')],
    sessions: [
      session('a', 'main', 'main:main', 100),
      ...Array.from({ length: 120 }, (_, i) => session('a', 'main', `channel:${i}`, 200, { kind: 'channel' })),
      session('a', 'main', 'cron', 200, { kind: 'cron', attention: 'cron_failed' }),
    ],
    watermarks: {},
  };
  expect(aggregateRoster([input], 'a')[0].agents[0]).toMatchObject({ unreadCount: 1, attentionCount: 1 });
  expect(aggregateRoster([{ ...input, watermarks: { 'main:main': 100 } }], 'a')[0].agents[0])
    .toMatchObject({ unreadCount: 0, attentionCount: 1 });
  expect(aggregateRoster([{ ...input, sessions: input.sessions.filter((entry) => entry.key !== 'main:main') }], 'a')[0].agents[0].unreadCount).toBe(0);
});
