import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ChevronRight, Search, X } from 'lucide-react-native';
import {
  Card,
  EmptyState,
  IconButton,
  LoadingState,
  ScreenHeader,
  ScreenLayout,
  createListContentStyle,
} from '../ui';
import { useTranslation } from 'react-i18next';
import { useAppContext } from '../../contexts/AppContext';
import { GatewayClient } from '../../services/gateway';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, HitSize, Radius, Space } from '../../theme/tokens';
import { relativeTime } from '../../utils/chat-message';

type AgentFile = {
  name: string;
  path: string;
  missing: boolean;
  size?: number;
  updatedAtMs?: number;
};

type SearchMatch = {
  line: string;
  lineNumber: number;
  matchStart: number;
  snippet: string;
};

type SearchResultGroup = {
  fileName: string;
  icon: string;
  matches: SearchMatch[];
};

type ListRow = AgentFile | SearchResultGroup;

type Props = {
  gateway: GatewayClient;
  topInset: number;
  onBack: () => void;
  onOpenFile: (name: string) => void;
  agentId?: string;
  hideHeader?: boolean;
};

const SEARCH_DEBOUNCE_MS = 300;
const MAX_MATCHES_PER_FILE = 10;
const MAX_TOTAL_MATCHES = 50;
const SNIPPET_MAX_CHARS = 120;

const FILE_ICONS: Record<string, string> = {
  'AGENTS.md': '🤖',
  'SOUL.md': '🧬',
  'MEMORY.md': '🧠',
  'TOOLS.md': '🔧',
  'HEARTBEAT.md': '💓',
  'USER.md': '👤',
  'IDENTITY.md': '🪪',
  'BOOTSTRAP.md': '🚀',
};

function iconForFile(name: string): string {
  return FILE_ICONS[name] ?? '📄';
}

function formatFileSize(size?: number): string {
  if (size === undefined || !Number.isFinite(size)) return 'Unknown size';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUpdated(updatedAtMs?: number): string {
  if (!updatedAtMs) return 'Unknown time';
  const relative = relativeTime(updatedAtMs);
  if (!relative) return 'Unknown time';
  if (relative === 'now') return 'just now';
  if (relative === 'Yesterday') return 'Yesterday';
  return `${relative} ago`;
}

function highlightMatch(text: string, query: string): Array<{ text: string; highlight: boolean }> {
  if (!query) return [{ text, highlight: false }];
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  const parts: Array<{ text: string; highlight: boolean }> = [];
  let cursor = 0;
  let index = lower.indexOf(qLower, cursor);

  while (index !== -1) {
    if (index > cursor) {
      parts.push({ text: text.slice(cursor, index), highlight: false });
    }
    parts.push({ text: text.slice(index, index + query.length), highlight: true });
    cursor = index + query.length;
    index = lower.indexOf(qLower, cursor);
  }

  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), highlight: false });
  }

  return parts.length > 0 ? parts : [{ text, highlight: false }];
}

function createLineSnippet(line: string, matchStart: number, queryLength: number): string {
  if (line.length <= SNIPPET_MAX_CHARS) return line;
  const windowLength = Math.max(SNIPPET_MAX_CHARS, queryLength);
  let start = Math.max(0, matchStart - Math.floor((windowLength - queryLength) / 2));
  let end = Math.min(line.length, start + windowLength);

  if (end === line.length) {
    start = Math.max(0, end - windowLength);
  }

  const prefix = start > 0 ? '...' : '';
  const suffix = end < line.length ? '...' : '';
  return `${prefix}${line.slice(start, end)}${suffix}`;
}

export function FileListView({
  gateway,
  topInset,
  onBack,
  onOpenFile,
  agentId,
  hideHeader = false,
}: Props): React.JSX.Element {
  const { gatewayEpoch } = useAppContext();
  const { t } = useTranslation('console');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const [files, setFiles] = useState<AgentFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultGroup[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const fileContentCache = useRef<Map<string, string>>(new Map());
  const cacheFetchPromise = useRef<Promise<void> | null>(null);
  const searchRequestIdRef = useRef(0);

  const loadFiles = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    try {
      const result = await gateway.listAgentFiles(agentId);
      const FILE_ORDER = ['SOUL.md', 'MEMORY.md', 'USER.md', 'AGENTS.md'];
      result.sort((a, b) => {
        const ai = FILE_ORDER.indexOf(a.name);
        const bi = FILE_ORDER.indexOf(b.name);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return a.name.localeCompare(b.name);
      });
      setFiles(result);
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load files';
      setError(message);
    } finally {
      if (mode === 'initial') setLoading(false);
      if (mode === 'refresh') setRefreshing(false);
    }
  }, [agentId, gateway, gatewayEpoch]);

  const ensureFileContentCache = useCallback(async () => {
    if (fileContentCache.current.size > 0) return;
    if (cacheFetchPromise.current) {
      await cacheFetchPromise.current;
      return;
    }

    const searchableFiles = files.filter((file) => !file.missing);
    if (searchableFiles.length === 0) return;

    setSearchLoading(true);
    cacheFetchPromise.current = Promise.all(
      searchableFiles.map(async (file) => {
        try {
          const result = await gateway.getAgentFile(file.name, agentId);
          fileContentCache.current.set(file.name, result.content ?? '');
        } catch {
          fileContentCache.current.set(file.name, '');
        }
      }),
    ).then(() => undefined).finally(() => {
      cacheFetchPromise.current = null;
      setSearchLoading(false);
    });

    await cacheFetchPromise.current;
  }, [agentId, files, gateway]);

  const performSearch = useCallback(async (query: string) => {
    const normalizedQuery = query.toLowerCase();
    if (!normalizedQuery) {
      setSearchResults([]);
      return;
    }

    const requestId = ++searchRequestIdRef.current;
    await ensureFileContentCache();
    if (requestId !== searchRequestIdRef.current) return;

    const groups: SearchResultGroup[] = [];
    let totalMatches = 0;

    for (const file of files) {
      if (file.missing) continue;
      if (totalMatches >= MAX_TOTAL_MATCHES) break;

      const content = fileContentCache.current.get(file.name) ?? '';
      const lines = content.split(/\r?\n/);
      const matches: SearchMatch[] = [];

      for (let index = 0; index < lines.length; index++) {
        if (matches.length >= MAX_MATCHES_PER_FILE || totalMatches >= MAX_TOTAL_MATCHES) break;
        const line = lines[index];
        const matchStart = line.toLowerCase().indexOf(normalizedQuery);
        if (matchStart === -1) continue;

        matches.push({
          line,
          lineNumber: index + 1,
          matchStart,
          snippet: createLineSnippet(line, matchStart, query.length),
        });
        totalMatches += 1;
      }

      if (matches.length > 0) {
        groups.push({
          fileName: file.name,
          icon: iconForFile(file.name),
          matches,
        });
      }
    }

    if (requestId === searchRequestIdRef.current) {
      setSearchResults(groups);
    }
  }, [ensureFileContentCache, files]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setDebouncedQuery('');
    setSearchResults([]);
    searchRequestIdRef.current += 1;
  }, []);

  const handleRefresh = useCallback(() => {
    fileContentCache.current.clear();
    cacheFetchPromise.current = null;
    loadFiles('refresh').catch(() => {
      // Error state already handled in loadFiles.
    });
  }, [loadFiles]);

  useEffect(() => {
    loadFiles().catch(() => {
      // Error state already handled in loadFiles.
    });
  }, [loadFiles]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (!debouncedQuery) {
      setSearchResults([]);
      setSearchLoading(false);
      searchRequestIdRef.current += 1;
      return;
    }
    performSearch(debouncedQuery).catch(() => {
      setSearchLoading(false);
    });
  }, [debouncedQuery, files, performSearch]);

  const renderItem = ({ item }: { item: AgentFile }) => {
    const disabled = item.missing;
    return (
      <Card
        style={[styles.card, disabled && styles.cardDisabled]}
        onPress={() => onOpenFile(item.name)}
        disabled={disabled}
      >
        <View style={styles.cardRow}>
          <Text style={styles.cardIcon}>{iconForFile(item.name)}</Text>
          <View style={styles.cardText}>
            <Text style={[styles.cardTitle, disabled && styles.textDisabled]}>{item.name}</Text>
            <Text style={[styles.cardMeta, disabled && styles.textDisabled]}>
              {item.missing ? 'Not created' : `${formatFileSize(item.size)} • ${formatUpdated(item.updatedAtMs)}`}
            </Text>
          </View>
          <Text style={[styles.cardArrow, disabled && styles.textDisabled]}>{item.missing ? '-' : '›'}</Text>
        </View>
      </Card>
    );
  };

  const renderHighlightedSnippet = useCallback((text: string, query: string) => {
    const parts = highlightMatch(text, query);
    return (
      <Text style={styles.matchText}>
        {parts.map((part, index) => (
          <Text
            key={`${part.text}-${index}`}
            style={part.highlight ? styles.matchTextHighlight : undefined}
          >
            {part.text}
          </Text>
        ))}
      </Text>
    );
  }, [styles.matchText, styles.matchTextHighlight]);

  const renderSearchGroup = ({ item }: { item: SearchResultGroup }) => (
    <View style={styles.searchGroup}>
      <TouchableOpacity
        style={styles.groupHeader}
        onPress={() => onOpenFile(item.fileName)}
        activeOpacity={0.7}
      >
        <View style={styles.groupHeaderLeft}>
          <Text style={styles.groupHeaderIcon}>{item.icon}</Text>
          <Text style={styles.groupHeaderTitle}>{item.fileName}</Text>
        </View>
        <View style={styles.groupHeaderRight}>
          <Text style={styles.groupHeaderCount}>{item.matches.length}</Text>
          <ChevronRight size={16} color={theme.colors.textMuted} strokeWidth={2} />
        </View>
      </TouchableOpacity>

      {item.matches.map((match, index) => (
        <TouchableOpacity
          key={`${item.fileName}-${match.lineNumber}-${match.matchStart}-${index}`}
          style={styles.matchCard}
          onPress={() => onOpenFile(item.fileName)}
          activeOpacity={0.7}
        >
          {renderHighlightedSnippet(match.snippet, debouncedQuery)}
          <Text style={styles.matchLineNumber}>Line {match.lineNumber}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const headerComponent = useMemo(() => (
    <View style={styles.listHeader}>
      <View style={styles.searchInputWrap}>
        <Search size={16} color={theme.colors.textMuted} strokeWidth={2} />
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t('Search memory...')}
          placeholderTextColor={theme.colors.textSubtle}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {searchQuery ? (
          <IconButton
            size={HitSize.sm}
            icon={<X size={16} color={theme.colors.textMuted} strokeWidth={2} />}
            onPress={clearSearch}
          />
        ) : null}
      </View>
      {searchLoading && debouncedQuery ? (
        <View style={styles.searchLoadingRow}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
        </View>
      ) : null}
      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Failed to load files</Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => loadFiles('initial')}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  ), [
    clearSearch,
    debouncedQuery,
    error,
    loadFiles,
    searchLoading,
    searchQuery,
    styles.errorCard,
    styles.errorMessage,
    styles.errorTitle,
    styles.listHeader,
    styles.retryButton,
    styles.retryText,
    styles.searchInput,
    styles.searchInputWrap,
    styles.searchLoadingRow,
    theme.colors.primary,
    theme.colors.textMuted,
    theme.colors.textSubtle,
  ]);

  const isSearchMode = searchQuery.trim().length > 0;
  const listData: ListRow[] = isSearchMode ? searchResults : files;
  const keyExtractor = useCallback((item: ListRow) => (
    isSearchMode ? `search-${(item as SearchResultGroup).fileName}` : `file-${(item as AgentFile).name}`
  ), [isSearchMode]);
  const renderListItem = useCallback(({ item }: { item: ListRow }) => (
    isSearchMode
      ? renderSearchGroup({ item: item as SearchResultGroup })
      : renderItem({ item: item as AgentFile })
  ), [isSearchMode]);
  const listEmptyComponent = isSearchMode
    ? (!searchLoading ? (
      <View style={styles.emptySearchState}>
        <Text style={styles.emptySearchText}>No results for "{searchQuery.trim()}"</Text>
      </View>
    ) : null)
    : (error ? null : <EmptyState icon="📄" title={t('No memory found.')} />);

  return (
    <View style={styles.root}>
      {!hideHeader ? <ScreenHeader title={t('Memory')} topInset={topInset} onBack={onBack} /> : null}

      {loading ? (
        <LoadingState message={t('Loading files...')} />
      ) : (
        <FlatList<ListRow>
          data={listData}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.content}
          stickyHeaderIndices={[0]}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.colors.primary} />}
          ListHeaderComponent={headerComponent}
          ListEmptyComponent={listEmptyComponent}
          renderItem={renderListItem}
        />
      )}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      ...createListContentStyle({ grow: true }),
    },
    listHeader: {
      backgroundColor: colors.background,
      paddingBottom: Space.md,
    },
    searchInputWrap: {
      minHeight: HitSize.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: Space.md,
    },
    searchInput: {
      flex: 1,
      color: colors.text,
      fontSize: FontSize.base,
      paddingVertical: Space.sm + 1,
    },
    searchLoadingRow: {
      paddingTop: Space.sm,
      alignItems: 'flex-start',
    },
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.md,
      marginBottom: Space.md - 2,
      overflow: 'hidden',
      padding: 0,
    },
    cardDisabled: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.border,
    },
    cardRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: Space.lg - 2,
    },
    cardIcon: {
      fontSize: FontSize.xxl,
      marginRight: Space.md,
    },
    cardText: {
      flex: 1,
    },
    cardTitle: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    cardMeta: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
      marginTop: 2,
    },
    cardArrow: {
      fontSize: FontSize.xxl,
      color: colors.textMuted,
      fontWeight: '300',
      marginLeft: Space.sm,
    },
    textDisabled: {
      color: colors.textSubtle,
    },
    searchGroup: {
      marginBottom: Space.md,
    },
    groupHeader: {
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.md,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm + 2,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    groupHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
      marginRight: Space.sm,
    },
    groupHeaderIcon: {
      fontSize: FontSize.lg,
      marginRight: Space.sm,
    },
    groupHeaderTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    groupHeaderRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
    },
    groupHeaderCount: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
    },
    matchCard: {
      marginTop: Space.sm,
      marginLeft: Space.xs,
      marginRight: Space.xs,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.md,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm + 2,
    },
    matchText: {
      color: colors.text,
      fontSize: FontSize.md,
      lineHeight: FontSize.lg + 2,
    },
    matchTextHighlight: {
      color: colors.primary,
      fontWeight: FontWeight.bold,
    },
    matchLineNumber: {
      marginTop: Space.xs,
      color: colors.textSubtle,
      fontSize: FontSize.xs,
    },
    emptySearchState: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: ScreenLayout.listTop + Space.xl,
      paddingBottom: Space.xxl,
      paddingHorizontal: Space.lg,
    },
    emptySearchText: {
      color: colors.textMuted,
      fontSize: FontSize.md,
      textAlign: 'center',
    },
    errorCard: {
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.error,
      marginBottom: Space.md,
      padding: Space.md,
    },
    errorTitle: {
      color: colors.error,
      fontSize: FontSize.md + 1,
      fontWeight: FontWeight.bold,
    },
    errorMessage: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      marginTop: Space.xs,
    },
    retryButton: {
      alignSelf: 'flex-start',
      marginTop: Space.md - 2,
      backgroundColor: colors.primary,
      borderRadius: Radius.sm,
      paddingHorizontal: Space.md,
      paddingVertical: 6,
    },
    retryText: {
      color: colors.primaryText,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
  });
}
