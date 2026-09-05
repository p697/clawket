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
import { Button } from '../../components/ui/Button';
import { CompositionSafeBottomSheetTextInput } from '../../components/ui/CompositionSafeBottomSheetTextInput';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { FloatingButton, type FloatingButtonBadge } from '../../components/ui/FloatingButton';
import { RosterRow } from '../../components/ui/RosterRow';
import {
  SettingsDivider,
  SettingsGroup,
  SettingsRow,
} from '../../components/ui/SettingsGroup';
import { Sheet } from '../../components/ui/Sheet';
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
import {
  assembleRosterAddActions,
  assembleRosterRowActions,
  type RosterAddAction,
  type RosterRowAction,
} from './actions';

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
  agentPreferences?: RosterModelOptions['agentPreferences'];
  canAccessAgent?: RosterModelOptions['canAccessAgent'];
  canCreateAgent?: boolean;
  canRenamePinnedSession?: boolean;
  graceBanner?: RosterGraceBanner;
  isPro?: boolean;
  accountAttentionCount?: number;
  onOpenAccount: () => void;
  onSearch: () => void;
  onAdd: () => void;
  onOpenRow: (row: RosterDisplayRow) => void;
  onOpenLockedRow: (row: RosterDisplayRow) => void;
  onLongPressRow?: (row: RosterDisplayRow) => void;
  onCreateAgent?: () => void;
  onToggleAgentPinned?: (row: RosterDisplayRow) => MaybePromise;
  onToggleAgentMuted?: (row: RosterDisplayRow) => MaybePromise;
  onRemoveConnection?: (row: RosterDisplayRow) => MaybePromise;
  onUnpinSession?: (row: RosterDisplayRow) => MaybePromise;
  onRenameSession?: (row: RosterDisplayRow, title: string) => MaybePromise;
  onGraceAction?: () => void;
  onOpenPro?: () => void;
}>;

function ActionRows({
  actions,
  label,
  onPress,
}: Readonly<{
  actions: ReadonlyArray<string>;
  label: (action: string) => string;
  onPress: (action: string) => void;
}>): React.JSX.Element {
  return (
    <SettingsGroup>
      {actions.map((action, index) => (
        <React.Fragment key={action}>
          {index > 0 ? <SettingsDivider inset="content" /> : null}
          <SettingsRow
            testID={`roster-action-${action}`}
            title={label(action)}
            onPress={() => onPress(action)}
          />
        </React.Fragment>
      ))}
    </SettingsGroup>
  );
}

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
  agentPreferences,
  canAccessAgent,
  canCreateAgent = false,
  canRenamePinnedSession = false,
  graceBanner,
  isPro = false,
  accountAttentionCount = 0,
  onOpenAccount,
  onSearch,
  onAdd,
  onOpenRow,
  onOpenLockedRow,
  onLongPressRow,
  onCreateAgent,
  onToggleAgentPinned,
  onToggleAgentMuted,
  onRemoveConnection,
  onUnpinSession,
  onRenameSession,
  onGraceAction,
  onOpenPro,
}: RosterScreenProps): React.JSX.Element {
  const { t } = useTranslation(['common', 'chat', 'config']);
  const { theme } = useAppTheme();
  const connections = useConnections();
  const roster = useRoster();
  const [refreshing, setRefreshing] = useState(false);
  const [addVisible, setAddVisible] = useState(false);
  const [actionRow, setActionRow] = useState<RosterDisplayRow | null>(null);
  const [removeRow, setRemoveRow] = useState<RosterDisplayRow | null>(null);
  const [renameRow, setRenameRow] = useState<RosterDisplayRow | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renaming, setRenaming] = useState(false);
  const rows = useMemo(() => buildRosterRows(roster, {
    ...(pinnedSessionKeys ? { pinnedSessionKeys } : {}),
    ...(agentPreferences ? { agentPreferences } : {}),
    ...(canAccessAgent ? { canAccessAgent } : {}),
  }), [agentPreferences, canAccessAgent, pinnedSessionKeys, roster]);
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

  const addActions = useMemo(
    () => assembleRosterAddActions({ canCreateAgent: canCreateAgent && Boolean(onCreateAgent) }),
    [canCreateAgent, onCreateAgent],
  );
  const rowActions = useMemo(() => {
    if (!actionRow) return [];
    const group = roster.find((item) => item.connection.id === actionRow.connectionId);
    return assembleRosterRowActions({
      row: actionRow,
      connectionAgentCount: group?.agents.length ?? 0,
      canRenameSession: canRenamePinnedSession
        && actionRow.connectionId === connections.activeConnectionId
        && Boolean(onRenameSession),
    });
  }, [
    actionRow,
    canRenamePinnedSession,
    connections.activeConnectionId,
    onRenameSession,
    roster,
  ]);
  const closeLabel = t('Close', { ns: 'common' });
  const addActionLabel = useCallback((action: string) => {
    switch (action as RosterAddAction) {
      case 'create_agent': return t('New Agent', { ns: 'chat' });
      default: return t('Add Connection', { ns: 'config' });
    }
  }, [t]);
  const rowActionLabel = useCallback((action: string) => {
    switch (action as RosterRowAction) {
      case 'pin_agent': return t('Pin Agent', { ns: 'common' });
      case 'unpin_agent': return t('Unpin Agent', { ns: 'common' });
      case 'mute_agent': return t('Mute Agent', { ns: 'common' });
      case 'unmute_agent': return t('Unmute Agent', { ns: 'common' });
      case 'remove_connection': return t('Remove connection', { ns: 'config' });
      case 'unpin_session': return t('Unpin from roster', { ns: 'common' });
      default: return t('Rename', { ns: 'common' });
    }
  }, [t]);
  const handleAddAction = useCallback((value: string) => {
    const action = value as RosterAddAction;
    setAddVisible(false);
    if (action === 'add_connection') {
      onAdd();
      return;
    }
    if (!isPro) {
      onOpenPro?.();
      return;
    }
    onCreateAgent?.();
  }, [isPro, onAdd, onCreateAgent, onOpenPro]);
  const handleLongPressRow = useCallback((row: RosterDisplayRow) => {
    onLongPressRow?.(row);
    setActionRow(row);
  }, [onLongPressRow]);
  const handleRowAction = useCallback((value: string) => {
    const row = actionRow;
    if (!row) return;
    const action = value as RosterRowAction;
    setActionRow(null);
    if (action === 'remove_connection') {
      setRemoveRow(row);
      return;
    }
    if (action === 'rename_session') {
      setRenameDraft(row.name);
      setRenameRow(row);
      return;
    }
    const run = action === 'pin_agent' || action === 'unpin_agent'
      ? onToggleAgentPinned
      : action === 'mute_agent' || action === 'unmute_agent'
        ? onToggleAgentMuted
        : onUnpinSession;
    if (run) void Promise.resolve(run(row)).catch(() => undefined);
  }, [actionRow, onToggleAgentMuted, onToggleAgentPinned, onUnpinSession]);
  const submitRename = useCallback(async () => {
    const row = renameRow;
    const title = renameDraft.trim();
    if (!row || !title || title === row.name || !onRenameSession || renaming) return;
    setRenaming(true);
    try {
      await onRenameSession(row, title);
      setRenameRow(null);
    } catch {
      // Keep the editor open so the user can retry without losing the title.
    } finally {
      setRenaming(false);
    }
  }, [onRenameSession, renameDraft, renameRow, renaming]);
  const removeConnectionName = removeRow
    ? roster.find((item) => item.connection.id === removeRow.connectionId)?.connection.label
      ?? removeRow.name
    : '';

  return (
    <>
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
        onAdd={() => setAddVisible(true)}
        onOpenRow={onOpenRow}
        onOpenLockedRow={onOpenLockedRow}
        onLongPressRow={handleLongPressRow}
        onRefresh={refresh}
        onGraceAction={onGraceAction}
        onOpenPro={onOpenPro}
      />
      <Sheet
        testID="roster-add-sheet"
        visible={addVisible}
        onClose={() => setAddVisible(false)}
        closeAccessibilityLabel={closeLabel}
        title={t('Add', { ns: 'common' })}
        maxHeight="55%"
      >
        <ActionRows actions={addActions} label={addActionLabel} onPress={handleAddAction} />
      </Sheet>
      <Sheet
        testID="roster-row-actions"
        visible={actionRow !== null}
        onClose={() => setActionRow(null)}
        closeAccessibilityLabel={closeLabel}
        title={actionRow?.kind === 'pinned_session'
          ? t('Session actions', { ns: 'common' })
          : t('Agent actions', { ns: 'common' })}
        maxHeight="65%"
      >
        <ActionRows actions={rowActions} label={rowActionLabel} onPress={handleRowAction} />
      </Sheet>
      <Sheet
        testID="roster-rename-sheet"
        visible={renameRow !== null}
        onClose={() => { if (!renaming) setRenameRow(null); }}
        closeAccessibilityLabel={closeLabel}
        title={t('Rename', { ns: 'common' })}
        dismissOnBackdropPress={!renaming}
        maxHeight="55%"
      >
        <View style={styles.renameContent}>
          <View style={[styles.renameField, { backgroundColor: theme.colors.surfaceFloating }]}>
            <CompositionSafeBottomSheetTextInput
              testID="roster-rename-input"
              style={[styles.renameInput, { color: theme.colors.ink }]}
              value={renameDraft}
              onChangeText={setRenameDraft}
              editable={!renaming}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => { void submitRename(); }}
            />
          </View>
          <View style={styles.renameActions}>
            <Button
              testID="roster-rename-cancel"
              label={t('Cancel', { ns: 'common' })}
              variant="secondary"
              disabled={renaming}
              onPress={() => setRenameRow(null)}
              style={styles.renameAction}
            />
            <Button
              testID="roster-rename-save"
              label={t('Save', { ns: 'common' })}
              loading={renaming}
              disabled={!renameDraft.trim() || renameDraft.trim() === renameRow?.name}
              onPress={() => { void submitRename(); }}
              style={styles.renameAction}
            />
          </View>
        </View>
      </Sheet>
      <ConfirmationModal
        testID="roster-remove-connection"
        visible={removeRow !== null}
        title={t('Remove connection', { ns: 'config' })}
        message={t('Are you sure you want to delete "{{name}}"?', {
          ns: 'config',
          name: removeConnectionName,
        })}
        cancelLabel={t('Cancel', { ns: 'common' })}
        confirmLabel={t('Remove', { ns: 'common' })}
        destructive
        onClose={() => setRemoveRow(null)}
        onConfirm={() => {
          const row = removeRow;
          setRemoveRow(null);
          if (row && onRemoveConnection) {
            void Promise.resolve(onRemoveConnection(row)).catch(() => undefined);
          }
        }}
      />
    </>
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
  renameContent: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.lg,
    gap: Space.lg,
  },
  renameActions: {
    flexDirection: 'row',
    gap: Space.sm,
  },
  renameAction: {
    flex: 1,
  },
  renameField: {
    minHeight: ControlSize.floatingButton,
    justifyContent: 'center',
    borderRadius: Radius.settingsGroup,
    overflow: 'hidden',
  },
  renameInput: {
    minHeight: ControlSize.floatingButton,
    paddingHorizontal: Space.md,
    paddingVertical: 0,
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
  },
});
