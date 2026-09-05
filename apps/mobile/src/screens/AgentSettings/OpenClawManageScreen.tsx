import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { ChevronLeft } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { FloatingButton } from '../../components/ui/FloatingButton';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import { Sheet } from '../../components/ui/Sheet';
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
  BackupsSection,
  ConfigurationSection,
  DiagnosticsSection,
  ManageSectionLoading,
  PermissionsSection,
  SectionEmpty,
} from './OpenClawManageSections';
import {
  isOpenClawManageTabSupported,
  managementErrorDetail,
  managementErrorKey,
  normalizeConfigDraft,
  resolveOpenClawManageSupport,
  serializeConfigView,
  type OpenClawManageTab,
} from './openclaw-manage-model';
import { translateAgentSettingsKey } from './translation';

type ExecApproval = Extract<ApprovalRequest, { kind: 'exec' }>;
type FlagMap = Record<OpenClawManageTab, boolean>;
type ErrorMap = Record<OpenClawManageTab, string | null>;

type ManageSheet =
  | Readonly<{ kind: 'configuration-edit' }>
  | Readonly<{ kind: 'configuration-confirm'; raw: string }>
  | Readonly<{ kind: 'repair'; source: 'permissions' | 'diagnostics' }>
  | Readonly<{ kind: 'approval'; approval: ExecApproval }>
  | Readonly<{ kind: 'restore'; backup: Backup }>
  | Readonly<{ kind: 'detail'; title: string; body: string }>
  | null;

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
  onOpenPaywall: (reason: 'openclawManagement') => void;
}>;

export function OpenClawManageScreen({
  adapter,
  isPro,
  permissionDenied = false,
  initialTab = 'configuration',
  onBack,
  onOpenPaywall,
}: OpenClawManageScreenProps): React.JSX.Element {
  const { t } = useTranslation(['config', 'common', 'settings', 'chat']);
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const support = useMemo(() => resolveOpenClawManageSupport(adapter), [adapter]);
  const hasAccess = isPro && !permissionDenied;
  const [activeTab, setActiveTab] = useState<OpenClawManageTab>(initialTab);
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
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const adapterLoadEpoch = useRef(0);
  const tabLoadIds = useRef<Record<OpenClawManageTab, number>>({
    configuration: 0,
    permissions: 0,
    diagnostics: 0,
    backups: 0,
  });
  const online = connectionState === 'ready';

  const tabs = useMemo(() => [
    { key: 'configuration' as const, label: t('Configuration', { ns: 'settings' }) },
    { key: 'permissions' as const, label: t('Permissions') },
    { key: 'diagnostics' as const, label: t('Diagnostics') },
    { key: 'backups' as const, label: t('Backups') },
  ], [t]);

  const translateError = useCallback((error: unknown, fallback: string) => {
    const key = managementErrorKey(error);
    return key ? translateAgentSettingsKey(t, key) : managementErrorDetail(error, fallback);
  }, [t]);

  const loadTab = useCallback(async (tab: OpenClawManageTab) => {
    if (!hasAccess || !online || !isOpenClawManageTabSupported(support, tab)) return;
    const loadEpoch = adapterLoadEpoch.current;
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
          const next = await config.permissions();
          if (!isCurrentLoad()) return;
          setPermissions(next);
        }
      } else if (tab === 'diagnostics' && support.diagnostics && config?.doctor) {
        const next = await config.doctor();
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
    if (!loaded[activeTab] && !loading[activeTab]) void loadTab(activeTab);
  }, [activeTab, loadTab, loaded, loading]);

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
      setSheetError(t('common:Save Failed'));
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
      if (!result.ok) throw new Error(t('common:Save Failed'));
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      setConfiguration({ config: result.config ?? parsed, hash: null });
      setLoaded((current) => ({ ...current, configuration: false }));
      setNotice(t('common:Saved'));
      setSheet(null);
      if (adapter.state === 'ready') await loadTab('configuration');
    } catch (error: unknown) {
      setSheetError(translateError(error, t('common:Save Failed')));
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
      analyticsEvents.chatExecApprovalResolved({
        decision,
        source: 'openclaw_management',
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
      setNotice(t('common:Saved'));
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
    if (loading[activeTab] && !loaded[activeTab]) return <ManageSectionLoading />;
    if (!loaded[activeTab]) {
      return online || errors[activeTab]
        ? null
        : <SectionEmpty testID="openclaw-manage-offline-empty" message={t('common:Offline')} />;
    }
    if (activeTab === 'configuration') {
      return (
        <ConfigurationSection
          view={configuration}
          canEdit={support.configurationWrite}
          online={online}
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
        online={online}
        busy={Boolean(busy)}
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
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <View style={styles.headerSide}>
          <FloatingButton
            testID="openclaw-manage-back"
            icon={ChevronLeft}
            appearance="quiet"
            accessibilityLabel={t('common:Back')}
            onPress={onBack}
          />
        </View>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t('common:OpenClaw management')}
        </Text>
        <View style={styles.headerSide} />
      </View>

      <ScrollView
        automaticallyAdjustContentInsets={false}
        contentContainerStyle={[
          styles.content,
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
        ) : !hasAccess ? (
          <Banner
            testID="openclaw-manage-locked"
            message={t('common:Pro required for this agent')}
            actionLabel={t('common:View Pro')}
            onAction={() => onOpenPaywall('openclawManagement')}
          />
        ) : (
          <>
            <SegmentedTabs
              testID="openclaw-manage-tabs"
              tabs={tabs}
              active={activeTab}
              onSwitch={(tab) => {
                setActiveTab(tab);
                setNotice(null);
                setSheet(null);
                setSheetError(null);
              }}
              size="sm"
            />
            {!online ? (
              <Banner
                testID="openclaw-manage-offline"
                message={t('Offline · showing cached settings', { ns: 'config' })}
                actionLabel={t('common:Retry')}
                onAction={() => { void retry(); }}
              />
            ) : null}
            {errors[activeTab] ? (
              <Banner
                testID="openclaw-manage-error"
                tone="bad"
                message={errors[activeTab] ?? ''}
                actionLabel={t('common:Retry')}
                onAction={() => { void retry(); }}
              />
            ) : null}
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}
            {renderSection()}
          </>
        )}
      </ScrollView>

      <Sheet
        visible={sheet?.kind === 'configuration-edit'}
        testID="openclaw-configuration-editor"
        title={t('Current OpenClaw config')}
        closeAccessibilityLabel={t('common:Close')}
        onClose={closeSheet}
        dismissOnBackdropPress={!busy}
      >
        <View style={styles.sheetContent}>
          {sheetError ? <Banner tone="bad" message={sheetError} /> : null}
          <FormTextInput
            testID="openclaw-configuration-input"
            value={configurationDraft}
            onChangeText={setConfigurationDraft}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            minHeight={ControlSize.settingsRow * 4}
            inputStyle={styles.codeInput}
          />
          <View style={styles.actionRow}>
            <Button
              testID="openclaw-configuration-cancel"
              label={t('common:Cancel')}
              variant="secondary"
              onPress={closeSheet}
              style={styles.actionButton}
            />
            <Button
              testID="openclaw-configuration-review"
              label={t('common:Save')}
              onPress={reviewConfiguration}
              style={styles.actionButton}
            />
          </View>
        </View>
      </Sheet>

      <Sheet
        visible={sheet?.kind === 'configuration-confirm'}
        testID="openclaw-configuration-confirm"
        title={t('common:Confirm Save')}
        closeAccessibilityLabel={t('common:Close')}
        onClose={closeSheet}
        dismissOnBackdropPress={!busy}
      >
        <ConfirmationContent
          testIDPrefix="openclaw-configuration-confirm"
          message={t('common:This will restart Gateway. Continue?')}
          error={sheetError}
          busy={busy === 'configuration'}
          cancelLabel={t('common:Cancel')}
          confirmLabel={t('common:Save')}
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
        closeAccessibilityLabel={t('common:Close')}
        onClose={closeSheet}
        dismissOnBackdropPress={!busy}
      >
        <ConfirmationContent
          testIDPrefix="openclaw-repair-confirm"
          message={t('This will fully enable command access for the current agent, set command permission level to Full, and set command confirmation mode to Unknown Only. OpenClaw Gateway will restart. Continue?')}
          error={sheetError}
          busy={busy === 'repair'}
          cancelLabel={t('common:Cancel')}
          confirmLabel={t('Repair Now')}
          onCancel={closeSheet}
          onConfirm={() => {
            if (sheet?.kind === 'repair') void repair(sheet.source);
          }}
        />
      </Sheet>

      <Sheet
        visible={sheet?.kind === 'restore'}
        testID="openclaw-restore-confirm"
        title={t('Restore Backup')}
        closeAccessibilityLabel={t('common:Close')}
        onClose={closeSheet}
        dismissOnBackdropPress={!busy}
      >
        <ConfirmationContent
          testIDPrefix="openclaw-restore-confirm"
          message={t('Restore this config backup to OpenClaw? This will replace the current OpenClaw config and restart Gateway.')}
          error={sheetError}
          busy={Boolean(busy?.startsWith('backup-restore:'))}
          cancelLabel={t('common:Cancel')}
          confirmLabel={t('Restore')}
          onCancel={closeSheet}
          onConfirm={() => {
            if (sheet?.kind === 'restore') void restoreBackup(sheet.backup);
          }}
        />
      </Sheet>

      <Sheet
        visible={sheet?.kind === 'approval'}
        testID="openclaw-approval-sheet"
        title={t('Allow exec?', { ns: 'chat' })}
        closeAccessibilityLabel={t('common:Close')}
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
        closeAccessibilityLabel={t('common:Close')}
        onClose={closeSheet}
      >
        <View style={styles.sheetContent}>
          <Text selectable style={styles.detailText}>
            {sheet?.kind === 'detail' ? sheet.body : ''}
          </Text>
          <Button label={t('common:Done')} onPress={closeSheet} />
        </View>
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
    header: {
      minHeight: ControlSize.settingsRow,
      paddingHorizontal: Space.lg,
      paddingBottom: Space.sm,
      flexDirection: 'row',
      alignItems: 'flex-end',
    },
    headerSide: {
      width: ControlSize.floatingButton,
      minHeight: ControlSize.floatingButton,
      justifyContent: 'center',
    },
    headerTitle: {
      flex: 1,
      alignSelf: 'center',
      color: colors.ink,
      fontSize: FontSize.title,
      lineHeight: LineHeight.title,
      fontWeight: FontWeight.semibold,
      textAlign: 'center',
      paddingHorizontal: Space.sm,
    },
    content: {
      paddingHorizontal: Space.lg,
      paddingTop: Space.md,
      gap: Space.lg,
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
