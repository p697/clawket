import { useWorkspaceLayout } from '../../navigation/workspace-context';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from 'react-native';
import {
  Bot,
  MonitorSmartphone,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings2,
  UserRound,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  getConnectionRuntime,
  useConnections,
  useRoster,
} from '../../connection';
import { ConnectionUnavailable, type ConnectionUnavailableProps } from '../../components/ui/ConnectionUnavailable';
import { Banner } from '../../components/ui/Banner';
import { ConnectionStatusPill } from '../../components/ui/ConnectionStatusPill';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { FloatingButton, FLOATING_PRIMARY_BUTTON_SIZE, type FloatingButtonBadge } from '../../components/ui/FloatingButton';
import { ProEntryButton } from '../../components/ui/ProEntryButton';
import { RenameSheet } from '../../components/ui/RenameSheet';
import { RosterRow } from '../../components/ui/RosterRow';
import {
  SettingsDivider,
  SettingsGroup,
  SettingsRow,
} from '../../components/ui/SettingsGroup';
import { ChoiceRow } from '../../components/ui/SetupPrimitives';
import { Sheet } from '../../components/ui/Sheet';
import {
  SwipeableRow,
  useSwipeableRowGroup,
  type SwipeableRowAction,
} from '../../components/ui/SwipeableRow';
import { LoadingState } from '../../components/ui/LoadingState';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
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
  assembleRosterSwipeActions,
  type RosterAddAction,
  type RosterRowAction,
} from './actions';

type MaybePromise = void | Promise<void>;



export type RosterGraceBanner = Readonly<{
  message: string;
  actionLabel: string;
}>;

export type RosterViewProps = Readonly<{
  selectedThread?: Readonly<{ connectionId: string; agentId: string; sessionKey: string }>;
  connectionFailure?: ConnectionUnavailableProps;
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
  /** Trailing swipe tray per row; rows without actions do not swipe. */
  rowSwipeActions?: (row: RosterDisplayRow) => ReadonlyArray<SwipeableRowAction>;
  onRefresh: () => MaybePromise;
  onReconnect?: () => MaybePromise;
  onGraceAction?: () => void;
  onOpenPro?: () => void;
}>;

export type RosterScreenProps = Readonly<{
  presentation?: 'page' | 'sidebar';
  selectedThread?: RosterViewProps['selectedThread'];
  onManageActiveConnection?: (connectionId: string) => void;
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
  /** Opens the row's connection page: reconnect, pause, rename, details and removal live there. */
  onManageConnection?: (row: RosterDisplayRow) => void;
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
    <SettingsGroup chrome="plain" style={styles.actionRows}>
      {actions.map((action, index) => (
        <React.Fragment key={action}>
          {index > 0 ? <SettingsDivider /> : null}
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
          description={t('Connect OpenClaw, Hermes and more', { ns: 'config' })}
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
  status,
  onOpenAccount,
  onOpenPro,
  onSearch,
}: Pick<
  RosterViewProps,
  'accountBadge' | 'showProEntry' | 'onOpenAccount' | 'onOpenPro' | 'onSearch'
> & Readonly<{ status?: React.ReactNode }>): React.JSX.Element {
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
      {/* Connection state sits in the spare width, trailing against Search
          (owner feedback 2026-09-19: a centred capsule floated between the
          groups); it never pushes the list. */}
      <View testID="roster-header-status" pointerEvents="box-none" style={styles.headerStatusSlot}>
        {status}
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

/**
 * Connection state in the header centre. The slot is narrow (account, Pro and
 * search share the row), so the capsule carries the glyph plus one action
 * word; the full status stays in the accessibility label.
 */
function RosterConnectionStatus({
  state,
  showOfflineBanner,
  recovering,
  showErrorBanner,
  onRefresh,
  onReconnect,
}: Pick<
  RosterViewProps,
  | 'state'
  | 'recovering'
  | 'showOfflineBanner'
  | 'showErrorBanner'
  | 'onRefresh'
  | 'onReconnect'
>): React.JSX.Element | null {
  const { t } = useTranslation('common');
  const offline = showOfflineBanner ?? state === 'offline';
  const error = showErrorBanner ?? state === 'error';
  const reconnect = () => { void (onReconnect ?? onRefresh)(); };

  if (recovering) {
    return (
      <ConnectionStatusPill
        testID="roster-reconnecting"
        placement="inline"
        status="reconnecting"
        message={t('Reconnecting…')}
      />
    );
  }
  if (offline) {
    return (
      <ConnectionStatusPill
        testID="roster-offline-banner"
        placement="inline"
        status="offline"
        actionLabel={t('Reconnect')}
        accessibilityLabel={`${t('Offline · reconnecting')}, ${t('Reconnect')}`}
        onAction={reconnect}
      />
    );
  }
  if (error) {
    return (
      <ConnectionStatusPill
        testID="roster-error-banner"
        placement="inline"
        status="error"
        actionLabel={t('Retry')}
        accessibilityLabel={`${t('Connection unavailable')}, ${t('Retry')}`}
        onAction={reconnect}
      />
    );
  }
  return null;
}

function RosterBanners({
  state,
  graceBanner,
  onGraceAction,
  onOpenPro,
}: Pick<
  RosterViewProps,
  | 'state'
  | 'graceBanner'
  | 'onGraceAction'
  | 'onOpenPro'
>): React.JSX.Element | null {
  const { t } = useTranslation('common');
  const permission = state === 'permission';

  if (!graceBanner && !permission) return null;

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
  selectedThread,
  connectionFailure,
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
  rowSwipeActions,
  onRefresh,
  onReconnect,
  onGraceAction,
  onOpenPro,
}: RosterViewProps): React.JSX.Element {
  const { t } = useTranslation('common');
  const { dismissRoster } = useWorkspaceLayout();
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const swipeGroup = useSwipeableRowGroup();
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
      item.cached ? item.syncedAt : item.lastActivityAt,
      translateRelativeTime,
    );
    const row = (
      <RosterRow
        testID={`roster-row-${item.key}`}
        selected={selectedThread?.connectionId === item.connectionId
          && selectedThread.agentId === item.agentId && selectedThread.sessionKey === item.sessionKey}
        agentId={item.agentId}
        name={item.name}
        avatarName={item.avatarName}
        emoji={item.emoji}
        avatarUrl={item.avatarUrl}
        preview={!activeConnectionOffline && item.working
          ? item.activity === 'thinking' ? t('Thinking…', { ns: 'chat' })
            : item.activity === 'tool' ? t('Using tool', { ns: 'chat' }) : t('Working')
          : item.subtitle?.label ?? item.preview ?? t('No activity yet')}
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
        onPress={() => { dismissRoster?.(); open(item); }}
        {...(onLongPressRow ? { onLongPress: () => onLongPressRow(item) } : {})}
      />
    );
    const swipeActions = rowSwipeActions?.(item) ?? [];
    if (swipeActions.length === 0) return row;
    return (
      <SwipeableRow
        rowKey={item.key}
        testID={`roster-swipe-${item.key}`}
        actions={swipeActions}
        group={swipeGroup}
      >
        {row}
      </SwipeableRow>
    );
  }, [
    activeConnectionId,
    selectedThread,
    dismissRoster,
    onLongPressRow,
    onOpenLockedRow,
    onOpenRow,
    rowSwipeActions,
    showOfflineBanner,
    recovering,
    state,
    swipeGroup,
    t,
    translateRelativeTime,
  ]);

  return (
    <View testID="roster-screen" style={[styles.screen, { backgroundColor: theme.colors.canvas }]}>
      <View pointerEvents="box-none" style={[styles.header, headerInsets]}>
        <RosterHeader
          accountBadge={accountBadge}
          showProEntry={showProEntry}
          status={(
            <RosterConnectionStatus
              state={state}
              recovering={recovering}
              showOfflineBanner={showOfflineBanner}
              showErrorBanner={showErrorBanner}
              onRefresh={onRefresh}
              onReconnect={onReconnect}
            />
          )}
          onOpenAccount={onOpenAccount}
          onOpenPro={onOpenPro}
          onSearch={onSearch}
        />
      </View>
      {connectionFailure && rows.length === 0 ? (
        <View style={[styles.list, contentInsets]}><ConnectionUnavailable {...connectionFailure} testID="roster-connection-unavailable" /></View>
      ) : state === 'loading' || (rows.length === 0 && recovering) ? (
        <View style={[styles.list, contentInsets]}>
          <RosterLoading />
        </View>
      ) : (
        <FlatList
          testID="roster-list"
          data={rows}
          keyExtractor={(item) => item.key}
          renderItem={renderRow}
          onScrollBeginDrag={swipeGroup.closeAll}
          automaticallyAdjustContentInsets={false}
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={[
            styles.listContent,
            contentInsets,
            rows.length === 0 ? styles.emptyContent : null,
          ]}
          ListHeaderComponent={(
            <>
              {connectionFailure ? <ConnectionUnavailable {...connectionFailure} compact testID="roster-connection-unavailable" /> : null}
              <RosterBanners
                state={state}
                graceBanner={graceBanner}
                onGraceAction={onGraceAction}
                onOpenPro={onOpenPro}
              />
            </>
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
              progressViewOffset={contentInsets.paddingTop}
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
  presentation = 'page',
  selectedThread,
  onManageActiveConnection,
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
  onManageConnection,
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
  const reconnectInFlight = useRef(false);
  const [addVisible, setAddVisible] = useState(false);
  const afterAddCloseRef = useRef<(() => void) | undefined>(undefined);
  const [actionRow, setActionRow] = useState<RosterDisplayRow | null>(null);
  const [removeRow, setRemoveRow] = useState<RosterDisplayRow | null>(null);
  const [renameRow, setRenameRow] = useState<RosterDisplayRow | null>(null);
  const rows = useMemo(() => buildRosterRows(roster, {
    runActivities: connections.runActivities,
    ...(pinnedSessionKeys ? { pinnedSessionKeys } : {}),
    ...(agentPreferences ? { agentPreferences } : {}),
    ...(canAccessAgent ? { canAccessAgent } : {}),
  }), [agentPreferences, canAccessAgent, pinnedSessionKeys, roster, connections.runActivities]);
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
  const activeConnection = connections.connections.find((item) => item.id === connections.activeConnectionId);
  const connectionError = connections.error
    && (connections.error.operation === 'connect' || connections.error.operation === 'probe')
    && (!connections.error.connectionId || connections.error.connectionId === connections.activeConnectionId);
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

  const reconnect = useCallback(async () => {
    const connectionId = connections.activeConnectionId;
    if (!connectionId || reconnectInFlight.current) return;
    reconnectInFlight.current = true;
    try {
      // A button retry is not a pull gesture. The runtime owns recovery UI and
      // opens a fresh socket without expanding iOS RefreshControl's top inset.
      await getConnectionRuntime().reconnectConnection(connectionId);
    } catch {
      // ConnectionRuntime publishes the actionable error; keep the retry usable.
    } finally {
      reconnectInFlight.current = false;
    }
  }, [connections.activeConnectionId]);

  const addActions = useMemo(
    () => assembleRosterAddActions({ canCreateAgent: canCreateAgent && Boolean(onCreateAgent) }),
    [canCreateAgent, onCreateAgent],
  );
  const canRenameRow = useCallback((row: RosterDisplayRow) => canRenamePinnedSession
    && row.connectionId === connections.activeConnectionId
    && Boolean(onRenameSession), [canRenamePinnedSession, connections.activeConnectionId, onRenameSession]);
  const rowActions = useMemo(() => {
    if (!actionRow) return [];
    const group = roster.find((item) => item.connection.id === actionRow.connectionId);
    return assembleRosterRowActions({
      row: actionRow,
      connectionAgentCount: group?.agents.length ?? 0,
      canRenameSession: canRenameRow(actionRow),
    });
  }, [actionRow, canRenameRow, roster]);
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
      case 'manage_connection': return t('Manage connection', { ns: 'config' });
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
  // The long-press menu and the swipe tray share one dispatcher so they never diverge.
  const performRowAction = useCallback((row: RosterDisplayRow, action: RosterRowAction) => {
    if (action === 'remove_connection') {
      setRemoveRow(row);
      return;
    }
    if (action === 'rename_session') {
      setRenameRow(row);
      return;
    }
    if (action === 'manage_connection') {
      onManageConnection?.(row);
      return;
    }
    const run = action === 'pin_agent' || action === 'unpin_agent'
      ? onToggleAgentPinned
      : onUnpinSession;
    if (run) void Promise.resolve(run(row)).catch(() => undefined);
  }, [onManageConnection, onToggleAgentPinned, onUnpinSession]);
  const handleRowAction = useCallback((value: string) => {
    const row = actionRow;
    if (!row) return;
    setActionRow(null);
    performRowAction(row, value as RosterRowAction);
  }, [actionRow, performRowAction]);
  const rowSwipeActions = useCallback((row: RosterDisplayRow): ReadonlyArray<SwipeableRowAction> => (
    assembleRosterSwipeActions({ row, canRenameSession: canRenameRow(row) }).map((action) => ({
      key: action,
      icon: action === 'pin_agent' ? Pin
        : action === 'manage_connection' ? Settings2
          : action === 'rename_session' ? Pencil
            : PinOff,
      label: action === 'pin_agent' ? t('Pin', { ns: 'common' })
        : action === 'manage_connection' ? t('Manage', { ns: 'common' })
          : action === 'rename_session' ? t('Rename', { ns: 'common' })
            : t('Unpin', { ns: 'common' }),
      accessibilityLabel: rowActionLabel(action),
      onPress: () => performRowAction(row, action),
    }))
  ), [canRenameRow, performRowAction, rowActionLabel, t]);
  const submitRename = useCallback(async (title: string) => {
    if (!renameRow || !onRenameSession) return;
    await onRenameSession(renameRow, title);
  }, [onRenameSession, renameRow]);
  const removeConnectionName = removeRow
    ? roster.find((item) => item.connection.id === removeRow.connectionId)?.connection.label
      ?? removeRow.name
    : '';

  return (
    <>
      <RosterView
        selectedThread={presentation === 'sidebar' ? selectedThread : undefined}
        connectionFailure={!connections.recovering && !connections.switching && activeConnection
          && (offline || connectionError) ? {
            name: activeConnection.label,
            lastReadyAt: connections.connectionDetails[activeConnection.id]?.lastReadyAt,
            message: connections.pausedConnectionIds?.includes(activeConnection.id)
              ? t('Connection paused', { ns: 'config' }) : undefined,
            actionLabel: connections.pausedConnectionIds?.includes(activeConnection.id)
              ? t('Resume connection', { ns: 'config' }) : undefined,
            onRetry: reconnect,
            onManage: onManageActiveConnection ? () => onManageActiveConnection(activeConnection.id) : undefined,
          } : undefined}
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
        rowSwipeActions={rowSwipeActions}
        onRefresh={refresh}
        onReconnect={reconnect}
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
      <RenameSheet
        testID="roster-rename"
        visible={renameRow !== null}
        value={renameRow?.name ?? ''}
        onClose={() => setRenameRow(null)}
        onSubmit={submitRename}
      />
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
  headerStatusSlot: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: Space.sm,
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
    gap: Space.sm,
  },
  // Action sheets are list sheets: plain rows on the 16-point body inset, like Commands.
  actionRows: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.lg,
  },
});
