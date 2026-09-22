import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  resolveCapabilities,
  type Capabilities,
  type ConnectionDescriptor,
} from '@clawket/agent-protocol';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  getConnectionRuntime,
  useConnections,
  useRoster,
} from '../../connection';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import type { RootStackParamList } from '../../navigation/root-stack';
import {
  ChatCacheService,
  type CachedSessionMeta,
} from '../../services/chat-cache';
import {
  MessageFavoritesService,
  type FavoritedMessage,
} from '../../services/message-favorites';
import { analyticsEvents } from '../../services/analytics/events';
import { useManualSessions } from '../../services/manual-sessions';
import {
  buildSearchModel,
  resolveSearchPageState,
  type CachedMessageMatches,
  type ResolveSearchThreadLockedReason,
  type SearchFilter,
  type SearchResult,
} from './model';
import {
  loadRecentSearches,
  rememberRecentSearch,
} from './recent-searches';
import { Keyboard } from 'react-native';
import { ConversationArchiveSheet } from '../../features/sharing/ConversationArchiveSheet';
import { SearchView } from './SearchView';

const RECENT_SEARCH_SETTLE_MS = 400;
const SEARCH_ANALYTICS_DEBOUNCE_MS = 400;

type NavigationProps = NativeStackScreenProps<RootStackParamList, 'Search'>;

export type SearchScreenProps = NavigationProps & Readonly<{
  permissionGranted?: boolean;
  isProOverride?: boolean;
  resolveThreadLockedReason?: ResolveSearchThreadLockedReason;
  /** @deprecated Prefer resolveThreadLockedReason so the paywall shows the exact quota. */
  canOpenThread?: (connectionId: string, agentId: string) => boolean;
  onOpenPaywall?: (reason: string, onContinue?: () => void) => void;
}>;

function collectConnections(
  connections: ReadonlyArray<ConnectionDescriptor>,
  roster: ReturnType<typeof useRoster>,
): ReadonlyArray<ConnectionDescriptor> {
  const result = new Map(connections.map((connection) => [connection.id, connection]));
  for (const group of roster) result.set(group.connection.id, group.connection);
  return Object.freeze([...result.values()]);
}

export function resolveSearchCapabilities(
  connections: ReadonlyArray<ConnectionDescriptor>,
  activeConnectionId: string | null,
  activeCapabilities?: Capabilities,
): Readonly<Record<string, Capabilities>> {
  return Object.freeze(Object.fromEntries(connections.map((connection) => [
    connection.id,
    connection.id === activeConnectionId && activeCapabilities
      ? activeCapabilities
      : resolveCapabilities(connection.backendKind),
  ])));
}

export function SearchScreen({
  navigation,
  route,
  permissionGranted = true,
  isProOverride,
  resolveThreadLockedReason,
  canOpenThread,
  onOpenPaywall,
}: SearchScreenProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const runtime = useConnections();
  const roster = useRoster();
  const manualSessions = useManualSessions();
  const { isPro: contextIsPro, visible: paywallVisible, showPaywall } = useProPaywall();
  const [archivesVisible, setArchivesVisible] = useState(false);
  const isPro = isProOverride ?? contextIsPro;
  const [query, setQuery] = useState(route.params?.query ?? '');
  const [filter, setFilter] = useState<SearchFilter>('all');
  const [cachedSessions, setCachedSessions] = useState<ReadonlyArray<CachedSessionMeta>>([]);
  const [messageMatches, setMessageMatches] = useState<ReadonlyArray<CachedMessageMatches>>([]);
  const [favorites, setFavorites] = useState<ReadonlyArray<FavoritedMessage>>([]);
  const [recentSearches, setRecentSearches] = useState<ReadonlyArray<string>>([]);
  const [baseLoaded, setBaseLoaded] = useState(false);
  const [searchingMessages, setSearchingMessages] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);

  const connections = useMemo(
    () => collectConnections(runtime.connections, roster),
    [roster, runtime.connections, runtime.connectionsRevision],
  );
  const capabilitiesByConnection = useMemo(
    () => resolveSearchCapabilities(
      connections,
      runtime.activeConnectionId,
      runtime.activeAdapter?.capabilities,
    ),
    [connections, runtime.activeAdapter, runtime.activeConnectionId, runtime.revision],
  );

  useEffect(() => {
    let cancelled = false;
    setBaseLoaded(false);
    setDataError(null);
    void Promise.all([
      ChatCacheService.listSessions(),
      MessageFavoritesService.listFavorites(),
      loadRecentSearches(),
    ]).then(([sessions, storedFavorites, storedRecent]) => {
      if (cancelled) return;
      setCachedSessions(sessions);
      setFavorites(storedFavorites);
      setRecentSearches(storedRecent);
      setBaseLoaded(true);
    }).catch((error: unknown) => {
      if (cancelled) return;
      setDataError(error instanceof Error ? error.message : String(error));
      setBaseLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [retryRevision]);

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) {
      setMessageMatches([]);
      setSearchingMessages(false);
      return;
    }
    let cancelled = false;
    setSearchingMessages(true);
    void ChatCacheService.search(normalized).then((matches) => {
      if (cancelled) return;
      setMessageMatches(matches);
      setSearchingMessages(false);
    }).catch((error: unknown) => {
      if (cancelled) return;
      setDataError(error instanceof Error ? error.message : String(error));
      setSearchingMessages(false);
    });
    return () => {
      cancelled = true;
    };
  }, [query, retryRevision]);

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized || searchingMessages) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void rememberRecentSearch(normalized).then((stored) => {
        if (!cancelled) setRecentSearches(stored);
      }).catch(() => {});
    }, RECENT_SEARCH_SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, searchingMessages]);

  const model = useMemo(() => buildSearchModel({
    query,
    filter,
    connections,
    roster,
    cachedSessions,
    messageMatches,
    favorites,
    capabilitiesByConnection,
    isPro,
    manualSessions,
    resolveThreadLockedReason,
    canOpenThread,
  }), [
    cachedSessions,
    canOpenThread,
    capabilitiesByConnection,
    connections,
    favorites,
    filter,
    isPro,
    manualSessions,
    messageMatches,
    query,
    resolveThreadLockedReason,
    roster,
  ]);
  const analyticsResultKinds = useMemo(
    () => model.sections
      .filter((section) => section.results.length > 0)
      .map((section) => section.kind)
      .join(',') || 'none',
    [model.sections],
  );
  useEffect(() => {
    if (!permissionGranted || !model.query || !baseLoaded || searchingMessages) return undefined;
    const timer = setTimeout(() => {
      analyticsEvents.searchPerformed({
        scope: 'global',
        has_results: model.visibleResultCount > 0,
        result_kinds: analyticsResultKinds,
      });
    }, SEARCH_ANALYTICS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [analyticsResultKinds, baseLoaded, model.query, model.visibleResultCount, permissionGranted, searchingMessages]);
  const runtimeError = runtime.error?.message ?? null;
  const errorCode = dataError || runtimeError ? 'network' : null;
  const offline = runtime.activeState === 'offline' || runtime.activeState === 'reconnecting';
  const state = resolveSearchPageState({
    initialized: runtime.initialized,
    permitted: permissionGranted,
    loading: !baseLoaded || searchingMessages,
    offline,
    errorCode,
    visibleResultCount: model.visibleResultCount,
    recentSearchCount: recentSearches.length,
    favoriteCount: model.favorites.length,
    hasQuery: Boolean(model.query),
  });

  const rememberCurrentQuery = useCallback(() => {
    if (!model.query) return;
    void rememberRecentSearch(query).then(setRecentSearches).catch(() => {});
  }, [model.query, query]);

  const openThread = useCallback((result: SearchResult) => {
    navigation.navigate('Thread', {
      connectionId: result.connectionId,
      agentId: result.agentId,
      sessionKey: result.sessionKey,
      from: 'search',
    });
  }, [navigation]);

  const openResult = useCallback((result: SearchResult) => {
    if (result.kind === 'agent' || result.kind === 'session') {
      openThread(result);
      return;
    }
    navigation.navigate('MessageDetail', {
      connectionId: result.connectionId,
      sessionKey: result.sessionKey,
      messageId: result.messageId,
    });
  }, [navigation, openThread]);

  const selectResult = useCallback((result: SearchResult) => {
    rememberCurrentQuery();
    if (result.kind === 'message' || result.kind === 'favorite') {
      analyticsEvents.searchMessageOpened({ is_pro: isPro });
    }
    const onContinue = () => openResult(result);
    if (result.lockedReason) {
      if (onOpenPaywall) onOpenPaywall(result.lockedReason, onContinue);
      else navigation.navigate('Paywall', { reason: result.lockedReason });
      return;
    }
    onContinue();
  }, [isPro, navigation, onOpenPaywall, openResult, rememberCurrentQuery]);

  const retry = useCallback(() => {
    setDataError(null);
    setRetryRevision((revision) => revision + 1);
    if (offline || runtime.error) {
      void getConnectionRuntime().probeActive().catch(() => {});
    }
  }, [offline, runtime.error]);

  return (
    <>
    <SearchView
      state={state}
      query={query}
      filter={filter}
      sections={model.sections}
      favorites={model.favorites}
      recentSearches={recentSearches}
      availableResultCount={model.availableResultCount}
      errorCode={errorCode}
      reconnecting={runtime.recovering === true}
      topInset={insets.top}
      bottomInset={insets.bottom}
      onBack={() => navigation.goBack()}
      onOpenArchives={() => { Keyboard.dismiss(); setArchivesVisible(true); }}
      onChangeQuery={setQuery}
      onChangeFilter={setFilter}
      onSelectResult={selectResult}
      onSelectRecent={(recent) => {
        setFilter('all');
        setQuery(recent);
      }}
      onRetry={retry}
      onOpenPermission={() => navigation.navigate('Paywall', { reason: 'messageHistory' })}
    />
    <ConversationArchiveSheet visible={archivesVisible} suspended={paywallVisible} isPro={isPro} onClose={() => setArchivesVisible(false)}
      onRequirePro={(action) => { if (onOpenPaywall) onOpenPaywall('archiveTools', action); else showPaywall('archiveTools'); }} />
    </>
  );
}
