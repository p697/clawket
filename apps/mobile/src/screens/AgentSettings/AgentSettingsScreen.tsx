import { useUsageCalendar } from './useUsageCalendar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Lock, MessageCircle, PenLine, Plug, Settings2, Wrench, Monitor, FileText } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type {
  AgentAdapter,
  AgentDescriptor,
  Capabilities,
  ConnectionDescriptor,
  ConnectionState,
} from '@clawket/agent-protocol';
import { AgentAvatar } from '../../components/ui/AgentAvatar';
import { PlatformMark } from '../../components/ui/PlatformMark';
import { SettingsIcon } from '../../components/ui/SettingsIcon';
import { Banner } from '../../components/ui/Banner';
import { ConnectionStatusPill } from '../../components/ui/ConnectionStatusPill';
import { FloatingButton } from '../../components/ui/FloatingButton';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import {
  SettingsDivider,
  SettingsGroup,
  SettingsRow,
} from '../../components/ui/SettingsGroup';
import { Skeleton } from '../../components/ui/Skeleton';
import type {
  AgentSettingsSection,
  RootStackParamList,
} from '../../navigation/root-stack';
import { analyticsEvents } from '../../services/analytics/events';
import { CronFailureAckService } from '../../services/cron-failure-acks';
import { useAppTheme } from '../../theme';
import {
  BorderWidth,
  ControlSize,
  FontSize,
  FontWeight,
  IconSize,
  LineHeight,
  Motion,
  Radius,
  Space,
} from '../../theme/tokens';
import { formatConsoleHeartbeatAge } from '../../utils/console-heartbeat';
import { loadAgentCronSummary, loadAgentSettingsSummary } from './load-summary';
import {
  buildAgentSettingsModel,
  resolveAgentSettingsPageState,
  type AgentSettingsGroupDescriptor,
  type AgentSettingsPageState,
  type AgentSettingsRowDescriptor,
  type AgentSettingsStatDescriptor,
  type AgentSettingsSummary,
} from './model';
import { translateAgentSettingsKey } from './translation';

export type AgentSettingsNavigate = (
  route: 'AgentSettingsSection',
  params: RootStackParamList['AgentSettingsSection'],
) => void;

export type AgentSettingsViewProps = Readonly<{
  connection: ConnectionDescriptor;
  agent: AgentDescriptor | null;
  capabilities: Capabilities;
  connectionState: ConnectionState;
  state: AgentSettingsPageState;
  isPro: boolean;
  summary?: AgentSettingsSummary;
  identityDetail?: string;
  /** Agents on the connection; the shared Gateway heartbeat line shows only for a lone Agent. */
  agentCount?: number;
  errorMessage?: string;
  /** The runtime's foreground grace window is open: show quiet reconnecting instead of offline. */
  reconnecting?: boolean;
  onBack: () => void;
  onContinueChat?: () => void;
  onNavigate: AgentSettingsNavigate;
  onOpenPro: (section: AgentSettingsSection, onContinue?: () => void) => void;
  onRetry: () => void;
  /** Pull-to-refresh; omitted means the page has no refresh gesture. */
  onRefresh?: () => void;
  refreshing?: boolean;
}>;

export type AgentSettingsScreenProps = Omit<
  AgentSettingsViewProps,
  'connectionState' | 'state' | 'summary' | 'onRefresh' | 'refreshing'
> & Readonly<{
  adapter: AgentAdapter | null;
  /** Route-level refresh (roster identity, connection probe) that runs beside the summary reload. */
  onRefresh?: () => void | Promise<void>;
  initialSummary?: AgentSettingsSummary;
  permissionDenied?: boolean;
}>;

type AgentSettingsRuntimeScreenProps = Omit<
  AgentSettingsScreenProps,
  'identityDetail'
> & Readonly<{
  loadIdentityDetail: (connection: ConnectionDescriptor) => Promise<string | undefined>;
}>;

export function AgentSettingsRuntimeScreen({
  connection,
  loadIdentityDetail,
  ...screenProps
}: AgentSettingsRuntimeScreenProps): React.JSX.Element {
  const [loadedIdentity, setLoadedIdentity] = useState<Readonly<{
    connectionId: string;
    detail?: string;
  }> | null>(null);

  useEffect(() => {
    let active = true;
    setLoadedIdentity(null);
    void loadIdentityDetail(connection)
      .then((detail) => {
        if (active) setLoadedIdentity({ connectionId: connection.id, detail });
      })
      .catch(() => {
        if (active) setLoadedIdentity({ connectionId: connection.id });
      });
    return () => {
      active = false;
    };
  }, [connection, loadIdentityDetail]);

  return (
    <AgentSettingsScreen
      {...screenProps}
      connection={connection}
      identityDetail={loadedIdentity?.connectionId === connection.id
        ? loadedIdentity.detail
        : undefined}
    />
  );
}

export function AgentSettingsRouteLoading({
  onBack,
}: Readonly<{ onBack: () => void }>): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings']);
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);

  return (
    <View
      testID="agent-settings-route-loading"
      style={styles.screen}
    >
      <AgentSettingsHeader
        backLabel={t('Back', { ns: 'common' })}
        title={t('Agent profile', { ns: 'settings' })}
        topInset={insets.top}
        onBack={onBack}
      />
      <AgentSettingsLoading
        bottomInset={insets.bottom}
        loadingLabel={t('Loading...', { ns: 'common' })}
      />
    </View>
  );
}

export function AgentSettingsScreen({
  adapter,
  connection,
  agent,
  capabilities,
  initialSummary,
  permissionDenied = false,
  errorMessage,
  onRefresh,
  ...viewProps
}: AgentSettingsScreenProps): React.JSX.Element {
  const accessibleAdapter = permissionDenied ? null : adapter;
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    accessibleAdapter?.state ?? 'offline',
  );
  const calendar = useUsageCalendar();
  const summaryKey = agent ? `${connection.id}:${agent.agentId}:${calendar.key}` : null;
  const [loadedSummary, setLoadedSummary] = useState<Readonly<{
    key: string;
    value: AgentSettingsSummary;
  }> | null>(null);
  const [hasStateError, setHasStateError] = useState(false);
  const summary = loadedSummary?.key === summaryKey
    ? loadedSummary.value
    : initialSummary;
  // Optional counts must never hold navigation hostage.
  const initialized = true;

  useEffect(() => {
    setConnectionState(accessibleAdapter?.state ?? 'offline');
    setHasStateError(false);
    if (!accessibleAdapter) return undefined;
    return accessibleAdapter.on('state', (nextState) => {
      setConnectionState(nextState);
      setHasStateError(nextState === 'error');
    });
  }, [accessibleAdapter]);

  const initialSummaryRef = useRef(initialSummary);
  initialSummaryRef.current = initialSummary;
  const mergeSummary = useCallback((key: string, nextSummary: AgentSettingsSummary) => {
    setLoadedSummary((previous) => ({
      key,
      value: {
        ...(previous?.key === key ? previous.value : initialSummaryRef.current),
        ...nextSummary,
      },
    }));
  }, []);

  useEffect(() => {
    if (!accessibleAdapter || !agent || !summaryKey || connectionState !== 'ready') return undefined;

    let active = true;
    const applySummary = (nextSummary: AgentSettingsSummary) => {
      if (active) mergeSummary(summaryKey, nextSummary);
    };
    void loadAgentSettingsSummary(accessibleAdapter, agent, Date.now(), applySummary).then(applySummary);
    return () => {
      active = false;
    };
  }, [accessibleAdapter, agent?.agentId, calendar.revision, connectionState, mergeSummary, summaryKey]);

  // The Runs tab marks failures as seen while this page stays mounted underneath it; re-read only
  // the Cron card so the red count clears on return without reloading the whole profile.
  useEffect(() => {
    if (!accessibleAdapter || !agent || !summaryKey || connectionState !== 'ready') return undefined;
    let active = true;
    const unsubscribe = CronFailureAckService.subscribe((scope) => {
      if (scope.connectionId !== agent.connectionId || scope.agentId !== agent.agentId) return;
      void loadAgentCronSummary(accessibleAdapter, agent)
        .then((cron) => { if (active) mergeSummary(summaryKey, cron); })
        .catch(() => { /* The card keeps its last value; the next page load reads it again. */ });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [accessibleAdapter, agent, connectionState, mergeSummary, summaryKey]);

  const state = resolveAgentSettingsPageState({
    initialized,
    hasAgent: agent !== null,
    connectionState,
    permissionDenied,
    hasError: Boolean(errorMessage) || hasStateError,
  });

  const [refreshing, setRefreshing] = useState(false);
  const refreshInFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    try {
      const tasks: Array<Promise<unknown>> = [];
      if (onRefresh) tasks.push(Promise.resolve().then(onRefresh).catch(() => { /* The runtime publishes the actionable error. */ }));
      // Offline pulls only reconnect; the summary effect reloads once the adapter is ready again.
      if (accessibleAdapter && agent && summaryKey && connectionState === 'ready') {
        tasks.push(loadAgentSettingsSummary(accessibleAdapter, agent, Date.now())
          .then((nextSummary) => mergeSummary(summaryKey, nextSummary))
          .catch(() => { /* Cards keep their last value. */ }));
      }
      await Promise.all(tasks);
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }, [accessibleAdapter, agent, connectionState, mergeSummary, onRefresh, summaryKey]);

  return (
    <AgentSettingsView
      {...viewProps}
      connection={connection}
      agent={agent}
      capabilities={accessibleAdapter?.capabilities ?? capabilities}
      connectionState={connectionState}
      state={state}
      isPro={viewProps.isPro}
      summary={summary}
      identityDetail={viewProps.identityDetail}
      errorMessage={errorMessage}
      refreshing={refreshing}
      onRefresh={() => { void refresh(); }}
    />
  );
}

export function AgentSettingsView({
  connection,
  agent,
  capabilities,
  connectionState,
  state,
  isPro,
  summary,
  identityDetail,
  agentCount,
  errorMessage,
  reconnecting = false,
  onBack,
  onContinueChat,
  onNavigate,
  onOpenPro,
  onRetry,
  onRefresh,
  refreshing = false,
}: AgentSettingsViewProps): React.JSX.Element {
  const { t, i18n } = useTranslation(['common', 'settings', 'config']);
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const trackedConnectionRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${connection.id}:${connection.backendKind}`;
    if (trackedConnectionRef.current === key) return;
    trackedConnectionRef.current = key;
    analyticsEvents.agentSettingsOpened({ backend: connection.backendKind });
  }, [connection.backendKind, connection.id]);
  const model = useMemo(() => agent ? buildAgentSettingsModel({
    connection,
    agent,
    capabilities,
    connectionState,
    isPro,
    permissionDenied: state === 'permission',
    identityDetail,
    summary,
    agentCount,
    now: Date.now(),
  }) : null, [
    agentCount,
    agent,
    capabilities,
    connection,
    connectionState,
    identityDetail,
    isPro,
    state,
    summary,
  ]);

  const navigate = (section: AgentSettingsSection) => {
    onNavigate('AgentSettingsSection', {
      connectionId: connection.id,
      agentId: agent?.agentId ?? '',
      section,
    });
  };

  const openRow = (row: AgentSettingsRowDescriptor | AgentSettingsStatDescriptor) => {
    const open = () => {
      // The Cron page itself lands on the run records (where a lit failure count is marked as
      // seen), so no row needs to steer its section.
      const onContinue = () => navigate(row.section);
      analyticsEvents.settingsRowOpened({ row: row.id, locked: row.locked, backend: connection.backendKind });
      if (row.locked) onOpenPro(row.section, onContinue);
      else onContinue();
    };
    open();
  };

  // The hero has no static line: the backend is the avatar's corner mark, so the grey text only
  // appears when it carries something live (heartbeat age) or account-specific (YouMind email).
  const identityDetailLabel = (() => {
    if (!model) return undefined;
    const minutes = model.identity.activeMinutesAgo;
    if (minutes === null) return model.identity.detail;
    const formatted = formatConsoleHeartbeatAge(minutes, i18n?.resolvedLanguage ?? i18n?.language ?? 'en');
    const age = formatted.compactText
      ?? (formatted.count === undefined
        ? t(formatted.key, { ns: 'common' })
        : t(formatted.key, { ns: 'common', count: formatted.count }));
    return t('Active {{age}}', { ns: 'settings', age });
  })();

  const identityOpensFromHero = model?.identity.editable === true || model?.identity.locked === true;
  const openIdentity = () => {
    if (!identityOpensFromHero) return;
    const onContinue = () => navigate('identity');
    analyticsEvents.settingsRowOpened({
      row: 'identity',
      locked: model?.identity.locked === true,
      backend: connection.backendKind,
    });
    if (model?.identity.locked) {
      onOpenPro('identity', onContinue);
      return;
    }
    onContinue();
  };
  const connectionStatus = state === 'offline' && reconnecting ? (
    <ConnectionStatusPill
      testID="agent-settings-reconnecting"
      placement="inline"
      status="reconnecting"
      message={t('Reconnecting…', { ns: 'common' })}
    />
  ) : state === 'offline' ? (
    <ConnectionStatusPill
      testID="agent-settings-offline"
      placement="inline"
      status="offline"
      message={translateAgentSettingsKey(t, 'Offline · reconnecting')}
      actionLabel={translateAgentSettingsKey(t, 'Reconnect')}
      onAction={onRetry}
    />
  ) : state === 'error' ? (
    <ConnectionStatusPill
      testID="agent-settings-error"
      placement="inline"
      status="error"
      message={errorMessage || translateAgentSettingsKey(t, 'Settings could not load')}
      actionLabel={t('Retry', { ns: 'common' })}
      onAction={onRetry}
    />
  ) : null;

  return (
    <View
      testID="agent-settings-screen"
      style={styles.screen}
    >
      <AgentSettingsHeader
        backLabel={t('Back', { ns: 'common' })}
        title={t('Agent profile', { ns: 'settings' })}
        status={connectionStatus}
        topInset={insets.top}
        onBack={onBack}
        trailing={(
          <FloatingButton
            testID="agent-profile-chat"
            icon={MessageCircle}
            appearance="ink"
            accessibilityLabel={t('Continue chatting', { ns: 'settings' })}
            onPress={onContinueChat ?? onBack}
          />
        )}
      />

      {state === 'loading' ? (
        <AgentSettingsLoading
          bottomInset={insets.bottom}
          loadingLabel={t('Loading...', { ns: 'common' })}
        />
      ) : state === 'empty' || !agent || !model ? (
        <View testID="agent-settings-empty" style={styles.centeredState}>
          <Text style={styles.stateText}>{translateAgentSettingsKey(t, 'Agent unavailable')}</Text>
        </View>
      ) : (
        <ScrollView
          testID="agent-settings-content"
          automaticallyAdjustContentInsets={false}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + Space.xl },
          ]}
          refreshControl={onRefresh ? (
            <RefreshControl
              testID="agent-settings-refresh-control"
              refreshing={refreshing}
              tintColor={theme.colors.inkSecondary}
              colors={[theme.colors.inkSecondary]}
              onRefresh={onRefresh}
            />
          ) : undefined}
          showsVerticalScrollIndicator={false}
        >
          {state === 'permission' ? (
            <Banner
              testID="agent-settings-permission"
              message={translateAgentSettingsKey(t, 'Pro required for this agent')}
              actionLabel={t('Unlock', { ns: 'common' })}
              onAction={() => onOpenPro('identity', () => navigate('identity'))}
            />
          ) : null}

          {/* The hero is the Identity entry (owner request 2026-09-19): the avatar, the name and the
              edit glyph beside it share one touch target; nothing else on the page opens Identity. */}
          <Pressable
            testID={identityOpensFromHero ? 'agent-settings-identity' : 'agent-settings-hero'}
            accessibilityRole={identityOpensFromHero ? 'button' : undefined}
            accessibilityLabel={identityOpensFromHero ? model.identity.name : undefined}
            accessibilityHint={identityOpensFromHero ? t('Identity', { ns: 'config' }) : undefined}
            disabled={!identityOpensFromHero}
            onPress={openIdentity}
            style={({ pressed }) => [styles.profileHero, pressed && identityOpensFromHero ? styles.profileHeroPressed : null]}
          >
            <View style={styles.profileAvatar}>
              <AgentAvatar testID="agent-settings-avatar" agentId={agent.agentId}
                name={model.identity.name} emoji={agent.emoji} avatarUrl={agent.avatarUrl}
                variant="roster" status={model.identity.locked ? 'locked' : state === 'offline' ? 'offline' : 'idle'} />
              {model.identity.locked ? null : (
                <View
                  testID="agent-settings-backend-mark"
                  accessibilityRole="image"
                  accessibilityLabel={model.identity.backendLabel}
                  style={styles.backendMark}
                >
                  <PlatformMark platform={model.identity.backend} size={IconSize.md} />
                </View>
              )}
            </View>
            <View style={[styles.profileNameRow, identityOpensFromHero ? styles.profileNameRowEditable : null]}>
              <Text style={styles.profileName}>{model.identity.name}</Text>
              {identityOpensFromHero ? (
                <View testID="agent-settings-identity-glyph" style={styles.profileNameGlyph}>
                  {model.identity.locked
                    ? <Lock size={IconSize.sm} color={theme.colors.inkSecondary} strokeWidth={1.75} />
                    : <PenLine size={IconSize.sm} color={theme.colors.inkSecondary} strokeWidth={1.75} />}
                </View>
              ) : null}
            </View>
            {identityDetailLabel ? (
              <Text testID="agent-settings-identity-detail" style={styles.profileDetail}>{identityDetailLabel}</Text>
            ) : null}
          </Pressable>
          <AgentSettingsStats
            stats={model.stats}
            translate={(key) => translateAgentSettingsKey(t, key)}
            translateDetail={(detail) => t(detail.key, { ns: 'settings', ...detail.params })}
            onOpen={openRow}
          />
          {model.groups.map((group) => (
            <SettingsSection key={group.id} group={group} translate={(key) => translateAgentSettingsKey(t, key)} onOpenRow={openRow} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/** The canonical page header with the Agent profile test hooks; the title yields its slot to connection state. */
function AgentSettingsHeader({
  backLabel,
  title,
  status,
  topInset,
  onBack,
  trailing,
}: Readonly<{
  backLabel: string;
  title: string;
  status?: React.ReactNode;
  topInset: number;
  onBack: () => void;
  trailing?: React.ReactNode;
}>): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  return (
    <ScreenHeader
      testID="agent-settings-header"
      backTestID="agent-settings-back"
      titleTestID="agent-settings-title"
      statusTestID="agent-settings-header-status"
      title={title}
      topInset={topInset}
      status={status}
      onBack={onBack}
      backAccessibilityLabel={backLabel}
      rightContent={trailing}
      style={styles.header}
    />
  );
}

type TranslateDetail = (detail: NonNullable<AgentSettingsStatDescriptor['detail']>) => string;

/** Two hero cards on top, then a row of tiles; every card is one 44-point-plus target. */
function AgentSettingsStats({
  stats,
  translate,
  translateDetail,
  onOpen,
}: Readonly<{
  stats: ReadonlyArray<AgentSettingsStatDescriptor>;
  translate: Translate;
  translateDetail: TranslateDetail;
  onOpen: (stat: AgentSettingsStatDescriptor) => void;
}>): React.JSX.Element | null {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const heroes = stats.filter((stat) => stat.placement === 'hero');
  const tiles = stats.filter((stat) => stat.placement === 'tile');
  if (heroes.length === 0 && tiles.length === 0) return null;

  const renderCard = (stat: AgentSettingsStatDescriptor) => (
    <SettingsGroup key={stat.id} testID={`agent-settings-stat-${stat.id}`} style={styles.statCard}>
      <SettingsRow
        testID={`agent-settings-stat-${stat.id}-row`}
        layout="column"
        accessibilityLabel={`${translate(stat.title)} ${stat.value ?? ''}`.trim()}
        onPress={() => onOpen(stat)}
      >
        <View style={styles.statBody}>
          <View style={styles.statHead}>
            <Text
              testID={`agent-settings-stat-${stat.id}-value`}
              style={styles.statValue}
              numberOfLines={1}
            >
              {stat.value ?? '—'}
            </Text>
            {stat.locked ? (
              <Lock
                testID={`agent-settings-stat-${stat.id}-lock`}
                size={IconSize.sm}
                color={theme.colors.inkTertiary}
                strokeWidth={2}
              />
            ) : stat.detail ? (
              <Text
                testID={`agent-settings-stat-${stat.id}-detail`}
                style={[styles.statDetail, stat.detail.tone === 'bad' ? styles.statDetailBad : null]}
                numberOfLines={1}
              >
                {translateDetail(stat.detail)}
              </Text>
            ) : null}
          </View>
          <Text style={styles.statLabel} numberOfLines={1}>{translate(stat.title)}</Text>
        </View>
      </SettingsRow>
    </SettingsGroup>
  );

  return (
    <View testID="agent-settings-stats" style={styles.stats}>
      {heroes.length > 0 ? <View style={styles.statRow}>{heroes.map(renderCard)}</View> : null}
      {tiles.length > 0 ? <View style={styles.statRow}>{tiles.map(renderCard)}</View> : null}
    </View>
  );
}

type Translate = (key: string) => string;

function SettingsSection({
  group,
  translate,
  onOpenRow,
}: Readonly<{
  group: AgentSettingsGroupDescriptor;
  translate: Translate;
  onOpenRow: (row: AgentSettingsRowDescriptor) => void;
}>): React.JSX.Element | null {
  if (group.rows.length === 0) return null;

  return (
    <SettingsGroup density="comfortable" testID={`agent-settings-${group.id}-group`}>
      {group.rows.map((row, index) => (
        <React.Fragment key={row.id}>
          {index > 0 ? <SettingsDivider inset="content" /> : null}
          <SettingsRow
            testID={`agent-settings-row-${row.id}`}
            title={translate(row.title)}
            leading={<SettingsIcon icon={({ connection: Plug, openclaw: Settings2, tools: Wrench, 'channels-devices': Monitor, logs: FileText } as Record<string, typeof Plug>)[row.id] ?? Settings2} tone="neutral" size={20} strokeWidth={1.75} />}
            value={row.section === 'connection' && row.value
              ? translate(row.value)
              : row.value}
            attention={row.attention}
            locked={row.locked}
            showChevron={!row.locked}
            onPress={() => onOpenRow(row)}
          />
        </React.Fragment>
      ))}
    </SettingsGroup>
  );
}

function AgentSettingsLoading({
  bottomInset,
  loadingLabel,
}: Readonly<{
  bottomInset: number;
  loadingLabel: string;
}>): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  return (
    <View
      testID="agent-settings-loading"
      accessibilityLabel={loadingLabel}
      style={[styles.content, { paddingBottom: bottomInset + Space.xl }]}
    >
      <SettingsGroup>
        <View style={styles.identitySkeleton}>
          <Skeleton testID="agent-settings-skeleton-avatar" style={styles.avatarSkeleton} />
          <View style={styles.skeletonCopy}>
            <Skeleton style={styles.skeletonName} />
            <Skeleton style={styles.skeletonDetail} />
          </View>
        </View>
      </SettingsGroup>
      <SettingsGroup>
        {[0, 1, 2, 3, 4].map((index) => (
          <React.Fragment key={index}>
            {index > 0 ? <SettingsDivider inset="content" /> : null}
            <View style={styles.rowSkeleton}>
              <Skeleton style={styles.skeletonRowTitle} />
              <Skeleton style={styles.skeletonRowValue} />
            </View>
          </React.Fragment>
        ))}
      </SettingsGroup>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    // Owner trimmed the hero on 2026-09-16: 8 points off the top, 4 off the bottom.
    profileHero: { alignItems: 'center', gap: Space.md, paddingTop: Space.sm, paddingBottom: Space.md },
    profileHeroPressed: { opacity: Motion.pressedOpacity },
    profileAvatar: { position: 'relative', overflow: 'visible' },
    // The edit glyph hangs off the name's right edge so the name itself stays centred under the avatar.
    profileNameRow: { alignItems: 'center', justifyContent: 'center' },
    profileNameRowEditable: { paddingHorizontal: IconSize.sm + Space.xs },
    profileNameGlyph: {
      position: 'absolute',
      right: 0,
      top: 0,
      height: LineHeight.title,
      justifyContent: 'center',
    },
    // Corner mark cut out of the avatar by a ring in the page ground, like the roster status badges.
    backendMark: {
      position: 'absolute',
      right: -Space.xs,
      bottom: -Space.xs,
      width: Space.xl,
      height: Space.xl,
      borderRadius: Radius.full,
      borderWidth: BorderWidth.strong,
      borderColor: colors.canvasGrouped,
      backgroundColor: colors.surfaceFloating,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    },
    stats: { gap: Space.md },
    statRow: { flexDirection: 'row', gap: Space.md, alignItems: 'stretch' },
    statCard: { flex: 1, minWidth: 0 },
    statBody: { paddingVertical: Space.xs, gap: Space.xs },
    statHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.sm,
      minHeight: LineHeight.title,
    },
    statValue: {
      flexShrink: 1,
      color: colors.ink,
      fontSize: FontSize.title,
      lineHeight: LineHeight.title,
      fontWeight: FontWeight.semibold,
      fontVariant: ['tabular-nums'],
    },
    statDetail: {
      flexShrink: 1,
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.regular,
      fontVariant: ['tabular-nums'],
      textAlign: 'right',
    },
    statDetailBad: { color: colors.bad, fontWeight: FontWeight.semibold },
    statLabel: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
    },
    profileName: { color: colors.ink, fontSize: FontSize.title, lineHeight: LineHeight.title, fontWeight: FontWeight.semibold, textAlign: 'center' },
    profileDetail: { color: colors.inkSecondary, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, textAlign: 'center' },
    screen: {
      flex: 1,
      backgroundColor: colors.canvasGrouped,
    },
    header: { backgroundColor: colors.canvasGrouped },
    content: {
      paddingHorizontal: Space.lg,
      paddingTop: Space.lg,
      gap: Space.xl,
    },
    centeredState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Space.lg,
      paddingBottom: Space.xxl,
    },
    stateText: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
      textAlign: 'center',
    },
    identitySkeleton: {
      minHeight: ControlSize.settingsRow + Space.md,
      paddingHorizontal: Space.lg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
    },
    avatarSkeleton: {
      width: ControlSize.floatingButton,
      height: ControlSize.floatingButton,
      borderRadius: Radius.full,
    },
    skeletonCopy: {
      flex: 1,
      gap: Space.sm,
    },
    skeletonName: {
      width: '42%',
      minHeight: 0,
      height: Space.lg,
    },
    skeletonDetail: {
      width: '66%',
      minHeight: 0,
      height: Space.md,
    },
    rowSkeleton: {
      minHeight: ControlSize.settingsRow,
      paddingHorizontal: Space.lg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.lg,
    },
    skeletonRowTitle: {
      width: '38%',
      minHeight: 0,
      height: Space.lg,
    },
    skeletonRowValue: {
      width: '20%',
      minHeight: 0,
      height: Space.md,
    },
  });
}
