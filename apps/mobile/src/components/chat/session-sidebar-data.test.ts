import { buildChannelOptions, buildSidebarSessionItems } from './session-sidebar-data';
import { CachedSessionMeta } from '../../services/chat-cache';
import { SessionInfo } from '../../types';

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    key: 'agent:main:main',
    updatedAt: 100,
    ...overrides,
  };
}

function makeCached(overrides: Partial<CachedSessionMeta> = {}): CachedSessionMeta {
  return {
    storageKey: 'cache:1',
    gatewayConfigId: 'gw1',
    agentId: 'agentA',
    sessionKey: 'agent:agentA:main',
    messageCount: 1,
    updatedAt: 100,
    ...overrides,
  };
}

describe('buildSidebarSessionItems', () => {
  it('merges remote sessions with cached fallback preview', () => {
    const sessions = [
      makeSession({ key: 'agent:agentA:main', updatedAt: 100 }),
    ];
    const cached = [
      makeCached({ sessionKey: 'agent:agentA:main', lastMessagePreview: 'Cached preview', lastMessageMs: 120 }),
    ];

    const result = buildSidebarSessionItems({
      sessions,
      cachedSessions: cached,
      currentAgentId: 'agentA',
      activeTab: 'sessions',
      activeChannel: 'all',
      searchText: '',
      pinnedSessionKeys: [],
    });

    expect(result[0]).toMatchObject({
      key: 'agent:agentA:main',
      previewText: 'Cached preview',
      sortUpdatedAt: 120,
      localOnly: false,
    });
  });

  it('includes cached-only sessions for the current agent', () => {
    const cached = [
      makeCached({ sessionKey: 'agent:agentA:telegram:123', lastMessagePreview: 'Offline copy', lastMessageMs: 150 }),
    ];

    const result = buildSidebarSessionItems({
      sessions: [],
      cachedSessions: cached,
      currentAgentId: 'agentA',
      activeTab: 'sessions',
      activeChannel: 'all',
      searchText: '',
      pinnedSessionKeys: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      key: 'agent:agentA:telegram:123',
      localOnly: true,
      previewText: 'Offline copy',
    });
  });

  it('sorts pinned sessions before recency', () => {
    const sessions = [
      makeSession({ key: 'agent:agentA:main', updatedAt: 100 }),
      makeSession({ key: 'agent:agentA:telegram:1', updatedAt: 200 }),
    ];

    const result = buildSidebarSessionItems({
      sessions,
      cachedSessions: [],
      currentAgentId: 'agentA',
      activeTab: 'sessions',
      activeChannel: 'all',
      searchText: '',
      pinnedSessionKeys: ['agent:agentA:main'],
    });

    expect(result.map((item) => item.key)).toEqual(['agent:agentA:main', 'agent:agentA:telegram:1']);
  });

  it('filters by active channel and search text', () => {
    const sessions = [
      makeSession({ key: 'agent:agentA:telegram:1', channel: 'telegram', label: 'Ops', updatedAt: 200 }),
      makeSession({ key: 'agent:agentA:discord:1', channel: 'discord', label: 'Builds', updatedAt: 100 }),
    ];

    const result = buildSidebarSessionItems({
      sessions,
      cachedSessions: [],
      currentAgentId: 'agentA',
      activeTab: 'sessions',
      activeChannel: 'telegram',
      searchText: 'ops',
      pinnedSessionKeys: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('agent:agentA:telegram:1');
  });

  it('shows all Hermes sessions when using a backend-scoped main session key', () => {
    const sessions = [
      makeSession({ key: 'main', updatedAt: 200 }),
      makeSession({ key: '20260411_122441_d40735', updatedAt: 100 }),
    ];

    const result = buildSidebarSessionItems({
      sessions,
      cachedSessions: [],
      currentAgentId: 'main',
      mainSessionKey: 'main',
      activeTab: 'sessions',
      activeChannel: 'all',
      searchText: '',
      pinnedSessionKeys: [],
    });

    expect(result.map((item) => item.key)).toEqual(['main', '20260411_122441_d40735']);
  });
});

describe('buildChannelOptions', () => {
  it('builds an all option plus ordered channel counts', () => {
    const items = buildSidebarSessionItems({
      sessions: [
        makeSession({ key: 'agent:agentA:telegram:1', channel: 'telegram' }),
        makeSession({ key: 'agent:agentA:discord:1', channel: 'discord' }),
      ],
      cachedSessions: [],
      currentAgentId: 'agentA',
      activeTab: 'sessions',
      activeChannel: 'all',
      searchText: '',
      pinnedSessionKeys: [],
    });

    expect(buildChannelOptions(items, { allLabel: 'Alle' })).toEqual([
      { key: 'all', label: 'Alle', count: 2 },
      { key: 'telegram', label: 'Telegram', count: 1 },
      { key: 'discord', label: 'Discord', count: 1 },
    ]);
  });
});
