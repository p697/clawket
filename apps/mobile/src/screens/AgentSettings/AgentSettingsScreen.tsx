import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
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
  LineHeight,
  Radius,
  Space,
} from '../../theme/tokens';
import { loadAgentSettingsSummary } from './load-summary';
import {
  buildAgentSettingsModel,
  resolveAgentSettingsPageState,
  type AgentSettingsGroupDescriptor,
  type AgentSettingsPageState,
  type AgentSettingsRowDescriptor,
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
  errorMessage?: string;
  onBack: () => void;
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
        title={translateAgentSettingsKey(t, 'Agent settings')}
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
  const initialized = agent === null
    || connectionState !== 'ready'
    || summary !== undefined;

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
    void loadAgentSettingsSummary(accessibleAdapter, agent).then((nextSummary) => {
      if (!active) return;
      setLoadedSummary((previous) => ({
        key: summaryKey,
        value: {
          ...(previous?.key === summaryKey ? previous.value : initialSummary),
          ...nextSummary,
        },
      }));
    });
    return () => {
      active = false;
    };
  }, [accessibleAdapter, agent, connectionState, initialSummary, summaryKey]);

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
  errorMessage,
  onBack,
  onNavigate,
  onOpenPro,
  onRetry,
}: AgentSettingsViewProps): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings', 'config']);
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
  }) : null, [
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

  const openRow = (row: AgentSettingsRowDescriptor) => {
    const onContinue = () => navigate(row.section);
    analyticsEvents.settingsRowOpened({
      row: row.id,
      locked: row.locked,
      backend: connection.backendKind,
    });
    if (row.locked) {
      onOpenPro(row.section, onContinue);
      return;
    }
    onContinue();
  };

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
        title={translateAgentSettingsKey(t, 'Agent settings')}
        onBack={onBack}
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

          <SettingsGroup testID="agent-settings-identity-group">
            <SettingsRow
              testID="agent-settings-identity"
              leading={(
                <AgentAvatar
                  testID="agent-settings-avatar"
                  agentId={agent.agentId}
                  name={model.identity.name}
                  emoji={agent.emoji}
                  avatarUrl={agent.avatarUrl}
                  variant="settings"
                  status={model.identity.locked
                    ? 'locked'
                    : state === 'offline'
                      ? 'offline'
                      : 'idle'}
                />
              )}
              title={model.identity.name}
              subtitle={model.identity.detail}
              locked={model.identity.locked}
              showChevron={model.identity.editable}
              onPress={model.identity.locked
                ? openIdentity
                : model.identity.editable
                  ? openIdentity
                  : undefined}
            />
          </SettingsGroup>

          {model.groups.map((group) => (
            <SettingsSection
              key={group.id}
              group={group}
              translate={(key) => translateAgentSettingsKey(t, key)}
              onOpenRow={openRow}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function AgentSettingsHeader({
  backLabel,
  title,
  onBack,
}: Readonly<{
  backLabel: string;
  title: string;
  onBack: () => void;
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
      <View style={styles.headerSlot} />
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
      borderRadius: Radius.avatarSettings,
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
