import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshControl,
  SectionList,
  SectionListData,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MenuAction, MenuView } from '@react-native-menu/menu';
import { ArrowUpDown, ChevronDown, ChevronRight, Plus } from 'lucide-react-native';
import { CommonActions, useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Card,
  EmptyState,
  HeaderActionButton,
  LoadingState,
  SearchInput,
  ScreenLayout,
  createListContentStyle,
} from '../../components/ui';
import { useTranslation } from 'react-i18next';
import { useAppContext } from '../../contexts/AppContext';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { analyticsEvents } from '../../services/analytics/events';
import { resolveGatewayBackendKind } from '../../services/gateway-backends';
import { StorageService, getDefaultSkillListSortMode } from '../../services/storage';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type { SkillStatusEntry, SkillStatusReport } from '../../types';
import type { ConsoleStackParamList } from './ConsoleTab';

type SkillListNavigation = NativeStackNavigationProp<ConsoleStackParamList, 'SkillList'>;

type SkillSection = {
  key: string;
  title: string;
  order: number;
  data: SkillStatusEntry[];
};

type SkillSortMode = 'name' | 'createdAsc' | 'createdDesc' | 'updatedAsc' | 'updatedDesc';

const SOURCE_GROUPS: Array<{ key: string; title: string; order: number; sources: string[] }> = [
  { key: 'workspace', title: 'Workspace', order: 0, sources: ['workspace', 'openclaw-workspace'] },
  { key: 'extensions', title: 'Extensions', order: 1, sources: ['openclaw-extension', 'extension', 'openclaw-extra'] },
  { key: 'built-in', title: 'Built-in', order: 2, sources: ['openclaw-bundled', 'built-in'] },
  { key: 'managed', title: 'Managed', order: 3, sources: ['managed', 'openclaw-managed'] },
];

function resolveSourceGroup(source: string): { key: string; title: string; order: number } {
  const normalized = source.trim().toLowerCase();
  const match = SOURCE_GROUPS.find((group) => group.sources.includes(normalized));
  if (match) {
    return { key: match.key, title: match.title, order: match.order };
  }
  const fallbackTitle = source.trim() || 'Other';
  return {
    key: `other:${normalized || 'other'}`,
    title: fallbackTitle,
    order: 10,
  };
}

function resolveSkillStatus(skill: SkillStatusEntry): {
  label: 'Active' | 'Unavailable' | 'Disabled';
  colorToken: 'success' | 'warning' | 'muted';
} {
  if (skill.disabled) {
    return { label: 'Disabled', colorToken: 'muted' };
  }
  if (skill.eligible) {
    return { label: 'Active', colorToken: 'success' };
  }
  return { label: 'Unavailable', colorToken: 'warning' };
}

function sortSkills(skills: SkillStatusEntry[], sortMode: SkillSortMode): SkillStatusEntry[] {
  return [...skills].sort((left, right) => {
    if (sortMode === 'createdAsc') {
      const diff = (left.createdAtMs ?? 0) - (right.createdAtMs ?? 0);
      if (diff !== 0) return diff;
    } else if (sortMode === 'createdDesc') {
      const diff = (right.createdAtMs ?? 0) - (left.createdAtMs ?? 0);
      if (diff !== 0) return diff;
    } else if (sortMode === 'updatedAsc') {
      const diff = (left.updatedAtMs ?? 0) - (right.updatedAtMs ?? 0);
      if (diff !== 0) return diff;
    } else if (sortMode === 'updatedDesc') {
      const diff = (right.updatedAtMs ?? 0) - (left.updatedAtMs ?? 0);
      if (diff !== 0) return diff;
    }
    return left.name.localeCompare(right.name);
  });
}

export function SkillListScreen(): React.JSX.Element {
  const { gateway, gatewayEpoch, currentAgentId, config } = useAppContext();
  const { theme } = useAppTheme();
  const { t } = useTranslation('console');
  const navigation = useNavigation<SkillListNavigation>();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const backendKind = resolveGatewayBackendKind(config);

  const handleOpenDiscover = useCallback(() => {
    analyticsEvents.clawHubCreateTapped({
      source: 'skill_list_header',
    });
    const state = navigation.getState();
    if (state.routeNames.includes('ConsoleMenu')) {
      // Inside ConsoleStack — reset to full-screen push from ConsoleMenu
      navigation.dispatch(
        CommonActions.reset({
          index: 1,
          routes: [{ name: 'ConsoleMenu' }, { name: 'Discover' }],
        }),
      );
    } else {
      // At RootStack level (opened from Office/Chat) —
      // atomic reset: dismiss SkillList + switch to Console tab with Discover
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      navigation.dispatch((rootState: any) => {
        const mainTabsRoute = rootState.routes.find((r: any) => r.name === 'MainTabs');
        const tabState = mainTabsRoute?.state;
        const consoleIndex = tabState?.routes?.findIndex((r: any) => r.name === 'Console') ?? 2;
        return CommonActions.reset({
          index: 0,
          routes: [{
            name: 'MainTabs' as any,
            state: tabState ? {
              ...tabState,
              index: consoleIndex,
              routes: tabState.routes.map((r: any) =>
                r.name === 'Console'
                  ? { ...r, state: { routes: [{ name: 'ConsoleMenu' }, { name: 'Discover' }] } }
                  : r,
              ),
            } : undefined,
          }],
        });
      });
    }
  }, [navigation]);

  const [report, setReport] = useState<SkillStatusReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [sortMode, setSortMode] = useState<SkillSortMode>(
    getDefaultSkillListSortMode(backendKind),
  );

  const sortMenuActions = useMemo<MenuAction[]>(() => [
    { id: 'name', title: t('Sort by name'), state: sortMode === 'name' ? 'on' : 'off' },
    { id: 'createdAsc', title: t('Sort by creation time ↑'), state: sortMode === 'createdAsc' ? 'on' : 'off' },
    { id: 'createdDesc', title: t('Sort by creation time ↓'), state: sortMode === 'createdDesc' ? 'on' : 'off' },
    { id: 'updatedAsc', title: t('Sort by updated time ↑'), state: sortMode === 'updatedAsc' ? 'on' : 'off' },
    { id: 'updatedDesc', title: t('Sort by updated time ↓'), state: sortMode === 'updatedDesc' ? 'on' : 'off' },
  ], [sortMode, t]);

  useEffect(() => {
    let active = true;
    StorageService.getSkillListSortMode(backendKind)
      .then((storedMode) => {
        if (!active) return;
        setSortMode(storedMode);
      })
      .catch(() => {
        // Best-effort preference only.
      });
    return () => {
      active = false;
    };
  }, [backendKind]);

  useEffect(() => {
    void StorageService.setSkillListSortMode(backendKind, sortMode);
  }, [backendKind, sortMode]);

  useNativeStackModalHeader({
    navigation,
    title: t('Skills'),
    onClose: () => navigation.goBack(),
    rightContent: (
      <View style={styles.headerActions}>
        <MenuView
          actions={sortMenuActions}
          onPressAction={({ nativeEvent }) => {
            if (
              nativeEvent.event === 'name'
              || nativeEvent.event === 'createdAsc'
              || nativeEvent.event === 'createdDesc'
              || nativeEvent.event === 'updatedAsc'
              || nativeEvent.event === 'updatedDesc'
            ) {
              setSortMode(nativeEvent.event);
            }
          }}
        >
          <View>
            <HeaderActionButton icon={ArrowUpDown} onPress={() => undefined} size={18} />
          </View>
        </MenuView>
        <HeaderActionButton icon={Plus} onPress={handleOpenDiscover} size={20} />
      </View>
    ),
  });

  const loadSkills = useCallback(async (mode: 'initial' | 'refresh' | 'background' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);

    try {
      const nextReport = await gateway.getSkillsStatus(currentAgentId);
      setReport(nextReport);
      setError(null);
      setHasLoadedOnce(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load skills';
      setError(message);
    } finally {
      if (mode === 'initial') setLoading(false);
      if (mode === 'refresh') setRefreshing(false);
    }
  }, [currentAgentId, gateway, gatewayEpoch]);

  useFocusEffect(
    useCallback(() => {
      loadSkills(hasLoadedOnce ? 'background' : 'initial').catch(() => {
        // Error state is handled in loadSkills.
      });
    }, [hasLoadedOnce, loadSkills]),
  );

  const skills = report?.skills ?? [];

  const sections = useMemo<SkillSection[]>(() => {
    const grouped = new Map<string, SkillSection>();

    for (const skill of skills) {
      const group = resolveSourceGroup(skill.source);
      const existing = grouped.get(group.key);
      if (existing) {
        existing.data.push(skill);
      } else {
        grouped.set(group.key, {
          key: group.key,
          title: group.title,
          order: group.order,
          data: [skill],
        });
      }
    }

    const nextSections = Array.from(grouped.values()).map((section) => ({
      ...section,
      data: sortSkills(section.data, sortMode),
    }));

    nextSections.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.title.localeCompare(b.title);
    });

    return nextSections;
  }, [skills, sortMode]);

  const filteredSections = useMemo(() => {
    const needle = filterText.trim().toLowerCase();
    if (!needle) return sections;
    return sections
      .map((section) => ({
        ...section,
        data: section.data.filter(
          (skill) =>
            skill.name.toLowerCase().includes(needle) ||
            (skill.description ?? '').toLowerCase().includes(needle) ||
            skill.skillKey.toLowerCase().includes(needle),
        ),
      }))
      .filter((section) => section.data.length > 0);
  }, [sections, filterText]);

  const displaySections = useMemo(() => {
    return filteredSections.map((section) => ({
      ...section,
      data: collapsedSections.has(section.key) ? [] : section.data,
    }));
  }, [filteredSections, collapsedSections]);

  const toggleSection = useCallback((sectionKey: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) {
        next.delete(sectionKey);
      } else {
        next.add(sectionKey);
      }
      return next;
    });
  }, []);

  const renderSectionHeader = ({ section }: { section: SectionListData<SkillStatusEntry, SkillSection> }) => {
    const isCollapsed = collapsedSections.has(section.key);
    const fullSection = filteredSections.find((s) => s.key === section.key);
    const count = fullSection?.data.length ?? 0;

    return (
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => toggleSection(section.key)}
        activeOpacity={0.6}
      >
        {isCollapsed
          ? <ChevronRight size={16} color={theme.colors.textMuted} strokeWidth={2.5} />
          : <ChevronDown size={16} color={theme.colors.textMuted} strokeWidth={2.5} />
        }
        <Text style={styles.sectionTitle}>{section.title}</Text>
        <Text style={styles.sectionCount}>{count}</Text>
      </TouchableOpacity>
    );
  };

  const renderItem = ({ item }: { item: SkillStatusEntry }) => {
    const status = resolveSkillStatus(item);
    const statusColor =
      status.colorToken === 'success'
        ? theme.colors.success
        : status.colorToken === 'warning'
          ? theme.colors.warning
          : theme.colors.textSubtle;

    return (
      <Card
        style={styles.card}
        onPress={() => navigation.navigate('SkillDetail', { skillKey: item.skillKey })}
      >
        <View style={styles.cardHead}>
          <View style={styles.cardMain}>
            <Text style={styles.cardEmoji}>{item.emoji ?? '⚡'}</Text>
            <View style={styles.cardTextWrap}>
              <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.cardDescription} numberOfLines={1}>{item.description}</Text>
            </View>
          </View>

          <View style={styles.cardStatusWrap}>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={styles.statusLabel}>{t(status.label)}</Text>
            </View>
            {item.always ? (
              <View style={styles.alwaysBadge}>
                <Text style={styles.alwaysBadgeText}>{t('Always on')}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </Card>
    );
  };

  return (
    <View style={styles.root}>
      {loading ? (
        <LoadingState message={t('Loading skills...')} />
      ) : (
        <>
          <SearchInput
            value={filterText}
            onChangeText={setFilterText}
            placeholder={t('Search skills...')}
            style={styles.searchWrap}
          />
          <SectionList
            sections={displaySections}
            keyExtractor={(item) => item.skillKey}
            contentContainerStyle={styles.content}
            stickySectionHeadersEnabled={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => loadSkills('refresh')}
                tintColor={theme.colors.primary}
              />
            }
            ListHeaderComponent={
              error ? (
                <View style={styles.errorCard}>
                  <Text style={styles.errorTitle}>{t('Failed to load skills')}</Text>
                  <Text style={styles.errorText}>{error}</Text>
                  <TouchableOpacity
                    style={styles.retryButton}
                    onPress={() => loadSkills(hasLoadedOnce ? 'background' : 'initial')}
                  >
                    <Text style={styles.retryText}>{t('common:Retry')}</Text>
                  </TouchableOpacity>
                </View>
              ) : null
            }
            ListEmptyComponent={
              <EmptyState icon="⚡" title={t('No skills found')} />
            }
            renderSectionHeader={renderSectionHeader}
            renderItem={renderItem}
          />
        </>
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
    searchWrap: {
      marginHorizontal: Space.lg,
      marginTop: ScreenLayout.listTop,
      marginBottom: Space.xs,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: Space.sm,
      marginBottom: Space.xs,
      gap: Space.sm,
    },
    sectionTitle: {
      flex: 1,
      color: colors.textMuted,
      fontSize: FontSize.md,
      fontWeight: FontWeight.bold,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    sectionCount: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
    },
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.md,
      padding: Space.lg - 2,
      marginBottom: Space.md - 2,
    },
    cardHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    cardMain: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      minWidth: 0,
    },
    cardEmoji: {
      fontSize: 20,
    },
    cardTextWrap: {
      flex: 1,
      minWidth: 0,
    },
    cardTitle: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    cardDescription: {
      marginTop: 2,
      fontSize: FontSize.md,
      color: colors.textMuted,
    },
    cardStatusWrap: {
      alignItems: 'flex-end',
      gap: 6,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    statusLabel: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
      fontWeight: FontWeight.semibold,
    },
    alwaysBadge: {
      borderRadius: Radius.sm + 2,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: Space.sm,
      paddingVertical: 3,
    },
    alwaysBadgeText: {
      color: colors.textMuted,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
    centerState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Space.lg + Space.xs,
    },
    stateText: {
      marginTop: Space.md - 2,
      color: colors.textMuted,
      fontSize: FontSize.md,
      textAlign: 'center',
    },
    errorCard: {
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.error,
      padding: Space.md,
      marginBottom: Space.md - 2,
    },
    errorTitle: {
      color: colors.error,
      fontSize: FontSize.md + 1,
      fontWeight: FontWeight.bold,
    },
    errorText: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      marginTop: Space.xs,
    },
    retryButton: {
      marginTop: Space.md - 2,
      alignSelf: 'flex-start',
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
