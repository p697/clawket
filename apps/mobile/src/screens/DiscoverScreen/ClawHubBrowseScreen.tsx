import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { EmptyState, SearchInput } from '../../components/ui';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { fetchClawHubBrowsePage } from '../../features/discover';
import { searchClawHubSkills } from '../../features/discover/clawhub';
import type { ClawHubBrowseSort, DiscoverSkillItem } from '../../features/discover/types';
import { analyticsEvents } from '../../services/analytics/events';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type { DiscoverStackParamList } from './sharedNavigator';
import { DiscoverSkillCard } from './components/DiscoverSkillCard';

type Nav = NativeStackNavigationProp<DiscoverStackParamList, 'DiscoverClawHubBrowse'>;
type RouteParams = RouteProp<DiscoverStackParamList, 'DiscoverClawHubBrowse'>;

const PAGE_SIZE = 24;

export function ClawHubBrowseScreen(): React.JSX.Element {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteParams>();
  const { theme } = useAppTheme();
  const { t } = useTranslation('common');

  const SORT_OPTIONS: { key: ClawHubBrowseSort; label: string }[] = useMemo(() => ([
    { key: 'stars', label: t('Stars') },
    { key: 'installs', label: t('Installs') },
    { key: 'downloads', label: t('Downloads') },
    { key: 'updated', label: t('Updated') },
    { key: 'newest', label: t('Newest') },
    { key: 'name', label: t('Name') },
  ]), [t]);

  const [sort, setSort] = useState<ClawHubBrowseSort>(route.params?.initialSort ?? 'stars');
  const [items, setItems] = useState<DiscoverSkillItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchResults, setSearchResults] = useState<DiscoverSkillItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const requestIdRef = useRef(0);
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  useNativeStackModalHeader({
    navigation,
    title: t('ClawHub'),
    onClose: () => navigation.goBack(),
  });

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(query.trim()), 280);
    return () => clearTimeout(timeout);
  }, [query]);

  const loadFirstPage = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    const reqId = ++requestIdRef.current;
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    setError(null);
    try {
      const page = await fetchClawHubBrowsePage({ sort, numItems: PAGE_SIZE });
      if (reqId !== requestIdRef.current) return;
      setItems(page.items);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (err: unknown) {
      if (reqId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : t('Discover feed failed'));
      setItems([]);
      setHasMore(false);
    } finally {
      if (reqId === requestIdRef.current) {
        if (mode === 'initial') setLoading(false);
        if (mode === 'refresh') setRefreshing(false);
      }
    }
  }, [sort, t]);

  useEffect(() => {
    void loadFirstPage('initial');
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !cursor || debouncedQuery) return;
    const reqId = requestIdRef.current;
    setLoadingMore(true);
    try {
      const page = await fetchClawHubBrowsePage({ sort, numItems: PAGE_SIZE, cursor });
      if (reqId !== requestIdRef.current) return;
      setItems((prev) => {
        const seen = new Set(prev.map((item) => item.id));
        const merged = [...prev];
        for (const item of page.items) {
          if (!seen.has(item.id)) merged.push(item);
        }
        return merged;
      });
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      // Keep current page; user can retry by scrolling again
    } finally {
      if (reqId === requestIdRef.current) setLoadingMore(false);
    }
  }, [cursor, debouncedQuery, hasMore, loadingMore, sort]);

  useEffect(() => {
    let cancelled = false;
    if (!debouncedQuery) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    searchClawHubSkills(debouncedQuery, 24)
      .then((results) => {
        if (!cancelled) setSearchResults(results);
      })
      .catch(() => {
        if (!cancelled) setSearchResults([]);
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });
    return () => { cancelled = true; };
  }, [debouncedQuery]);

  const openDetail = (item: DiscoverSkillItem) => {
    analyticsEvents.discoverSkillOpened({
      source: item.source,
      location: debouncedQuery ? 'search' : 'home',
    });
    navigation.navigate('DiscoverDetail', { item });
  };

  const renderItem = ({ item }: { item: DiscoverSkillItem }) => (
    <View style={styles.itemWrapper}>
      <DiscoverSkillCard item={item} onPress={() => openDetail(item)} />
    </View>
  );

  const listHeader = (
    <View>
      <SearchInput
        value={query}
        onChangeText={setQuery}
        placeholder={t('Search ClawHub skills...')}
        style={styles.search}
      />
      {!debouncedQuery ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.sortRow}
        >
          {SORT_OPTIONS.map((option) => {
            const active = option.key === sort;
            return (
              <TouchableOpacity
                key={option.key}
                onPress={() => setSort(option.key)}
                style={[
                  styles.sortChip,
                  {
                    backgroundColor: active ? theme.colors.primary : theme.colors.surface,
                    borderColor: active ? theme.colors.primary : theme.colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.sortChipLabel,
                    { color: active ? theme.colors.primaryText : theme.colors.text },
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );

  const data = debouncedQuery ? searchResults : items;
  const showInitialLoading = debouncedQuery ? searchLoading && data.length === 0 : loading && data.length === 0;

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        contentContainerStyle={[styles.listContent, { paddingBottom: Space.xl }]}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { void loadFirstPage('refresh'); }}
            tintColor={theme.colors.primary}
          />
        }
        ListEmptyComponent={
          showInitialLoading ? (
            <View style={styles.centerBlock}><ActivityIndicator color={theme.colors.primary} /></View>
          ) : error ? (
            <EmptyState icon="⚠️" title={t('Discover feed failed')} subtitle={error} />
          ) : (
            <EmptyState icon="🔎" title={t('No discover results')} />
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footerSpinner}><ActivityIndicator color={theme.colors.primary} /></View>
          ) : !hasMore && data.length > 0 && !debouncedQuery ? (
            <Text style={[styles.endLabel, { color: theme.colors.textMuted }]}>{t("You've reached the end")}</Text>
          ) : null
        }
      />
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: { flex: 1 },
    listContent: {
      paddingHorizontal: Space.lg,
      paddingTop: Space.md,
      paddingBottom: Space.xxxl,
    },
    search: {
      marginBottom: Space.md,
    },
    sortRow: {
      gap: Space.sm,
      paddingBottom: Space.md,
    },
    sortChip: {
      paddingHorizontal: Space.md,
      paddingVertical: 6,
      borderRadius: Radius.full,
      borderWidth: StyleSheet.hairlineWidth,
    },
    sortChipLabel: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    itemWrapper: {
      marginBottom: Space.md,
    },
    centerBlock: {
      paddingVertical: Space.xxl,
      alignItems: 'center',
    },
    footerSpinner: {
      paddingVertical: Space.lg,
      alignItems: 'center',
    },
    endLabel: {
      textAlign: 'center',
      paddingVertical: Space.lg,
      fontSize: FontSize.sm,
    },
  });
}
