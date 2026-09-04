import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Card, EmptyState, LoadingState, SearchInput, createCardContentStyle } from '../../components/ui';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { searchDiscoverSkills } from '../../features/discover';
import { fetchClawHubLatest, fetchClawHubTrending } from '../../features/discover/clawhub';
import { fetchSkillsShHot } from '../../features/discover/skillsSh';
import { interleaveSkillLists } from '../../features/discover/helpers';
import type { ClawHubBrowseSort, DiscoverSkillItem } from '../../features/discover/types';
import { analyticsEvents } from '../../services/analytics/events';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type { DiscoverStackParamList } from './sharedNavigator';
import { DiscoverSkillCard, DiscoverSkillRailCard, DiscoverSkillRow } from './components/DiscoverSkillCard';
import { DiscoverRailSkeleton, DiscoverSectionSkeleton } from './components/DiscoverSkillSkeleton';

type DiscoverNavigation = NativeStackNavigationProp<DiscoverStackParamList, 'DiscoverHome'>;

const SECTION_LIMIT = 4;

export function DiscoverHomeScreen(): React.JSX.Element {
  const navigation = useNavigation<DiscoverNavigation>();
  const { theme } = useAppTheme();
  const { t } = useTranslation('common');
  const parentNavigation = navigation.getParent();

  const [clawHubHot, setClawHubHot] = useState<DiscoverSkillItem[] | null>(null);
  const [skillsShHot, setSkillsShHot] = useState<DiscoverSkillItem[] | null>(null);
  const [clawHubFresh, setClawHubFresh] = useState<DiscoverSkillItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [errors, setErrors] = useState<{ clawHubHot?: string; skillsShHot?: string; clawHubFresh?: string }>({});

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchResults, setSearchResults] = useState<DiscoverSkillItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const requestIdRef = useRef(0);
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(query.trim()), 280);
    return () => clearTimeout(timeout);
  }, [query]);

  const loadHome = useCallback((mode: 'initial' | 'refresh') => {
    const reqId = ++requestIdRef.current;
    if (mode === 'refresh') setRefreshing(true);
    setErrors({});

    let pending = 3;
    const done = () => {
      if (reqId !== requestIdRef.current) return;
      pending -= 1;
      if (pending === 0) {
        setRefreshing(false);
        setLastRefreshedAt(Date.now());
      }
    };

    const guard = <T,>(setter: (v: T) => void) => (value: T) => {
      if (reqId === requestIdRef.current) setter(value);
    };

    fetchClawHubTrending(16)
      .then(guard(setClawHubHot))
      .catch(() => {
        if (reqId !== requestIdRef.current) return;
        setClawHubHot([]);
        setErrors((prev) => ({ ...prev, clawHubHot: t('Discover feed failed') }));
      })
      .finally(done);

    fetchSkillsShHot(16)
      .then(guard(setSkillsShHot))
      .catch(() => {
        if (reqId !== requestIdRef.current) return;
        setSkillsShHot([]);
        setErrors((prev) => ({ ...prev, skillsShHot: t('Discover feed failed') }));
      })
      .finally(done);

    fetchClawHubLatest(12)
      .then(guard(setClawHubFresh))
      .catch(() => {
        if (reqId !== requestIdRef.current) return;
        setClawHubFresh([]);
        setErrors((prev) => ({ ...prev, clawHubFresh: t('Discover feed failed') }));
      })
      .finally(done);
  }, [t]);

  useEffect(() => {
    loadHome('initial');
  }, [loadHome]);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const refreshedLabel = useMemo(() => {
    if (lastRefreshedAt == null) return null;
    const diffMs = Math.max(0, nowTick - lastRefreshedAt);
    const diffMinutes = Math.floor(diffMs / 60_000);
    if (diffMinutes < 1) return t('Updated just now');
    if (diffMinutes < 60) return t('Updated {{count}}m ago', { count: diffMinutes });
    const diffHours = Math.floor(diffMinutes / 60);
    return t('Updated {{count}}h ago', { count: diffHours });
  }, [lastRefreshedAt, nowTick, t]);

  useEffect(() => {
    let cancelled = false;
    if (!debouncedQuery) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError(null);
      return;
    }
    setSearchLoading(true);
    setSearchError(null);
    searchDiscoverSkills(debouncedQuery)
      .then((results) => { if (!cancelled) setSearchResults(results); })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSearchResults([]);
          setSearchError(err instanceof Error ? err.message : t('Discover feed failed'));
        }
      })
      .finally(() => { if (!cancelled) setSearchLoading(false); });
    return () => { cancelled = true; };
  }, [debouncedQuery, t]);

  const mixedTrending = useMemo(() => {
    if (!clawHubHot || !skillsShHot) return null;
    return interleaveSkillLists([clawHubHot, skillsShHot], 8);
  }, [clawHubHot, skillsShHot]);

  const openDetail = (item: DiscoverSkillItem, location: 'home' | 'search') => {
    analyticsEvents.discoverSkillOpened({ source: item.source, location });
    navigation.navigate('DiscoverDetail', { item });
  };

  const openClawHubBrowse = (sort: ClawHubBrowseSort) => {
    navigation.navigate('DiscoverClawHubBrowse', { initialSort: sort });
  };

  const openSkillsShBrowse = () => {
    navigation.navigate('DiscoverSkillsShBrowse');
  };

  const allLoaded = clawHubHot !== null && skillsShHot !== null && clawHubFresh !== null;
  const allEmpty = allLoaded
    && clawHubHot!.length === 0
    && skillsShHot!.length === 0
    && clawHubFresh!.length === 0;
  const allFailed = allLoaded && Boolean(errors.clawHubHot && errors.skillsShHot && errors.clawHubFresh);

  useNativeStackModalHeader({
    navigation: parentNavigation as any,
    title: t('Discover'),
    onClose: () => parentNavigation?.goBack(),
  });

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background, paddingTop: 0 }]}>
      <ScrollView
        contentContainerStyle={createCardContentStyle({ top: Space.md, bottom: Space.xl })}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadHome('refresh')}
            tintColor={theme.colors.primary}
            progressViewOffset={Space.md}
          />
        }
      >
        <SearchInput
          value={query}
          onChangeText={(text) => {
            setQuery(text);
            analyticsEvents.discoverSearchChanged({ has_query: text.trim().length > 0 });
          }}
          placeholder={t('Search discover skills...')}
          style={styles.search}
        />

        {debouncedQuery ? (
          <SearchResultsSection
            loading={searchLoading}
            error={searchError}
            results={searchResults}
            onOpen={(item) => openDetail(item, 'search')}
          />
        ) : (
          <>
            {allFailed ? (
              <Card style={styles.errorCard}>
                <Text style={[styles.errorTitle, { color: theme.colors.error }]}>{t('Discover feed failed')}</Text>
              </Card>
            ) : null}

            <RailSlot
              items={mixedTrending}
              title={t("Today's Picks")}
              subtitle={refreshedLabel
                ? `${t('Hand-mixed from ClawHub and skills.sh')} · ${refreshedLabel}`
                : t('Hand-mixed from ClawHub and skills.sh')}
              onOpen={(item) => openDetail(item, 'home')}
            />

            <SectionSlot
              items={clawHubHot}
              title={t('Hot Right Now on ClawHub')}
              subtitle={t('What others are installing right now')}
              onOpen={(item) => openDetail(item, 'home')}
              onSeeAll={() => openClawHubBrowse('installs')}
            />

            <SectionSlot
              items={skillsShHot}
              title={t('Trending on skills.sh')}
              subtitle={t('Climbing the leaderboard today')}
              onOpen={(item) => openDetail(item, 'home')}
              onSeeAll={openSkillsShBrowse}
            />

            <SectionSlot
              items={clawHubFresh}
              title={t('Just Shipped')}
              subtitle={t('Updated in the last day on ClawHub')}
              onOpen={(item) => openDetail(item, 'home')}
              onSeeAll={() => openClawHubBrowse('updated')}
            />

            <BrowseAllSection
              onOpenClawHub={() => openClawHubBrowse('stars')}
              onOpenSkillsSh={openSkillsShBrowse}
            />

            {allEmpty ? <EmptyState icon="🧭" title={t('No discover results')} /> : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function SectionSlot({
  items,
  title,
  subtitle,
  onOpen,
  onSeeAll,
}: {
  items: DiscoverSkillItem[] | null;
  title: string;
  subtitle: string;
  onOpen: (item: DiscoverSkillItem) => void;
  onSeeAll: () => void;
}): React.JSX.Element | null {
  if (items === null) return <DiscoverSectionSkeleton rows={SECTION_LIMIT} />;
  if (items.length === 0) return null;
  return (
    <Section
      title={title}
      subtitle={subtitle}
      items={items}
      onOpen={onOpen}
      onSeeAll={onSeeAll}
    />
  );
}

function RailSlot({
  items,
  title,
  subtitle,
  onOpen,
  onSeeAll,
}: {
  items: DiscoverSkillItem[] | null;
  title: string;
  subtitle: string;
  onOpen: (item: DiscoverSkillItem) => void;
  onSeeAll?: () => void;
}): React.JSX.Element | null {
  if (items === null) return <DiscoverRailSkeleton count={3} />;
  if (items.length === 0) return null;
  return (
    <Rail
      title={title}
      subtitle={subtitle}
      items={items}
      onOpen={onOpen}
      onSeeAll={onSeeAll}
    />
  );
}

function Rail({
  title,
  subtitle,
  items,
  onOpen,
  onSeeAll,
}: {
  title: string;
  subtitle: string;
  items: DiscoverSkillItem[];
  onOpen: (item: DiscoverSkillItem) => void;
  onSeeAll?: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('common');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleBlock}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>{title}</Text>
          <Text style={[styles.sectionSubtitle, { color: theme.colors.textMuted }]}>{subtitle}</Text>
        </View>
        {onSeeAll ? (
          <TouchableOpacity onPress={onSeeAll} style={styles.seeAllButton} hitSlop={8}>
            <Text style={[styles.seeAllText, { color: theme.colors.primary }]}>{t('See all')}</Text>
            <ChevronRight size={16} color={theme.colors.primary} strokeWidth={2.2} />
          </TouchableOpacity>
        ) : null}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.railContent}
      >
        {items.map((item) => (
          <DiscoverSkillRailCard key={item.id} item={item} onPress={() => onOpen(item)} />
        ))}
      </ScrollView>
    </View>
  );
}

function SearchResultsSection({
  loading,
  error,
  results,
  onOpen,
}: {
  loading: boolean;
  error: string | null;
  results: DiscoverSkillItem[];
  onOpen: (item: DiscoverSkillItem) => void;
}): React.JSX.Element {
  const { t } = useTranslation('common');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  if (loading) return <LoadingState message={t('Searching skills...')} />;
  if (error) {
    return (
      <Card style={styles.errorCard}>
        <Text style={[styles.errorTitle, { color: theme.colors.error }]}>{t('Search failed')}</Text>
        <Text style={[styles.errorBody, { color: theme.colors.textMuted }]}>{error}</Text>
      </Card>
    );
  }
  if (results.length === 0) {
    return <EmptyState icon="🔎" title={t('No discover results')} />;
  }
  return (
    <View style={styles.cardList}>
      {results.map((item) => (
        <DiscoverSkillCard key={item.id} item={item} onPress={() => onOpen(item)} />
      ))}
    </View>
  );
}

function Section({
  title,
  subtitle,
  items,
  onOpen,
  onSeeAll,
}: {
  title: string;
  subtitle: string;
  items: DiscoverSkillItem[];
  onOpen: (item: DiscoverSkillItem) => void;
  onSeeAll: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('common');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const visible = items.slice(0, SECTION_LIMIT);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleBlock}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>{title}</Text>
          <Text style={[styles.sectionSubtitle, { color: theme.colors.textMuted }]}>{subtitle}</Text>
        </View>
        <TouchableOpacity onPress={onSeeAll} style={styles.seeAllButton} hitSlop={8}>
          <Text style={[styles.seeAllText, { color: theme.colors.primary }]}>{t('See all')}</Text>
          <ChevronRight size={16} color={theme.colors.primary} strokeWidth={2.2} />
        </TouchableOpacity>
      </View>
      <View style={styles.rowList}>
        {visible.map((item) => (
          <DiscoverSkillRow key={item.id} item={item} onPress={() => onOpen(item)} />
        ))}
      </View>
    </View>
  );
}

function BrowseAllSection({
  onOpenClawHub,
  onOpenSkillsSh,
}: {
  onOpenClawHub: () => void;
  onOpenSkillsSh: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('common');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleBlock}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>{t('Browse by source')}</Text>
          <Text style={[styles.sectionSubtitle, { color: theme.colors.textMuted }]}>
            {t('Dive into the full catalog and sort by what matters to you')}
          </Text>
        </View>
      </View>
      <View style={styles.browseList}>
        <BrowseEntryCard
          accent={theme.colors.primary}
          title={t('Browse all ClawHub')}
          subtitle={t('Sort by stars, installs, downloads, updates and more')}
          onPress={onOpenClawHub}
        />
        <BrowseEntryCard
          accent={theme.colors.primary}
          title={t('Browse all skills.sh')}
          subtitle={t('Hot, all-time and official lists from skills.sh')}
          onPress={onOpenSkillsSh}
        />
      </View>
    </View>
  );
}

function BrowseEntryCard({
  title,
  subtitle,
  accent,
  onPress,
}: {
  title: string;
  subtitle: string;
  accent: string;
  onPress: () => void;
}): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  return (
    <Card style={styles.browseCard} onPress={onPress}>
      <View style={styles.browseRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.browseTitle, { color: theme.colors.text }]} numberOfLines={1}>{title}</Text>
          <Text style={[styles.browseSubtitle, { color: theme.colors.textMuted }]} numberOfLines={2}>{subtitle}</Text>
        </View>
        <ChevronRight size={20} color={accent} strokeWidth={2.2} />
      </View>
    </Card>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: { flex: 1 },
    search: { marginBottom: Space.xl },
    section: {
      marginBottom: Space.xl,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: Space.md,
    },
    sectionTitleBlock: {
      flex: 1,
      paddingRight: Space.sm,
    },
    sectionTitle: {
      fontSize: FontSize.xl,
      fontWeight: FontWeight.bold,
      marginBottom: 2,
    },
    sectionSubtitle: {
      fontSize: FontSize.sm,
      lineHeight: 18,
    },
    seeAllButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      paddingVertical: 4,
      paddingHorizontal: 4,
    },
    seeAllText: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    rowList: {
      gap: Space.sm,
    },
    railContent: {
      gap: Space.md,
      paddingRight: Space.sm,
    },
    browseList: {
      gap: Space.md,
    },
    browseCard: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      borderRadius: Radius.lg,
      paddingVertical: Space.lg,
    },
    browseRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
    },
    browseTitle: {
      fontSize: FontSize.lg,
      fontWeight: FontWeight.semibold,
      marginBottom: 2,
    },
    browseSubtitle: {
      fontSize: FontSize.sm,
      lineHeight: 18,
    },
    cardList: {
      gap: Space.md,
    },
    errorCard: {
      marginBottom: Space.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    errorTitle: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      marginBottom: Space.xs,
    },
    errorBody: {
      fontSize: FontSize.md,
      lineHeight: 18,
    },
  });
}
