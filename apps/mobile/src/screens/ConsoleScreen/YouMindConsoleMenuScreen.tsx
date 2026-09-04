import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import { MenuAction, MenuView } from '@react-native-menu/menu';
import { Animated, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Plus } from 'lucide-react-native';
import { EmptyState, SearchInput, createListContentStyle } from '../../components/ui';
import { YouMindAddMaterialSheet } from '../../components/console/YouMindAddMaterialSheet';
import { useAppContext } from '../../contexts/AppContext';
import { analyticsEvents } from '../../services/analytics/events';
import { StorageService } from '../../services/storage';
import {
  YouMindClient,
  getYouMindAuthFailureReason,
  type YouMindBoardDetail,
  type YouMindBoardEntry,
  type YouMindBoardEntryFilterType,
  type YouMindBoardSummary,
} from '../../services/youmind';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Shadow, Space, createThemedShadowStyle } from '../../theme/tokens';
import type { ConsoleStackParamList } from './ConsoleTab';
import { YouMindBoardControls } from './components/YouMindBoardControls';
import { YouMindBoardFilterModal } from './components/YouMindBoardFilterModal';
import { YouMindBoardIcon } from './components/YouMindBoardIcon';
import { YouMindEntryRow } from './components/YouMindEntryRow';
import { YouMindWaterfallMasonryList } from './components/YouMindWaterfallMasonryList';
import { filterEntriesByTypes, getAvailableFilterOptions, getFilterLabelKey } from './components/youmindBoardFilters';

type ConsoleMenuNavigation = NativeStackNavigationProp<ConsoleStackParamList, 'ConsoleMenu'>;

type WorkspaceState =
  | { kind: 'loading' }
  | { kind: 'authRequired' }
  | {
    kind: 'ready';
    selectedBoard: YouMindBoardSummary;
    detail: YouMindBoardDetail;
  }
  | { kind: 'error'; message: string };

type LoadMode = 'initial' | 'manual' | 'silent';
type WorkspaceTab = 'materials' | 'crafts';

const ADD_MATERIAL_FAB_SIZE = 58;

function hexToRgb(color: string): { r: number; g: number; b: number } {
  const normalized = color.replace('#', '');
  const raw =
    normalized.length === 3
      ? normalized
          .split('')
          .map((part) => `${part}${part}`)
          .join('')
      : normalized;
  const value = Number.parseInt(raw, 16);
  if (!Number.isFinite(value) || raw.length !== 6) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function withAlpha(color: string, alpha: number): string {
  if (!color.startsWith('#')) return color;
  const { r, g, b } = hexToRgb(color);
  return `rgba(${r},${g},${b},${alpha})`;
}

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

function resolveInitialBoard(
  boards: YouMindBoardSummary[],
  preferredBoardId: string | null,
): YouMindBoardSummary | null {
  if (boards.length === 0) return null;
  const activeBoards = boards.filter((board) => board.status === 'active');
  const boardPool = activeBoards.length > 0 ? activeBoards : boards;
  if (preferredBoardId) {
    const preferred = boardPool.find((board) => board.id === preferredBoardId);
    if (preferred) return preferred;
  }
  return boardPool.find((board) => board.type === 'default') ?? boardPool[0] ?? null;
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
          backgroundColor: theme.scheme === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(15,23,42,0.12)',
        },
        style,
      ]}
    />
  );
}

function YouMindWorkspaceSkeleton({
  styles,
  insetsTop,
  bottomInset,
}: {
  styles: ReturnType<typeof createStyles>;
  insetsTop: number;
  bottomInset: number;
}): React.JSX.Element {
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={createListContentStyle({
        top: insetsTop + Space.sm,
        bottom: bottomInset,
      })}
      scrollEnabled={false}
    >
      <View style={styles.heroCard}>
        <View style={styles.heroTopRow}>
          <View style={styles.skeletonBoardPicker}>
            <SkeletonLine width={22} height={22} radius={Radius.md} />
            <SkeletonLine width="46%" height={22} radius={Radius.md} />
            <SkeletonLine width={14} height={14} radius={Radius.full} />
          </View>
          <View style={styles.skeletonSectionPill}>
            <SkeletonLine width="62%" height={14} />
          </View>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <SkeletonLine width="100%" height={44} radius={Radius.lg} />
        <View style={styles.skeletonControlsRow}>
          <View style={styles.skeletonControl}>
            <SkeletonLine width={24} height={24} radius={Radius.md} />
            <View style={styles.skeletonControlCopy}>
              <SkeletonLine width="34%" height={12} />
              <SkeletonLine width="56%" height={15} />
            </View>
          </View>
          <View style={styles.skeletonControl}>
            <SkeletonLine width={24} height={24} radius={Radius.md} />
            <View style={styles.skeletonControlCopy}>
              <SkeletonLine width="28%" height={12} />
              <SkeletonLine width="42%" height={15} />
            </View>
          </View>
        </View>
      </View>

      <View style={styles.skeletonWaterfallColumns}>
        <View style={styles.skeletonWaterfallColumn}>
          {[
            { mediaHeight: 112, titleWidth: '76%' as const, bodyLines: 2 },
            { mediaHeight: 84, titleWidth: '68%' as const, bodyLines: 3 },
            { mediaHeight: 126, titleWidth: '72%' as const, bodyLines: 2 },
          ].map((item, index) => (
            <View key={`left-${index}`} style={styles.skeletonWaterfallItem}>
              <View style={styles.skeletonWaterfallCard}>
                <SkeletonLine width="100%" height={item.mediaHeight} radius={18} style={styles.skeletonCardMedia} />
                <View style={styles.skeletonCardBody}>
                  <SkeletonLine width="34%" height={12} />
                  <SkeletonLine width={item.titleWidth} height={18} />
                  {Array.from({ length: item.bodyLines }).map((_, lineIndex) => (
                    <SkeletonLine
                      key={lineIndex}
                      width={lineIndex === item.bodyLines - 1 ? '58%' : '100%'}
                      height={14}
                    />
                  ))}
                  <SkeletonLine width="28%" height={12} style={styles.skeletonCardFooter} />
                </View>
              </View>
            </View>
          ))}
        </View>
        <View style={styles.skeletonWaterfallColumn}>
          {[
            { mediaHeight: 136, titleWidth: '70%' as const, bodyLines: 2 },
            { mediaHeight: 96, titleWidth: '62%' as const, bodyLines: 2 },
            { mediaHeight: 116, titleWidth: '74%' as const, bodyLines: 3 },
          ].map((item, index) => (
            <View key={`right-${index}`} style={styles.skeletonWaterfallItem}>
              <View style={styles.skeletonWaterfallCard}>
                <SkeletonLine width="100%" height={item.mediaHeight} radius={18} style={styles.skeletonCardMedia} />
                <View style={styles.skeletonCardBody}>
                  <SkeletonLine width="30%" height={12} />
                  <SkeletonLine width={item.titleWidth} height={18} />
                  {Array.from({ length: item.bodyLines }).map((_, lineIndex) => (
                    <SkeletonLine
                      key={lineIndex}
                      width={lineIndex === item.bodyLines - 1 ? '54%' : '100%'}
                      height={14}
                    />
                  ))}
                  <SkeletonLine width="24%" height={12} style={styles.skeletonCardFooter} />
                </View>
              </View>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

function YouMindAddMaterialFab({
  onPress,
  bottom,
}: {
  onPress: () => void;
  bottom: number;
}): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('console');
  const styles = useMemo(() => createStyles(theme.colors, theme.scheme), [theme]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('Add material')}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={({ pressed }) => [
        styles.floatingActionButton,
        {
          bottom,
          backgroundColor: theme.scheme === 'dark'
            ? theme.colors.surfaceElevated
            : theme.colors.surface,
          transform: [
            { scale: pressed ? 0.97 : 1 },
            { translateY: pressed ? 1 : 0 },
          ],
        },
      ]}
    >
      <Plus
        size={22}
        strokeWidth={2.4}
        color={theme.colors.primary}
      />
    </Pressable>
  );
}

export function YouMindConsoleMenuScreen(): React.JSX.Element {
  const navigation = useNavigation<ConsoleMenuNavigation>();
  const { theme } = useAppTheme();
  const { t } = useTranslation('console');
  const { config, activeGatewayConfigId } = useAppContext();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const styles = useMemo(() => createStyles(theme.colors, theme.scheme), [theme]);
  const refreshProgressOffset = insets.top + 56;
  const baseUrl = config?.url || 'https://youmind.com';
  const client = useMemo(() => new YouMindClient(baseUrl, { authScopeKey: activeGatewayConfigId }), [activeGatewayConfigId, baseUrl]);
  const [state, setState] = useState<WorkspaceState>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('materials');
  const [viewMode, setViewMode] = useState<'list' | 'waterfall'>('waterfall');
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<string>>(() => new Set());
  const [addMaterialVisible, setAddMaterialVisible] = useState(false);
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [selectedFilterTypes, setSelectedFilterTypes] = useState<Record<WorkspaceTab, YouMindBoardEntryFilterType[]>>({
    materials: [],
    crafts: [],
  });
  const load = useCallback(async (mode: LoadMode = 'initial') => {
    if (mode === 'manual') setRefreshing(true);
    if (mode === 'initial') {
      setState((current) => (current.kind === 'ready' ? current : { kind: 'loading' }));
    }
    try {
      const session = await client.getValidSession();
      if (!session) {
        setState((current) => (current.kind === 'ready' && mode === 'silent' ? current : { kind: 'authRequired' }));
        return;
      }
      const [boards, preferredBoardId] = await Promise.all([
        client.listBoards(),
        StorageService.getYouMindLastOpenedBoardId(baseUrl, activeGatewayConfigId),
      ]);
      const selectedBoard = resolveInitialBoard(boards, preferredBoardId);
      if (!selectedBoard) {
        setState({
          kind: 'error',
          message: t('No boards yet'),
        });
        return;
      }
      if (preferredBoardId !== selectedBoard.id) {
        await StorageService.setYouMindLastOpenedBoardId(baseUrl, selectedBoard.id, activeGatewayConfigId);
      }
      const detail = await client.getBoardDetail(selectedBoard.id);
      setState({
        kind: 'ready',
        selectedBoard,
        detail,
      });
    } catch (error) {
      if (getYouMindAuthFailureReason(error, { hadStoredSession: true })) {
        setState({ kind: 'authRequired' });
        return;
      }
      const message = error instanceof Error ? error.message : t('Failed to load boards');
      setState((current) => (current.kind === 'ready' && mode === 'silent' ? current : { kind: 'error', message }));
    } finally {
      setRefreshing(false);
    }
  }, [activeGatewayConfigId, baseUrl, client, t]);

  useEffect(() => {
    if (!isFocused) return;
    void load(state.kind === 'ready' ? 'silent' : 'initial');
  }, [isFocused, load, state.kind]);

  const sectionActions = useMemo<MenuAction[]>(() => ([
    {
      id: 'materials',
      title: t('Materials'),
      state: activeTab === 'materials' ? 'on' : 'off',
    },
    {
      id: 'crafts',
      title: t('Crafts'),
      state: activeTab === 'crafts' ? 'on' : 'off',
    },
  ]), [activeTab, t]);
  const activeSectionLabel = activeTab === 'materials' ? t('Materials') : t('Crafts');

  const activeEntries = useMemo(() => {
    if (state.kind !== 'ready') return [];
    return activeTab === 'materials' ? state.detail.materials : state.detail.crafts;
  }, [activeTab, state]);
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

  const filteredEntries = useMemo(() => {
    if (state.kind !== 'ready') return [];
    const typeFilteredEntries = filterEntriesByTypes(activeEntries, activeFilterTypes);
    if (!query.trim()) return typeFilteredEntries;
    const normalizedQuery = query.trim().toLowerCase();
    return typeFilteredEntries.filter((entry) =>
      entry.title.toLowerCase().includes(normalizedQuery)
      || entry.subtitle.toLowerCase().includes(normalizedQuery),
    );
  }, [activeEntries, activeFilterTypes, query, state.kind]);

  const visibleEntries = useMemo(() => {
    if (query.trim() || hasActiveFilters) {
      return filteredEntries.map((entry) => ({ ...entry, depth: 0 }));
    }
    return getVisibleEntries(filteredEntries, collapsedGroupKeys);
  }, [collapsedGroupKeys, filteredEntries, hasActiveFilters, query]);

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

  const handleOpenBoardPicker = useCallback(() => {
    if (state.kind !== 'ready') return;
    analyticsEvents.consoleEntryTapped({
      destination: 'YouMindBoardPicker',
      source: 'youmind_workspace',
    });
    navigation.navigate('YouMindBoardPicker', {
      selectedBoardId: state.selectedBoard.id,
    });
  }, [navigation, state]);

  const renderWorkspaceHeader = useCallback(() => {
    if (state.kind !== 'ready') return null;
    return (
      <View>
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroBoardSlot}>
              <Pressable
                onPress={handleOpenBoardPicker}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.heroTitleButton,
                  pressed ? { opacity: 0.72 } : null,
                ]}
              >
                <YouMindBoardIcon icon={state.selectedBoard.icon} size={28} accentOnly />
                <Text
                  style={[styles.heroTitle, { color: theme.colors.text }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {state.selectedBoard.name}
                </Text>
                <ChevronDown size={16} color={theme.colors.textSubtle} strokeWidth={2.4} />
              </Pressable>
            </View>

            <MenuView
              actions={sectionActions}
              shouldOpenOnLongPress={false}
              onPressAction={({ nativeEvent }) => {
                const nextValue = nativeEvent.event === 'crafts' ? 'crafts' : 'materials';
                void Haptics.selectionAsync();
                setActiveTab(nextValue);
              }}
              title={t('View')}
              themeVariant={theme.scheme}
            >
              <View style={[styles.sectionPicker, { backgroundColor: theme.colors.surfaceElevated }]}>
                <Text style={[styles.sectionPickerLabel, { color: theme.colors.text }]} numberOfLines={1}>
                  {activeSectionLabel}
                </Text>
                <ChevronDown size={14} color={theme.colors.textSubtle} strokeWidth={2.2} />
              </View>
            </MenuView>
          </View>
        </View>
        <View style={styles.searchWrap}>
          <SearchInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('Search board contents')}
            style={styles.borderlessSearchInput}
          />
          <YouMindBoardControls
            viewMode={viewMode}
            onSelectViewMode={setViewMode}
            filterValueLabel={filterValueLabel}
            onPressFilter={() => setFilterModalVisible(true)}
            borderless
          />
        </View>
      </View>
    );
  }, [activeSectionLabel, filterValueLabel, handleOpenBoardPicker, query, sectionActions, state, styles.heroCard, styles.heroTitle, styles.heroTitleButton, styles.heroTopRow, styles.searchWrap, styles.sectionPicker, styles.sectionPickerLabel, t, theme.colors.borderStrong, theme.colors.surfaceElevated, theme.colors.text, theme.colors.textSubtle, theme.scheme, viewMode]);

  const emptyStateTitle = query.trim()
    ? t('No items match your search')
    : hasActiveFilters
      ? t('No items match your filters')
      : t('No items in this board yet');

  const emptyStateSubtitle = query.trim() || hasActiveFilters
    ? t('Try a different title or item type.')
    : activeTab === 'materials'
      ? t('Materials appear here once they are synced from YouMind.')
      : t('Crafts appear here once they are synced from YouMind.');
  const showInitialSkeleton = state.kind === 'loading';
  const addMaterialFabBottom = showInitialSkeleton
    ? insets.bottom + Space.xxxl
    : insets.bottom + Space.lg;

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
      source: 'youmind_workspace',
    });
    navigation.navigate('YouMindBoardItemWebView', {
      title: entry.detailTitle,
      path: entry.detailPath,
    });
  }, [navigation]);

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      {state.kind === 'authRequired' ? (
        <View style={styles.centerState}>
          <EmptyState
            icon="🪪"
            title={t('YouMind sign-in required')}
            subtitle={t('Sign in to YouMind in Chat first.')}
          />
        </View>
      ) : state.kind === 'error' ? (
        <View style={styles.centerState}>
          <EmptyState
            icon="⚠️"
            title={t('Failed to load boards')}
            subtitle={state.message}
          />
        </View>
      ) : (
        showInitialSkeleton ? (
          <YouMindWorkspaceSkeleton
            styles={styles}
            insetsTop={insets.top}
            bottomInset={Space.xxxl + 88}
          />
        ) : viewMode === 'list' ? (
          <FlashList
            data={visibleEntries}
            keyExtractor={(item) => `${item.kind}:${item.id}`}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={createListContentStyle({
              top: insets.top + Space.sm,
              bottom: Space.xxxl + 88,
              grow: state.kind !== 'ready' || visibleEntries.length === 0,
            })}
            refreshControl={(
              <RefreshControl
                refreshing={refreshing}
                tintColor={theme.colors.primary}
                progressViewOffset={refreshProgressOffset}
                onRefresh={() => {
                  void load('manual');
                }}
              />
            )}
            ListHeaderComponent={renderWorkspaceHeader()}
            ListEmptyComponent={(
              <View style={styles.centerState}>
                <EmptyState
                  icon="🗃️"
                  title={emptyStateTitle}
                  subtitle={emptyStateSubtitle}
                />
              </View>
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
            listKey={`workspace:${state.kind === 'ready' ? state.selectedBoard.id : 'none'}:${activeTab}:${query.trim() ? 'search' : 'browse'}:${hasActiveFilters ? 'filtered' : 'all'}`}
            entries={state.kind === 'ready' ? visibleEntries : []}
            collapsedGroupKeys={collapsedGroupKeys}
            entryCollapseKey={entryCollapseKey}
            onPressEntry={openEntry}
            renderHeader={state.kind === 'ready' ? renderWorkspaceHeader() : null}
            emptyState={(
              <View style={styles.centerState}>
                <EmptyState
                  icon="🗃️"
                  title={emptyStateTitle}
                  subtitle={emptyStateSubtitle}
                />
              </View>
            )}
            contentContainerStyle={createListContentStyle({
              top: insets.top + Space.sm,
              bottom: Space.xxxl + 88,
              grow: state.kind !== 'ready' || visibleEntries.length === 0,
            })}
            refreshControl={(
              <RefreshControl
                refreshing={refreshing}
                tintColor={theme.colors.primary}
                progressViewOffset={refreshProgressOffset}
                onRefresh={() => {
                  void load('manual');
                }}
              />
            )}
          />
        )
      )}
      {state.kind === 'ready' || showInitialSkeleton ? (
        <YouMindAddMaterialSheet
          visible={addMaterialVisible}
          onClose={() => setAddMaterialVisible(false)}
          boardId={state.kind === 'ready' ? state.selectedBoard.id : undefined}
          client={client}
          onCreated={async () => {
            await load('manual');
          }}
        />
      ) : null}
      <YouMindBoardFilterModal
        visible={filterModalVisible}
        onClose={() => setFilterModalVisible(false)}
        options={availableFilterOptions}
        selectedValues={activeFilterTypes}
        onToggleValue={toggleFilterType}
        onClear={clearActiveFilters}
      />
      {state.kind === 'ready' || showInitialSkeleton ? (
        <YouMindAddMaterialFab
          onPress={() => {
            setAddMaterialVisible(true);
          }}
          bottom={addMaterialFabBottom}
        />
      ) : null}
    </View>
  );
}

function createStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
  scheme: ReturnType<typeof useAppTheme>['theme']['scheme'],
) {
  return StyleSheet.create({
    root: {
      flex: 1,
    },
    searchWrap: {
      marginBottom: Space.xs + 2,
    },
    centerState: {
      flex: 1,
      justifyContent: 'center',
    },
    heroCard: {
      paddingHorizontal: Space.xs,
      paddingVertical: Space.xs,
      marginBottom: Space.md,
      gap: 2,
    },
    heroTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minWidth: 0,
    },
    heroBoardSlot: {
      flex: 1,
      minWidth: 0,
      marginRight: Space.md,
    },
    heroTitleButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      alignSelf: 'flex-start',
      minWidth: 0,
      maxWidth: '100%',
      flexShrink: 1,
    },
    heroTitle: {
      flexShrink: 1,
      minWidth: 0,
      fontSize: FontSize.displaySm,
      fontWeight: FontWeight.semibold,
    },
    sectionPicker: {
      minHeight: 34,
      maxWidth: 140,
      borderRadius: Radius.full,
      paddingLeft: Space.md,
      paddingRight: Space.sm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
      flexShrink: 0,
    },
    borderlessSearchInput: {
      borderWidth: 0,
      minHeight: 48,
      borderRadius: Radius.lg,
    },
    sectionPickerLabel: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      flexShrink: 1,
    },
    skeletonBoardPicker: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      flex: 1,
      marginRight: Space.sm,
    },
    skeletonSectionPill: {
      minHeight: 34,
      width: 92,
      borderRadius: Radius.full,
      backgroundColor: colors.surface,
      paddingHorizontal: Space.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    skeletonControlsRow: {
      flexDirection: 'row',
      gap: Space.sm,
      marginTop: Space.sm,
      marginBottom: Space.md,
    },
    skeletonControl: {
      flex: 1,
      minHeight: 52,
      borderRadius: Radius.lg,
      backgroundColor: colors.surface,
      paddingHorizontal: Space.md,
      paddingVertical: Space.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    skeletonControlCopy: {
      flex: 1,
      gap: 6,
    },
    skeletonWaterfallColumns: {
      flexDirection: 'row',
      gap: Space.sm,
      alignItems: 'flex-start',
    },
    skeletonWaterfallColumn: {
      flex: 1,
    },
    skeletonWaterfallItem: {
      paddingBottom: Space.md,
    },
    skeletonWaterfallCard: {
      borderRadius: Radius.lg,
      overflow: 'hidden',
      backgroundColor: colors.surface,
    },
    skeletonCardMedia: {
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
    },
    skeletonCardBody: {
      paddingHorizontal: 14,
      paddingTop: 12,
      paddingBottom: 14,
      gap: 8,
    },
    skeletonCardFooter: {
      marginTop: Space.xs,
    },
    floatingActionButton: {
      position: 'absolute',
      right: Space.lg,
      width: ADD_MATERIAL_FAB_SIZE,
      height: ADD_MATERIAL_FAB_SIZE,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      ...createThemedShadowStyle(colors, scheme, Shadow.md),
    },
  });
}
