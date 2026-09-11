import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from 'react-native';
import { Bot, MonitorSmartphone, Plus, Search, UserRound } from 'lucide-react-native';
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
import { FloatingButton, FLOATING_PRIMARY_BUTTON_SIZE, type FloatingButtonBadge } from '../../components/ui/FloatingButton';
import { ProEntryButton } from '../../components/ui/ProEntryButton';
import { RosterRow } from '../../components/ui/RosterRow';
import {
  SettingsDivider,
  SettingsGroup,
  SettingsRow,
} from '../../components/ui/SettingsGroup';
import { ChoiceRow } from '../../components/ui/SetupPrimitives';
import { Sheet } from '../../components/ui/Sheet';
import { LoadingState } from '../../components/ui/LoadingState';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Radius,
  Space,
} from '../../theme/tokens';
import {
  relativeTime,
  type RelativeTimeTranslator,
} from '../../utils/chat-message';
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
  showProEntry?: boolean;
  recovering?: boolean;
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
  /** Free tier already holds its one connection; the row shows the Pro lock and `onAdd` opens the paywall. */
  addConnectionLocked?: boolean;
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
  onCreateAgentLocked?: () => void;
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

/**
 * The add sheet is the product's main growth entry, so each option explains
 * what it creates and which level of the roster it lands on.
 */
function RosterAddChoices({
  actions,
  addConnectionLocked,
  createAgentLocked,
  connectionLabel,
  onPress,
}: Readonly<{
  actions: ReadonlyArray<RosterAddAction>;
  addConnectionLocked: boolean;
  createAgentLocked: boolean;
  connectionLabel: string | null;
  onPress: (action: RosterAddAction) => void;
}>): React.JSX.Element {
  const { t } = useTranslation(['chat', 'config']);
  return (
    <View style={styles.addChoices}>
      {actions.map((action) => (action === 'create_agent' ? (
        <ChoiceRow
          key={action}
          testID="roster-action-create_agent"
          icon={Bot}
          title={t('New Agent', { ns: 'chat' })}
          description={connectionLabel
            ? t('Create another agent on {{connection}}', { ns: 'config', connection: connectionLabel })
            : t('Create another agent on this connection', { ns: 'config' })}
          locked={createAgentLocked}
          onPress={() => onPress(action)}
        />
      ) : (
        <ChoiceRow
          key={action}
          testID="roster-action-add_connection"
          icon={MonitorSmartphone}
          title={t('Add Connection', { ns: 'config' })}
          description={t('Connect OpenClaw, Hermes or YouMind Sprite', { ns: 'config' })}
          locked={addConnectionLocked}
          onPress={() => onPress(action)}
        />
      )))}
    </View>
  );
}

function resolveAccountBadge(attentionCount: number): FloatingButtonBadge | undefined {
  if (attentionCount > 0) {
    return { tone: 'bad', count: attentionCount };
  }
  return undefined;
}

function RosterHeader({
  accountBadge,
  showProEntry,
  onOpenAccount,
  onOpenPro,
  onSearch,
}: Pick<
  RosterViewProps,
  'accountBadge' | 'showProEntry' | 'onOpenAccount' | 'onOpenPro' | 'onSearch'
>): React.JSX.Element {
  const { t } = useTranslation(['common', 'config']);

  return (
    <View testID="roster-header" pointerEvents="box-none" style={styles.headerRow}>
      <View style={styles.accountActions}>
        <FloatingButton
          testID="roster-account"
          icon={UserRound}
          badge={accountBadge}
          accessibilityLabel={t('Account settings')}
          onPress={onOpenAccount}
        />
        {showProEntry && onOpenPro ? (
          <ProEntryButton
            testID="roster-pro"
            label={t('Pro', { ns: 'config' })}
            accessibilityLabel={t('View Pro', { ns: 'common' })}
            onPress={onOpenPro}
          />
        ) : null}
      </View>
      <View style={styles.headerActions}>
        <FloatingButton
          testID="roster-search"
          icon={Search}
          accessibilityLabel={t('Search')}
          onPress={onSearch}
        />
      </View>
    </View>
  );
}

function RosterLoading(): React.JSX.Element {
  const { t } = useTranslation('common');
  return <LoadingState testID="roster-loading" message={t('Loading agents')} pose="connecting" />;
}

function RosterBanners({
  state,
  graceBanner,
  showOfflineBanner,
  recovering,
  showErrorBanner,
  onRefresh,
  onGraceAction,
  onOpenPro,
}: Pick<
  RosterViewProps,
  | 'state'
  | 'graceBanner'
  | 'recovering'
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

  if (!graceBanner && !recovering && !offline && !error && !permission) return null;

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
      {recovering ? <Banner testID="roster-reconnecting" tone="neutral" message={t('Reconnecting…')} /> : null}
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
  showProEntry = false,
  showOfflineBanner,
  recovering,
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
    paddingBottom: insets.bottom + Space.xl + FLOATING_PRIMARY_BUTTON_SIZE + Space.lg,
  }), [insets.bottom, insets.top]);
  const headerInsets = useMemo(() => ({
    paddingTop: insets.top + Space.sm,
  }), [insets.top]);
  const translateRelativeTime = useCallback<RelativeTimeTranslator>((key, count) => {
    switch (key) {
      case 'just now':
        return t('just now');
      case '{{count}}m ago':
        return t('{{count}}m ago', { count });
      case '{{count}}h ago':
        return t('{{count}}h ago', { count });
      case 'Yesterday':
        return t('Yesterday');
      case '{{count}}d ago':
        return t('{{count}}d ago', { count });
      case '{{count}}w ago':
        return t('{{count}}w ago', { count });
      case '{{count}}mo ago':
        return t('{{count}}mo ago', { count });
    }
  }, [t]);
  const renderRow = useCallback<ListRenderItem<RosterDisplayRow>>(({ item }) => {
    const activeConnectionOffline = item.connectionId === activeConnectionId
      && (showOfflineBanner ?? state === 'offline');
    const open = item.locked ? onOpenLockedRow : onOpenRow;
    const timeLabel = relativeTime(
      item.cached ? item.syncedAt : item.updatedAt,
      translateRelativeTime,
    );
    return (
      <RosterRow
        testID={`roster-row-${item.key}`}
        agentId={item.agentId}
        name={item.name}
        avatarName={item.avatarName}
        emoji={item.emoji}
        avatarUrl={item.avatarUrl}
        preview={item.subtitle?.label ?? item.preview ?? t('No activity yet')}
        pinned={item.kind === 'pinned_session'}
        sessionKind={item.sessionKind}
        avatarStatus={activeConnectionOffline ? 'offline' : item.working ? 'working' : 'idle'}
        timeLabel={timeLabel}
        unreadCount={item.unreadCount}
        unreadIndicator="dot"
        attention={item.attention !== null}
        attentionTone="bad"
        cached={item.cached}
        locked={item.locked}
        accessibilityLabel={item.cached ? `${item.name}, ${t('Last synced')}` : [item.name, item.working ? t('Working') : null, item.unreadCount > 0 ? t('Unread messages') : null].filter(Boolean).join(', ')}
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
  recovering,
    state,
    t,
    translateRelativeTime,
  ]);

  return (
    <View testID="roster-screen" style={[styles.screen, { backgroundColor: theme.colors.canvas }]}>
      <View pointerEvents="box-none" style={[styles.header, headerInsets]}>
        <RosterHeader
          accountBadge={accountBadge}
          showProEntry={showProEntry}
          onOpenAccount={onOpenAccount}
          onOpenPro={onOpenPro}
          onSearch={onSearch}
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
              recovering={recovering}
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
      <FloatingButton
        testID="roster-add"
        icon={Plus}
        size="primary"
        appearance="ink"
        accessibilityLabel={t('Add Connection', { ns: 'config' })}
        onPress={onAdd}
        style={[styles.addButton, {
          right: insets.right + Space.xl,
          bottom: insets.bottom + Space.xl,
        }]}
      />
    </View>
  );
}

export function RosterScreen({
  pinnedSessionKeys,
  agentPreferences,
  canAccessAgent,
  canCreateAgent = false,
  addConnectionLocked = false,
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
  onCreateAgentLocked,
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
  const afterAddCloseRef = useRef<(() => void) | undefined>(undefined);
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
  const offline = !connections.recovering && (connections.recoveryFailed || connections.activeState === 'offline'
    || connections.activeState === 'reconnecting');
  const accountBadge = resolveAccountBadge(accountAttentionCount);
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
  const activeConnectionLabel = useMemo(() => {
    const group = roster.find((item) => item.connection.id === connections.activeConnectionId);
    const label = group?.connection.label.trim() ?? '';
    return label.length > 0 ? label : null;
  }, [connections.activeConnectionId, roster]);
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
  const handleAddAction = useCallback((action: RosterAddAction) => {
    setAddVisible(false);
    if (action === 'add_connection') {
      afterAddCloseRef.current = onAdd;
      return;
    }
    if (!isPro) {
      afterAddCloseRef.current = onCreateAgentLocked ?? onOpenPro;
      return;
    }
    afterAddCloseRef.current = onCreateAgent;
  }, [isPro, onAdd, onCreateAgent, onCreateAgentLocked, onOpenPro]);
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
        showProEntry={!isPro}
        recovering={connections.recovering}
        showOfflineBanner={offline}
        showErrorBanner={connections.error !== null && !offline}
        onOpenAccount={onOpenAccount}
        onSearch={onSearch}
        onAdd={() => addActions.length === 1 ? onAdd() : setAddVisible(true)}
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
        onAfterClose={() => {
          const action = afterAddCloseRef.current;
          afterAddCloseRef.current = undefined;
          action?.();
        }}
        onClose={() => setAddVisible(false)}
        closeAccessibilityLabel={closeLabel}
        title={t('Add', { ns: 'common' })}
        maxHeight="55%"
      >
        <RosterAddChoices
          actions={addActions}
          addConnectionLocked={addConnectionLocked}
          createAgentLocked={!isPro}
          connectionLabel={activeConnectionLabel}
          onPress={handleAddAction}
        />
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
  addButton: {
    position: 'absolute',
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
  accountActions: {
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
  addChoices: {
    paddingHorizontal: Space.xl,
    paddingTop: Space.sm,
    gap: Space.sm,
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
