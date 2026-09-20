import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Check,
  ChevronDown,
  Pin,
  Search,
} from 'lucide-react-native';
import { ChevronRight } from '../../components/ui/DirectionalIcon';
import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { useTranslation } from 'react-i18next';
import type { AgentDescriptor, Capabilities } from '@clawket/agent-protocol';

import { getConnectionRuntime, useConnections, useRoster } from '../../connection';
import { AgentAvatar, AvatarWorkingBadge } from '../../components/ui/AgentAvatar';
import { Banner } from '../../components/ui/Banner';
import { ConnectionStatusPill } from '../../components/ui/ConnectionStatusPill';
import { Button } from '../../components/ui/Button';
import { SheetHeaderButton } from '../../components/ui/SheetHeaderButton';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { SearchInput } from '../../components/ui/SearchInput';
import {
  resolveSessionChannelIcon,
  resolveSessionKindIcon,
} from '../../components/ui/sessionKindIcon';
import { Sheet } from '../../components/ui/Sheet';
import { Skeleton } from '../../components/ui/Skeleton';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  HitSize,
  IconSize,
  LineHeight,
  Radius,
  Shadow,
  Space,
  StatusSize,
  createThemedShadowStyle,
} from '../../theme/tokens';
import { relativeTime } from '../../utils/chat-message';
import { analyticsEvents } from '../../services/analytics/events';
import {
  availableSessionActions,
  buildSessionPanelAgents,
  buildSessionPanelChips,
  buildSessionPanelListItems,
  buildSessionPanelRows,
  filterSessionPanelRows,
  normalizeSessionRenameTitle,
  resolveSessionPanelFilterKind,
  resolveSessionPanelPageState,
  type SessionPanelAction,
  type SessionPanelAgentOption,
  type SessionPanelChip,
  type SessionPanelFilter,
  type SessionPanelListItem,
  type SessionPanelPageState,
  type SessionPanelRenamePayload,
  type SessionPanelRow,
} from './model';

type MaybePromise = void | Promise<void>;
type SessionPanelActionHandler = (
  row: SessionPanelRow,
  action: SessionPanelAction,
  payload?: SessionPanelRenamePayload,
) => MaybePromise;
type PinnedSessionKeys = Readonly<Record<string, ReadonlyArray<string>>>;

const MUTATION_CAPABILITIES_OFF = Object.freeze({
  sessionRename: false,
  sessionReset: false,
  sessionDelete: false,
}) satisfies Pick<Capabilities, 'sessionRename' | 'sessionReset' | 'sessionDelete'>;

const PANEL_SKELETON_ROWS = Object.freeze(['one', 'two', 'three', 'four', 'five']);
const PANEL_SEARCH_ANALYTICS_DEBOUNCE_MS = 400;
/** Chips are 36 points tall; the slop restores the 44-point target. */
const CHIP_HIT_SLOP = Object.freeze({ top: Space.xs, bottom: Space.xs });
const CHIP_COUNT_SELECTED_OPACITY = 0.7;

export type SessionPanelViewProps = Readonly<{
  visible: boolean;
  state: SessionPanelPageState;
  rows: ReadonlyArray<SessionPanelRow>;
  agents: ReadonlyArray<AgentDescriptor>;
  currentAgentId: string;
  currentSessionKey: string;
  capabilities: Pick<
    Capabilities,
    'sessionRename' | 'sessionReset' | 'sessionDelete'
  >;
  bridgeOutdated?: boolean;
  /** The runtime's foreground grace window is open: show quiet reconnecting instead of offline. */
  reconnecting?: boolean;
  onClose: () => void;
  onSelectSession: (row: SessionPanelRow) => MaybePromise;
  onSessionAction?: SessionPanelActionHandler;
  onRetry?: () => MaybePromise;
  onOpenBridgeHelp?: () => void;
  onOpenPermission?: () => void;
}>;

export type SessionPanelProps = Readonly<{
  visible: boolean;
  currentAgentId: string;
  currentSessionKey: string;
  permissionDenied?: boolean;
  pinnedSessionKeys?: PinnedSessionKeys;
  onClose: () => void;
  onSelectSession: (row: SessionPanelRow) => MaybePromise;
  onSessionAction?: SessionPanelActionHandler;
  onOpenBridgeHelp?: () => void;
  onOpenPermission?: () => void;
}>;

type Translate = ReturnType<typeof useTranslation>['t'];

function chipLabel(chip: SessionPanelChip, t: Translate): string {
  if (chip.key === 'all') return t('All');
  if (chip.key === 'direct_group') return t('Direct & groups');
  if (chip.key === 'subagent') return t('Subagents');
  if (chip.key === 'cron') return t('Scheduled');
  return chip.label ?? t('Channels');
}

function rowTitle(row: SessionPanelRow, t: Translate): string {
  if (row.kind === 'main') return t('Main session');
  return row.title === row.key ? t('New session') : row.title;
}

function SessionTile({
  row,
  agent,
}: Readonly<{ row: SessionPanelRow; agent: AgentDescriptor | null }>): React.JSX.Element {
  const { theme } = useAppTheme();
  if (row.kind === 'main') {
    return (
      <AgentAvatar
        testID={`session-panel-row-${row.id}-avatar`}
        agentId={row.agentId}
        name={agent?.name ?? row.agentName}
        emoji={agent?.emoji}
        avatarUrl={agent?.avatarUrl}
        variant="panel"
        status={row.hasActiveRun ? 'working' : 'idle'}
      />
    );
  }
  const Icon = row.kind === 'channel'
    ? resolveSessionChannelIcon(row.channel)
    : resolveSessionKindIcon(row.kind);
  return (
    <View style={styles.tileSlot}>
      <View
        testID={`session-panel-row-${row.id}-tile`}
        style={[styles.tile, { backgroundColor: theme.colors.surface }]}
      >
        <Icon
          testID={`session-panel-row-${row.id}-icon`}
          size={IconSize.md}
          color={theme.colors.ink}
        />
      </View>
      {row.hasActiveRun ? (
        <AvatarWorkingBadge testID={`session-panel-row-${row.id}-working`} />
      ) : null}
    </View>
  );
}

function SessionRow({
  row,
  agent,
  selected,
  capabilities,
  onPress,
  onOpenActions,
}: Readonly<{
  row: SessionPanelRow;
  agent: AgentDescriptor | null;
  selected: boolean;
  capabilities: SessionPanelViewProps['capabilities'];
  onPress: () => void;
  onOpenActions: (row: SessionPanelRow) => void;
}>): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('common');
  const actions = availableSessionActions(row, capabilities);
  const title = rowTitle(row, t);
  const showUnread = row.unread && !selected && row.attention === null;
  // One quiet 6-point signal on the preview line: attention wins over unread.
  const signal = row.attention !== null
    ? (
      <View
        testID={`session-panel-row-${row.id}-attention`}
        style={[styles.signalDot, { backgroundColor: theme.colors.bad }]}
      />
    )
    : showUnread
      ? (
        <View
          testID={`session-panel-row-${row.id}-unread`}
          style={[styles.signalDot, { backgroundColor: theme.colors.ink }]}
        />
      )
      : null;

  return (
    <Pressable
      testID={`session-panel-row-${row.id}`}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected }}
      onPress={onPress}
      onLongPress={actions.length ? () => onOpenActions(row) : undefined}
      style={({ pressed }) => [
        styles.sessionRow,
        selected ? { backgroundColor: theme.colors.accentSoft } : null,
        pressed ? { backgroundColor: theme.colors.surfaceFloating } : null,
      ]}
    >
      <SessionTile row={row} agent={agent} />
      <View style={styles.copy}>
        <View style={styles.titleRow}>
          {row.pinned ? (
            <Pin
              testID={`session-panel-row-${row.id}-pinned`}
              size={IconSize.sm}
              color={theme.colors.inkTertiary}
            />
          ) : null}
          <Text style={[styles.rowTitle, { color: theme.colors.ink }]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[styles.rowTime, { color: theme.colors.inkTertiary }]} numberOfLines={1}>
            {relativeTime(row.updatedAt)}
          </Text>
        </View>
        {row.preview || signal ? (
          <View style={styles.previewRow}>
            {row.preview ? (
              <Text
                testID={`session-panel-row-${row.id}-preview`}
                style={[
                  styles.rowPreview,
                  { color: showUnread ? theme.colors.ink : theme.colors.inkSecondary },
                ]}
                numberOfLines={1}
              >
                {row.preview}
              </Text>
            ) : (
              <View style={styles.previewSpacer} />
            )}
            {signal}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function SubagentsRow({
  count,
  onPress,
}: Readonly<{ count: number; onPress: () => void }>): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('common');
  const Icon = resolveSessionKindIcon('subagent');
  return (
    <Pressable
      testID="session-panel-subagents"
      accessibilityRole="button"
      accessibilityLabel={t('Subagents')}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sessionRow,
        pressed ? { backgroundColor: theme.colors.surfaceFloating } : null,
      ]}
    >
      <View style={[styles.tile, { backgroundColor: theme.colors.surface }]}>
        <Icon size={IconSize.md} color={theme.colors.ink} />
      </View>
      <Text style={[styles.rowTitle, styles.copy, { color: theme.colors.ink }]} numberOfLines={1}>
        {t('Subagents')}
      </Text>
      <Text style={[styles.rowCount, { color: theme.colors.inkTertiary }]}>{count}</Text>
      <ChevronRight size={IconSize.sm} color={theme.colors.inkTertiary} />
    </Pressable>
  );
}

function FilterChip({
  chip,
  selected,
  onPress,
}: Readonly<{ chip: SessionPanelChip; selected: boolean; onPress: () => void }>): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('common');
  const label = chipLabel(chip, t);
  return (
    <Pressable
      testID={`session-panel-chip-${chip.key}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      hitSlop={CHIP_HIT_SLOP}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? theme.colors.ink : theme.colors.surface },
        pressed ? styles.pressed : null,
      ]}
    >
      <Text
        style={[
          styles.chipLabel,
          {
            color: selected ? theme.colors.canvas : theme.colors.ink,
            fontWeight: selected ? FontWeight.semibold : FontWeight.regular,
          },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.chipCount,
          selected
            ? { color: theme.colors.canvas, opacity: CHIP_COUNT_SELECTED_OPACITY }
            : { color: theme.colors.inkTertiary },
        ]}
      >
        {chip.count}
      </Text>
    </Pressable>
  );
}

function AgentPill({
  agent,
  switchable,
  expanded,
  onPress,
}: Readonly<{
  agent: AgentDescriptor;
  switchable: boolean;
  expanded: boolean;
  onPress: () => void;
}>): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('common');
  const content = (
    <>
      <AgentAvatar
        testID="session-panel-agent-pill-avatar"
        agentId={agent.agentId}
        name={agent.name}
        emoji={agent.emoji}
        avatarUrl={agent.avatarUrl}
        variant="header"
      />
      <Text style={[styles.agentName, { color: theme.colors.ink }]} numberOfLines={1}>
        {agent.name}
      </Text>
      {switchable ? (
        <ChevronDown size={IconSize.sm} color={theme.colors.inkSecondary} />
      ) : null}
    </>
  );
  const chrome = [styles.agentPill, { backgroundColor: theme.colors.surface }];
  if (!switchable) {
    return (
      <View testID="session-panel-agent-pill" accessibilityLabel={agent.name} style={chrome}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      testID="session-panel-agent-pill"
      accessibilityRole="button"
      accessibilityLabel={t('Switch Agent')}
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={({ pressed }) => [...chrome, pressed ? styles.pressed : null]}
    >
      {content}
    </Pressable>
  );
}

function AgentMenu({
  options,
  activeAgentId,
  onChoose,
  onClose,
}: Readonly<{
  options: ReadonlyArray<SessionPanelAgentOption>;
  activeAgentId: string;
  onChoose: (option: SessionPanelAgentOption) => void;
  onClose: () => void;
}>): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('common');
  const card = useMemo(() => [
    styles.agentMenu,
    { backgroundColor: theme.colors.surfaceFloating },
    createThemedShadowStyle(theme.colors, theme.scheme, Shadow.md),
  ], [theme.colors, theme.scheme]);
  return (
    <View testID="session-panel-agent-menu" style={StyleSheet.absoluteFill}>
      <Pressable
        testID="session-panel-agent-menu-backdrop"
        accessibilityRole="button"
        accessibilityLabel={t('Close')}
        style={StyleSheet.absoluteFill}
        onPress={onClose}
      />
      <View style={card}>
        {options.map((option) => {
          const selected = option.agent.agentId === activeAgentId;
          return (
            <Pressable
              key={option.agent.agentId}
              testID={`session-panel-agent-${option.agent.agentId}`}
              accessibilityRole="button"
              accessibilityLabel={option.agent.name}
              accessibilityState={{ selected }}
              onPress={() => onChoose(option)}
              style={({ pressed }) => [
                styles.agentMenuRow,
                pressed ? { backgroundColor: theme.colors.surface } : null,
              ]}
            >
              <AgentAvatar
                agentId={option.agent.agentId}
                name={option.agent.name}
                emoji={option.agent.emoji}
                avatarUrl={option.agent.avatarUrl}
                variant="sheet"
              />
              <Text
                style={[
                  styles.agentMenuName,
                  {
                    color: theme.colors.ink,
                    fontWeight: selected ? FontWeight.semibold : FontWeight.regular,
                  },
                ]}
                numberOfLines={1}
              >
                {option.agent.name}
              </Text>
              {selected ? (
                <Check size={IconSize.md} color={theme.colors.ink} />
              ) : (
                <Text style={[styles.rowCount, { color: theme.colors.inkTertiary }]}>
                  {option.count}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function PanelLoading(): React.JSX.Element {
  const { t } = useTranslation('common');
  return (
    <View testID="session-panel-loading" accessibilityLabel={t('Loading sessions')}>
      {PANEL_SKELETON_ROWS.map((key) => (
        <View key={key} style={styles.skeletonRow}>
          <Skeleton style={styles.skeletonTile} />
          <View style={styles.skeletonCopy}>
            <Skeleton style={styles.skeletonTitle} />
            <Skeleton style={styles.skeletonPreview} />
          </View>
          <Skeleton style={styles.skeletonTime} />
        </View>
      ))}
    </View>
  );
}

function actionLabel(
  action: SessionPanelAction,
  pinned: boolean,
  t: Translate,
): string {
  if (action === 'pin') return pinned ? t('Unpin from roster') : t('Pin to roster');
  if (action === 'rename') return t('Rename');
  if (action === 'reset') return t('Reset');
  return t('Delete');
}

function SessionActionSheet({
  row,
  capabilities,
  onClose,
  onChoose,
  onAfterClose,
}: Readonly<{
  row: SessionPanelRow | null;
  capabilities: SessionPanelViewProps['capabilities'];
  onClose: () => void;
  onChoose: (action: SessionPanelAction) => void;
  onAfterClose: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation('common');
  const { theme } = useAppTheme();
  const actions = row ? availableSessionActions(row, capabilities) : [];
  return (
    <Sheet
      testID="session-panel-actions"
      onAfterClose={onAfterClose}
      visible={row !== null}
      title={t('Session actions')}
      closeAccessibilityLabel={t('Close')}
      onClose={onClose}
    >
      <View style={styles.actionList}>
        {actions.map((action) => (
          <Pressable
            key={action}
            testID={`session-panel-action-${action}`}
            accessibilityRole="button"
            onPress={() => onChoose(action)}
            style={({ pressed }) => [styles.actionRow, pressed ? styles.pressed : null]}
          >
            <Text style={[
              styles.actionText,
              { color: action === 'delete' ? theme.colors.bad : theme.colors.ink },
            ]}>
              {actionLabel(action, row?.pinned === true, t)}
            </Text>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

function ConfirmActionSheet({
  pending,
  onClose,
  onConfirm,
}: Readonly<{
  pending: Readonly<{ row: SessionPanelRow; action: 'reset' | 'delete' }> | null;
  onClose: () => void;
  onConfirm: () => void;
}>): React.JSX.Element {
  const { t } = useTranslation('common');
  const action = pending?.action;
  return (
    <Sheet
      testID="session-panel-confirm"
      visible={pending !== null}
      title={action === 'delete' ? t('Delete session?') : t('Reset session?')}
      closeAccessibilityLabel={t('Close')}
      onClose={onClose}
    >
      <View style={styles.confirmContent}>
        <Text style={styles.confirmText}>{t('This cannot be undone.')}</Text>
        <View style={styles.confirmButtons}>
          <Button label={t('Cancel')} variant="secondary" onPress={onClose} style={styles.confirmButton} />
          <Button
            label={action === 'delete' ? t('Delete') : t('Reset')}
            variant="destructive"
            onPress={onConfirm}
            style={styles.confirmButton}
          />
        </View>
      </View>
    </Sheet>
  );
}

function RenameSessionSheet({
  row,
  onClose,
  onConfirm,
}: Readonly<{
  row: SessionPanelRow | null;
  onClose: () => void;
  onConfirm: (row: SessionPanelRow, title: string) => MaybePromise;
}>): React.JSX.Element {
  const { t } = useTranslation('common');
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setDraft(row?.title ?? '');
    setSubmitting(false);
  }, [row]);

  const title = row ? normalizeSessionRenameTitle(draft, row.title) : null;
  const close = useCallback(() => {
    if (!submitting) onClose();
  }, [onClose, submitting]);
  const submit = useCallback(() => {
    if (!row || !title || submitting) return;
    setSubmitting(true);
    void Promise.resolve(onConfirm(row, title)).then(
      () => {
        setSubmitting(false);
        onClose();
      },
      () => setSubmitting(false),
    );
  }, [onClose, onConfirm, row, submitting, title]);

  return (
    <Sheet
      testID="session-panel-rename"
      visible={row !== null}
      title={t('Rename')}
      closeAccessibilityLabel={t('Cancel')}
      dismissOnBackdropPress={!submitting}
      onClose={close}
    >
      <View style={styles.renameContent}>
        <FormTextInput
          testID="session-panel-rename-input"
          value={draft}
          placeholder={t('Name')}
          accessibilityLabel={t('Name')}
          autoFocus
          editable={!submitting}
          returnKeyType="done"
          onChangeText={setDraft}
          onSubmitEditing={submit}
        />
        <View style={styles.confirmButtons}>
          <Button
            label={t('Cancel')}
            variant="secondary"
            disabled={submitting}
            onPress={close}
            style={styles.confirmButton}
          />
          <Button
            label={t('Save')}
            disabled={!title}
            loading={submitting}
            onPress={submit}
            style={styles.confirmButton}
          />
        </View>
      </View>
    </Sheet>
  );
}

export function SessionPanelView({
  visible,
  state,
  rows,
  agents,
  currentAgentId,
  currentSessionKey,
  capabilities,
  bridgeOutdated = false,
  reconnecting = false,
  onClose,
  onSelectSession,
  onSessionAction,
  onRetry,
  onOpenBridgeHelp,
  onOpenPermission,
}: SessionPanelViewProps): React.JSX.Element {
  const { t } = useTranslation('common');
  const { theme } = useAppTheme();
  const [viewAgentId, setViewAgentId] = useState(currentAgentId);
  const [filter, setFilter] = useState<SessionPanelFilter>('all');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [actionRow, setActionRow] = useState<SessionPanelRow | null>(null);
  const [confirmation, setConfirmation] = useState<Readonly<{
    row: SessionPanelRow;
    action: 'reset' | 'delete';
  }> | null>(null);
  const [renameRow, setRenameRow] = useState<SessionPanelRow | null>(null);
  const wasVisibleRef = useRef(false);
  useEffect(() => {
    if (!visible) {
      wasVisibleRef.current = false;
      return;
    }
    if (wasVisibleRef.current) return;
    wasVisibleRef.current = true;
    analyticsEvents.sessionPanelOpened({ session_count: rows.length });
  }, [rows.length, visible]);

  // Each opening starts on the conversation's own Agent with the whole list.
  useEffect(() => {
    if (!visible) return;
    setViewAgentId(currentAgentId);
    setFilter('all');
    setAgentMenuOpen(false);
  }, [currentAgentId, visible]);

  const agentOptions = useMemo(() => buildSessionPanelAgents(rows, agents), [agents, rows]);
  const viewAgent = useMemo(() => (
    agents.find((agent) => agent.agentId === viewAgentId)
      ?? agents.find((agent) => agent.agentId === currentAgentId)
      ?? agents[0]
      ?? null
  ), [agents, currentAgentId, viewAgentId]);
  const viewAgentIdResolved = viewAgent?.agentId ?? currentAgentId;
  const agentRows = useMemo(
    () => rows.filter((row) => row.agentId === viewAgentIdResolved),
    [rows, viewAgentIdResolved],
  );
  const chips = useMemo(() => buildSessionPanelChips(agentRows), [agentRows]);
  const activeFilter: SessionPanelFilter = chips.some((chip) => chip.key === filter) ? filter : 'all';
  const filteredRows = useMemo(() => filterSessionPanelRows(rows, {
    agentId: viewAgentIdResolved,
    filter: activeFilter,
    query,
  }), [activeFilter, query, rows, viewAgentIdResolved]);
  const searching = query.trim().length > 0;
  const listItems = useMemo<ReadonlyArray<SessionPanelListItem>>(() => (
    searching
      ? filteredRows.map((row) => ({ type: 'row', row }))
      : buildSessionPanelListItems(filteredRows, activeFilter)
  ), [activeFilter, filteredRows, searching]);

  useEffect(() => {
    if (!visible || !searching) return undefined;
    const resultKinds = [...new Set(filteredRows.map((row) => row.kind))].sort().join(',') || 'none';
    const timer = setTimeout(() => {
      analyticsEvents.searchPerformed({
        scope: 'panel',
        has_results: filteredRows.length > 0,
        result_kinds: resultKinds,
      });
    }, PANEL_SEARCH_ANALYTICS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filteredRows, searching, visible]);

  const chooseFilter = useCallback((next: SessionPanelFilter) => {
    if (next !== activeFilter) {
      analyticsEvents.sessionPanelFilterChanged({ filter: resolveSessionPanelFilterKind(next) });
    }
    setFilter(next);
  }, [activeFilter]);
  const chooseAgent = useCallback((option: SessionPanelAgentOption) => {
    setAgentMenuOpen(false);
    if (option.agent.agentId === viewAgentIdResolved) return;
    analyticsEvents.sessionPanelAgentSwitched({ session_count: option.count });
    setViewAgentId(option.agent.agentId);
    setFilter('all');
  }, [viewAgentIdResolved]);
  const select = useCallback((row: SessionPanelRow) => {
    analyticsEvents.chatSessionSelected({
      source: 'panel',
      session_kind: row.kind,
      from: 'panel',
    });
    void Promise.resolve(onSelectSession(row)).then(onClose, () => undefined);
  }, [onClose, onSelectSession]);
  const pendingSessionAction = useRef<(() => void) | null>(null);
  const finishSessionAction = useCallback(() => {
    const action = pendingSessionAction.current;
    pendingSessionAction.current = null;
    if (visible) action?.();
  }, [visible]);
  useEffect(() => {
    if (visible) return;
    pendingSessionAction.current = null;
    setActionRow(null);
    setRenameRow(null);
    setConfirmation(null);
  }, [visible]);
  const chooseAction = useCallback((action: SessionPanelAction) => {
    if (!actionRow || pendingSessionAction.current) return;
    pendingSessionAction.current = () => {
      if (action === 'reset' || action === 'delete') {
        setConfirmation({ row: actionRow, action });
        return;
      }
      if (action === 'rename') {
        setRenameRow(actionRow);
        return;
      }
      if (onSessionAction) {
        analyticsEvents.sessionAction({ action });
        void Promise.resolve(onSessionAction(actionRow, action)).catch(() => undefined);
      }
    };
    setActionRow(null);
  }, [actionRow, onSessionAction]);
  const confirmAction = useCallback(() => {
    if (!confirmation) return;
    const pending = confirmation;
    setConfirmation(null);
    if (onSessionAction) {
      analyticsEvents.sessionAction({ action: pending.action });
      void Promise.resolve(onSessionAction(pending.row, pending.action)).catch(() => undefined);
    }
  }, [confirmation, onSessionAction]);
  const renameSession = useCallback((row: SessionPanelRow, title: string) => {
    if (!onSessionAction) return undefined;
    analyticsEvents.sessionAction({ action: 'rename' });
    return onSessionAction(row, 'rename', { title });
  }, [onSessionAction]);

  const renderItem = useCallback(({ item }: { item: SessionPanelListItem }) => {
    if (item.type === 'subagents') {
      return <SubagentsRow count={item.count} onPress={() => chooseFilter('subagent')} />;
    }
    return (
      <SessionRow
        row={item.row}
        agent={viewAgent}
        selected={item.row.key === currentSessionKey}
        capabilities={capabilities}
        onPress={() => select(item.row)}
        onOpenActions={setActionRow}
      />
    );
  }, [capabilities, chooseFilter, currentSessionKey, select, viewAgent]);
  const keyExtractor = useCallback((item: SessionPanelListItem) => (
    item.type === 'row' ? item.row.id : 'subagents'
  ), []);

  const showList = state !== 'permission';
  const switchable = agentOptions.length > 1;

  return (
    <>
      <Sheet
        testID="session-panel"
        snapPoints={['93%']}
        visible={visible}
        title={t('Sessions')}
        titleContent={viewAgent ? (
          <AgentPill
            agent={viewAgent}
            switchable={switchable}
            expanded={agentMenuOpen}
            onPress={() => setAgentMenuOpen((current) => !current)}
          />
        ) : undefined}
        closeAccessibilityLabel={t('Close sessions')}
        onClose={onClose}
        contentStyle={styles.sheetContent}
        headerRight={(
          <SheetHeaderButton
            testID="session-panel-search-toggle"
            icon={Search}
            accessibilityLabel={t('Search sessions')}
            onPress={() => setSearchOpen((current) => !current)}
          />
        )}
      >
        <View style={styles.body}>
          {showList && chips.length > 0 ? (
            <ScrollView
              testID="session-panel-chips"
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              style={styles.chipStrip}
              contentContainerStyle={styles.chipRow}
            >
              {chips.map((chip) => (
                <FilterChip
                  key={chip.key}
                  chip={chip}
                  selected={chip.key === activeFilter}
                  onPress={() => chooseFilter(chip.key)}
                />
              ))}
            </ScrollView>
          ) : null}
          {searchOpen ? (
            <View style={styles.searchWrap}>
              <SearchInput
                testID="session-panel-search"
                inSheet
                autoFocus
                value={query}
                placeholder={t('Search sessions')}
                onChangeText={setQuery}
                onClear={() => setQuery('')}
              />
            </View>
          ) : null}

          {state === 'loading' ? <PanelLoading /> : (
            <BottomSheetFlatList
              testID="session-panel-scroll"
              style={styles.list}
              data={showList ? listItems : []}
              keyExtractor={keyExtractor}
              renderItem={renderItem}
              initialNumToRender={12}
              maxToRenderPerBatch={12}
              windowSize={5}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              ListHeaderComponent={(
                <View>
                  {/* The sheet title slot belongs to the Agent switcher, so the capsule leads the list. */}
                  {state === 'offline' && reconnecting ? (
                    <ConnectionStatusPill
                      testID="session-panel-reconnecting"
                      placement="inline"
                      status="reconnecting"
                      message={t('Reconnecting…')}
                      style={styles.statusPill}
                    />
                  ) : state === 'offline' ? (
                    <ConnectionStatusPill
                      testID="session-panel-offline"
                      placement="inline"
                      status="offline"
                      message={t('Offline · reconnecting')}
                      actionLabel={onRetry ? t('Reconnect') : undefined}
                      onAction={onRetry ? () => { void onRetry(); } : undefined}
                      style={styles.statusPill}
                    />
                  ) : null}
                  {state === 'error' ? (
                    <ConnectionStatusPill
                      testID="session-panel-error"
                      placement="inline"
                      status="error"
                      message={t('Sessions unavailable')}
                      actionLabel={onRetry ? t('Retry') : undefined}
                      onAction={onRetry ? () => { void onRetry(); } : undefined}
                      style={styles.statusPill}
                    />
                  ) : null}
                  {state === 'permission' ? (
                    <Banner
                      testID="session-panel-permission"
                      message={t('Sessions require permission')}
                      actionLabel={onOpenPermission ? t('View Pro') : undefined}
                      onAction={onOpenPermission}
                    />
                  ) : null}
                  {bridgeOutdated ? (
                    <Banner
                      testID="session-panel-bridge-outdated"
                      message={t('Update bridge to 3.0 for more sessions')}
                      actionLabel={onOpenBridgeHelp ? t('Update') : undefined}
                      onAction={onOpenBridgeHelp}
                    />
                  ) : null}
                  {showList && listItems.length === 0 ? (
                    <View testID="session-panel-empty" style={styles.emptyState}>
                      <Text style={[styles.emptyText, { color: theme.colors.inkSecondary }]}>
                        {rows.length ? t('No matching sessions') : t('No sessions yet')}
                      </Text>
                    </View>
                  ) : null}
                </View>
              )}
            />
          )}

          {agentMenuOpen && switchable ? (
            <AgentMenu
              options={agentOptions}
              activeAgentId={viewAgentIdResolved}
              onChoose={chooseAgent}
              onClose={() => setAgentMenuOpen(false)}
            />
          ) : null}
        </View>
      </Sheet>

      <SessionActionSheet
        row={actionRow}
        capabilities={capabilities}
        onClose={() => setActionRow(null)}
        onChoose={chooseAction}
        onAfterClose={finishSessionAction}
      />
      <ConfirmActionSheet
        pending={confirmation}
        onClose={() => setConfirmation(null)}
        onConfirm={confirmAction}
      />
      <RenameSessionSheet
        row={renameRow}
        onClose={() => setRenameRow(null)}
        onConfirm={renameSession}
      />
    </>
  );
}

export function SessionPanel({
  visible,
  currentAgentId,
  currentSessionKey,
  permissionDenied = false,
  pinnedSessionKeys,
  onClose,
  onSelectSession,
  onSessionAction,
  onOpenBridgeHelp,
  onOpenPermission,
}: SessionPanelProps): React.JSX.Element {
  const connections = useConnections();
  const roster = useRoster();
  const group = roster.find((candidate) => (
    candidate.connection.id === connections.activeConnectionId
  ));
  const rows = useMemo(
    () => buildSessionPanelRows(group, { pinnedSessionKeys }),
    [group, pinnedSessionKeys],
  );
  const agents = useMemo(
    () => group?.agents.map((summary) => summary.agent) ?? [],
    [group],
  );
  const adapter = connections.activeAdapter;
  const capabilities = adapter?.capabilities ?? {
    ...MUTATION_CAPABILITIES_OFF,
  };
  const state = resolveSessionPanelPageState({
    initialized: connections.initialized,
    hasPermission: !permissionDenied,
    rowCount: rows.length,
    activeState: connections.activeState,
    hasError: connections.error !== null,
  });

  return (
    <SessionPanelView
      visible={visible}
      state={state}
      rows={rows}
      agents={agents}
      currentAgentId={currentAgentId}
      currentSessionKey={currentSessionKey}
      capabilities={capabilities}
      bridgeOutdated={group?.connection.bridgeOutdated === true}
      reconnecting={connections.recovering === true}
      onClose={onClose}
      onSelectSession={onSelectSession}
      onSessionAction={onSessionAction}
      onRetry={() => Promise.all([
        getConnectionRuntime().refreshRoster(),
        getConnectionRuntime().probeActive(),
      ]).then(() => undefined)}
      onOpenBridgeHelp={onOpenBridgeHelp}
      onOpenPermission={onOpenPermission}
    />
  );
}

const styles = StyleSheet.create({
  sheetContent: {
    flexShrink: 1,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  // A horizontal ScrollView grows by default; keep the strip one chip tall when the list is short.
  chipStrip: {
    flexGrow: 0,
    flexShrink: 0,
  },
  chipRow: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
  },
  chip: {
    height: HitSize.sm,
    paddingHorizontal: Space.md,
    borderRadius: Radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  chipLabel: {
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
  },
  chipCount: {
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
    fontWeight: FontWeight.regular,
    fontVariant: ['tabular-nums'],
  },
  searchWrap: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.sm,
  },
  agentPill: {
    height: ControlSize.pill,
    maxWidth: '100%',
    borderRadius: Radius.full,
    paddingLeft: Space.sm,
    paddingRight: Space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  agentName: {
    flexShrink: 1,
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
    fontWeight: FontWeight.semibold,
  },
  agentMenu: {
    position: 'absolute',
    top: Space.sm,
    alignSelf: 'center',
    minWidth: '60%',
    maxWidth: '90%',
    paddingVertical: Space.xs,
    borderRadius: Radius.card,
    overflow: 'hidden',
  },
  agentMenuRow: {
    minHeight: ControlSize.settingsRow,
    paddingLeft: Space.md,
    paddingRight: Space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  agentMenuName: {
    flex: 1,
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    paddingHorizontal: Space.lg,
    paddingTop: Space.xs,
    paddingBottom: Space.xxl,
    gap: Space.xs,
  },
  statusPill: {
    paddingVertical: Space.xs,
  },
  sessionRow: {
    minHeight: ControlSize.settingsRow,
    paddingHorizontal: Space.sm,
    paddingVertical: Space.sm,
    borderRadius: Radius.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  tileSlot: {
    width: ControlSize.pill,
    height: ControlSize.pill,
    position: 'relative',
  },
  tile: {
    width: ControlSize.pill,
    height: ControlSize.pill,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  // Title and time share a line; preview and the signal dot share the next one, so both
  // trailing marks stay aligned with their text whether or not the row has a preview.
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  previewSpacer: {
    flex: 1,
  },
  // One step below the roster row (secondary / caption): the 40-point tile sets the scale.
  rowTitle: {
    flex: 1,
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.semibold,
  },
  rowPreview: {
    flex: 1,
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
    fontWeight: FontWeight.regular,
  },
  rowCount: {
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
    fontWeight: FontWeight.regular,
    fontVariant: ['tabular-nums'],
  },
  rowTime: {
    flexShrink: 0,
    marginLeft: Space.xs,
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
    fontWeight: FontWeight.regular,
    fontVariant: ['tabular-nums'],
  },
  signalDot: {
    width: StatusSize.dot,
    height: StatusSize.dot,
    borderRadius: Radius.full,
  },
  emptyState: {
    minHeight: ControlSize.rosterRow,
    paddingHorizontal: Space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.md,
  },
  emptyText: {
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.regular,
    textAlign: 'center',
  },
  skeletonRow: {
    minHeight: ControlSize.settingsRow,
    paddingHorizontal: Space.xl,
    paddingVertical: Space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  skeletonTile: {
    width: ControlSize.pill,
    height: ControlSize.pill,
    borderRadius: Radius.full,
  },
  skeletonCopy: {
    flex: 1,
    gap: Space.xs,
  },
  skeletonTitle: {
    height: LineHeight.secondary,
    width: '55%',
  },
  skeletonPreview: {
    height: LineHeight.caption,
    width: '80%',
  },
  skeletonTime: {
    width: Space.xxl,
    height: LineHeight.caption,
  },
  actionList: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.xxl,
  },
  actionRow: {
    minHeight: ControlSize.settingsRow,
    paddingHorizontal: Space.sm,
    justifyContent: 'center',
  },
  actionText: {
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
    fontWeight: FontWeight.regular,
  },
  confirmContent: {
    paddingHorizontal: Space.xl,
    paddingBottom: Space.xxl,
    gap: Space.xl,
  },
  renameContent: {
    paddingHorizontal: Space.xl,
    paddingBottom: Space.xxl,
    gap: Space.xl,
  },
  confirmText: {
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.regular,
    textAlign: 'center',
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: Space.md,
  },
  confirmButton: {
    flex: 1,
  },
  pressed: {
    opacity: 0.72,
  },
});
