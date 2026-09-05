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
  ChevronDown,
  ChevronRight,
  Filter,
  Plus,
  Search,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { AgentDescriptor, Capabilities } from '@clawket/agent-protocol';

import { getConnectionRuntime, useConnections, useRoster } from '../../connection';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { FloatingButton } from '../../components/ui/FloatingButton';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { SearchInput } from '../../components/ui/SearchInput';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import { resolveSessionKindIcon } from '../../components/ui/sessionKindIcon';
import { Sheet } from '../../components/ui/Sheet';
import { Skeleton } from '../../components/ui/Skeleton';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  IconSize,
  LineHeight,
  Radius,
  Space,
  StatusSize,
} from '../../theme/tokens';
import { relativeTime } from '../../utils/chat-message';
import { analyticsEvents } from '../../services/analytics/events';
import {
  availableSessionActions,
  buildSessionPanelGroups,
  buildSessionPanelRows,
  filterSessionPanelRows,
  normalizeSessionRenameTitle,
  resolveSessionPanelPageState,
  shouldShowSessionPanelQuickFilters,
  summarizeSessionPanelRows,
  type SessionPanelAction,
  type SessionPanelAgentGroup,
  type SessionPanelKindFilter,
  type SessionPanelMode,
  type SessionPanelPageState,
  type SessionPanelQuickFilter,
  type SessionPanelRenamePayload,
  type SessionPanelRow,
  type SessionPanelSection,
} from './model';

type MaybePromise = void | Promise<void>;
type SessionPanelActionHandler = (
  row: SessionPanelRow,
  action: SessionPanelAction,
  payload?: SessionPanelRenamePayload,
) => MaybePromise;

const MUTATION_CAPABILITIES_OFF = Object.freeze({
  sessionRename: false,
  sessionReset: false,
  sessionDelete: false,
}) satisfies Pick<Capabilities, 'sessionRename' | 'sessionReset' | 'sessionDelete'>;

const PANEL_SKELETON_ROWS = Object.freeze(['one', 'two', 'three', 'four', 'five']);
const PANEL_SEARCH_ANALYTICS_DEBOUNCE_MS = 400;
let rememberedPanelMode: SessionPanelMode = 'grouped';

export type SessionPanelViewProps = Readonly<{
  visible: boolean;
  state: SessionPanelPageState;
  rows: ReadonlyArray<SessionPanelRow>;
  agents: ReadonlyArray<AgentDescriptor>;
  currentAgentId: string;
  currentSessionKey: string;
  capabilities: Pick<
    Capabilities,
    'sessionCreate' | 'sessionRename' | 'sessionReset' | 'sessionDelete'
  >;
  bridgeOutdated?: boolean;
  initialMode?: SessionPanelMode;
  kindFilter?: SessionPanelKindFilter;
  visibleRowCapacity?: number;
  onClose: () => void;
  onSelectSession: (row: SessionPanelRow) => MaybePromise;
  onCreateSession?: (agentId: string) => MaybePromise;
  onSessionAction?: SessionPanelActionHandler;
  onOpenKindFilter?: (current: SessionPanelKindFilter) => void;
  onRetry?: () => MaybePromise;
  onModeChange?: (mode: SessionPanelMode) => void;
  onOpenBridgeHelp?: () => void;
  onOpenPermission?: () => void;
}>;

export type SessionPanelProps = Readonly<{
  visible: boolean;
  currentAgentId: string;
  currentSessionKey: string;
  permissionDenied?: boolean;
  initialMode?: SessionPanelMode;
  kindFilter?: SessionPanelKindFilter;
  visibleRowCapacity?: number;
  onClose: () => void;
  onSelectSession: (row: SessionPanelRow) => MaybePromise;
  onCreateSession?: (agentId: string) => MaybePromise;
  onSessionAction?: SessionPanelActionHandler;
  onOpenKindFilter?: (current: SessionPanelKindFilter) => void;
  onModeChange?: (mode: SessionPanelMode) => void;
  onOpenBridgeHelp?: () => void;
  onOpenPermission?: () => void;
}>;

function sectionLabel(
  section: SessionPanelSection['kind'],
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (section === 'main') return t('Main session');
  if (section === 'channel') return t('Channels');
  if (section === 'direct_group') return t('Direct & groups');
  if (section === 'subagent') return t('Subagents');
  return t('Scheduled');
}

function SessionRow({
  row,
  listMode,
  selected,
  capabilities,
  onPress,
  onOpenActions,
}: Readonly<{
  row: SessionPanelRow;
  listMode: boolean;
  selected: boolean;
  capabilities: SessionPanelViewProps['capabilities'];
  onPress: () => void;
  onOpenActions: (row: SessionPanelRow) => void;
}>): React.JSX.Element {
  const { theme } = useAppTheme();
  const actions = availableSessionActions(row, capabilities);
  const Icon = resolveSessionKindIcon(row.kind);
  const dotColor = row.attention !== null
    ? theme.colors.bad
    : row.hasActiveRun
      ? theme.colors.accent
      : row.status === 'recent'
        ? theme.colors.good
        : theme.colors.inkTertiary;

  return (
    <Pressable
      testID={`session-panel-row-${row.id}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      onLongPress={actions.length ? () => onOpenActions(row) : undefined}
      style={({ pressed }) => [
        styles.sessionRow,
        selected ? { backgroundColor: theme.colors.accentSoft } : null,
        pressed ? { backgroundColor: theme.colors.surfaceFloating } : null,
      ]}
    >
      <View
        testID={`session-panel-row-${row.id}-status`}
        style={[styles.statusDot, { backgroundColor: dotColor }]}
      />
      {listMode ? (
        <Icon
          testID={`session-panel-row-${row.id}-icon`}
          size={IconSize.sm}
          color={theme.colors.inkSecondary}
        />
      ) : null}
      <Text
        style={[styles.rowTitle, { color: theme.colors.ink }]}
        numberOfLines={1}
      >
        {row.title}
      </Text>
      <Text
        style={[styles.rowTime, { color: theme.colors.inkTertiary }]}
        numberOfLines={1}
      >
        {relativeTime(row.updatedAt)}
      </Text>
    </Pressable>
  );
}

function PanelSection({
  section,
  currentSessionKey,
  completedExpanded,
  capabilities,
  onToggleCompleted,
  onSelect,
  onOpenActions,
}: Readonly<{
  section: SessionPanelSection;
  currentSessionKey: string;
  completedExpanded: boolean;
  capabilities: SessionPanelViewProps['capabilities'];
  onToggleCompleted: () => void;
  onSelect: (row: SessionPanelRow) => void;
  onOpenActions: (row: SessionPanelRow) => void;
}>): React.JSX.Element {
  const { t } = useTranslation('common');
  const { theme } = useAppTheme();
  const completed = section.completedRows ?? [];

  return (
    <View testID={`session-panel-section-${section.kind}`} style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.colors.inkSecondary }]}>
        {sectionLabel(section.kind, t)}
      </Text>
      {section.channelGroups?.map((channel) => (
        <View key={channel.key} style={styles.channelGroup}>
          <Text style={[styles.channelTitle, { color: theme.colors.inkSecondary }]}>
            {channel.label ?? t('Other channels')}
          </Text>
          {channel.rows.map((row) => (
            <SessionRow
              key={row.id}
              row={row}
              listMode={false}
              selected={row.key === currentSessionKey}
              capabilities={capabilities}
              onPress={() => onSelect(row)}
              onOpenActions={onOpenActions}
            />
          ))}
        </View>
      ))}
      {section.rows.map((row) => (
        <SessionRow
          key={row.id}
          row={row}
          listMode={false}
          selected={row.key === currentSessionKey}
          capabilities={capabilities}
          onPress={() => onSelect(row)}
          onOpenActions={onOpenActions}
        />
      ))}
      {completed.length ? (
        <>
          <Pressable
            testID="session-panel-completed-toggle"
            accessibilityRole="button"
            accessibilityState={{ expanded: completedExpanded }}
            onPress={onToggleCompleted}
            style={({ pressed }) => [styles.completedRow, pressed ? styles.pressed : null]}
          >
            {completedExpanded ? (
              <ChevronDown size={IconSize.sm} color={theme.colors.inkSecondary} />
            ) : (
              <ChevronRight size={IconSize.sm} color={theme.colors.inkSecondary} />
            )}
            <Text style={[styles.completedText, { color: theme.colors.inkSecondary }]}>
              {t('Completed {{count}}', { count: completed.length })}
            </Text>
          </Pressable>
          {completedExpanded ? completed.map((row) => (
            <SessionRow
              key={row.id}
              row={row}
              listMode={false}
              selected={row.key === currentSessionKey}
              capabilities={capabilities}
              onPress={() => onSelect(row)}
              onOpenActions={onOpenActions}
            />
          )) : null}
        </>
      ) : null}
    </View>
  );
}

function AgentGroup({
  group,
  expanded,
  completedExpanded,
  currentAgentId,
  currentSessionKey,
  canCreate,
  capabilities,
  onToggle,
  onToggleCompleted,
  onCreate,
  onSelect,
  onOpenActions,
}: Readonly<{
  group: SessionPanelAgentGroup;
  expanded: boolean;
  completedExpanded: boolean;
  currentAgentId: string;
  currentSessionKey: string;
  canCreate: boolean;
  capabilities: SessionPanelViewProps['capabilities'];
  onToggle: () => void;
  onToggleCompleted: () => void;
  onCreate: () => void;
  onSelect: (row: SessionPanelRow) => void;
  onOpenActions: (row: SessionPanelRow) => void;
}>): React.JSX.Element {
  const { t } = useTranslation('common');
  const { theme } = useAppTheme();
  return (
    <View testID={`session-panel-agent-${group.agent.agentId}`}>
      <Pressable
        testID={`session-panel-agent-${group.agent.agentId}-toggle`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => [styles.agentHeader, pressed ? styles.pressed : null]}
      >
        {expanded ? (
          <ChevronDown size={IconSize.sm} color={theme.colors.inkSecondary} />
        ) : (
          <ChevronRight size={IconSize.sm} color={theme.colors.inkSecondary} />
        )}
        <Text style={[styles.agentName, { color: theme.colors.ink }]} numberOfLines={1}>
          {group.agent.name}
        </Text>
        <Text style={[styles.agentCount, { color: theme.colors.inkSecondary }]}>
          {group.count}
        </Text>
        {group.agent.agentId === currentAgentId && canCreate ? (
          <FloatingButton
            testID={`session-panel-agent-${group.agent.agentId}-create`}
            icon={Plus}
            appearance="quiet"
            accessibilityLabel={t('New session')}
            onPress={onCreate}
          />
        ) : null}
      </Pressable>
      {expanded ? (
        <View style={styles.sections}>
          {group.sections.map((section) => (
            <PanelSection
              key={section.kind}
              section={section}
              currentSessionKey={currentSessionKey}
              completedExpanded={completedExpanded}
              capabilities={capabilities}
              onToggleCompleted={onToggleCompleted}
              onSelect={onSelect}
              onOpenActions={onOpenActions}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function PanelLoading(): React.JSX.Element {
  const { t } = useTranslation('common');
  return (
    <View testID="session-panel-loading" accessibilityLabel={t('Loading sessions')}>
      {PANEL_SKELETON_ROWS.map((key) => (
        <View key={key} style={styles.skeletonRow}>
          <Skeleton style={styles.skeletonDot} />
          <Skeleton style={styles.skeletonTitle} />
          <Skeleton style={styles.skeletonTime} />
        </View>
      ))}
    </View>
  );
}

function actionLabel(
  action: SessionPanelAction,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (action === 'pin') return t('Pin to roster');
  if (action === 'rename') return t('Rename');
  if (action === 'reset') return t('Reset');
  return t('Delete');
}

function SessionActionSheet({
  row,
  capabilities,
  onClose,
  onChoose,
}: Readonly<{
  row: SessionPanelRow | null;
  capabilities: SessionPanelViewProps['capabilities'];
  onClose: () => void;
  onChoose: (action: SessionPanelAction) => void;
}>): React.JSX.Element {
  const { t } = useTranslation('common');
  const { theme } = useAppTheme();
  const actions = row ? availableSessionActions(row, capabilities) : [];
  return (
    <Sheet
      testID="session-panel-actions"
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
              {actionLabel(action, t)}
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
  initialMode,
  kindFilter = 'all',
  visibleRowCapacity,
  onClose,
  onSelectSession,
  onCreateSession,
  onSessionAction,
  onOpenKindFilter,
  onRetry,
  onModeChange,
  onOpenBridgeHelp,
  onOpenPermission,
}: SessionPanelViewProps): React.JSX.Element {
  const { t } = useTranslation('common');
  const { theme } = useAppTheme();
  const [mode, setMode] = useState<SessionPanelMode>(initialMode ?? rememberedPanelMode);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickFilter, setQuickFilter] = useState<SessionPanelQuickFilter>('all');
  const [expandedAgentIds, setExpandedAgentIds] = useState<ReadonlySet<string>>(
    () => new Set([currentAgentId]),
  );
  const [completedExpandedAgentIds, setCompletedExpandedAgentIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
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
    analyticsEvents.sessionPanelOpened({ mode, session_count: rows.length });
  }, [mode, rows.length, visible]);

  useEffect(() => {
    setExpandedAgentIds((current) => new Set([...current, currentAgentId]));
  }, [currentAgentId]);

  const filteredRows = useMemo(() => filterSessionPanelRows(rows, {
    query,
    quickFilter,
    kindFilter,
  }), [kindFilter, query, quickFilter, rows]);
  useEffect(() => {
    if (!visible || !query.trim()) return undefined;
    const resultKinds = [...new Set(filteredRows.map((row) => row.kind))].sort().join(',') || 'none';
    const timer = setTimeout(() => {
      analyticsEvents.searchPerformed({
        scope: 'panel',
        has_results: filteredRows.length > 0,
        result_kinds: resultKinds,
      });
    }, PANEL_SEARCH_ANALYTICS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filteredRows, query, visible]);
  const groups = useMemo(
    () => buildSessionPanelGroups(filteredRows, agents, currentAgentId),
    [agents, currentAgentId, filteredRows],
  );
  const summary = useMemo(() => summarizeSessionPanelRows(filteredRows), [filteredRows]);
  const showFilters = shouldShowSessionPanelQuickFilters(rows.length, visibleRowCapacity);
  const autoExpand = query.trim().length > 0 || quickFilter !== 'all' || kindFilter !== 'all';

  const switchMode = useCallback((next: SessionPanelMode) => {
    rememberedPanelMode = next;
    setMode(next);
    if (next !== mode) analyticsEvents.sessionPanelModeChanged({ mode: next });
    onModeChange?.(next);
  }, [mode, onModeChange]);
  const select = useCallback((row: SessionPanelRow) => {
    analyticsEvents.chatSessionSelected({
      source: 'panel',
      session_kind: row.kind,
      from: 'panel',
    });
    void Promise.resolve(onSelectSession(row)).then(onClose, () => undefined);
  }, [onClose, onSelectSession]);
  const create = useCallback(() => {
    if (!onCreateSession) return;
    analyticsEvents.sessionAction({ action: 'create' });
    void Promise.resolve(onCreateSession(currentAgentId)).catch(() => undefined);
  }, [currentAgentId, onCreateSession]);
  const chooseAction = useCallback((action: SessionPanelAction) => {
    if (!actionRow) return;
    setActionRow(null);
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

  const modeTabs = useMemo(() => [
    { key: 'grouped' as const, label: t('Grouped') },
    { key: 'list' as const, label: t('List') },
  ], [t]);
  const filterTabs = useMemo(() => [
    { key: 'all' as const, label: t('All') },
    { key: 'attention' as const, label: t('Needs you') },
    { key: 'working' as const, label: t('Working') },
  ], [t]);

  return (
    <>
      <Sheet
        testID="session-panel"
        visible={visible}
        title={t('Sessions')}
        closeAccessibilityLabel={t('Close sessions')}
        onClose={onClose}
        contentStyle={styles.sheetContent}
        headerRight={(
          <FloatingButton
            testID="session-panel-search-toggle"
            icon={Search}
            appearance="quiet"
            accessibilityLabel={t('Search sessions')}
            onPress={() => setSearchOpen((current) => !current)}
          />
        )}
      >
        <View style={styles.controls}>
          <SegmentedTabs
            testID="session-panel-mode"
            tabs={modeTabs}
            active={mode}
            onSwitch={switchMode}
          />
          {searchOpen ? (
            <SearchInput
              testID="session-panel-search"
              inSheet
              autoFocus
              value={query}
              placeholder={t('Search sessions')}
              onChangeText={setQuery}
              onClear={() => setQuery('')}
            />
          ) : null}
          {showFilters ? (
            <SegmentedTabs
              testID="session-panel-quick-filter"
              size="sm"
              tabs={filterTabs}
              active={quickFilter}
              onSwitch={setQuickFilter}
            />
          ) : null}
        </View>

        {state === 'loading' ? <PanelLoading /> : (
          <ScrollView
            testID="session-panel-scroll"
            contentContainerStyle={styles.scrollContent}
            automaticallyAdjustContentInsets={false}
            showsVerticalScrollIndicator={false}
          >
            {state === 'offline' ? (
              <Banner
                testID="session-panel-offline"
                message={t('Offline · reconnecting')}
                actionLabel={onRetry ? t('Reconnect') : undefined}
                onAction={onRetry ? () => { void onRetry(); } : undefined}
              />
            ) : null}
            {state === 'error' ? (
              <Banner
                testID="session-panel-error"
                tone="bad"
                message={t('Sessions unavailable')}
                actionLabel={onRetry ? t('Retry') : undefined}
                onAction={onRetry ? () => { void onRetry(); } : undefined}
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

            {state !== 'permission' && filteredRows.length === 0 ? (
              <View testID="session-panel-empty" style={styles.emptyState}>
                <Text style={[styles.emptyText, { color: theme.colors.inkSecondary }]}>
                  {rows.length ? t('No matching sessions') : t('No sessions yet')}
                </Text>
                {capabilities.sessionCreate && onCreateSession ? (
                  <Button label={t('New session')} onPress={create} />
                ) : null}
              </View>
            ) : null}

            {state !== 'permission' && filteredRows.length > 0 && mode === 'list' ? (
              <View testID="session-panel-list-mode">
                <View style={styles.summaryRow}>
                  <Text style={[styles.summary, { color: theme.colors.inkSecondary }]}>
                    {t('{{active}} active · {{recent}} recent · {{idle}} idle', summary)}
                  </Text>
                  {onOpenKindFilter ? (
                    <FloatingButton
                      testID="session-panel-kind-filter"
                      icon={Filter}
                      appearance="quiet"
                      badge={kindFilter === 'all' ? undefined : { tone: 'accent' }}
                      accessibilityLabel={t('Filter sessions')}
                      onPress={() => onOpenKindFilter(kindFilter)}
                    />
                  ) : null}
                </View>
                {filteredRows.map((row) => (
                  <SessionRow
                    key={row.id}
                    row={row}
                    listMode
                    selected={row.key === currentSessionKey}
                    capabilities={capabilities}
                    onPress={() => select(row)}
                    onOpenActions={setActionRow}
                  />
                ))}
              </View>
            ) : null}

            {state !== 'permission' && filteredRows.length > 0 && mode === 'grouped' ? (
              <View testID="session-panel-grouped-mode">
                {groups.map((group) => (
                  <AgentGroup
                    key={group.agent.agentId}
                    group={group}
                    expanded={autoExpand || expandedAgentIds.has(group.agent.agentId)}
                    completedExpanded={completedExpandedAgentIds.has(group.agent.agentId)}
                    currentAgentId={currentAgentId}
                    currentSessionKey={currentSessionKey}
                    canCreate={capabilities.sessionCreate && Boolean(onCreateSession)}
                    capabilities={capabilities}
                    onToggle={() => setExpandedAgentIds((current) => {
                      const next = new Set(current);
                      if (next.has(group.agent.agentId)) next.delete(group.agent.agentId);
                      else next.add(group.agent.agentId);
                      return next;
                    })}
                    onToggleCompleted={() => setCompletedExpandedAgentIds((current) => {
                      const next = new Set(current);
                      if (next.has(group.agent.agentId)) next.delete(group.agent.agentId);
                      else next.add(group.agent.agentId);
                      return next;
                    })}
                    onCreate={create}
                    onSelect={select}
                    onOpenActions={setActionRow}
                  />
                ))}
              </View>
            ) : null}
          </ScrollView>
        )}
      </Sheet>

      <SessionActionSheet
        row={actionRow}
        capabilities={capabilities}
        onClose={() => setActionRow(null)}
        onChoose={chooseAction}
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
  initialMode,
  kindFilter,
  visibleRowCapacity,
  onClose,
  onSelectSession,
  onCreateSession,
  onSessionAction,
  onOpenKindFilter,
  onModeChange,
  onOpenBridgeHelp,
  onOpenPermission,
}: SessionPanelProps): React.JSX.Element {
  const connections = useConnections();
  const roster = useRoster();
  const group = roster.find((candidate) => (
    candidate.connection.id === connections.activeConnectionId
  ));
  const rows = useMemo(() => buildSessionPanelRows(group), [group]);
  const agents = useMemo(
    () => group?.agents.map((summary) => summary.agent) ?? [],
    [group],
  );
  const adapter = connections.activeAdapter;
  const capabilities = adapter?.capabilities ?? {
    ...MUTATION_CAPABILITIES_OFF,
    sessionCreate: false,
  };
  const state = resolveSessionPanelPageState({
    initialized: connections.initialized,
    hasPermission: !permissionDenied,
    rowCount: rows.length,
    activeState: connections.activeState,
    hasError: connections.error !== null,
  });
  const createSession = onCreateSession ?? (adapter?.createSession && group
    ? async (agentId: string) => {
      const session = await adapter.createSession?.(agentId);
      await getConnectionRuntime().refreshRoster();
      const row = session
        ? buildSessionPanelRows({
          ...group,
          agents: group.agents.map((summary) => summary.agent.agentId === agentId
            ? { ...summary, sessions: [...summary.sessions, session] }
            : summary),
        }).find((candidate) => candidate.key === session.key)
        : undefined;
      if (row) {
        await onSelectSession(row);
        onClose();
      }
    }
    : undefined);

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
      initialMode={initialMode}
      kindFilter={kindFilter}
      visibleRowCapacity={visibleRowCapacity}
      onClose={onClose}
      onSelectSession={onSelectSession}
      onCreateSession={createSession}
      onSessionAction={onSessionAction}
      onOpenKindFilter={onOpenKindFilter}
      onRetry={() => Promise.all([
        getConnectionRuntime().refreshRoster(),
        getConnectionRuntime().probeActive(),
      ]).then(() => undefined)}
      onModeChange={onModeChange}
      onOpenBridgeHelp={onOpenBridgeHelp}
      onOpenPermission={onOpenPermission}
    />
  );
}

const styles = StyleSheet.create({
  sheetContent: {
    flexShrink: 1,
  },
  controls: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.sm,
    gap: Space.sm,
  },
  scrollContent: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.xxl,
    gap: Space.md,
  },
  sessionRow: {
    minHeight: ControlSize.settingsRow,
    paddingHorizontal: Space.sm,
    borderRadius: Radius.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  statusDot: {
    width: StatusSize.dot,
    height: StatusSize.dot,
    borderRadius: Radius.full,
  },
  rowTitle: {
    flex: 1,
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
    fontWeight: FontWeight.semibold,
  },
  rowTime: {
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
    fontWeight: FontWeight.regular,
    fontVariant: ['tabular-nums'],
  },
  agentHeader: {
    minHeight: ControlSize.settingsRow,
    paddingHorizontal: Space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  agentName: {
    flex: 1,
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
    fontWeight: FontWeight.semibold,
  },
  agentCount: {
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.regular,
    fontVariant: ['tabular-nums'],
  },
  sections: {
    gap: Space.md,
    paddingBottom: Space.lg,
  },
  section: {
    gap: Space.xs,
  },
  sectionTitle: {
    paddingHorizontal: Space.sm,
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.regular,
  },
  channelGroup: {
    gap: Space.xs,
  },
  channelTitle: {
    paddingHorizontal: Space.lg,
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.regular,
  },
  completedRow: {
    minHeight: ControlSize.settingsRow,
    paddingHorizontal: Space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  completedText: {
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.regular,
  },
  summaryRow: {
    minHeight: ControlSize.floatingButton,
    paddingLeft: Space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  summary: {
    flex: 1,
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.regular,
    fontVariant: ['tabular-nums'],
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  skeletonDot: {
    width: StatusSize.dot,
    height: StatusSize.dot,
    borderRadius: Radius.full,
  },
  skeletonTitle: {
    flex: 1,
    height: LineHeight.body,
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
