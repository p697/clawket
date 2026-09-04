import React, { useEffect, useMemo, useState } from 'react';
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
  onOpenPro: (section: AgentSettingsSection) => void;
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
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    adapter?.state ?? 'offline',
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
    setConnectionState(adapter?.state ?? 'offline');
    setHasStateError(false);
    if (!adapter) return undefined;
    return adapter.on('state', (nextState) => {
      setConnectionState(nextState);
      setHasStateError(nextState === 'error');
    });
  }, [adapter]);

  useEffect(() => {
    if (!adapter || !agent || !summaryKey || connectionState !== 'ready') return undefined;

    let active = true;
    void loadAgentSettingsSummary(adapter, agent).then((nextSummary) => {
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
  }, [adapter, agent, connectionState, initialSummary, summaryKey]);

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
      capabilities={adapter?.capabilities ?? capabilities}
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
  const { t } = useTranslation(['common', 'console', 'config']);
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
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
    if (row.locked) {
      onOpenPro(row.section);
      return;
    }
    navigate(row.section);
  };

  return (
    <View
      testID="agent-settings-screen"
      style={[styles.screen, { paddingTop: insets.top }]}
    >
      <View testID="agent-settings-header" style={styles.header}>
        <FloatingButton
          testID="agent-settings-back"
          icon={ChevronLeft}
          accessibilityLabel={t('Back', { ns: 'common' })}
          onPress={onBack}
        />
        <Text testID="agent-settings-title" style={styles.headerTitle} numberOfLines={1}>
          {t('Agent settings')}
        </Text>
        <View style={styles.headerSlot} />
      </View>

      {state === 'loading' ? (
        <AgentSettingsLoading
          bottomInset={insets.bottom}
          loadingLabel={t('Loading...', { ns: 'common' })}
        />
      ) : state === 'empty' || !agent || !model ? (
        <View testID="agent-settings-empty" style={styles.centeredState}>
          <Text style={styles.stateText}>{t('Agent unavailable')}</Text>
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
              message={t('Offline · reconnecting')}
              actionLabel={t('Reconnect')}
              onAction={onRetry}
            />
          ) : null}
          {state === 'error' ? (
            <Banner
              testID="agent-settings-error"
              tone="bad"
              message={errorMessage || t('Settings could not load')}
              actionLabel={t('Retry', { ns: 'common' })}
              onAction={onRetry}
            />
          ) : null}
          {state === 'permission' ? (
            <Banner
              testID="agent-settings-permission"
              message={t('Pro required for this agent')}
              actionLabel={t('Unlock', { ns: 'common' })}
              onAction={() => onOpenPro('identity')}
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
                ? () => onOpenPro('identity')
                : model.identity.editable
                  ? () => navigate('identity')
                  : undefined}
            />
          </SettingsGroup>

          {model.groups.map((group) => (
            <SettingsSection
              key={group.id}
              group={group}
              translate={t}
              onOpenRow={openRow}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

type Translate = ReturnType<typeof useTranslation>['t'];

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
