import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { EmptyState, SearchInput, SegmentedTabs } from '../../components/ui';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import type { SegmentedTabItem } from '../../components/ui';
import { fetchSkillsShBrowseList } from '../../features/discover';
import { searchSkillsSh } from '../../features/discover/skillsSh';
import type { DiscoverSkillItem, SkillsShBrowseView } from '../../features/discover/types';
import { analyticsEvents } from '../../services/analytics/events';
import { useAppTheme } from '../../theme';
import { Space } from '../../theme/tokens';
import type { DiscoverStackParamList } from './sharedNavigator';
import { DiscoverSkillCard } from './components/DiscoverSkillCard';

type Nav = NativeStackNavigationProp<DiscoverStackParamList, 'DiscoverSkillsShBrowse'>;

export function SkillsShBrowseScreen(): React.JSX.Element {
  const navigation = useNavigation<Nav>();
  const { theme } = useAppTheme();
  const { t } = useTranslation('common');

  useNativeStackModalHeader({
    navigation,
    title: 'skills.sh',
    onClose: () => navigation.goBack(),
  });

  const tabs = useMemo<SegmentedTabItem<SkillsShBrowseView>[]>(() => ([
    { key: 'hot', label: t('Hot') },
    { key: 'all-time', label: t('All-time') },
  ]), [t]);

  const [view, setView] = useState<SkillsShBrowseView>('hot');
  const [items, setItems] = useState<DiscoverSkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchResults, setSearchResults] = useState<DiscoverSkillItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const requestIdRef = useRef(0);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(query.trim()), 280);
    return () => clearTimeout(timeout);
  }, [query]);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    const reqId = ++requestIdRef.current;
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    setError(null);
    try {
      const list = await fetchSkillsShBrowseList(view, 80);
      if (reqId !== requestIdRef.current) return;
      setItems(list);
    } catch (err: unknown) {
      if (reqId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : t('Discover feed failed'));
      setItems([]);
    } finally {
      if (reqId === requestIdRef.current) {
        if (mode === 'initial') setLoading(false);
        if (mode === 'refresh') setRefreshing(false);
      }
    }
  }, [view, t]);

  useEffect(() => { void load('initial'); }, [load]);

  useEffect(() => {
    let cancelled = false;
    if (!debouncedQuery) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    searchSkillsSh(debouncedQuery, 32)
      .then((results) => { if (!cancelled) setSearchResults(results); })
      .catch(() => { if (!cancelled) setSearchResults([]); })
      .finally(() => { if (!cancelled) setSearchLoading(false); });
    return () => { cancelled = true; };
  }, [debouncedQuery]);

  const openDetail = (item: DiscoverSkillItem) => {
    analyticsEvents.discoverSkillOpened({
      source: item.source,
      location: debouncedQuery ? 'search' : 'home',
    });
    navigation.navigate('DiscoverDetail', { item });
  };

  const data = debouncedQuery ? searchResults : items;
  const showLoading = debouncedQuery ? searchLoading && data.length === 0 : loading && data.length === 0;

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.itemWrapper}>
            <DiscoverSkillCard item={item} onPress={() => openDetail(item)} />
          </View>
        )}
        ListHeaderComponent={
          <View>
            <SearchInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('Search skills.sh skills...')}
              style={styles.search}
            />
            {!debouncedQuery ? (
              <SegmentedTabs tabs={tabs} active={view} onSwitch={setView} containerStyle={styles.segmented} />
            ) : null}
          </View>
        }
        contentContainerStyle={[styles.listContent, { paddingBottom: Space.xl }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { void load('refresh'); }}
            tintColor={theme.colors.primary}
          />
        }
        ListEmptyComponent={
          showLoading ? (
            <View style={styles.centerBlock}><ActivityIndicator color={theme.colors.primary} /></View>
          ) : error ? (
            <EmptyState icon="⚠️" title={t('Discover feed failed')} subtitle={error} />
          ) : (
            <EmptyState icon="🔎" title={t('No discover results')} />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  listContent: {
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    paddingBottom: Space.xxxl,
  },
  search: {
    marginBottom: Space.md,
  },
  segmented: {
    marginHorizontal: 0,
    marginTop: 0,
    marginBottom: Space.md,
  },
  itemWrapper: {
    marginBottom: Space.md,
  },
  centerBlock: {
    paddingVertical: Space.xxl,
    alignItems: 'center',
  },
});
