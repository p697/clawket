import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {
  AgentAdapter,
  ApprovalRequest,
  Backup,
  ConfigView,
  DoctorResult,
  PermissionsReport,
} from '@clawket/agent-protocol';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { HeaderTextAction } from '../../components/ui/HeaderTextAction';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { SettingsIcon } from '../../components/ui/SettingsIcon';
import { SettingsGroup, SettingsRow } from '../../components/ui/SettingsGroup';
import { ChevronRight } from '../../components/ui/DirectionalIcon';
import { Archive, FileJson, ShieldCheck, Stethoscope } from 'lucide-react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Sheet } from '../../components/ui/Sheet';
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
import {
  BackupsSection,
  ConfigurationSection,
  DiagnosticsSection,
  ManageSectionLoading,
  PermissionsSection,
  SectionEmpty,
  type ManageSectionGate,
} from './OpenClawManageSections';
import {
  withManagementDeadline,
  isOpenClawManageTabSupported,
  managementErrorDetail,
  managementErrorKey,
  normalizeConfigDraft,
  resolveOpenClawManageSupport,
  serializeConfigView,
  type OpenClawManageTab,
} from './openclaw-manage-model';
import { translateAgentSettingsKey } from './translation';
import { formatConsoleHeartbeatAge, heartbeatMinutesAgo } from '../../utils/console-heartbeat';

type ExecApproval = Extract<ApprovalRequest, { kind: 'exec' }>;
type FlagMap = Record<OpenClawManageTab, boolean>;
type ErrorMap = Record<OpenClawManageTab, string | null>;

type ManageSheet =
  | Readonly<{ kind: 'configuration-edit' }>
  | Readonly<{ kind: 'configuration-confirm'; raw: string }>
  | Readonly<{ kind: 'repair'; source: 'permissions' | 'diagnostics' }>
  | Readonly<{ kind: 'approval'; approval: ExecApproval }>
  | Readonly<{ kind: 'restore'; backup: Backup }>
  | Readonly<{ kind: 'delete-backup'; backup: Backup }>
  | Readonly<{ kind: 'detail'; title: string; body: string }>
  | null;

// The whole config outgrows the screen: the editor is a fixed 93% document
// sheet whose input scrolls through the Gorhom-integrated scroll view, with the
// Cancel / Save row kept below it (a grown input in a dynamic sheet pushed it off).
const CONFIGURATION_EDITOR_SNAP_POINTS: string[] = ['93%'];

const EMPTY_FLAGS: FlagMap = {
  configuration: false,
  permissions: false,
  diagnostics: false,
  backups: false,
};

const EMPTY_ERRORS: ErrorMap = {
  configuration: null,
  permissions: null,
  diagnostics: null,
  backups: null,
};

export type OpenClawManageScreenProps = Readonly<{
  adapter: AgentAdapter;
  isPro: boolean;
  permissionDenied?: boolean;
  initialTab?: OpenClawManageTab;
  onBack: () => void;
  onOpenPaywall: (
    reason: 'configManage' | 'openclawPermissions' | 'openclawDiagnostics' | 'configBackups',
    onContinue?: () => void,
  ) => void;
}>;

function paywallFeatureForTab(
  tab: OpenClawManageTab,
): 'configManage' | 'openclawPermissions' | 'openclawDiagnostics' | 'configBackups' {
  switch (tab) {
    case 'permissions': return 'openclawPermissions';
    case 'diagnostics': return 'openclawDiagnostics';
    case 'backups': return 'configBackups';
    default: return 'configManage';
  }
}

export function OpenClawManageScreen({
  adapter,
  isPro,
  permissionDenied = false,
  initialTab,
  onBack,
  onOpenPaywall,
}: OpenClawManageScreenProps): React.JSX.Element {
  const { t, i18n } = useTranslation(['config', 'common', 'settings', 'chat']);
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const support = useMemo(() => resolveOpenClawManageSupport(adapter), [adapter]);
  // A locked Agent never reaches management. A free user on an accessible Agent
  // sees real data and meets the contextual paywall only at the last step.
  const hasAccess = !permissionDenied;
  const preview = !isPro && !permissionDenied;
  const [showMenu, setShowMenu] = useState(initialTab === undefined);
  const [activeTab, setActiveTab] = useState<OpenClawManageTab>(initialTab ?? 'configuration');
  const [connectionState, setConnectionState] = useState(adapter.state);
  const [configuration, setConfiguration] = useState<ConfigView | null>(null);
  const [permissions, setPermissions] = useState<PermissionsReport | null>(null);
  const [diagnostics, setDiagnostics] = useState<DoctorResult | null>(null);
  const [backups, setBackups] = useState<ReadonlyArray<Backup> | null>(null);
  const [approvals, setApprovals] = useState<ReadonlyArray<ExecApproval>>([]);
  const [loaded, setLoaded] = useState<FlagMap>(EMPTY_FLAGS);
  const [loading, setLoading] = useState<FlagMap>(EMPTY_FLAGS);
  const [errors, setErrors] = useState<ErrorMap>(EMPTY_ERRORS);
  const [sheet, setSheet] = useState<ManageSheet>(null);
  const [configurationDraft, setConfigurationDraft] = useState('');
  // Configuration browsing state lives here, not in the section: the ScrollView
  // remounts per section, and a user who steps out to the menu and back should
  // find the keys they opened still open (owner request 2026-09-19: several
  // keys open at once, no exclusive accordion).
  const [configurationQuery, setConfigurationQuery] = useState('');
  const [configurationExpanded, setConfigurationExpanded] = useState<ReadonlyArray<string>>([]);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const adapterLoadEpoch = useRef(0);
  const backupDeleteLock = useRef(false);
  const inFlightLoads = useRef(new Set<string>());
  const tabLoadIds = useRef<Record<OpenClawManageTab, number>>({
    configuration: 0,
    permissions: 0,
    diagnostics: 0,
    backups: 0,
  });
  const online = connectionState === 'ready';

  // Menu copy (owner-requested 2026-09-16): each Pro section says what it does in one plain line —
  // a bare "Configuration" / "Permissions" / "Diagnostics" told users nothing worth tapping into,
  // and the owner asked for wording a middle-schooler would follow. Since 2026-09-19 each entry is
  // its own feature card (icon on top, then the name and the sentence on full lines): the four rows
  // packed into one card read as crowded and left the lower half of the page empty.
  const tabs = useMemo(() => [
    {
      key: 'configuration' as const,
      label: t('OpenClaw config'),
      description: t('See and change every OpenClaw setting.'),
    },
    {
      key: 'permissions' as const,
      label: t('Permissions'),
      description: t('Check web and command access; fix it in one tap.'),
    },
    {
      key: 'diagnostics' as const,
      label: t('Diagnostics'),
      description: t('Give OpenClaw a check-up and auto-fix issues.'),
    },
    {
      key: 'backups' as const,
      label: t('Back up OpenClaw config'),
      description: t('Keeps a copy on your phone so a bad change can be undone.'),
    },
  ], [t]);

  // The only live values the menu shows are the ones it already has for free: exec approvals that
  // arrived over the socket, and the newest restore point (a local read, never a Gateway request).
  const menuValues = useMemo((): Partial<Record<OpenClawManageTab, Readonly<{ value: string; attention: boolean }>>> => {
    const values: Partial<Record<OpenClawManageTab, Readonly<{ value: string; attention: boolean }>>> = {};
    if (approvals.length > 0) values.permissions = { value: String(approvals.length), attention: true };
    const newestBackupAt = backups?.[0]?.createdAt;
    const minutes = heartbeatMinutesAgo(newestBackupAt, Date.now());
    if (minutes !== null) {
      const formatted = formatConsoleHeartbeatAge(minutes, i18n?.resolvedLanguage ?? i18n?.language ?? 'en');
      const age = formatted.compactText
        ?? (formatted.count === undefined
          ? t(formatted.key, { ns: 'common' })
          : t(formatted.key, { ns: 'common', count: formatted.count }));
      values.backups = { value: age, attention: false };
    }
    return values;
  }, [approvals.length, backups, i18n?.language, i18n?.resolvedLanguage, t]);

  const translateError = useCallback((error: unknown, fallback: string) => {
    const key = managementErrorKey(error);
    return key ? translateAgentSettingsKey(t, key) : managementErrorDetail(error, fallback);
  }, [t]);

  const gateFor = useCallback((tab: OpenClawManageTab): ManageSectionGate => ({
    locked: preview,
    open: (continuation?: () => void) => onOpenPaywall(paywallFeatureForTab(tab), continuation),
  }), [onOpenPaywall, preview]);

  const loadTab = useCallback(async (tab: OpenClawManageTab) => {
    // Restore points live on this phone, so their list does not wait for the Gateway.
    if (!hasAccess || (!online && tab !== 'backups') || !isOpenClawManageTabSupported(support, tab)) return;
    const loadEpoch = adapterLoadEpoch.current;
    const loadKey = `${loadEpoch}:${tab}`;
    if (inFlightLoads.current.has(loadKey)) return;
    inFlightLoads.current.add(loadKey);
    const loadId = tabLoadIds.current[tab] + 1;
    tabLoadIds.current[tab] = loadId;
    const isCurrentLoad = () => adapterLoadEpoch.current === loadEpoch
      && tabLoadIds.current[tab] === loadId;
    const config = adapter.management?.config;
    setLoading((current) => ({ ...current, [tab]: true }));
    setErrors((current) => ({ ...current, [tab]: null }));
    try {
      if (tab === 'configuration' && support.configuration && config?.view) {
        const next = await config.view();
        if (!isCurrentLoad()) return;
        setConfiguration(next);
      } else if (tab === 'permissions') {
        if (support.permissions && config?.permissions) {
          const next = await withManagementDeadline(config.permissions());
          if (!isCurrentLoad()) return;
          setPermissions(next);
        }
      } else if (tab === 'diagnostics' && support.diagnostics && config?.doctor) {
        const next = await withManagementDeadline(config.doctor());
        if (!isCurrentLoad()) return;
        setDiagnostics(next);
      } else if (tab === 'backups' && support.backups && config?.backups?.list) {
        const next = await config.backups.list();
        if (!isCurrentLoad()) return;
        setBackups([...next].sort((left, right) => right.createdAt - left.createdAt));
      }
      if (!isCurrentLoad()) return;
      setLoaded((current) => ({ ...current, [tab]: true }));
    } catch (error: unknown) {
      if (!isCurrentLoad()) return;
      const fallback = tab === 'configuration'
        ? t('Unable to load config')
        : tab === 'permissions'
          ? t('Unable to load permission status')
          : tab === 'diagnostics'
            ? t('Doctor command failed.')
            : t('Unable to load backups');
      setErrors((current) => ({
        ...current,
        [tab]: translateError(error, fallback),
      }));
      setLoaded((current) => ({ ...current, [tab]: true }));
    } finally {
      inFlightLoads.current.delete(loadKey);
      if (isCurrentLoad()) {
        setLoading((current) => ({ ...current, [tab]: false }));
      }
    }
  }, [adapter.management?.config, hasAccess, online, support, t, translateError]);

  useEffect(() => {
    analyticsEvents.gatewayConfigViewOpened({ source: 'agent_settings_openclaw' });
  }, []);

  useEffect(() => {
    const loadEpoch = adapterLoadEpoch.current + 1;
    adapterLoadEpoch.current = loadEpoch;
    setConnectionState(adapter.state);
    setConfiguration(null);
    setPermissions(null);
    setDiagnostics(null);
    setBackups(null);
    setApprovals([]);
    setLoaded(EMPTY_FLAGS);
    setLoading(EMPTY_FLAGS);
    setErrors(EMPTY_ERRORS);
    setSheet(null);
    setBusy(null);
    setNotice(null);
    const unsubscribe = adapter.on('state', (state) => setConnectionState(state));
    return () => {
      if (adapterLoadEpoch.current === loadEpoch) adapterLoadEpoch.current += 1;
      unsubscribe();
    };
  }, [adapter]);

  useEffect(() => adapter.on('update', (update) => {
    if (update.type === 'approval_requested' && update.approval.kind === 'exec') {
      const approval = update.approval;
      setApprovals((current) => [
        approval,
        ...current.filter((candidate) => candidate.id !== approval.id),
      ]);
    } else if (update.type === 'approval_resolved') {
      setApprovals((current) => current.filter(
        (candidate) => candidate.id !== update.approvalId,
      ));
      setSheet((current) => current?.kind === 'approval'
        && current.approval.id === update.approvalId
        ? null
        : current);
    }
  }), [adapter]);

  useEffect(() => {
    if (!showMenu && !loaded[activeTab] && !loading[activeTab]) void loadTab(activeTab);
  }, [activeTab, loadTab, loaded, loading, showMenu]);

  // The menu reads only the local backup list so its row can show the newest restore point's age.
  useEffect(() => {
    if (showMenu && support.backups && !loaded.backups && !loading.backups) void loadTab('backups');
  }, [loadTab, loaded.backups, loading.backups, showMenu, support.backups]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showMenu || sheet) return false;
      setShowMenu(true);
      return true;
    });
    return () => subscription.remove();
  }, [showMenu, sheet]);

  const retry = useCallback(async () => {
    setErrors((current) => ({ ...current, [activeTab]: null }));
    setNotice(null);
    if (online) {
      await loadTab(activeTab);
      return;
    }
    try {
      await adapter.connect();
      const nextState = adapter.state;
      setConnectionState(nextState);
      if (nextState === 'ready') await loadTab(activeTab);
    } catch (error: unknown) {
      setErrors((current) => ({
        ...current,
        [activeTab]: translateError(error, t('OpenClaw is not responding')),
      }));
    }
  }, [activeTab, adapter, loadTab, online, t, translateError]);

  const toggleConfigurationKey = useCallback((key: string) => {
    setConfigurationExpanded((current) => (
      current.includes(key) ? current.filter((candidate) => candidate !== key) : [...current, key]
    ));
  }, []);

  const openConfigurationEditor = useCallback(() => {
    if (!configuration || !support.configurationWrite || !online) return;
    setConfigurationDraft(serializeConfigView(configuration));
    setSheetError(null);
    setSheet({ kind: 'configuration-edit' });
  }, [configuration, online, support.configurationWrite]);

  const reviewConfiguration = useCallback(() => {
    try {
      const raw = normalizeConfigDraft(configurationDraft);
      setSheetError(null);
      setSheet({ kind: 'configuration-confirm', raw });
    } catch {
      setSheetError(t('Save Failed', { ns: 'common' }));
    }
  }, [configurationDraft, t]);

  const saveConfiguration = useCallback(async (raw: string) => {
    const setConfig = adapter.management?.config?.set;
    if (!support.configurationWrite || !setConfig || !online) return;
    if (!configuration?.hash) {
      setSheetError(t('Gateway config hash is missing. Please refresh and try again.'));
      return;
    }
    setBusy('configuration');
    setSheetError(null);
    try {
      const result = await setConfig(raw, configuration.hash);
      if (!result.ok) throw new Error(t('Save Failed', { ns: 'common' }));
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      setConfiguration({ config: result.config ?? parsed, hash: null });
      setLoaded((current) => ({ ...current, configuration: false }));
      setNotice(t('Saved', { ns: 'common' }));
      setSheet(null);
      if (adapter.state === 'ready') await loadTab('configuration');
    } catch (error: unknown) {
      setSheetError(translateError(error, t('Save Failed', { ns: 'common' })));
    } finally {
      setBusy(null);
    }
  }, [adapter, configuration?.hash, loadTab, online, support.configurationWrite, t, translateError]);

  const repair = useCallback(async (source: 'permissions' | 'diagnostics') => {
    const repairConfig = adapter.management?.config?.repair;
    const allowed = source === 'permissions'
      ? support.permissions && Boolean(repairConfig)
      : support.diagnosticRepair;
    if (!allowed || !repairConfig || !online) return;
    setBusy('repair');
    setSheetError(null);
    try {
      const result = await repairConfig();
      setNotice(result.summary || t(
        result.ok ? 'Fix completed successfully' : 'Fix completed with issues',
      ));
      setSheet(null);
      await loadTab(source);
    } catch (error: unknown) {
      setSheetError(translateError(error, t('Fix command failed.')));
    } finally {
      setBusy(null);
    }
  }, [adapter.management?.config?.repair, loadTab, online, support.diagnosticRepair, support.permissions, t, translateError]);

  const resolveApproval = useCallback(async (
    approval: ExecApproval,
    decision: 'allow-once' | 'allow-always' | 'deny',
  ) => {
    const resolve = adapter.management?.approvals?.resolveExec;
    if (!support.approvals || !resolve || !online || approval.expiresAtMs <= Date.now()) return;
    setBusy(`approval:${approval.id}`);
    setSheetError(null);
    try {
      await resolve(approval.id, decision);
      analyticsEvents.approvalResolved({
        kind: 'exec',
        decision,
      });
      setApprovals((current) => current.filter((candidate) => candidate.id !== approval.id));
      setSheet(null);
    } catch (error: unknown) {
      setSheetError(translateError(error, t('Approval failed', { ns: 'settings' })));
    } finally {
      setBusy(null);
    }
  }, [adapter.management?.approvals?.resolveExec, online, support.approvals, t, translateError]);

  const createBackup = useCallback(async () => {
    const create = adapter.management?.config?.backups?.create;
    if (!support.backupCreate || !create || !online || busy) return;
    setBusy('backup-create');
    setErrors((current) => ({ ...current, backups: null }));
    try {
      const backup = await create();
      const nextCount = (backups?.length ?? 0) + 1;
      setBackups((current) => [
        backup,
        ...(current ?? []).filter((candidate) => candidate.id !== backup.id),
      ]);
      setLoaded((current) => ({ ...current, backups: true }));
      setNotice(t('Config backup created.'));
      analyticsEvents.gatewayConfigBackupCreated({
        source: 'agent_settings_openclaw',
        backup_count: nextCount,
      });
    } catch (error: unknown) {
      setErrors((current) => ({
        ...current,
        backups: translateError(error, t('Failed to create config backup')),
      }));
    } finally {
      setBusy(null);
    }
  }, [adapter.management?.config?.backups?.create, backups?.length, busy, online, support.backupCreate, t, translateError]);

  const deleteBackup = useCallback(async (backup: Backup) => {
    const remove = adapter.management?.config?.backups?.remove;
    if (!remove || backupDeleteLock.current || busy) return;
    backupDeleteLock.current = true;
    const epoch = adapterLoadEpoch.current;
    tabLoadIds.current.backups += 1;
    setBusy(`backup-delete:${backup.id}`);
    setSheetError(null);
    try {
      await remove(backup.id);
      if (adapterLoadEpoch.current !== epoch) return;
      setBackups(current => current?.filter(item => item.id !== backup.id) ?? null);
      setSheet(null);
    } catch (error) {
      if (adapterLoadEpoch.current === epoch) setSheetError(translateError(error, t('Error', { ns: 'common' })));
    } finally {
      backupDeleteLock.current = false;
      if (adapterLoadEpoch.current === epoch) setBusy(null);
    }
  }, [adapter, busy, t, translateError]);

  const restoreBackup = useCallback(async (backup: Backup) => {
    const restore = adapter.management?.config?.backups?.restore;
    if (!support.backupRestore || !restore || !online) return;
    setBusy(`backup-restore:${backup.id}`);
    setSheetError(null);
    try {
      analyticsEvents.gatewayConfigRestoreTapped({
        source: 'agent_settings_openclaw',
        backup_count: backups?.length ?? 0,
      });
      await restore(backup.id);
      setConfiguration(null);
      setLoaded((current) => ({ ...current, configuration: false }));
      setNotice(t('Saved', { ns: 'common' }));
      setSheet(null);
    } catch (error: unknown) {
      setSheetError(translateError(error, t('Unable to load backups')));
    } finally {
      setBusy(null);
    }
  }, [adapter.management?.config?.backups?.restore, backups?.length, online, support.backupRestore, t, translateError]);

  const renderSection = (): React.ReactNode => {
    const supported = isOpenClawManageTabSupported(support, activeTab);
    if (!supported) {
      return (
        <SectionEmpty
          testID="openclaw-manage-unsupported"
          message={t('Not supported by this backend')}
        />
      );
    }
    if (loading[activeTab]) return <ManageSectionLoading diagnostics={activeTab === 'diagnostics'} />;
    if (!loaded[activeTab]) {
      return online || errors[activeTab]
        ? null
        : <SectionEmpty testID="openclaw-manage-offline-empty" message={t('Offline', { ns: 'common' })} />;
    }
    if (activeTab === 'configuration') {
      return (
        <ConfigurationSection
          view={configuration}
          canEdit={support.configurationWrite}
          online={online}
          gate={gateFor('configuration')}
          query={configurationQuery}
          onQueryChange={setConfigurationQuery}
          expandedKeys={configurationExpanded}
          onToggleKey={toggleConfigurationKey}
          onEdit={openConfigurationEditor}
        />
      );
    }
    if (activeTab === 'permissions') {
      return (
        <PermissionsSection
          report={permissions}
          approvals={approvals}
          now={Date.now()}
          canResolveApprovals={support.approvals}
          canRepair={support.permissions && Boolean(adapter.management?.config?.repair)}
          online={online}
          repairing={busy === 'repair'}
          gate={gateFor('permissions')}
          onSelectApproval={(approval) => {
            if (approval.expiresAtMs > Date.now()) {
              setSheetError(null);
              setSheet({ kind: 'approval', approval });
            }
          }}
          onRepair={() => {
            setSheetError(null);
            setSheet({ kind: 'repair', source: 'permissions' });
          }}
          onShowDetail={(detail) => setSheet({ kind: 'detail', ...detail })}
        />
      );
    }
    if (activeTab === 'diagnostics') {
      return (
        <DiagnosticsSection
          result={diagnostics}
          canRepair={support.diagnosticRepair}
          online={online}
          repairing={busy === 'repair'}
          gate={gateFor('diagnostics')}
          onDiagnose={() => { void loadTab('diagnostics'); }}
          onRepair={() => {
            setSheetError(null);
            setSheet({ kind: 'repair', source: 'diagnostics' });
          }}
          onShowDetail={(detail) => setSheet({ kind: 'detail', ...detail })}
        />
      );
    }
    return (
      <BackupsSection
        backups={backups}
        canCreate={support.backupCreate}
        canRestore={support.backupRestore}
        onDeleteBackup={adapter.management?.config?.backups?.remove ? backup => {
          setSheetError(null);
          setSheet({ kind: 'delete-backup', backup });
        } : undefined}
        online={online}
        busy={Boolean(busy)}
        gate={gateFor('backups')}
        onCreate={() => { void createBackup(); }}
        onSelectBackup={(backup) => {
          setSheetError(null);
          setSheet({ kind: 'restore', backup });
        }}
      />
    );
  };

  const closeSheet = useCallback(() => {
    if (busy) return;
    setSheet(null);
    setSheetError(null);
  }, [busy]);

  return (
    <View
      testID="openclaw-manage-screen"
      style={[styles.screen, { backgroundColor: theme.colors.canvasGrouped }]}
    >
      <ScreenHeader
        testID="openclaw-manage-header"
        backTestID="openclaw-manage-back"
        title={(showMenu ? t('OpenClaw management', { ns: 'common' }) : tabs.find(tab => tab.key === activeTab)?.label) ?? ''}
        topInset={insets.top}
        onBack={() => showMenu ? onBack() : setShowMenu(true)}
        backAccessibilityLabel={t('Back', { ns: 'common' })}
        rightContent={!showMenu && activeTab === 'configuration' && configurationExpanded.length >= 2 ? (
          <HeaderTextAction
            testID="openclaw-configuration-collapse-all"
            label={t('Collapse all')}
            onPress={() => setConfigurationExpanded([])}
          />
        ) : undefined}
        style={styles.header}
      />

      <ScrollView
        key={showMenu ? 'menu' : activeTab}
        automaticallyAdjustContentInsets={false}
        contentContainerStyle={[
          styles.content,
          // A section still loading owns the whole viewport so the Companion sits centred.
          !showMenu && support.root && loading[activeTab] ? styles.contentFill : null,
          { paddingBottom: insets.bottom + Space.xl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!support.root ? (
          <SectionEmpty
            testID="openclaw-manage-unsupported"
            message={t('Not supported by this backend')}
          />
        ) : (
          <>
            {showMenu ? (
              <View testID="openclaw-manage-menu" style={styles.menu}>
                {tabs.map((tab) => {
                  const Icon = { configuration: FileJson, permissions: ShieldCheck, diagnostics: Stethoscope, backups: Archive }[tab.key];
                  const live = menuValues[tab.key];
                  const testID = `openclaw-manage-tabs-${tab.key}`;
                  return (
                    <SettingsGroup key={tab.key} density="comfortable" testID={`openclaw-manage-card-${tab.key}`}>
                      <SettingsRow
                        testID={testID}
                        layout="column"
                        accessibilityLabel={[tab.label, live?.value, tab.description].filter(Boolean).join(', ')}
                        disabled={!isOpenClawManageTabSupported(support, tab.key)}
                        onPress={() => {
                          setActiveTab(tab.key);
                          setShowMenu(false);
                          setNotice(null);
                          setSheet(null);
                          setSheetError(null);
                        }}
                      >
                        <View style={styles.featureBody}>
                          <View style={styles.featureHead}>
                            <SettingsIcon icon={Icon} tone="neutral" tile="feature" strokeWidth={1.75} />
                            <View style={styles.featureTail}>
                              {live?.attention ? <View testID={`${testID}-attention`} style={styles.featureAttention} /> : null}
                              {live?.value ? <Text style={styles.featureValue} numberOfLines={1}>{live.value}</Text> : null}
                              <ChevronRight size={IconSize.sm} color={theme.colors.inkTertiary} strokeWidth={2} />
                            </View>
                          </View>
                          <View style={styles.featureCopy}>
                            <Text style={styles.featureTitle}>{tab.label}</Text>
                            <Text style={styles.featureDescription}>{tab.description}</Text>
                          </View>
                        </View>
                      </SettingsRow>
                    </SettingsGroup>
                  );
                })}
              </View>
            ) : <>
            {permissionDenied ? (
              <Banner
                testID="openclaw-manage-locked"
                message={t('Pro required for this agent', { ns: 'common' })}
                actionLabel={t('View Pro', { ns: 'common' })}
                onAction={() => onOpenPaywall(paywallFeatureForTab(activeTab))}
              />
            ) : !online ? (
              <Banner
                testID="openclaw-manage-offline"
                message={t('Offline · showing cached settings', { ns: 'config' })}
                actionLabel={t('Retry', { ns: 'common' })}
                onAction={() => { void retry(); }}
              />
            ) : null}
            {hasAccess && errors[activeTab] ? (
              <Banner
                testID="openclaw-manage-error"
                tone="bad"
                message={errors[activeTab] ?? ''}
                actionLabel={t('Retry', { ns: 'common' })}
                onAction={() => { void retry(); }}
              />
            ) : null}
            {hasAccess && notice ? <Text style={styles.notice}>{notice}</Text> : null}
            {hasAccess ? renderSection() : null}
            </>}
          </>
        )}
      </ScrollView>

      <Sheet
        visible={sheet?.kind === 'configuration-edit'}
        testID="openclaw-configuration-editor"
        title={t('Current OpenClaw config')}
        closeAccessibilityLabel={t('Close', { ns: 'common' })}
        onClose={closeSheet}
        dismissOnBackdropPress={!busy}
        snapPoints={CONFIGURATION_EDITOR_SNAP_POINTS}
      >
        <View style={[styles.sheetContent, styles.editorSheet]}>
          {sheetError ? <Banner tone="bad" message={sheetError} /> : null}
          <BottomSheetScrollView
            testID="openclaw-configuration-scroll"
            style={styles.editorScroll}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            <FormTextInput
              testID="openclaw-configuration-input"
              value={configurationDraft}
              onChangeText={setConfigurationDraft}
              multiline
              scrollEnabled={false}
              autoCapitalize="none"
              autoCorrect={false}
              minHeight={ControlSize.settingsRow * 4}
              inputStyle={styles.codeInput}
            />
          </BottomSheetScrollView>
          <View style={styles.actionRow}>
            <Button
              testID="openclaw-configuration-cancel"
              label={t('Cancel', { ns: 'common' })}
              variant="secondary"
              onPress={closeSheet}
              style={styles.actionButton}
            />
            <Button
              testID="openclaw-configuration-review"
              label={t('Save', { ns: 'common' })}
              onPress={reviewConfiguration}
              style={styles.actionButton}
            />
          </View>
        </View>
      </Sheet>

      <Sheet
        visible={sheet?.kind === 'configuration-confirm'}
        testID="openclaw-configuration-confirm"
        title={t('Confirm Save', { ns: 'common' })}
        closeAccessibilityLabel={t('Close', { ns: 'common' })}
        onClose={closeSheet}
        dismissOnBackdropPress={!busy}
      >
        <ConfirmationContent
          testIDPrefix="openclaw-configuration-confirm"
          message={t('This will restart Gateway. Continue?', { ns: 'common' })}
          error={sheetError}
          busy={busy === 'configuration'}
          cancelLabel={t('Cancel', { ns: 'common' })}
          confirmLabel={t('Save', { ns: 'common' })}
          onCancel={closeSheet}
          onConfirm={() => {
            if (sheet?.kind === 'configuration-confirm') {
              void saveConfiguration(sheet.raw);
            }
          }}
        />
      </Sheet>

      <Sheet
        visible={sheet?.kind === 'repair'}
        testID="openclaw-repair-confirm"
        title={t('Repair agent permissions?')}
        closeAccessibilityLabel={t('Close', { ns: 'common' })}
        onClose={closeSheet}
        dismissOnBackdropPress={!busy}
      >
        <ConfirmationContent
          testIDPrefix="openclaw-repair-confirm"
          message={t('This will fully enable command access for the current agent, set command permission level to Full, and set command confirmation mode to Unknown Only. OpenClaw Gateway will restart. Continue?')}
          error={sheetError}
          busy={busy === 'repair'}
          cancelLabel={t('Cancel', { ns: 'common' })}
          confirmLabel={t('Repair Now')}
          onCancel={closeSheet}
          onConfirm={() => {
            if (sheet?.kind === 'repair') void repair(sheet.source);
          }}
        />
      </Sheet>

      <Sheet visible={sheet?.kind === 'delete-backup'} testID="openclaw-backup-delete-confirm"
        title={t('Delete', { ns: 'common' })} onClose={closeSheet} dismissOnBackdropPress={!busy}
        closeAccessibilityLabel={t('Close', { ns: 'common' })}>
        <ConfirmationContent testIDPrefix="openclaw-backup-delete-confirm"
          message={t('Delete this local config backup? This does not change the current Gateway config.')}
          error={sheetError} busy={Boolean(busy?.startsWith('backup-delete:'))}
          cancelLabel={t('Cancel', { ns: 'common' })} confirmLabel={t('Delete', { ns: 'common' })}
          onCancel={closeSheet} onConfirm={() => { if (sheet?.kind === 'delete-backup') void deleteBackup(sheet.backup); }} />
      </Sheet>

      <Sheet
        visible={sheet?.kind === 'restore'}
        testID="openclaw-restore-confirm"
        title={t('Restore Backup')}
        closeAccessibilityLabel={t('Close', { ns: 'common' })}
        onClose={closeSheet}
        dismissOnBackdropPress={!busy}
      >
        <ConfirmationContent
          testIDPrefix="openclaw-restore-confirm"
          message={t('Restore this config backup to OpenClaw? This will replace the current OpenClaw config and restart Gateway.')}
          error={sheetError}
          busy={Boolean(busy?.startsWith('backup-restore:'))}
          cancelLabel={t('Cancel', { ns: 'common' })}
          confirmLabel={t('Restore')}
          onCancel={closeSheet}
          onConfirm={() => {
            if (sheet?.kind !== 'restore') return;
            const { backup } = sheet;
            if (preview) {
              onOpenPaywall('configBackups', () => { void restoreBackup(backup); });
              return;
            }
            void restoreBackup(backup);
          }}
        />
      </Sheet>

      <Sheet
        visible={sheet?.kind === 'approval'}
        testID="openclaw-approval-sheet"
        title={t('Allow exec?', { ns: 'chat' })}
        closeAccessibilityLabel={t('Close', { ns: 'common' })}
        onClose={closeSheet}
        dismissOnBackdropPress={!busy}
      >
        <View style={styles.sheetContent}>
          {sheet?.kind === 'approval' ? (
            <View style={[styles.commandBlock, { backgroundColor: theme.colors.surfaceFloating }]}>
              <Text selectable style={styles.codeInput}>{sheet.approval.command}</Text>
            </View>
          ) : null}
          {sheetError ? <Banner tone="bad" message={sheetError} /> : null}
          <Button
            testID="openclaw-approval-allow-once"
            label={t('Allow', { ns: 'chat' })}
            loading={busy?.startsWith('approval:')}
            onPress={() => {
              if (sheet?.kind === 'approval') {
                void resolveApproval(sheet.approval, 'allow-once');
              }
            }}
          />
          <Button
            testID="openclaw-approval-allow-always"
            label={t('Always', { ns: 'settings' })}
            variant="secondary"
            disabled={Boolean(busy)}
            onPress={() => {
              if (sheet?.kind === 'approval') {
                void resolveApproval(sheet.approval, 'allow-always');
              }
            }}
          />
          <Button
            testID="openclaw-approval-deny"
            label={t('Reject', { ns: 'chat' })}
            variant="destructive"
            disabled={Boolean(busy)}
            onPress={() => {
              if (sheet?.kind === 'approval') {
                void resolveApproval(sheet.approval, 'deny');
              }
            }}
          />
        </View>
      </Sheet>

      <Sheet
        visible={sheet?.kind === 'detail'}
        testID="openclaw-detail-sheet"
        title={sheet?.kind === 'detail' ? sheet.title : undefined}
        closeAccessibilityLabel={t('Close', { ns: 'common' })}
        onClose={closeSheet}
        snapPoints={['93%']}
      >
        <BottomSheetScrollView style={styles.screen} contentContainerStyle={styles.sheetContent}>
          <Text selectable style={styles.detailText}>
            {sheet?.kind === 'detail' ? sheet.body : ''}
          </Text>
          <Button label={t('Done', { ns: 'common' })} onPress={closeSheet} />
        </BottomSheetScrollView>
      </Sheet>
    </View>
  );
}

function ConfirmationContent({
  testIDPrefix,
  message,
  error,
  busy,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
}: Readonly<{
  testIDPrefix: string;
  message: string;
  error: string | null;
  busy: boolean;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}>): React.JSX.Element {
  const { theme } = useAppTheme();
  return (
    <View style={stylesStatic.sheetContent}>
      <Text style={[stylesStatic.confirmationText, { color: theme.colors.ink }]}>
        {message}
      </Text>
      {error ? <Banner tone="bad" message={error} /> : null}
      <View style={stylesStatic.actionRow}>
        <Button
          testID={`${testIDPrefix}-cancel`}
          label={cancelLabel}
          variant="secondary"
          disabled={busy}
          onPress={onCancel}
          style={stylesStatic.actionButton}
        />
        <Button
          testID={`${testIDPrefix}-action`}
          label={confirmLabel}
          loading={busy}
          onPress={onConfirm}
          style={stylesStatic.actionButton}
        />
      </View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    screen: {
      flex: 1,
    },
    header: { backgroundColor: colors.canvasGrouped },
    content: {
      paddingHorizontal: Space.lg,
      paddingTop: Space.md,
      gap: Space.lg,
    },
    contentFill: {
      flexGrow: 1,
    },
    // Feature cards: 12 between cards; inside, 16 of padding (the comfortable row's 12 plus 4),
    // the 44-point tile row with the live value and chevron on its right, 12 down to the name,
    // 4 to the sentence. The two visible sizes are body and secondary.
    menu: { gap: Space.md },
    featureBody: { paddingVertical: Space.xs, gap: Space.md },
    featureHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.md,
    },
    featureTail: {
      flexShrink: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    featureAttention: {
      width: Space.sm,
      height: Space.sm,
      borderRadius: Radius.full,
      backgroundColor: colors.bad,
    },
    featureValue: {
      flexShrink: 1,
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
    },
    featureCopy: { gap: Space.xs },
    featureTitle: {
      color: colors.ink,
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
      fontWeight: FontWeight.semibold,
    },
    featureDescription: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
    },
    notice: {
      color: colors.good,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.semibold,
    },
    sheetContent: {
      paddingHorizontal: Space.lg,
      paddingBottom: Space.xl,
      gap: Space.lg,
    },
    editorSheet: { flex: 1, minHeight: 0 },
    editorScroll: { flex: 1, minHeight: 0 },
    actionRow: {
      flexDirection: 'row',
      gap: Space.sm,
    },
    actionButton: {
      flex: 1,
    },
    codeInput: {
      color: colors.ink,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontFamily: Platform.select({
        ios: 'Menlo',
        android: 'monospace',
        default: 'monospace',
      }),
    },
    commandBlock: {
      minHeight: ControlSize.settingsRow,
      padding: Space.lg,
      justifyContent: 'center',
    },
    detailText: {
      color: colors.ink,
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
    },
  });
}

const stylesStatic = StyleSheet.create({
  sheetContent: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.xl,
    gap: Space.lg,
  },
  confirmationText: {
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
  },
  actionRow: {
    flexDirection: 'row',
    gap: Space.sm,
  },
  actionButton: {
    flex: 1,
  },
});
