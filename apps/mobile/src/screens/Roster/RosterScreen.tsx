import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from 'react-native';
import { Plus, Search, UserRound } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  getConnectionRuntime,
  useConnections,
  useRoster,
} from '../../connection';
import { Banner } from '../../components/ui/Banner';
import { FloatingButton, type FloatingButtonBadge } from '../../components/ui/FloatingButton';
import { RosterRow } from '../../components/ui/RosterRow';
import { Skeleton } from '../../components/ui/Skeleton';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Radius,
  Space,
} from '../../theme/tokens';
import { relativeTime } from '../../utils/chat-message';
import {
  buildRosterRows,
  resolveRosterPageState,
  type RosterDisplayRow,
  type RosterModelOptions,
  type RosterPageState,
} from './model';

type MaybePromise = void | Promise<void>;

const ROSTER_SKELETON_KEYS = Object.freeze([
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
]);

export type RosterGraceBanner = Readonly<{
  message: string;
  actionLabel: string;
}>;

export type RosterViewProps = Readonly<{
  state: RosterPageState;
  rows: ReadonlyArray<RosterDisplayRow>;
  activeConnectionId: string | null;
  refreshing?: boolean;
  graceBanner?: RosterGraceBanner;
  accountBadge?: FloatingButtonBadge;
  showOfflineBanner?: boolean;
  showErrorBanner?: boolean;
  onOpenAccount: () => void;
  onSearch: () => void;
  onAdd: () => void;
  onOpenRow: (row: RosterDisplayRow) => void;
  onOpenLockedRow: (row: RosterDisplayRow) => void;
  onLongPressRow?: (row: RosterDisplayRow) => void;
  onRefresh: () => MaybePromise;
  onGraceAction?: () => void;
  onOpenPro?: () => void;
}>;

export type RosterScreenProps = Readonly<{
  pinnedSessionKeys?: RosterModelOptions['pinnedSessionKeys'];
  canAccessAgent?: RosterModelOptions['canAccessAgent'];
  graceBanner?: RosterGraceBanner;
  isPro?: boolean;
  accountAttentionCount?: number;
  onOpenAccount: () => void;
  onSearch: () => void;
  onAdd: () => void;
  onOpenRow: (row: RosterDisplayRow) => void;
  onOpenLockedRow: (row: RosterDisplayRow) => void;
  onLongPressRow?: (row: RosterDisplayRow) => void;
  onGraceAction?: () => void;
  onOpenPro?: () => void;
}>;

function resolveAccountBadge(
  attentionCount: number,
  isPro: boolean,
): FloatingButtonBadge | undefined {
  if (attentionCount > 0) {
    return { tone: 'bad', count: attentionCount };
  }
  if (isPro) return { tone: 'accent' };
  return undefined;
}

function RosterHeader({
  accountBadge,
  onOpenAccount,
  onSearch,
  onAdd,
}: Pick<
  RosterViewProps,
  'accountBadge' | 'onOpenAccount' | 'onSearch' | 'onAdd'
>): React.JSX.Element {
  const { t } = useTranslation('common');

  return (
    <View testID="roster-header" pointerEvents="box-none" style={styles.headerRow}>
      <FloatingButton
        testID="roster-account"
        icon={UserRound}
        badge={accountBadge}
        accessibilityLabel={t('Account settings')}
        onPress={onOpenAccount}
      />
      <View style={styles.headerActions}>
        <FloatingButton
          testID="roster-search"
          icon={Search}
          accessibilityLabel={t('Search')}
          onPress={onSearch}
        />
        <FloatingButton
          testID="roster-add"
          icon={Plus}
          accessibilityLabel={t('Add')}
          onPress={onAdd}
        />
      </View>
    </View>
  );
}

function RosterLoading(): React.JSX.Element {
  const { t } = useTranslation('common');

  return (
    <View testID="roster-loading" style={styles.loadingList}>
      {ROSTER_SKELETON_KEYS.map((key) => (
        <View key={key} testID={`roster-skeleton-${key}`} style={styles.skeletonRow}>
          <Skeleton
            accessibilityLabel={t('Loading agents')}
            style={styles.skeletonAvatar}
          />
          <View style={styles.skeletonCopy}>
            <Skeleton style={styles.skeletonName} />
            <Skeleton style={styles.skeletonPreview} />
          </View>
          <Skeleton style={styles.skeletonTime} />
        </View>
      ))}
    </View>
  );
}

function RosterBanners({
  state,
  graceBanner,
  showOfflineBanner,
  showErrorBanner,
  onRefresh,
  onGraceAction,
  onOpenPro,
}: Pick<
  RosterViewProps,
  | 'state'
  | 'graceBanner'
  | 'showOfflineBanner'
  | 'showErrorBanner'
  | 'onRefresh'
  | 'onGraceAction'
  | 'onOpenPro'
>): React.JSX.Element | null {
  const { t } = useTranslation('common');
  const offline = showOfflineBanner ?? state === 'offline';
  const error = showErrorBanner ?? state === 'error';
  const permission = state === 'permission';

  if (!graceBanner && !offline && !error && !permission) return null;

  return (
    <View testID="roster-banners" style={styles.banners}>
      {graceBanner ? (
        <Banner
          testID="roster-grace-banner"
          message={graceBanner.message}
          actionLabel={graceBanner.actionLabel}
          onAction={onGraceAction}
        />
      ) : null}
      {offline ? (
        <Banner
          testID="roster-offline-banner"
          message={t('Offline · reconnecting')}
          actionLabel={t('Reconnect')}
          onAction={() => { void onRefresh(); }}
        />
      ) : null}
      {error ? (
        <Banner
          testID="roster-error-banner"
          tone="bad"
          message={t('Connection unavailable')}
          actionLabel={t('Retry')}
          onAction={() => { void onRefresh(); }}
        />
      ) : null}
      {permission ? (
        <Banner
          testID="roster-permission-banner"
          message={t('Pro unlocks this agent')}
          actionLabel={t('View Pro')}
          onAction={onOpenPro}
        />
      ) : null}
    </View>
  );
}

export function RosterView({
  state,
  rows,
  activeConnectionId,
  refreshing = false,
  graceBanner,
  accountBadge,
  showOfflineBanner,
  showErrorBanner,
  onOpenAccount,
  onSearch,
  onAdd,
  onOpenRow,
  onOpenLockedRow,
  onLongPressRow,
  onRefresh,
  onGraceAction,
  onOpenPro,
}: RosterViewProps): React.JSX.Element {
  const { t } = useTranslation('common');
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const contentInsets = useMemo(() => ({
    paddingTop: insets.top + ControlSize.floatingButton + Space.xl,
    paddingBottom: insets.bottom + Space.lg,
  }), [insets.bottom, insets.top]);
  const headerInsets = useMemo(() => ({
    paddingTop: insets.top + Space.sm,
  }), [insets.top]);
  const renderRow = useCallback<ListRenderItem<RosterDisplayRow>>(({ item }) => {
    const activeConnectionOffline = item.connectionId === activeConnectionId
      && (showOfflineBanner ?? state === 'offline');
    const open = item.locked ? onOpenLockedRow : onOpenRow;
    return (
      <RosterRow
        testID={`roster-row-${item.key}`}
        agentId={item.agentId}
        name={item.name}
        emoji={item.emoji}
        preview={item.preview ?? t('No activity yet')}
        avatarStatus={activeConnectionOffline ? 'offline' : item.working ? 'working' : 'idle'}
        timeLabel={relativeTime(item.updatedAt)}
        unreadCount={item.unreadCount}
        attention={item.attention !== null}
        attentionTone="bad"
        cached={item.cached}
        locked={item.locked}
        onPress={() => open(item)}
        {...(onLongPressRow ? { onLongPress: () => onLongPressRow(item) } : {})}
      />
    );
  }, [
    activeConnectionId,
    onLongPressRow,
    onOpenLockedRow,
    onOpenRow,
    showOfflineBanner,
    state,
    t,
  ]);

  return (
    <View testID="roster-screen" style={[styles.screen, { backgroundColor: theme.colors.canvas }]}>
      <View pointerEvents="box-none" style={[styles.header, headerInsets]}>
        <RosterHeader
          accountBadge={accountBadge}
          onOpenAccount={onOpenAccount}
          onSearch={onSearch}
          onAdd={onAdd}
        />
      </View>
      {state === 'loading' ? (
        <View style={[styles.list, contentInsets]}>
          <RosterLoading />
        </View>
      ) : (
        <FlatList
          testID="roster-list"
          data={rows}
          keyExtractor={(item) => item.key}
          renderItem={renderRow}
          automaticallyAdjustContentInsets={false}
          contentContainerStyle={[
            styles.listContent,
            contentInsets,
            rows.length === 0 ? styles.emptyContent : null,
          ]}
          ListHeaderComponent={(
            <RosterBanners
              state={state}
              graceBanner={graceBanner}
              showOfflineBanner={showOfflineBanner}
              showErrorBanner={showErrorBanner}
              onRefresh={onRefresh}
              onGraceAction={onGraceAction}
              onOpenPro={onOpenPro}
            />
          )}
          ListEmptyComponent={(
            <Text testID="roster-empty" style={[styles.emptyText, { color: theme.colors.inkSecondary }]}>
              {t('No agents on this connection')}
            </Text>
          )}
          refreshControl={(
            <RefreshControl
              testID="roster-refresh-control"
              refreshing={refreshing}
              tintColor={theme.colors.inkSecondary}
              colors={[theme.colors.inkSecondary]}
              onRefresh={() => { void onRefresh(); }}
            />
          )}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

export function RosterScreen({
  pinnedSessionKeys,
  canAccessAgent,
  graceBanner,
  isPro = false,
  accountAttentionCount = 0,
  onOpenAccount,
  onSearch,
  onAdd,
  onOpenRow,
  onOpenLockedRow,
  onLongPressRow,
  onGraceAction,
  onOpenPro,
}: RosterScreenProps): React.JSX.Element {
  const connections = useConnections();
  const roster = useRoster();
  const [refreshing, setRefreshing] = useState(false);
  const rows = useMemo(() => buildRosterRows(roster, {
    ...(pinnedSessionKeys ? { pinnedSessionKeys } : {}),
    ...(canAccessAgent ? { canAccessAgent } : {}),
  }), [canAccessAgent, pinnedSessionKeys, roster]);
  const allRowsLocked = rows.length > 0 && rows.every((row) => row.locked);
  const state = resolveRosterPageState({
    initialized: connections.initialized,
    connectionCount: connections.connections.length,
    rowCount: rows.length,
    activeState: connections.activeState,
    hasError: connections.error !== null,
    allRowsLocked,
  });
  const offline = connections.activeState === 'offline'
    || connections.activeState === 'reconnecting';
  const accountBadge = resolveAccountBadge(accountAttentionCount, isPro);
  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    const coordinator = getConnectionRuntime();
    try {
      await Promise.all([
        coordinator.refreshRoster(),
        coordinator.probeActive(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshing]);

  return (
    <RosterView
      state={state}
      rows={rows}
      activeConnectionId={connections.activeConnectionId}
      refreshing={refreshing}
      graceBanner={graceBanner}
      accountBadge={accountBadge}
      showOfflineBanner={offline}
      showErrorBanner={connections.error !== null && !offline}
      onOpenAccount={onOpenAccount}
      onSearch={onSearch}
      onAdd={onAdd}
      onOpenRow={onOpenRow}
      onOpenLockedRow={onOpenLockedRow}
      onLongPressRow={onLongPressRow}
      onRefresh={refresh}
      onGraceAction={onGraceAction}
      onOpenPro={onOpenPro}
    />
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    zIndex: 1,
    paddingHorizontal: Space.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  list: {
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
  },
  emptyContent: {
    justifyContent: 'center',
  },
  banners: {
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    paddingBottom: Space.sm,
  },
  emptyText: {
    alignSelf: 'center',
    paddingHorizontal: Space.xl,
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.regular,
    textAlign: 'center',
  },
  loadingList: {
    flex: 1,
  },
  skeletonRow: {
    height: ControlSize.rosterRow,
    paddingHorizontal: Space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  skeletonAvatar: {
    width: ControlSize.settingsRow + Space.xs,
    height: ControlSize.settingsRow + Space.xs,
    borderRadius: Radius.avatarRoster,
  },
  skeletonCopy: {
    flex: 1,
    gap: Space.sm,
  },
  skeletonName: {
    width: '40%',
    height: LineHeight.body,
  },
  skeletonPreview: {
    width: '72%',
    height: LineHeight.secondary,
  },
  skeletonTime: {
    width: Space.xxl,
    height: LineHeight.caption,
  },
});
