import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import { Plus, RefreshCw } from 'lucide-react-native';
import { Animated, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { EmptyState, HeaderActionButton, SegmentedTabs, createListContentStyle } from '../../components/ui';
import { YouMindAddMaterialSheet } from '../../components/console/YouMindAddMaterialSheet';
import { useAppContext } from '../../contexts/AppContext';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { analyticsEvents } from '../../services/analytics/events';
import { YouMindClient, type YouMindBoardDetail, type YouMindBoardEntry, type YouMindBoardEntryFilterType } from '../../services/youmind';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type { ConsoleStackParamList } from './ConsoleTab';
import { YouMindBoardControls } from './components/YouMindBoardControls';
import { YouMindBoardFilterModal } from './components/YouMindBoardFilterModal';
import { YouMindEntryRow } from './components/YouMindEntryRow';
import { YouMindWaterfallMasonryList } from './components/YouMindWaterfallMasonryList';
import { filterEntriesByTypes, getAvailableFilterOptions, getFilterLabelKey } from './components/youmindBoardFilters';

type BoardDetailNavigation = NativeStackNavigationProp<ConsoleStackParamList, 'YouMindBoardDetail'>;
type BoardDetailRoute = RouteProp<ConsoleStackParamList, 'YouMindBoardDetail'>;
type BoardDetailTab = 'materials' | 'crafts';

function entryCollapseKey(entry: YouMindBoardEntry): string {
  return `${entry.section}:${entry.id}`;
}

function getVisibleEntries(entries: YouMindBoardEntry[], collapsedKeys: Set<string>): YouMindBoardEntry[] {
  const visible: YouMindBoardEntry[] = [];
  const collapsedStack: Array<{ depth: number; key: string }> = [];

  for (const entry of entries) {
    while (collapsedStack.length > 0 && entry.depth <= collapsedStack[collapsedStack.length - 1]!.depth) {
      collapsedStack.pop();
    }

    if (collapsedStack.length === 0) {
      visible.push(entry);
    }

    if (entry.kind === 'group' && collapsedKeys.has(entryCollapseKey(entry))) {
      collapsedStack.push({ depth: entry.depth, key: entryCollapseKey(entry) });
    }
  }

  return visible;
}

function useSkeletonOpacity(): Animated.Value {
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return opacity;
}

type SkeletonLineProps = {
  width?: number | `${number}%`;
  height: number;
  radius?: number;
  style?: ViewStyle;
};

function SkeletonLine({
  width = '100%',
  height,
  radius = Radius.sm,
  style,
}: SkeletonLineProps): React.JSX.Element {
  const opacity = useSkeletonOpacity();
  const { theme } = useAppTheme();

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius,
          opacity,
          backgroundColor: theme.colors.surfaceMuted,
        },
        style,
      ]}
    />
  );
}

function YouMindBoardDetailSkeleton({
  styles,
}: {
  styles: ReturnType<typeof createStyles>;
}): React.JSX.Element {
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={createListContentStyle({
        top: Space.md,
        bottom: Space.xxxl,
      })}
      scrollEnabled={false}
    >
      <View style={styles.heroCard}>
        <SkeletonLine width="56%" height={30} radius={Radius.md} />
        <SkeletonLine width="28%" height={16} style={{ marginTop: Space.xs }} />
      </View>

      <View style={styles.tabs}>
        <View style={styles.skeletonTabsRow}>
          <SkeletonLine width="48%" height={38} radius={Radius.full} />
          <SkeletonLine width="48%" height={38} radius={Radius.full} />
        </View>
      </View>

      <View style={styles.skeletonControlsRow}>
        <View style={styles.skeletonControl}>
          <SkeletonLine width={28} height={28} radius={Radius.md} />
          <View style={styles.skeletonControlCopy}>
            <SkeletonLine width="34%" height={12} />
            <SkeletonLine width="58%" height={15} />
          </View>
        </View>
        <View style={styles.skeletonControl}>
          <SkeletonLine width={28} height={28} radius={Radius.md} />
          <View style={styles.skeletonControlCopy}>
            <SkeletonLine width="28%" height={12} />
            <SkeletonLine width="46%" height={15} />
          </View>
        </View>
      </View>

      <View style={styles.skeletonList}>
        {[
          { indent: 0, width: '52%' as const },
          { indent: 16, width: '64%' as const },
          { indent: 16, width: '44%' as const },
          { indent: 0, width: '58%' as const },
          { indent: 0, width: '48%' as const },
          { indent: 16, width: '68%' as const },
          { indent: 16, width: '54%' as const },
        ].map((item, index) => (
          <View key={index} style={[styles.skeletonRow, { marginLeft: item.indent }]}>
            <SkeletonLine width={18} height={18} radius={6} />
            <SkeletonLine width={item.width} height={16} />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export function YouMindBoardDetailScreen(): React.JSX.Element {
  const navigation = useNavigation<BoardDetailNavigation>();
  const route = useRoute<BoardDetailRoute>();
  const { theme } = useAppTheme();
  const { t } = useTranslation('console');
  const { config, activeGatewayConfigId } = useAppContext();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const client = useMemo(
    () => new YouMindClient(config?.url || 'https://youmind.com', { authScopeKey: activeGatewayConfigId }),
    [activeGatewayConfigId, config?.url],
  );
  const [detail, setDetail] = useState<YouMindBoardDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<BoardDetailTab>('materials');
  const [viewMode, setViewMode] = useState<'list' | 'waterfall'>('list');
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<string>>(() => new Set());
  const [addMaterialVisible, setAddMaterialVisible] = useState(false);
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [selectedFilterTypes, setSelectedFilterTypes] = useState<Record<BoardDetailTab, YouMindBoardEntryFilterType[]>>({
    materials: [],
    crafts: [],
  });
  const load = useCallback(async (mode: 'initial' | 'manual' = 'initial') => {
    if (mode === 'manual') setRefreshing(true);
    else setLoading(true);
    try {
      const next = await client.getBoardDetail(route.params.boardId);
      setDetail(next);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('Failed to load board contents'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [client, route.params.boardId, t]);

  useEffect(() => {
    void load('initial');
  }, [load]);

  useNativeStackModalHeader({
    navigation,
    title: detail?.name || route.params.boardName || t('Board'),
    onClose: () => navigation.goBack(),
    rightContent: (
      <View style={styles.headerActions}>
        <HeaderActionButton
          icon={Plus}
          onPress={() => {
            setAddMaterialVisible(true);
          }}
          tone="accent"
          size={20}
        />
        <HeaderActionButton
          icon={RefreshCw}
          onPress={() => {
            void load('manual');
          }}
          disabled={refreshing}
        />
      </View>
    ),
  });

  const openEntry = useCallback((entry: YouMindBoardEntry) => {
    if (entry.kind === 'group') {
      const key = entryCollapseKey(entry);
      setCollapsedGroupKeys((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      return;
    }
    if (!entry.detailPath) return;
    analyticsEvents.consoleEntryTapped({
      destination: 'YouMindBoardItemWebView',
      source: 'youmind_board_detail',
    });
    navigation.navigate('YouMindBoardItemWebView', {
      title: entry.detailTitle,
      path: entry.detailPath,
    });
  }, [navigation]);

  const tabs = useMemo(() => ([
    { key: 'materials' as const, label: t('Materials') },
    { key: 'crafts' as const, label: t('Crafts') },
  ]), [t]);

  const activeEntries = useMemo(() => {
    if (!detail) return [];
    return activeTab === 'materials' ? detail.materials : detail.crafts;
  }, [activeTab, detail]);
  const activeFilterTypes = selectedFilterTypes[activeTab];
  const availableFilterOptions = useMemo(
    () => getAvailableFilterOptions(activeEntries, activeTab),
    [activeEntries, activeTab],
  );
  const hasActiveFilters = activeFilterTypes.length > 0;
  const filterValueLabel = useMemo(() => {
    if (activeFilterTypes.length === 0) return t('All types');
    if (activeFilterTypes.length === 1) return t(getFilterLabelKey(activeFilterTypes[0]!));
    return t('{{count}} selected', { count: activeFilterTypes.length });
  }, [activeFilterTypes, t]);
  const filteredEntries = useMemo(
    () => filterEntriesByTypes(activeEntries, activeFilterTypes),
    [activeEntries, activeFilterTypes],
  );

  const visibleEntries = useMemo(
    () => (
      hasActiveFilters
        ? filteredEntries.map((entry) => ({ ...entry, depth: 0 }))
        : getVisibleEntries(filteredEntries, collapsedGroupKeys)
    ),
    [collapsedGroupKeys, filteredEntries, hasActiveFilters],
  );

  const toggleFilterType = useCallback((value: YouMindBoardEntryFilterType) => {
    setSelectedFilterTypes((current) => {
      const currentValues = current[activeTab];
      const nextValues = currentValues.includes(value)
        ? currentValues.filter((item) => item !== value)
        : [...currentValues, value];
      return {
        ...current,
        [activeTab]: nextValues,
      };
    });
  }, [activeTab]);

  const clearActiveFilters = useCallback(() => {
    setSelectedFilterTypes((current) => ({
      ...current,
      [activeTab]: [],
    }));
  }, [activeTab]);

  const renderBoardHeader = useCallback(() => {
    if (!detail) return null;
    return (
      <View>
        <View style={styles.heroCard}>
          <Text style={[styles.heroTitle, { color: theme.colors.text }]}>{detail.name}</Text>
        </View>
        <SegmentedTabs tabs={tabs} active={activeTab} onSwitch={setActiveTab} containerStyle={styles.tabs} />
        <YouMindBoardControls
          viewMode={viewMode}
          onSelectViewMode={setViewMode}
          filterValueLabel={filterValueLabel}
          onPressFilter={() => setFilterModalVisible(true)}
        />
      </View>
    );
  }, [activeTab, detail, filterValueLabel, styles.heroCard, styles.heroTitle, styles.tabs, t, theme.colors.text, viewMode]);

  const emptyStateTitle = hasActiveFilters
    ? t('No items match your filters')
    : t('No items in this board yet');
  const emptyStateSubtitle = hasActiveFilters
    ? t('Try a different title or item type.')
    : activeTab === 'materials'
      ? t('Materials appear here once they are synced from YouMind.')
      : t('Crafts appear here once they are synced from YouMind.');
  const showInitialSkeleton = loading && !detail && !error;

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      {showInitialSkeleton ? (
        <YouMindBoardDetailSkeleton styles={styles} />
      ) : viewMode === 'list' ? (
        <FlashList
          data={visibleEntries}
          keyExtractor={(item) => `${item.kind}:${item.id}`}
          contentContainerStyle={createListContentStyle({
            top: Space.md,
            bottom: Space.xxxl,
            grow: !detail || visibleEntries.length === 0,
          })}
          ListHeaderComponent={renderBoardHeader()}
          ListEmptyComponent={(
            error
                ? (
                  <View style={styles.stateWrap}>
                    <EmptyState icon="⚠️" title={t('Failed to load board contents')} subtitle={error} />
                  </View>
                )
                : (
                  <View style={styles.stateWrap}>
                    <EmptyState
                      icon="🗃️"
                      title={emptyStateTitle}
                      subtitle={emptyStateSubtitle}
                    />
                  </View>
                )
          )}
          renderItem={({ item }) => (
            <YouMindEntryRow
              entry={item}
              collapsed={collapsedGroupKeys.has(entryCollapseKey(item))}
              onPress={() => openEntry(item)}
            />
          )}
        />
      ) : (
        <YouMindWaterfallMasonryList
          listKey={`board:${route.params.boardId}:${activeTab}:${hasActiveFilters ? 'filtered' : 'all'}`}
          entries={detail ? visibleEntries : []}
          collapsedGroupKeys={collapsedGroupKeys}
          entryCollapseKey={entryCollapseKey}
          onPressEntry={openEntry}
          renderHeader={detail ? renderBoardHeader() : null}
          emptyState={(
            <View style={styles.stateWrap}>
              {error ? (
                <EmptyState icon="⚠️" title={t('Failed to load board contents')} subtitle={error} />
              ) : (
                <EmptyState
                  icon="🗃️"
                  title={emptyStateTitle}
                  subtitle={emptyStateSubtitle}
                />
              )}
            </View>
          )}
          contentContainerStyle={createListContentStyle({
            top: Space.md,
            bottom: Space.xxxl,
            grow: !detail || visibleEntries.length === 0,
          })}
        />
      )}
      <YouMindAddMaterialSheet
        visible={addMaterialVisible}
        onClose={() => setAddMaterialVisible(false)}
        boardId={route.params.boardId}
        client={client}
        onCreated={async () => {
          await load('manual');
        }}
      />
      <YouMindBoardFilterModal
        visible={filterModalVisible}
        onClose={() => setFilterModalVisible(false)}
        options={availableFilterOptions}
        selectedValues={activeFilterTypes}
        onToggleValue={toggleFilterType}
        onClear={clearActiveFilters}
      />
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      flex: 1,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
    },
    heroCard: {
      paddingHorizontal: Space.xs,
      paddingVertical: Space.xs,
      marginBottom: Space.sm,
      gap: 2,
    },
    tabs: {
      marginHorizontal: 0,
      marginTop: 0,
      marginBottom: Space.md,
    },
    heroTitle: {
      fontSize: FontSize.displaySm,
      fontWeight: FontWeight.semibold,
    },
    stateWrap: {
      flex: 1,
      justifyContent: 'center',
    },
    skeletonTabsRow: {
      flexDirection: 'row',
      gap: Space.sm,
    },
    skeletonControlsRow: {
      flexDirection: 'row',
      gap: Space.sm,
      marginTop: Space.sm,
      marginBottom: Space.md,
    },
    skeletonControl: {
      flex: 1,
      minHeight: 56,
      borderRadius: Radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    skeletonControlCopy: {
      flex: 1,
      gap: 6,
    },
    skeletonList: {
      gap: Space.xs,
    },
    skeletonRow: {
      minHeight: 38,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      borderRadius: Radius.md,
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
  });
}
