import type {
  Capabilities,
  ConnectionDescriptor,
} from '@clawket/agent-protocol';
import type { RosterConnectionGroup } from '../../connection';
import type {
  CachedMessage,
  CachedSessionMeta,
} from '../../services/chat-cache';
import type { FavoritedMessage } from '../../services/message-favorites';

export type SearchFilter = 'all' | 'messages' | 'favorites';
export type SearchResultKind = 'agent' | 'session' | 'message' | 'favorite';
export type SearchSectionKind = 'agents' | 'sessions' | 'messages' | 'favorites';
export type SearchDataSource = 'live' | 'cache';
export type SearchLockedReason = 'agents' | 'messageHistory';

type SearchResultBase = Readonly<{
  id: string;
  kind: SearchResultKind;
  connectionId: string;
  agentId: string;
  sessionKey: string;
  title: string;
  subtitle?: string;
  updatedAt: number | null;
  source: SearchDataSource;
  lockedReason?: SearchLockedReason;
}>;

export type AgentSearchResult = SearchResultBase & Readonly<{
  kind: 'agent';
  emoji?: string;
}>;

export type SessionSearchResult = SearchResultBase & Readonly<{
  kind: 'session';
}>;

export type MessageSearchResult = SearchResultBase & Readonly<{
  kind: 'message';
  messageId: string;
  text: string;
}>;

export type FavoriteSearchResult = SearchResultBase & Readonly<{
  kind: 'favorite';
  favoriteKey: string;
  messageId: string;
  text: string;
}>;

export type SearchResult =
  | AgentSearchResult
  | SessionSearchResult
  | MessageSearchResult
  | FavoriteSearchResult;

export type SearchSection = Readonly<{
  kind: SearchSectionKind;
  results: ReadonlyArray<SearchResult>;
}>;

export type CachedMessageMatches = Readonly<{
  meta: CachedSessionMeta;
  matches: ReadonlyArray<CachedMessage>;
}>;

export type SearchModelInput = Readonly<{
  query: string;
  filter?: SearchFilter;
  connections: ReadonlyArray<ConnectionDescriptor>;
  roster: ReadonlyArray<RosterConnectionGroup>;
  cachedSessions: ReadonlyArray<CachedSessionMeta>;
  messageMatches: ReadonlyArray<CachedMessageMatches>;
  favorites: ReadonlyArray<FavoritedMessage>;
  capabilitiesByConnection: Readonly<Record<string, Capabilities | undefined>>;
  isPro: boolean;
  canOpenThread?: (connectionId: string, agentId: string) => boolean;
}>;

export type SearchModel = Readonly<{
  query: string;
  filter: SearchFilter;
  sections: ReadonlyArray<SearchSection>;
  availableResultCount: number;
  visibleResultCount: number;
}>;

export type SearchPageState =
  | 'loading'
  | 'empty'
  | 'error'
  | 'offline'
  | 'permission'
  | 'ready';

export type HighlightSegment = Readonly<{
  text: string;
  matched: boolean;
}>;

const SECTION_ORDER: ReadonlyArray<SearchSectionKind> = [
  'agents',
  'sessions',
  'messages',
  'favorites',
];

const RECENT_SEARCH_LIMIT = 8;
export const SEARCH_FILTER_THRESHOLD = 6;

function normalizeQuery(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function matchesQuery(query: string, ...values: ReadonlyArray<string | null | undefined>): boolean {
  return values.some((value) => value?.toLocaleLowerCase().includes(query));
}

function connectionMap(
  connections: ReadonlyArray<ConnectionDescriptor>,
  roster: ReadonlyArray<RosterConnectionGroup>,
): ReadonlyMap<string, ConnectionDescriptor> {
  const result = new Map(connections.map((connection) => [connection.id, connection]));
  for (const group of roster) result.set(group.connection.id, group.connection);
  return result;
}

function resultSort(left: SearchResult, right: SearchResult): number {
  return (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
    || left.title.localeCompare(right.title)
    || left.id.localeCompare(right.id);
}

function resultKey(connectionId: string, suffix: string): string {
  return `${connectionId}:${suffix}`;
}

function hasCapability(
  capabilitiesByConnection: SearchModelInput['capabilitiesByConnection'],
  connectionId: string,
  capability: keyof Capabilities,
): boolean {
  return capabilitiesByConnection[connectionId]?.[capability] === true;
}

function threadLockReason(
  canOpenThread: SearchModelInput['canOpenThread'],
  connectionId: string,
  agentId: string,
): SearchLockedReason | undefined {
  return canOpenThread && !canOpenThread(connectionId, agentId) ? 'agents' : undefined;
}

function buildAgentResults(
  input: SearchModelInput,
  query: string,
  connections: ReadonlyMap<string, ConnectionDescriptor>,
): AgentSearchResult[] {
  const results = new Map<string, AgentSearchResult>();
  for (const group of input.roster) {
    if (!hasCapability(input.capabilitiesByConnection, group.connection.id, 'chat')) continue;
    for (const summary of group.agents) {
      const { agent } = summary;
      if (!matchesQuery(query, agent.name, group.connection.label)) continue;
      const id = resultKey(group.connection.id, `agent:${agent.agentId}`);
      const result: AgentSearchResult = {
        id,
        kind: 'agent',
        connectionId: group.connection.id,
        agentId: agent.agentId,
        sessionKey: agent.mainSessionKey,
        title: agent.name,
        subtitle: connections.get(group.connection.id)?.label,
        updatedAt: summary.updatedAt,
        source: group.source,
        ...(agent.emoji ? { emoji: agent.emoji } : {}),
        ...(threadLockReason(input.canOpenThread, group.connection.id, agent.agentId)
          ? { lockedReason: 'agents' as const }
          : {}),
      };
      const previous = results.get(id);
      if (!previous || result.source === 'live' || (result.updatedAt ?? 0) > (previous.updatedAt ?? 0)) {
        results.set(id, result);
      }
    }
  }
  return [...results.values()].sort(resultSort);
}

function cachedSessionTitle(meta: CachedSessionMeta): string {
  return meta.sessionLabel?.trim() || meta.sessionKey;
}

function cachedAgentTitle(meta: CachedSessionMeta): string {
  return meta.agentName?.trim() || meta.agentId;
}

function buildSessionResults(
  input: SearchModelInput,
  query: string,
  connections: ReadonlyMap<string, ConnectionDescriptor>,
): SessionSearchResult[] {
  const results = new Map<string, SessionSearchResult>();

  for (const group of input.roster) {
    if (!hasCapability(input.capabilitiesByConnection, group.connection.id, 'sessions')) continue;
    for (const summary of group.agents) {
      for (const session of summary.sessions) {
        if (!matchesQuery(
          query,
          session.title,
          session.preview,
          session.key,
          summary.agent.name,
          group.connection.label,
        )) continue;
        const id = resultKey(group.connection.id, `session:${session.key}`);
        results.set(id, {
          id,
          kind: 'session',
          connectionId: group.connection.id,
          agentId: summary.agent.agentId,
          sessionKey: session.key,
          title: session.title,
          subtitle: summary.agent.name,
          updatedAt: session.updatedAt,
          source: group.source,
          ...(threadLockReason(input.canOpenThread, group.connection.id, summary.agent.agentId)
            ? { lockedReason: 'agents' as const }
            : {}),
        });
      }
    }
  }

  for (const meta of input.cachedSessions) {
    if (!connections.has(meta.gatewayConfigId)) continue;
    if (!hasCapability(input.capabilitiesByConnection, meta.gatewayConfigId, 'sessions')) continue;
    const title = cachedSessionTitle(meta);
    const agentTitle = cachedAgentTitle(meta);
    if (!matchesQuery(
      query,
      title,
      meta.lastMessagePreview,
      meta.sessionKey,
      agentTitle,
      connections.get(meta.gatewayConfigId)?.label,
    )) continue;
    const id = resultKey(meta.gatewayConfigId, `session:${meta.sessionKey}`);
    const cached: SessionSearchResult = {
      id,
      kind: 'session',
      connectionId: meta.gatewayConfigId,
      agentId: meta.agentId,
      sessionKey: meta.sessionKey,
      title,
      subtitle: agentTitle,
      updatedAt: meta.lastMessageMs ?? meta.updatedAt,
      source: 'cache',
      ...(threadLockReason(input.canOpenThread, meta.gatewayConfigId, meta.agentId)
        ? { lockedReason: 'agents' as const }
        : {}),
    };
    const existing = results.get(id);
    if (!existing) results.set(id, cached);
  }

  return [...results.values()].sort(resultSort);
}

function buildMessageResults(
  input: SearchModelInput,
  query: string,
  connections: ReadonlyMap<string, ConnectionDescriptor>,
): MessageSearchResult[] {
  const results = new Map<string, MessageSearchResult>();
  for (const group of input.messageMatches) {
    const { meta } = group;
    if (!connections.has(meta.gatewayConfigId)) continue;
    if (!hasCapability(input.capabilitiesByConnection, meta.gatewayConfigId, 'history')) continue;
    for (const message of group.matches) {
      if (!matchesQuery(query, message.text, message.toolName, message.toolSummary)) continue;
      const id = resultKey(
        meta.gatewayConfigId,
        `message:${meta.sessionKey}:${message.id}`,
      );
      const lockedReason = input.isPro ? undefined : 'messageHistory';
      results.set(id, {
        id,
        kind: 'message',
        connectionId: meta.gatewayConfigId,
        agentId: meta.agentId,
        sessionKey: meta.sessionKey,
        title: meta.sessionLabel?.trim() || meta.agentName?.trim() || meta.agentId,
        subtitle: connections.get(meta.gatewayConfigId)?.label,
        updatedAt: message.timestampMs ?? meta.lastMessageMs ?? meta.updatedAt,
        source: 'cache',
        messageId: message.id,
        text: message.text || message.toolSummary || message.toolName || '',
        ...(lockedReason ? { lockedReason } : {}),
      });
    }
  }
  return [...results.values()].sort(resultSort);
}

function buildFavoriteResults(
  input: SearchModelInput,
  query: string,
  connections: ReadonlyMap<string, ConnectionDescriptor>,
): FavoriteSearchResult[] {
  const results = new Map<string, FavoriteSearchResult>();
  for (const favorite of input.favorites) {
    if (!connections.has(favorite.gatewayConfigId)) continue;
    if (!hasCapability(input.capabilitiesByConnection, favorite.gatewayConfigId, 'history')) continue;
    if (!matchesQuery(
      query,
      favorite.text,
      favorite.toolName,
      favorite.toolSummary,
      favorite.agentName,
      favorite.sessionLabel,
      connections.get(favorite.gatewayConfigId)?.label,
    )) continue;
    const id = resultKey(favorite.gatewayConfigId, `favorite:${favorite.favoriteKey}`);
    const lockedReason = input.isPro ? undefined : 'messageHistory';
    results.set(id, {
      id,
      kind: 'favorite',
      connectionId: favorite.gatewayConfigId,
      agentId: favorite.agentId,
      sessionKey: favorite.sessionKey,
      title: favorite.sessionLabel?.trim() || favorite.agentName?.trim() || favorite.agentId,
      subtitle: connections.get(favorite.gatewayConfigId)?.label,
      updatedAt: favorite.timestampMs ?? favorite.favoritedAt,
      source: 'cache',
      favoriteKey: favorite.favoriteKey,
      messageId: favorite.messageId,
      text: favorite.text || favorite.toolSummary || favorite.toolName || '',
      ...(lockedReason ? { lockedReason } : {}),
    });
  }
  return [...results.values()].sort(resultSort);
}

function sectionVisible(filter: SearchFilter, section: SearchSectionKind): boolean {
  if (filter === 'messages') return section === 'messages';
  if (filter === 'favorites') return section === 'favorites';
  return true;
}

export function buildSearchModel(input: SearchModelInput): SearchModel {
  const query = normalizeQuery(input.query);
  const filter = input.filter ?? 'all';
  if (!query) {
    return Object.freeze({
      query,
      filter,
      sections: Object.freeze([]),
      availableResultCount: 0,
      visibleResultCount: 0,
    });
  }

  const connections = connectionMap(input.connections, input.roster);
  const bySection: Readonly<Record<SearchSectionKind, ReadonlyArray<SearchResult>>> = {
    agents: buildAgentResults(input, query, connections),
    sessions: buildSessionResults(input, query, connections),
    messages: buildMessageResults(input, query, connections),
    favorites: buildFavoriteResults(input, query, connections),
  };
  const availableResultCount = SECTION_ORDER.reduce(
    (count, section) => count + bySection[section].length,
    0,
  );
  const sections = SECTION_ORDER
    .filter((section) => sectionVisible(filter, section) && bySection[section].length > 0)
    .map((section) => Object.freeze({
      kind: section,
      results: Object.freeze([...bySection[section]]),
    }));

  return Object.freeze({
    query,
    filter,
    sections: Object.freeze(sections),
    availableResultCount,
    visibleResultCount: sections.reduce((count, section) => count + section.results.length, 0),
  });
}

export function resolveSearchPageState(input: Readonly<{
  initialized: boolean;
  permitted: boolean;
  loading: boolean;
  offline: boolean;
  errorCode?: string | null;
  visibleResultCount: number;
  recentSearchCount: number;
  hasQuery: boolean;
}>): SearchPageState {
  if (!input.permitted) return 'permission';
  if (!input.initialized || input.loading) return 'loading';
  if (input.errorCode) return 'error';
  if (input.offline) return 'offline';
  if (input.hasQuery ? input.visibleResultCount === 0 : input.recentSearchCount === 0) {
    return 'empty';
  }
  return 'ready';
}

export function normalizeRecentSearches(
  searches: ReadonlyArray<string>,
  limit = RECENT_SEARCH_LIMIT,
): ReadonlyArray<string> {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const search of searches) {
    const trimmed = search.trim();
    const normalized = normalizeQuery(trimmed);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(trimmed);
    if (result.length >= Math.max(0, limit)) break;
  }
  return Object.freeze(result);
}

export function addRecentSearch(
  searches: ReadonlyArray<string>,
  query: string,
  limit = RECENT_SEARCH_LIMIT,
): ReadonlyArray<string> {
  return normalizeRecentSearches([query, ...searches], limit);
}

export function shouldShowSearchFilters(availableResultCount: number): boolean {
  return availableResultCount > SEARCH_FILTER_THRESHOLD;
}

export function splitHighlightSegments(value: string, query: string): ReadonlyArray<HighlightSegment> {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) return Object.freeze([{ text: value, matched: false }]);
  const normalizedValue = value.toLocaleLowerCase();
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const matchIndex = normalizedValue.indexOf(normalizedQuery, cursor);
    if (matchIndex < 0) {
      segments.push({ text: value.slice(cursor), matched: false });
      break;
    }
    if (matchIndex > cursor) {
      segments.push({ text: value.slice(cursor, matchIndex), matched: false });
    }
    const end = matchIndex + normalizedQuery.length;
    segments.push({ text: value.slice(matchIndex, end), matched: true });
    cursor = end;
  }
  if (segments.length === 0) segments.push({ text: value, matched: false });
  return Object.freeze(segments);
}
