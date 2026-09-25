import { resolveCapabilities } from '@clawket/agent-protocol';
import type {
  AgentDescriptor,
  ConnectionDescriptor,
  SessionDescriptor,
} from '@clawket/agent-protocol';
import type { RosterConnectionGroup } from '../../connection';
import type {
  CachedMessage,
  CachedSessionMeta,
} from '../../services/chat-cache';
import type { FavoritedMessage } from '../../services/message-favorites';
import {
  addRecentSearch,
  buildSearchModel,
  normalizeRecentSearches,
  resolveSearchPageState,
  shouldShowSearchFilters,
  splitHighlightSegments,
} from './model';

const actions = { rename: true, reset: true, delete: true, pin: true };

function connection(
  id: string,
  backendKind: ConnectionDescriptor['backendKind'] = 'openclaw',
): ConnectionDescriptor {
  return {
    id,
    backendKind,
    transportKind: ({ openclaw: 'relay', hermes: 'relay', 'local-model': 'relay', pi: 'relay', youmind: 'https' } as const)[backendKind],
    label: id === 'home' ? 'Home server' : 'Travel server',
    createdAt: 1,
    isFreeSlot: true,
  };
}

function agent(connectionId: string, name = 'Launch Agent'): AgentDescriptor {
  return {
    connectionId,
    agentId: 'main',
    name,
    emoji: 'L',
    isMain: true,
    mainSessionKey: 'agent:main:main',
  };
}

function session(
  connectionId: string,
  key: string,
  title: string,
  updatedAt: number,
): SessionDescriptor {
  return {
    connectionId,
    agentId: 'main',
    key,
    kind: key.endsWith(':main') ? 'main' : 'channel',
    title,
    updatedAt,
    preview: 'Launch notes',
    hasActiveRun: false,
    attention: null,
    allowedActions: actions,
  };
}

function rosterGroup(
  descriptor: ConnectionDescriptor,
  source: 'live' | 'cache',
  sessions: ReadonlyArray<SessionDescriptor>,
): RosterConnectionGroup {
  const descriptorAgent = agent(descriptor.id);
  return {
    connection: descriptor,
    source,
    syncedAt: 100,
    agents: [{
      agent: descriptorAgent,
      sessions,
      preview: 'Launch preview',
      lastActivityAt: sessions[0]?.updatedAt ?? null,
      unreadCount: 0,
      hasUnread: false,
      attentionCount: 0,
      attention: null,
    }],
    unreadCount: 0,
    attentionCount: 0,
    lastActivityAt: sessions[0]?.updatedAt ?? null,
  };
}

function cachedMeta(
  connectionId: string,
  key: string,
  updatedAt: number,
): CachedSessionMeta {
  return {
    storageKey: `storage:${connectionId}:${key}`,
    gatewayConfigId: connectionId,
    agentId: 'main',
    agentName: 'Launch Agent',
    sessionKey: key,
    sessionLabel: key.includes('cached') ? 'Cached launch' : 'Launch room',
    messageCount: 1,
    lastMessageMs: updatedAt,
    lastMessagePreview: 'Launch cached preview',
    updatedAt,
  };
}

function cachedMessage(id: string, text: string, timestampMs: number): CachedMessage {
  return { id, role: 'assistant', text, timestampMs };
}

function favorite(connectionId: string): FavoritedMessage {
  return {
    favoriteKey: `favorite:${connectionId}`,
    favoritedAt: 250,
    gatewayConfigId: connectionId,
    agentId: 'main',
    agentName: 'Launch Agent',
    sessionKey: 'agent:main:main',
    sessionLabel: 'Launch room',
    messageId: 'favorite-message',
    role: 'assistant',
    text: 'Favorite launch answer',
    timestampMs: 250,
  };
}

function buildInput() {
  const home = connection('home');
  const travel = connection('travel', 'hermes');
  const homeMain = session('home', 'agent:main:main', 'Launch room', 300);
  const travelMain = session('travel', 'main', 'Launch travel', 200);
  const travelCache = cachedMeta('travel', 'cached:launch', 400);
  return {
    query: 'launch',
    connections: [home, travel],
    roster: [
      rosterGroup(home, 'live', [homeMain]),
      rosterGroup(travel, 'cache', [travelMain]),
    ],
    cachedSessions: [cachedMeta('home', homeMain.key, 350), travelCache],
    messageMatches: [{
      meta: cachedMeta('home', homeMain.key, 350),
      matches: [cachedMessage('message', 'A local launch message', 500)],
    }],
    favorites: [favorite('home')],
    capabilitiesByConnection: {
      home: resolveCapabilities('openclaw'),
      travel: resolveCapabilities('hermes'),
    },
    isPro: true,
  } as const;
}

describe('global Search model', () => {
  it('opens an explicitly created session for free only in its exact connection and Agent scope', () => {
    const input = buildInput();
    const key = 'manual-topic';
    const scoped = { ...input, isPro: false,
      messageMatches: [{ meta: cachedMeta('home', key, 350), matches: [cachedMessage('own', 'launch notes', 500)] }],
      manualSessions: [{ connectionId: 'home', agentId: 'main', key }],
    };
    const result = (value: typeof scoped) => buildSearchModel(value).sections.flatMap((section) => section.results).find((row) => row.kind === 'message');
    expect(result(scoped)).toMatchObject({ text: 'launch notes' });
    expect(result(scoped)?.lockedReason).toBeUndefined();
    expect(result({ ...scoped, manualSessions: [{ connectionId: 'travel', agentId: 'main', key }] })).toMatchObject({ text: '', lockedReason: 'messageHistory' });
    expect(result({ ...scoped, manualSessions: [{ connectionId: 'home', agentId: 'other', key }] })).toMatchObject({ text: '', lockedReason: 'messageHistory' });
  });
  it('keeps non-main search results discoverable without exposing locked excerpts', () => {
    const input = buildInput();
    const otherSession = 'agent:main:slack:channel:one';
    const restricted = {
      ...input,
      isPro: false,
      messageMatches: [{ meta: cachedMeta('home', otherSession, 350), matches: [cachedMessage('secret', 'launch secret history', 500)] }],
      favorites: [{ ...favorite('home'), sessionKey: otherSession }],
    };
    const results = buildSearchModel(restricted).sections.flatMap((section) => section.results);
    const excerpts = results.filter((result) => result.kind === 'message' || result.kind === 'favorite');
    expect(excerpts).toHaveLength(2);
    expect(excerpts.every((result) => result.text === '' && result.lockedReason)).toBe(true);
    const unlocked = buildSearchModel({ ...restricted, isPro: true }).sections.flatMap((section) => section.results);
    expect(unlocked.find((result) => result.kind === 'message')).toMatchObject({ text: 'launch secret history' });
  });

  it('builds all four result sections across live and cached connections', () => {
    const model = buildSearchModel(buildInput());

    expect(model.sections.map((section) => section.kind)).toEqual([
      'agents',
      'sessions',
      'messages',
      'favorites',
    ]);
    expect(model.sections.find((section) => section.kind === 'agents')?.results).toHaveLength(2);
    expect(model.sections.find((section) => section.kind === 'sessions')?.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Cached launch', source: 'cache' }),
        expect.objectContaining({ title: 'Launch room', source: 'live' }),
      ]),
    );
    expect(model.sections.find((section) => section.kind === 'messages')?.results[0]).toMatchObject({
      messageId: 'message',
      text: 'A local launch message',
    });
    expect(model.sections.find((section) => section.kind === 'favorites')?.results[0]).toMatchObject({
      favoriteKey: 'favorite:home',
    });
  });

  it('deduplicates live and chat-cache sessions and sorts every section by recency', () => {
    const model = buildSearchModel(buildInput());
    const sessions = model.sections.find((section) => section.kind === 'sessions')?.results ?? [];

    expect(sessions.map((result) => result.title)).toEqual([
      'Cached launch',
      'Launch room',
      'Launch travel',
    ]);
    expect(sessions.filter((result) => result.sessionKey === 'agent:main:main')).toHaveLength(1);
  });

  it('lists every favorite under an empty query so Search doubles as the favorites browser', () => {
    const input = buildInput();
    const browse = buildSearchModel({
      ...input,
      query: '   ',
      favorites: [
        { ...favorite('home'), favoriteKey: 'favorite:old', messageId: 'old', text: 'Older note', timestampMs: 100 },
        favorite('home'),
        { ...favorite('travel'), text: 'Unrelated travel note' },
      ],
    });

    expect(browse.sections).toEqual([]);
    expect(browse.availableResultCount).toBe(0);
    expect(browse.favorites.map((result) => result.favoriteKey)).toEqual([
      'favorite:home',
      'favorite:travel',
      'favorite:old',
    ]);
    expect(browse.favorites.every((result) => result.kind === 'favorite' && !result.lockedReason)).toBe(true);
    expect(buildSearchModel({ ...input, query: '', isPro: false }).favorites[0]?.lockedReason).toBeUndefined();
    expect(buildSearchModel(input).favorites).toEqual([]);
  });

  it('filters to messages or favorites without changing the all-results count', () => {
    const messages = buildSearchModel({ ...buildInput(), filter: 'messages' });
    const favorites = buildSearchModel({ ...buildInput(), filter: 'favorites' });

    expect(messages.sections.map((section) => section.kind)).toEqual(['messages']);
    expect(favorites.sections.map((section) => section.kind)).toEqual(['favorites']);
    expect(messages.availableResultCount).toBe(favorites.availableResultCount);
    expect(messages.visibleResultCount).toBe(1);
    expect(favorites.visibleResultCount).toBe(1);
  });

  it('uses capabilities to omit unsupported session and history results', () => {
    const input = buildInput();
    const model = buildSearchModel({
      ...input,
      capabilitiesByConnection: {
        ...input.capabilitiesByConnection,
        home: resolveCapabilities('openclaw', { sessions: false, history: false }),
      },
    });

    expect(model.sections.find((section) => section.kind === 'agents')?.results).toEqual(
      expect.arrayContaining([expect.objectContaining({ connectionId: 'home' })]),
    );
    expect(model.sections.find((section) => section.kind === 'messages')).toBeUndefined();
    expect(model.sections.find((section) => section.kind === 'favorites')).toBeUndefined();
    expect(model.sections.find((section) => section.kind === 'sessions')?.results).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ connectionId: 'home' })]),
    );
  });

  it('preserves exact connection and agent quota reasons before history access', () => {
    const model = buildSearchModel({
      ...buildInput(),
      isPro: false,
      resolveThreadLockedReason: (connectionId) => (
        connectionId === 'home' ? 'gatewayConnections' : 'agents'
      ),
    });

    expect(model.sections.flatMap((section) => section.results).filter(
      (result) => result.kind === 'message' || result.kind === 'favorite',
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ lockedReason: 'gatewayConnections' }),
    ]));
    expect(model.sections.flatMap((section) => section.results).filter(
      (result) => result.kind === 'agent' || result.kind === 'session',
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ connectionId: 'home', lockedReason: 'gatewayConnections' }),
      expect.objectContaining({ connectionId: 'travel', lockedReason: 'agents' }),
    ]));

    const proModel = buildSearchModel({
      ...buildInput(),
      resolveThreadLockedReason: (connectionId) => (
        connectionId === 'home' ? 'gatewayConnections' : null
      ),
    });
    expect(proModel.sections.flatMap((section) => section.results).filter(
      (result) => result.kind === 'message' || result.kind === 'favorite',
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ lockedReason: 'gatewayConnections' }),
    ]));
  });

  it('keeps the legacy boolean thread-access policy as an agents fallback', () => {
    const model = buildSearchModel({
      ...buildInput(),
      canOpenThread: (_connectionId, agentId) => agentId !== 'main',
    });

    expect(model.sections.flatMap((section) => section.results)).toEqual(expect.arrayContaining([
      expect.objectContaining({ lockedReason: 'agents' }),
    ]));
  });

  it('normalizes recent searches with case-insensitive uniqueness and a bound', () => {
    expect(normalizeRecentSearches([' Launch ', 'launch', '', 'Hermes'], 2)).toEqual([
      'Launch',
      'Hermes',
    ]);
    expect(addRecentSearch(['Hermes', 'Launch'], ' launch ')).toEqual([
      'launch',
      'Hermes',
    ]);
  });

  it('splits every case-insensitive highlight without interpreting regex characters', () => {
    expect(splitHighlightSegments('Launch + launch', 'LAUNCH')).toEqual([
      { text: 'Launch', matched: true },
      { text: ' + ', matched: false },
      { text: 'launch', matched: true },
    ]);
    expect(splitHighlightSegments('a+b', '+')).toEqual([
      { text: 'a', matched: false },
      { text: '+', matched: true },
      { text: 'b', matched: false },
    ]);
  });

  it.each([
    [{ initialized: false, permitted: true, loading: false, offline: false, visibleResultCount: 0, recentSearchCount: 0, favoriteCount: 0, hasQuery: false }, 'loading'],
    [{ initialized: true, permitted: false, loading: false, offline: false, visibleResultCount: 1, recentSearchCount: 0, favoriteCount: 0, hasQuery: true }, 'permission'],
    [{ initialized: true, permitted: true, loading: false, offline: false, errorCode: 'network', visibleResultCount: 1, recentSearchCount: 0, favoriteCount: 0, hasQuery: true }, 'error'],
    [{ initialized: true, permitted: true, loading: false, offline: true, visibleResultCount: 1, recentSearchCount: 0, favoriteCount: 0, hasQuery: true }, 'offline'],
    [{ initialized: true, permitted: true, loading: false, offline: false, visibleResultCount: 0, recentSearchCount: 0, favoriteCount: 0, hasQuery: true }, 'empty'],
    [{ initialized: true, permitted: true, loading: false, offline: false, visibleResultCount: 1, recentSearchCount: 0, favoriteCount: 0, hasQuery: true }, 'ready'],
    [{ initialized: true, permitted: true, loading: false, offline: false, visibleResultCount: 0, recentSearchCount: 0, favoriteCount: 0, hasQuery: false }, 'empty'],
    [{ initialized: true, permitted: true, loading: false, offline: false, visibleResultCount: 0, recentSearchCount: 1, favoriteCount: 0, hasQuery: false }, 'ready'],
    [{ initialized: true, permitted: true, loading: false, offline: false, visibleResultCount: 0, recentSearchCount: 0, favoriteCount: 1, hasQuery: false }, 'ready'],
  ] as const)('resolves all Search page states', (input, expected) => {
    expect(resolveSearchPageState(input)).toBe(expected);
  });

  it('shows the three filters only after results exceed one compact screen', () => {
    expect(shouldShowSearchFilters(6)).toBe(false);
    expect(shouldShowSearchFilters(7)).toBe(true);
  });
});
