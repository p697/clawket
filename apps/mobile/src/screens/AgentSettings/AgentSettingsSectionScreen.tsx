import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  CAPABILITY_KEYS,
  type AgentAdapter,
  type AgentDescriptor,
  type Capabilities,
  type ConnectionDescriptor,
} from '@clawket/agent-protocol';
import { ChevronLeft } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getConnectionRuntime,
  useConnections,
} from '../../connection';
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
  Space,
} from '../../theme/tokens';
import {
  buildAgentSettingsSectionModel,
  getAgentSettingsSectionPaywallReason,
  getAgentSettingsSectionTitle,
  isAgentSettingsSectionSupported,
  isAgentSettingsSectionLocked,
  resolveAgentSettingsSectionState,
  type AgentSettingsSectionAction,
  type AgentSettingsSectionGroupDescriptor,
  type AgentSettingsSectionModel,
  type AgentSettingsSectionRowDescriptor,
  type AgentSettingsSectionState,
} from './section-model';

const NO_CAPABILITIES = Object.freeze(Object.fromEntries(
  CAPABILITY_KEYS.map((capability) => [capability, false]),
)) as unknown as Capabilities;
const SETTINGS_NAMESPACES = ['common', 'console', 'config'];

type NavigationProps = NativeStackScreenProps<RootStackParamList, 'AgentSettingsSection'>;

export type AgentSettingsSectionActionRequest = Readonly<{
  section: AgentSettingsSection;
  action: AgentSettingsSectionAction;
  connectionId: string;
  agentId: string;
}>;

export type AgentSettingsSectionActionContext = Readonly<{
  adapter: AgentAdapter;
  connection: ConnectionDescriptor;
  agent: AgentDescriptor;
}>;

export type AgentSettingsSectionActionResolver = (
  request: AgentSettingsSectionActionRequest,
  context: AgentSettingsSectionActionContext,
) => void | Promise<void>;

export type AgentSettingsSectionScreenProps = NavigationProps & Readonly<{
  isPro?: boolean;
  permissionDenied?: boolean;
  resolveAction?: AgentSettingsSectionActionResolver;
  onOpenPaywall?: (reason: string) => void;
}>;

export type AgentSettingsSectionViewProps = Readonly<{
  model: AgentSettingsSectionModel;
  state: AgentSettingsSectionState;
  errorMessage?: string;
  pendingAction?: AgentSettingsSectionAction | null;
  onBack: () => void;
  onRetry: () => void;
  onAction?: (action: AgentSettingsSectionAction) => void;
  canResolveAction?: (action: AgentSettingsSectionAction) => boolean;
  onOpenPaywall: (reason: string) => void;
}>;

export function AgentSettingsSectionScreen({
  navigation,
  route,
  isPro = false,
  permissionDenied = false,
  resolveAction,
  onOpenPaywall,
}: AgentSettingsSectionScreenProps): React.JSX.Element {
  const runtime = useConnections();
  const [activationError, setActivationError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<AgentSettingsSectionAction | null>(null);
  const { connectionId, agentId, section } = route.params;
  const routeIsActive = runtime.activeConnectionId === connectionId;
  const adapter = routeIsActive ? runtime.activeAdapter : null;
  const connectionGroup = runtime.roster.find(
    (candidate) => candidate.connection.id === connectionId,
  );
  const connection = runtime.connections.find((candidate) => candidate.id === connectionId)
    ?? connectionGroup?.connection
    ?? null;
  const agent = connectionGroup?.agents.find(
    (candidate) => candidate.agent.agentId === agentId,
  )?.agent ?? null;
  const capabilities = adapter?.capabilities ?? NO_CAPABILITIES;
  const supported = adapter
    ? isAgentSettingsSectionSupported(section, capabilities)
    : false;
  const sectionLocked = isAgentSettingsSectionLocked(section, isPro, permissionDenied);
  const runtimeError = runtime.error
    && (!runtime.error.connectionId || runtime.error.connectionId === connectionId)
    ? runtime.error.message
    : null;
  const errorMessage = actionError ?? activationError ?? runtimeError ?? undefined;

  useEffect(() => {
    if (!runtime.initialized || routeIsActive) return;
    let active = true;
    setActivationError(null);
    void getConnectionRuntime().activate(connectionId).catch((error: unknown) => {
      if (active) setActivationError(errorMessageFrom(error));
    });
    return () => {
      active = false;
    };
  }, [connectionId, routeIsActive, runtime.initialized]);

  const model = useMemo(() => connection ? buildAgentSettingsSectionModel({
    section,
    capabilities,
    ...(adapter?.management ? { management: adapter.management } : {}),
    connection,
    connectionState: runtime.activeState,
    isPro,
    permissionDenied,
  }) : emptySectionModel(section, sectionLocked), [
    adapter?.management,
    capabilities,
    connection,
    isPro,
    permissionDenied,
    runtime.activeState,
    section,
    sectionLocked,
  ]);
  const state = resolveAgentSettingsSectionState({
    initialized: runtime.initialized && (adapter !== null || Boolean(errorMessage)),
    routeIsActive,
    switching: runtime.switching,
    hasConnection: connection !== null,
    hasAgent: agent !== null,
    connectionState: runtime.activeState,
    supported,
    locked: sectionLocked,
    hasError: Boolean(errorMessage),
  });

  const retry = useCallback(() => {
    setActivationError(null);
    setActionError(null);
    void (async () => {
      const coordinator = getConnectionRuntime();
      if (coordinator.getSnapshot().activeConnectionId !== connectionId) {
        await coordinator.activate(connectionId);
        return;
      }
      await coordinator.probeActive();
    })().catch((error: unknown) => {
      setActivationError(errorMessageFrom(error));
    });
  }, [connectionId]);

  const openPaywall = useCallback((reason: string) => {
    if (onOpenPaywall) {
      onOpenPaywall(reason);
      return;
    }
    navigation.navigate('Paywall', { reason });
  }, [navigation, onOpenPaywall]);

  const runAction = useCallback((action: AgentSettingsSectionAction) => {
    if (action === 'connection.reconnect') {
      retry();
      return;
    }
    if (!resolveAction || !adapter || !connection || !agent || pendingAction) return;
    const request: AgentSettingsSectionActionRequest = {
      section,
      action,
      connectionId,
      agentId,
    };
    setActionError(null);
    setPendingAction(action);
    void Promise.resolve()
      .then(() => resolveAction(request, { adapter, connection, agent }))
      .catch((error: unknown) => {
        setActionError(errorMessageFrom(error));
      })
      .finally(() => {
        setPendingAction(null);
      });
  }, [
    adapter,
    agent,
    agentId,
    connection,
    connectionId,
    pendingAction,
    resolveAction,
    retry,
    section,
  ]);

  return (
    <AgentSettingsSectionView
      model={model}
      state={state}
      errorMessage={errorMessage}
      pendingAction={pendingAction}
      onBack={navigation.goBack}
      onRetry={retry}
      onAction={runAction}
      canResolveAction={(action) => action === 'connection.reconnect' || Boolean(resolveAction)}
      onOpenPaywall={openPaywall}
    />
  );
}

export function AgentSettingsSectionView({
  model,
  state,
  errorMessage,
  pendingAction,
  onBack,
  onRetry,
  onAction,
  canResolveAction,
  onOpenPaywall,
}: AgentSettingsSectionViewProps): React.JSX.Element {
  const { t } = useTranslation(['common', 'console', 'config']);
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const translate = useCallback(
    (key: string) => t(key, { ns: SETTINGS_NAMESPACES }),
    [t],
  );
  const openRow = (row: AgentSettingsSectionRowDescriptor) => {
    if (row.locked || state === 'locked') {
      onOpenPaywall(row.paywallReason ?? model.paywallReason ?? 'agents');
      return;
    }
    onAction?.(row.id);
  };

  return (
    <View
      testID="agent-settings-section-screen"
      style={[styles.screen, { paddingTop: insets.top }]}
    >
      <View testID="agent-settings-section-header" style={styles.header}>
        <FloatingButton
          testID="agent-settings-section-back"
          icon={ChevronLeft}
          accessibilityLabel={t('Back', { ns: 'common' })}
          onPress={onBack}
        />
        <Text
          testID="agent-settings-section-title"
          style={styles.headerTitle}
          numberOfLines={1}
        >
          {translate(model.title)}
        </Text>
        <View style={styles.headerSlot} />
      </View>

      {state === 'loading' ? (
        <AgentSettingsSectionLoading
          bottomInset={insets.bottom}
          label={translate('Loading...')}
        />
      ) : state === 'empty' ? (
        <View testID="agent-settings-section-empty" style={styles.centeredState}>
          <Text style={styles.stateText}>{translate('Agent unavailable')}</Text>
        </View>
      ) : (
        <ScrollView
          testID="agent-settings-section-content"
          automaticallyAdjustContentInsets={false}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + Space.xl },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {state === 'unsupported' ? (
            <Banner
              testID="agent-settings-section-unsupported"
              message={translate('Not supported by this backend')}
            />
          ) : null}
          {state === 'locked' ? (
            <Banner
              testID="agent-settings-section-locked"
              message={translate('Pro required for this setting')}
              actionLabel={t('Unlock', { ns: 'common' })}
              onAction={() => onOpenPaywall(model.paywallReason ?? 'agents')}
            />
          ) : null}
          {state === 'error' ? (
            <Banner
              testID="agent-settings-section-error"
              tone="bad"
              message={errorMessage || translate('Settings could not load')}
              actionLabel={t('Retry', { ns: 'common' })}
              onAction={onRetry}
            />
          ) : null}
          {state === 'offline' ? (
            <Banner
              testID="agent-settings-section-offline"
              message={translate('Offline · reconnecting')}
              actionLabel={translate('Reconnect')}
              onAction={onRetry}
            />
          ) : null}

          {state !== 'unsupported' && model.groups.length > 0
            ? model.groups.map((group) => (
              <AgentSettingsSectionGroup
                key={group.id}
                group={group}
                state={state}
                pendingAction={pendingAction}
                translate={translate}
                canResolveAction={(action) => Boolean(onAction)
                  && (canResolveAction?.(action) ?? true)}
                onOpenRow={openRow}
              />
            ))
            : state !== 'unsupported' ? (
              <View testID="agent-settings-section-no-settings" style={styles.centeredInlineState}>
                <Text style={styles.stateText}>{translate('No available settings')}</Text>
              </View>
            ) : null}
        </ScrollView>
      )}
    </View>
  );
}

type Translate = (key: string) => string;

function AgentSettingsSectionGroup({
  group,
  state,
  pendingAction,
  translate,
  canResolveAction,
  onOpenRow,
}: Readonly<{
  group: AgentSettingsSectionGroupDescriptor;
  state: AgentSettingsSectionState;
  pendingAction?: AgentSettingsSectionAction | null;
  translate: Translate;
  canResolveAction: (action: AgentSettingsSectionAction) => boolean;
  onOpenRow: (row: AgentSettingsSectionRowDescriptor) => void;
}>): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  return (
    <View testID={`agent-settings-section-${group.id}`} style={styles.section}>
      {group.title ? (
        <Text style={styles.sectionTitle}>{translate(group.title)}</Text>
      ) : null}
      <SettingsGroup testID={`agent-settings-section-${group.id}-group`}>
        {group.rows.map((row, index) => {
          const offlineAvailable = state !== 'offline' || row.availableOffline;
          const isLocked = row.locked || state === 'locked';
          const canResolve = canResolveAction(row.id);
          const missingResolver = row.actionable && !canResolve && !isLocked;
          const enabled = row.available
            && offlineAvailable
            && pendingAction == null
            && (isLocked || (row.actionable && canResolve));
          const value = pendingAction === row.id
            ? translate('Loading...')
            : row.value
              ? translate(row.value)
              : missingResolver
                ? translate('Unavailable')
                : undefined;
          return (
            <React.Fragment key={row.id}>
              {index > 0 ? <SettingsDivider inset="content" /> : null}
              <SettingsRow
                testID={`agent-settings-section-row-${row.id}`}
                title={translate(row.title)}
                value={value}
                locked={isLocked}
                disabled={!row.available
                  || !offlineAvailable
                  || pendingAction != null
                  || missingResolver}
                showChevron={enabled && !isLocked}
                onPress={enabled ? () => onOpenRow(row) : undefined}
              />
            </React.Fragment>
          );
        })}
      </SettingsGroup>
    </View>
  );
}

function AgentSettingsSectionLoading({
  bottomInset,
  label,
}: Readonly<{
  bottomInset: number;
  label: string;
}>): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  return (
    <View
      testID="agent-settings-section-loading"
      accessibilityLabel={label}
      style={[styles.content, { paddingBottom: bottomInset + Space.xl }]}
    >
      {[0, 1].map((group) => (
        <SettingsGroup key={group}>
          {[0, 1, 2].map((row) => (
            <React.Fragment key={row}>
              {row > 0 ? <SettingsDivider inset="content" /> : null}
              <View style={styles.skeletonRow}>
                <Skeleton
                  testID={group === 0 && row === 0
                    ? 'agent-settings-section-skeleton-row'
                    : undefined}
                  style={styles.skeletonTitle}
                />
                <Skeleton style={styles.skeletonValue} />
              </View>
            </React.Fragment>
          ))}
        </SettingsGroup>
      ))}
    </View>
  );
}

function emptySectionModel(
  section: AgentSettingsSection,
  locked: boolean,
): AgentSettingsSectionModel {
  return {
    section,
    title: getAgentSettingsSectionTitle(section),
    supported: false,
    locked,
    ...(getAgentSettingsSectionPaywallReason(section)
      ? { paywallReason: getAgentSettingsSectionPaywallReason(section) }
      : {}),
    groups: [],
  };
}

function errorMessageFrom(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'Settings could not load';
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
    centeredInlineState: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: Space.xxl,
    },
    stateText: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
      textAlign: 'center',
    },
    skeletonRow: {
      minHeight: ControlSize.settingsRow,
      paddingHorizontal: Space.lg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.lg,
    },
    skeletonTitle: {
      width: '42%',
      height: LineHeight.body,
    },
    skeletonValue: {
      width: '20%',
      height: LineHeight.secondary,
    },
  });
}
