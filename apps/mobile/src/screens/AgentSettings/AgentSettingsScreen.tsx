import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ChevronLeft, SlidersHorizontal, Fingerprint, Lock, MessageCircle } from 'lucide-react-native';
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
import { Sheet } from '../../components/ui/Sheet';
import { Banner } from '../../components/ui/Banner';
import { FloatingButton } from '../../components/ui/FloatingButton';
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
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  IconSize,
  LineHeight,
  Radius,
  Space,
} from '../../theme/tokens';
import { formatConsoleHeartbeatAge } from '../../utils/console-heartbeat';
import { loadAgentSettingsSummary } from './load-summary';
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
  onBack: () => void;
  onContinueChat?: () => void;
  onNavigate: AgentSettingsNavigate;
  onOpenPro: (section: AgentSettingsSection, onContinue?: () => void) => void;
  onRetry: () => void;
}>;

export type AgentSettingsScreenProps = Omit<
  AgentSettingsViewProps,
  'connectionState' | 'state' | 'summary'
> & Readonly<{
  adapter: AgentAdapter | null;
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
      style={[styles.screen, { paddingTop: insets.top }]}
    >
      <AgentSettingsHeader
        backLabel={t('Back', { ns: 'common' })}
        title={t('Agent profile', { ns: 'settings' })}
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
  ...viewProps
}: AgentSettingsScreenProps): React.JSX.Element {
  const accessibleAdapter = permissionDenied ? null : adapter;
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    accessibleAdapter?.state ?? 'offline',
  );
  const summaryKey = agent ? `${connection.id}:${agent.agentId}` : null;
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

  useEffect(() => {
    if (!accessibleAdapter || !agent || !summaryKey || connectionState !== 'ready') return undefined;

    let active = true;
    const applySummary = (nextSummary: AgentSettingsSummary) => {
      if (!active) return;
      setLoadedSummary((previous) => ({
        key: summaryKey,
        value: {
          ...(previous?.key === summaryKey ? previous.value : initialSummary),
          ...nextSummary,
        },
      }));
    };
    void loadAgentSettingsSummary(accessibleAdapter, agent, Date.now(), applySummary).then(applySummary);
    return () => {
      active = false;
    };
  }, [accessibleAdapter, agent?.agentId, connectionState, summaryKey]);

  const state = resolveAgentSettingsPageState({
    initialized,
    hasAgent: agent !== null,
    connectionState,
    permissionDenied,
    hasError: Boolean(errorMessage) || hasStateError,
  });

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
  onBack,
  onContinueChat,
  onNavigate,
  onOpenPro,
  onRetry,
}: AgentSettingsViewProps): React.JSX.Element {
  const { t, i18n } = useTranslation(['common', 'settings', 'config']);
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const [advancedVisible, setAdvancedVisible] = useState(false);
  const afterAdvancedCloseRef = useRef<(() => void) | null>(null);
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
      const onContinue = () => navigate(row.section);
      analyticsEvents.settingsRowOpened({ row: row.id, locked: row.locked, backend: connection.backendKind });
      if (row.locked) onOpenPro(row.section, onContinue);
      else onContinue();
    };
    if (advancedVisible) {
      afterAdvancedCloseRef.current = open;
      setAdvancedVisible(false);
      return;
    }
    open();
  };

  const identityDetailLabel = (() => {
    if (!model) return '';
    const minutes = model.identity.activeMinutesAgo;
    if (minutes === null) return model.identity.detail;
    const formatted = formatConsoleHeartbeatAge(minutes, i18n?.resolvedLanguage ?? i18n?.language ?? 'en');
    const age = formatted.compactText
      ?? (formatted.count === undefined
        ? t(formatted.key, { ns: 'common' })
        : t(formatted.key, { ns: 'common', count: formatted.count }));
    return `${model.identity.backendLabel} · ${t('Active {{age}}', { ns: 'settings', age })}`;
  })();

  const openIdentity = () => {
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

  return (
    <View
      testID="agent-settings-screen"
      style={[styles.screen, { paddingTop: insets.top }]}
    >
      <AgentSettingsHeader
        backLabel={t('Back', { ns: 'common' })}
        title={t('Agent profile', { ns: 'settings' })}
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
          showsVerticalScrollIndicator={false}
        >
          {state === 'offline' ? (
            <Banner
              testID="agent-settings-offline"
              message={translateAgentSettingsKey(t, 'Offline · reconnecting')}
              actionLabel={translateAgentSettingsKey(t, 'Reconnect')}
              onAction={onRetry}
            />
          ) : null}
          {state === 'error' ? (
            <Banner
              testID="agent-settings-error"
              tone="bad"
              message={errorMessage || translateAgentSettingsKey(t, 'Settings could not load')}
              actionLabel={t('Retry', { ns: 'common' })}
              onAction={onRetry}
            />
          ) : null}
          {state === 'permission' ? (
            <Banner
              testID="agent-settings-permission"
              message={translateAgentSettingsKey(t, 'Pro required for this agent')}
              actionLabel={t('Unlock', { ns: 'common' })}
              onAction={() => onOpenPro('identity', () => navigate('identity'))}
            />
          ) : null}

          <View style={styles.profileHero}>
            <AgentAvatar testID="agent-settings-avatar" agentId={agent.agentId}
              name={model.identity.name} emoji={agent.emoji} avatarUrl={agent.avatarUrl}
              variant="roster" status={model.identity.locked ? 'locked' : state === 'offline' ? 'offline' : 'idle'} />
            <Text style={styles.profileName}>{model.identity.name}</Text>
            <Text testID="agent-settings-identity-detail" style={styles.profileDetail}>{identityDetailLabel}</Text>
          </View>
          <AgentSettingsStats
            stats={model.stats}
            translate={(key) => translateAgentSettingsKey(t, key)}
            translateDetail={(detail) => t(detail.key, { ns: 'settings', ...detail.params })}
            onOpen={openRow}
          />
          {model.identity.editable || model.identity.locked ? (
            <SettingsGroup testID="agent-settings-identity-group">
              <SettingsRow testID="agent-settings-identity" title={t('Personality & memory', { ns: 'settings' })}
                leading={<Fingerprint size={20} color={theme.colors.inkSecondary} />}
                locked={model.identity.locked} showChevron onPress={openIdentity} />
            </SettingsGroup>
          ) : null}
          {model.groups.map((group) => (
            <SettingsSection key={group.id} group={{ ...group,
              rows: group.rows.filter((row) => row.placement === 'primary'),
            }} translate={(key) => translateAgentSettingsKey(t, key)} onOpenRow={openRow} />
          ))}
          {model.groups.some((group) => group.rows.some((row) => row.placement === 'advanced')) ? (
            <SettingsGroup>
              <SettingsRow testID="agent-profile-advanced" title={t('Advanced management', { ns: 'settings' })}
                leading={<SlidersHorizontal size={20} color={theme.colors.inkSecondary} />}
                showChevron onPress={() => setAdvancedVisible(true)} />
            </SettingsGroup>
          ) : null}
        </ScrollView>
      )}
      {model ? (
        <Sheet visible={advancedVisible} onClose={() => setAdvancedVisible(false)} title={t('Advanced management', { ns: 'settings' })}
          onAfterClose={() => {
            const action = afterAdvancedCloseRef.current;
            afterAdvancedCloseRef.current = null;
            action?.();
          }}
          closeAccessibilityLabel={t('Close', { ns: 'common' })}>
          <ScrollView contentContainerStyle={styles.content}>
            {model.groups.map((group) => <SettingsSection key={group.id} group={{ ...group,
              rows: group.rows.filter((row) => row.placement === 'advanced'),
            }} translate={(key) => translateAgentSettingsKey(t, key)} onOpenRow={openRow} />)}
          </ScrollView>
        </Sheet>
      ) : null}
    </View>
  );
}

function AgentSettingsHeader({
  backLabel,
  title,
  onBack,
  trailing,
}: Readonly<{
  backLabel: string;
  title: string;
  onBack: () => void;
  trailing?: React.ReactNode;
}>): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  return (
    <View testID="agent-settings-header" style={styles.header}>
      <FloatingButton
        testID="agent-settings-back"
        icon={ChevronLeft}
        accessibilityLabel={backLabel}
        onPress={onBack}
      />
      <Text testID="agent-settings-title" style={styles.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      {trailing ?? <View style={styles.headerSlot} />}
    </View>
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
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  if (group.rows.length === 0) return null;

  return (
    <View testID={`agent-settings-${group.id}-section`} style={styles.section}>
      {group.title ? (
        <Text testID={`agent-settings-${group.id}-heading`} style={styles.sectionTitle}>
          {group.title}
        </Text>
      ) : null}
      <SettingsGroup testID={`agent-settings-${group.id}-group`}>
        {group.rows.map((row, index) => (
          <React.Fragment key={row.id}>
            {index > 0 ? <SettingsDivider inset="content" /> : null}
            <SettingsRow
              testID={`agent-settings-row-${row.id}`}
              title={translate(row.title)}
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
    </View>
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
    profileHero: { alignItems: 'center', gap: Space.md, paddingVertical: Space.lg },
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
    header: {
      minHeight: ControlSize.floatingButton,
      paddingHorizontal: Space.lg,
      marginTop: Space.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerSlot: {
      width: ControlSize.floatingButton,
      height: ControlSize.floatingButton,
    },
    headerTitle: {
      flex: 1,
      color: colors.ink,
      fontSize: FontSize.title,
      lineHeight: LineHeight.title,
      fontWeight: FontWeight.semibold,
      textAlign: 'center',
      marginHorizontal: Space.sm,
    },
    content: {
      paddingHorizontal: Space.lg,
      paddingTop: Space.xl,
      gap: Space.xl,
    },
    section: {
      gap: Space.sm,
    },
    sectionTitle: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
      paddingHorizontal: Space.xs,
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
      height: LineHeight.body,
    },
    skeletonDetail: {
      width: '66%',
      height: LineHeight.caption,
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
      height: LineHeight.body,
    },
    skeletonRowValue: {
      width: '20%',
      height: LineHeight.secondary,
    },
  });
}
