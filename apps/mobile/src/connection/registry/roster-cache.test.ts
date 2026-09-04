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

describe('RosterCache', () => {
  it('round-trips a credential-free tier-zero snapshot through StorageService primitives', async () => {
    const storage = new MemoryCacheStorage();
    const cache = new RosterCache({ storage, now: () => 500 });
    const agents = [{ ...agent('connection-1', 'main'), emoji: '🪽' }];
    const sessions = [session('connection-1', 'main', 'main:main', 100, {
      preview: 'Latest answer',
      source: 'native',
    })];

    const saved = await cache.set('connection-1', agents, sessions, 'ready');
    const loaded = await cache.get('connection-1');

    expect(saved).toEqual(loaded);
    expect(loaded).toMatchObject({
      connectionId: 'connection-1',
      savedAt: 500,
      connectionStateAtSave: 'ready',
      agents: [{ agentId: 'main', emoji: '🪽' }],
      sessions: [{ key: 'main:main', preview: 'Latest answer', source: 'native' }],
    });
    expect(JSON.stringify([...storage.entries.values()])).not.toMatch(/token|password|bootstrap/i);
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
});

describe('aggregateRoster', () => {
  it('sorts connection groups by attention, unread, and activity while keeping each group adjacent', () => {
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

    expect(groups.map((group) => group.connection.id)).toEqual(['b', 'a', 'c']);
    expect(groups[0]).toMatchObject({ attentionCount: 1, unreadCount: 0, source: 'cache' });
    expect(groups[1].agents.map((entry) => entry.agent.agentId)).toEqual(['main', 'quiet']);
    expect(groups[1].agents[0]).toMatchObject({
      preview: 'unread main',
      updatedAt: 200,
      lastActivityAt: 600,
      unreadCount: 1,
      hasUnread: true,
    });
    expect(groups[2].unreadCount).toBe(0);
    expect(flattenRoster(groups).map((entry) => entry.agent.connectionId)).toEqual(['b', 'a', 'a', 'c']);
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
