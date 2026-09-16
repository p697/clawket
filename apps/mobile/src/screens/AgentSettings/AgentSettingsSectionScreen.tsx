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
  resolveCapabilities,
  type AgentAdapter,
  type AgentDescriptor,
  type BackendKind,
  type Capabilities,
  type ConnectionDescriptor,
} from '@clawket/agent-protocol';
import { ChevronLeft } from '../../components/ui/DirectionalIcon';
import { Compass, Plus, Share } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getConnectionRuntime,
  useConnections,
} from '../../connection';
import { Banner } from '../../components/ui/Banner';
import { ConnectionStatusPill } from '../../components/ui/ConnectionStatusPill';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
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
import { ModelsScreen } from './ModelsScreen';
import { SkillsSection } from './SkillsSection';
import { CronSection } from './CronSection';
import { CronEditorScreen } from './CronEditorScreen';
import { FilesSection } from './FilesSection';
import { UsageSection } from './UsageSection';
import { IdentityScreen } from './IdentityScreen';
import { ToolsSection } from './ToolsSection';
import { ChannelsDevicesSection } from './ChannelsDevicesSection';
import { LogsSection } from './LogsSection';
import { OpenClawManageScreen } from './OpenClawManageScreen';
import { translateAgentSettingsKey } from './translation';

const NO_CAPABILITIES = Object.freeze(Object.fromEntries(
  CAPABILITY_KEYS.map((capability) => [capability, false]),
)) as unknown as Capabilities;

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
  onOpenPaywall?: (reason: string, onContinue?: () => void) => void;
}>;

export type AgentSettingsSectionViewProps = Readonly<{
  model: AgentSettingsSectionModel;
  backend?: BackendKind;
  connectionLabel?: string;
  state: AgentSettingsSectionState;
  errorMessage?: string;
  /** The runtime's foreground grace window is open: show quiet reconnecting instead of offline. */
  reconnecting?: boolean;
  pendingAction?: AgentSettingsSectionAction | null;
  onBack: () => void;
  onRetry: () => void;
  onAction?: (action: AgentSettingsSectionAction) => void;
  canResolveAction?: (action: AgentSettingsSectionAction) => boolean;
  onOpenPaywall: (reason: string, onContinue?: () => void) => void;
  sectionContent?: React.ReactNode;
  title?: string;
  headerRight?: React.ReactNode;
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
  const [skillsRefresh, setSkillsRefresh] = useState(0);
  const [usagePosterRequest, setUsagePosterRequest] = useState(0);
  const { t, i18n } = useTranslation('common');
  const locale = i18n?.resolvedLanguage;
  const { connectionId, agentId, section } = route.params;
  const discoveringSkills = section === 'skills' && route.params.action === 'discover-skills';
  const editingCron = section === 'cron' && (route.params.action === 'create-cron' || route.params.action === 'edit-cron');
  useEffect(() => {
    if ((section !== 'skills' && section !== 'cron') || discoveringSkills || editingCron) return;
    return navigation.addListener('focus', () => setSkillsRefresh((value) => value + 1));
  }, [discoveringSkills, editingCron, navigation, section]);
  const routeIsActive = runtime.activeConnectionId === connectionId;
  const adapter = routeIsActive && !permissionDenied ? runtime.activeAdapter : null;
  const connectionGroup = runtime.roster.find(
    (candidate) => candidate.connection.id === connectionId,
  );
  const connection = runtime.connections.find((candidate) => candidate.id === connectionId)
    ?? connectionGroup?.connection
    ?? null;
  const agent = connectionGroup?.agents.find(
    (candidate) => candidate.agent.agentId === agentId,
  )?.agent ?? null;
  const capabilities = adapter?.capabilities
    ?? (connection ? resolveCapabilities(connection.backendKind) : NO_CAPABILITIES);
  const supported = connection
    ? isAgentSettingsSectionSupported(section, capabilities)
    : false;
  const sectionLocked = isAgentSettingsSectionLocked(section, isPro, permissionDenied);
  const runtimeError = runtime.error
    && (!runtime.error.connectionId || runtime.error.connectionId === connectionId)
    ? runtime.error.message
    : null;
  const errorMessage = actionError ?? activationError ?? runtimeError ?? undefined;

  useEffect(() => {
    if (!runtime.initialized || routeIsActive || permissionDenied) return;
    let active = true;
    setActivationError(null);
    void getConnectionRuntime().activate(connectionId).catch((error: unknown) => {
      if (active) setActivationError(errorMessageFrom(error));
    });
    return () => {
      active = false;
    };
  }, [connectionId, permissionDenied, routeIsActive, runtime.initialized]);

  const model = useMemo(() => connection ? buildAgentSettingsSectionModel({
    section,
    capabilities,
    ...(adapter?.management ? { management: adapter.management } : {}),
    connection,
    connectionState: runtime.activeState,
    isPro,
    permissionDenied,
    ...(runtime.connectionDetails?.[connectionId]
      ? { connectionDetails: runtime.connectionDetails[connectionId] }
      : {}),
    ...(locale ? { locale } : {}),
  }) : emptySectionModel(section, sectionLocked), [
    adapter?.management,
    capabilities,
    connection,
    isPro,
    permissionDenied,
    runtime.activeState,
    runtime.connectionDetails,
    section,
    sectionLocked,
    locale,
  ]);
  const state = resolveAgentSettingsSectionState({
    initialized: sectionLocked
      || (runtime.initialized && (adapter !== null || Boolean(errorMessage))),
    routeIsActive: sectionLocked || routeIsActive,
    switching: sectionLocked ? false : runtime.switching,
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

  const openPaywall = useCallback((reason: string, onContinue?: () => void) => {
    if (onOpenPaywall) {
      onOpenPaywall(reason, onContinue);
      return;
    }
    navigation.navigate('Paywall', { reason });
  }, [navigation, onOpenPaywall]);

  const refreshRoster = useCallback(async () => {
    try {
      await getConnectionRuntime().refreshRoster();
    } catch {
      // The management mutation already succeeded; the runtime will refresh on focus.
    }
  }, []);

  const finishAgentRemoval = useCallback(async () => {
    await refreshRoster();
    navigation.navigate('Roster');
  }, [navigation, refreshRoster]);

  let sectionContent: React.ReactNode;
  if (adapter && agent) {
    const online = runtime.activeState === 'ready';
    if (section === 'skills') {
      sectionContent = (
        <SkillsSection
          isPro={isPro}
          onOpenPaywall={openPaywall}
          adapter={adapter}
          agent={agent}
          online={online}
          view={discoveringSkills ? 'discover' : 'installed'}
          refreshKey={skillsRefresh}
          onInstallRequested={() => navigation.navigate('Thread', {
            connectionId, agentId, sessionKey: agent.mainSessionKey, from: 'roster',
          })}
        />
      );
    } else if (section === 'cron') {
      sectionContent = (
        <CronSection
          adapter={adapter}
          agent={agent}
          online={online}
          refreshKey={skillsRefresh}
          onCreate={() => navigation.push('AgentSettingsSection', { connectionId, agentId, section: 'cron', action: 'create-cron' })}
          onEdit={(cronJobId) => navigation.push('AgentSettingsSection', { connectionId, agentId, section: 'cron', action: 'edit-cron', cronJobId })}
        />
      );
    } else if (section === 'files') {
      sectionContent = (
        <FilesSection
          adapter={adapter}
          agent={agent}
          online={online}
          isPro={isPro}
          onOpenPaywall={openPaywall}
        />
      );
    } else if (section === 'usage') {
      sectionContent = (
        <UsageSection
          adapter={adapter}
          agent={agent}
          online={online}
          posterRequest={usagePosterRequest}
          isPro={isPro}
          onOpenPaywall={openPaywall}
        />
      );
    } else if (section === 'tools') {
      sectionContent = <ToolsSection adapter={adapter} agent={agent} online={online} />;
    } else if (section === 'channels-devices') {
      sectionContent = <ChannelsDevicesSection adapter={adapter} online={online} />;
    } else if (section === 'logs') {
      sectionContent = (
        <LogsSection
          adapter={adapter}
          online={online}
          isPro={isPro}
          onReconnect={retry}
          onOpenPaywall={openPaywall}
        />
      );
    }
  }

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

  if (section === 'openclaw' && adapter) {
    return (
      <OpenClawManageScreen
        adapter={adapter}
        isPro={isPro}
        permissionDenied={permissionDenied}
        onBack={navigation.goBack}
        onOpenPaywall={openPaywall}
      />
    );
  }

  if (section === 'models' && adapter && agent && supported && !sectionLocked && state !== 'empty' && state !== 'loading') {
    return (
      <ModelsScreen
        adapter={adapter}
        agent={agent}
        online={runtime.activeState === 'ready'}
        navigation={navigation}
        isPro={isPro}
        onOpenPaywall={openPaywall}
        onOpenProviderConfig={() => navigation.push('AgentSettingsSection', { connectionId, agentId, section: 'openclaw' })}
      />
    );
  }

  if (section === 'identity' && adapter && agent && supported && !sectionLocked && state !== 'empty' && state !== 'loading') {
    return (
      <IdentityScreen
        adapter={adapter}
        agent={agent}
        online={runtime.activeState === 'ready'}
        isPro={isPro}
        navigation={navigation}
        openCreateOnMount={route.params.action === 'create-agent'}
        onOpenPaywall={openPaywall}
        onChanged={refreshRoster}
        onCreated={() => navigation.navigate('Roster')}
        onRemoved={finishAgentRemoval}
      />
    );
  }

  if (editingCron && adapter && agent && supported && !sectionLocked && state !== 'empty' && state !== 'loading') {
    return <CronEditorScreen adapter={adapter} agent={agent} online={runtime.activeState === 'ready'}
      reconnecting={runtime.recovering === true}
      jobId={route.params.action === 'edit-cron' ? route.params.cronJobId : undefined}
      initialPrompt={route.params.cronPrompt} navigation={navigation} />;
  }

  return (
    <AgentSettingsSectionView
      model={model}
      backend={connection?.backendKind}
      connectionLabel={connection?.label}
      state={state}
      errorMessage={errorMessage}
      reconnecting={runtime.recovering && runtime.activeConnectionId === connectionId}
      pendingAction={pendingAction}
      onBack={navigation.goBack}
      onRetry={retry}
      onAction={runAction}
      canResolveAction={(action) => action === 'connection.reconnect' || Boolean(resolveAction)}
      onOpenPaywall={openPaywall}
      sectionContent={sectionContent}
      title={discoveringSkills ? t('Discover') : undefined}
      headerRight={section === 'skills' && agent && supported && !discoveringSkills && !sectionLocked
        && adapter?.capabilities.skillDiscover && adapter.management?.skills?.discover ? (
          <FloatingButton
            testID="agent-skills-discover"
            icon={Compass}
            appearance="quiet"
            accessibilityLabel={t('Discover')}
            onPress={() => navigation.push('AgentSettingsSection', {
              connectionId, agentId, section: 'skills', action: 'discover-skills',
            })}
          />
        ) : section === 'cron' && agent && supported && !sectionLocked && adapter?.capabilities.cronCreate && adapter.management?.cron?.add ? (
          <FloatingButton testID="agent-cron-new" icon={Plus} appearance="ink"
            accessibilityLabel={t('New cron job', { ns: 'config' })} disabled={runtime.activeState !== 'ready'}
            onPress={() => {
              analyticsEvents.cronCreateTapped({ source: 'cron_header' });
              navigation.push('AgentSettingsSection', { connectionId, agentId, section: 'cron', action: 'create-cron' });
            }} />
        ) : section === 'usage' && agent && supported && !sectionLocked && adapter?.management?.usage?.sessions ? (
          <FloatingButton testID="agent-usage-share" icon={Share} appearance="quiet"
            accessibilityLabel={t('Share', { ns: 'settings' })}
            onPress={() => setUsagePosterRequest((value) => value + 1)} />
        ) : undefined}
    />
  );
}

export function AgentSettingsSectionView({
  model,
  backend,
  connectionLabel,
  state,
  errorMessage,
  reconnecting = false,
  pendingAction,
  onBack,
  onRetry,
  onAction,
  canResolveAction,
  onOpenPaywall,
  sectionContent,
  title,
  headerRight,
}: AgentSettingsSectionViewProps): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings', 'config']);
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [removeConfirmationVisible, setRemoveConfirmationVisible] = useState(false);
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const translate = useCallback(
    (key: string) => translateAgentSettingsKey(t, key),
    [t],
  );
  const openAvailableRow = (row: AgentSettingsSectionRowDescriptor) => {
    if (row.id === 'connection.remove') {
      setRemoveConfirmationVisible(true);
      return;
    }
    onAction?.(row.id);
  };
  const openRow = (row: AgentSettingsSectionRowDescriptor) => {
    const locked = row.locked || state === 'locked';
    if (backend) {
      analyticsEvents.settingsRowOpened({ row: row.id, locked, backend });
    }
    if (locked) {
      onOpenPaywall(
        row.paywallReason ?? model.paywallReason ?? 'agents',
        () => openAvailableRow(row),
      );
      return;
    }
    openAvailableRow(row);
  };
  // The title yields its slot to connection state so the header never grows. Logs, tools and
  // channels present their own offline copy in place.
  const sectionOwnsOffline = model.section === 'logs'
    || model.section === 'tools'
    || model.section === 'channels-devices';
  const connectionStatus = state === 'offline' && !sectionOwnsOffline && reconnecting ? (
    <ConnectionStatusPill
      testID="agent-settings-section-reconnecting"
      placement="inline"
      status="reconnecting"
      message={t('Reconnecting…', { ns: 'common' })}
    />
  ) : state === 'offline' && !sectionOwnsOffline ? (
    <ConnectionStatusPill
      testID="agent-settings-section-offline"
      placement="inline"
      status="offline"
      message={translate('Offline · reconnecting')}
      actionLabel={translate('Reconnect')}
      onAction={onRetry}
    />
  ) : state === 'error' ? (
    <ConnectionStatusPill
      testID="agent-settings-section-error"
      placement="inline"
      status="error"
      message={errorMessage || translate('Settings could not load')}
      actionLabel={t('Retry', { ns: 'common' })}
      onAction={onRetry}
    />
  ) : null;

  return (
    <>
      <View
        testID="agent-settings-section-screen"
        style={[styles.screen, model.section === 'skills' || model.section === 'cron' ? styles.skillsScreen : null, { paddingTop: insets.top }]}
      >
        <View testID="agent-settings-section-header" style={styles.header}>
          <FloatingButton
            testID="agent-settings-section-back"
            icon={ChevronLeft}
            accessibilityLabel={t('Back', { ns: 'common' })}
            onPress={onBack}
          />
          {connectionStatus ? (
            <View testID="agent-settings-section-header-status" style={styles.headerStatus}>
              {connectionStatus}
            </View>
          ) : (
            <Text
              testID="agent-settings-section-title"
              style={styles.headerTitle}
              numberOfLines={1}
            >
              {title ?? translate(model.title)}
            </Text>
          )}
          {headerRight ?? <View style={styles.headerSlot} />}
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
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
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

          {sectionContent && state !== 'unsupported' && state !== 'locked'
            ? sectionContent
            : state !== 'unsupported' && model.groups.length > 0
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
      <ConfirmationModal
        visible={removeConfirmationVisible}
        title={t('Remove connection', { ns: 'config' })}
        message={t('Are you sure you want to delete "{{name}}"?', {
          ns: 'config',
          name: connectionLabel ?? t('Connection', { ns: 'common' }),
        })}
        cancelLabel={t('Cancel', { ns: 'common' })}
        confirmLabel={t('Remove', { ns: 'common' })}
        destructive
        testID="agent-settings-remove-connection-confirmation"
        onClose={() => setRemoveConfirmationVisible(false)}
        onConfirm={() => {
          setRemoveConfirmationVisible(false);
          onAction?.('connection.remove');
        }}
      />
    </>
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
                attention={row.attention}
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
    skillsScreen: { backgroundColor: colors.canvas },
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
    headerStatus: {
      flex: 1,
      minWidth: 0,
      alignItems: 'center',
      justifyContent: 'center',
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
