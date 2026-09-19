import React, { Fragment, useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type {
  ApprovalRequest,
  Backup,
  ConfigView,
  DoctorResult,
  PermissionsReport,
} from '@clawket/agent-protocol';
import {
  Archive,
  CheckCircle2,
  CircleAlert,
  Code2,
  Globe2,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/ui/Button';
import { JsonValueTree } from '../../components/chat/JsonTree';
import { ProGate } from '../../components/pro/ProGate';
import {
  SettingsDivider,
  SettingsGroup,
  SettingsRow,
} from '../../components/ui/SettingsGroup';
import { LoadingState } from '../../components/ui/LoadingState';
import { SearchInput } from '../../components/ui/SearchInput';
import { SettingsIcon } from '../../components/ui/SettingsIcon';
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
  filterConfigEntries,
  permissionStatusKey,
  type ConfigValuePreview,
} from './openclaw-manage-model';
import { translateAgentSettingsKey } from './translation';

type DetailRequest = Readonly<{
  title: string;
  body: string;
}>;

/**
 * Last-step Pro gate for a management section. `locked` sections still load
 * and show real data; `open` presents the contextual paywall and runs the
 * continuation once entitlement arrives.
 */
export type ManageSectionGate = Readonly<{
  locked: boolean;
  open: (continuation?: () => void) => void;
}>;

export const DIAGNOSTICS_FREE_CHECKS = 2;

export type ConfigurationSectionProps = Readonly<{
  view: ConfigView | null;
  canEdit: boolean;
  online: boolean;
  gate?: ManageSectionGate;
  /** Filters keys by name or serialized value; owned by the screen so it survives the section remount. */
  query: string;
  onQueryChange: (query: string) => void;
  /** Keys whose JSON is open. Several may be open at once; the screen owns the list. */
  expandedKeys: ReadonlyArray<string>;
  onToggleKey: (key: string) => void;
  onEdit: () => void;
}>;

/**
 * The config is a table of contents first (owner request 2026-09-19): one card
 * of top-level keys in file order, each captioned with what it holds, a
 * search capsule above it, and the JSON of an opened key in a `surface` well
 * under its row. Primitives and empty containers show their literal in the
 * caption and do not expand; opened JSON renders through the shared
 * `JsonValueTree` so a 250-line `models` section starts as a few collapsed nodes.
 */
export function ConfigurationSection({
  view,
  canEdit,
  online,
  gate,
  query,
  onQueryChange,
  expandedKeys,
  onToggleKey,
  onEdit,
}: ConfigurationSectionProps): React.JSX.Element {
  const { t } = useTranslation(['config', 'common']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);

  const config = view?.config ?? null;
  const entries = useMemo(
    () => (config ? filterConfigEntries(config, query) : []),
    [config, query],
  );
  const previewText = useCallback((preview: ConfigValuePreview): string => {
    switch (preview.kind) {
      case 'keys': return preview.keys.join(', ');
      case 'count': return t('{{count}} items', { count: preview.count });
      default: return preview.text;
    }
  }, [t]);

  if (!config) {
    return (
      <SectionEmpty
        testID="openclaw-configuration-empty"
        message={t('No config returned from Gateway.')}
      />
    );
  }

  return (
    <View testID="openclaw-configuration-content" style={styles.stack}>
      <SearchInput
        testID="openclaw-configuration-search"
        appearance="quiet"
        value={query}
        onChangeText={onQueryChange}
        placeholder={t('Search config...')}
      />
      {entries.length === 0 ? (
        <SectionEmpty
          testID="openclaw-configuration-no-results"
          message={t('No results', { ns: 'common' })}
        />
      ) : (
        <SettingsGroup testID="openclaw-configuration-keys">
          {entries.map((entry, index) => {
            const expanded = entry.expandable && expandedKeys.includes(entry.key);
            return (
              <Fragment key={entry.key}>
                {index > 0 ? <SettingsDivider inset="content" /> : null}
                <SettingsRow
                  testID={`openclaw-config-key-${entry.key}`}
                  title={entry.key}
                  subtitle={previewText(entry.preview)}
                  showChevron={entry.expandable}
                  expanded={entry.expandable ? expanded : undefined}
                  onPress={entry.expandable ? () => onToggleKey(entry.key) : undefined}
                />
                {expanded ? (
                  <View testID={`openclaw-config-body-${entry.key}`} style={styles.codeWell}>
                    {gate?.locked ? (
                      <ProGate
                        testID={`openclaw-config-gate-${entry.key}`}
                        title={t('Edit OpenClaw config from your phone')}
                        detail={t('View and edit every section, saved with a safe restart.')}
                        actionLabel={t('Unlock full configuration')}
                        surfaceColor={theme.colors.surface}
                        onUnlock={() => gate.open()}
                      >
                        <JsonValueTree value={entry.value} />
                      </ProGate>
                    ) : (
                      <JsonValueTree value={entry.value} />
                    )}
                  </View>
                ) : null}
              </Fragment>
            );
          })}
        </SettingsGroup>
      )}
      {canEdit ? (
        <Button
          testID="openclaw-configuration-edit"
          label={t('Edit', { ns: 'common' })}
          variant="secondary"
          disabled={!online}
          onPress={gate?.locked ? () => gate.open(onEdit) : onEdit}
        />
      ) : (
        <SettingsGroup>
          <SettingsRow
            title={t('Current OpenClaw config')}
            value={t('Read only')}
          />
        </SettingsGroup>
      )}
    </View>
  );
}

export type PermissionsSectionProps = Readonly<{
  report: PermissionsReport | null;
  approvals: ReadonlyArray<Extract<ApprovalRequest, { kind: 'exec' }>>;
  now: number;
  canResolveApprovals: boolean;
  canRepair: boolean;
  online: boolean;
  repairing: boolean;
  gate?: ManageSectionGate;
  onSelectApproval: (approval: Extract<ApprovalRequest, { kind: 'exec' }>) => void;
  onRepair: () => void;
  onShowDetail: (detail: DetailRequest) => void;
}>;

export function PermissionsSection({
  report,
  approvals,
  now,
  canResolveApprovals,
  canRepair,
  online,
  repairing,
  gate,
  onSelectApproval,
  onRepair,
  onShowDetail,
}: PermissionsSectionProps): React.JSX.Element {
  const { t } = useTranslation(['config', 'common', 'settings', 'chat']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);

  if (!report && approvals.length === 0) {
    return (
      <SectionEmpty
        testID="openclaw-permissions-empty"
        message={t('No available settings')}
      />
    );
  }

  const permissionRows = report ? [
    {
      key: 'web',
      title: t('Web Search & Fetch'),
      value: translateAgentSettingsKey(t, permissionStatusKey(report.web.status)),
      icon: Globe2,
      detail: [report.web.summary, ...report.web.reasons].filter(Boolean).join('\n'),
    },
    {
      key: 'exec',
      title: t('Command Execution'),
      value: translateAgentSettingsKey(t, permissionStatusKey(report.exec.status)),
      icon: ShieldCheck,
      detail: [report.exec.summary, ...report.exec.reasons].filter(Boolean).join('\n'),
    },
    {
      key: 'code',
      title: t('Code Execution'),
      value: translateAgentSettingsKey(t, permissionStatusKey(report.codeExecution.status)),
      icon: Code2,
      detail: [report.codeExecution.summary, ...report.codeExecution.reasons]
        .filter(Boolean)
        .join('\n'),
    },
  ] : [];

  return (
    <View testID="openclaw-permissions-content" style={styles.stack}>
      {report ? (
        <>
          <SettingsGroup density="comfortable" testID="openclaw-permission-report">
            {permissionRows.map((row, index) => {
              const Icon = row.icon;
              return (
                <Fragment key={row.key}>
                  {index ? <SettingsDivider inset="content" /> : null}
                  <SettingsRow
                    testID={`openclaw-permission-${row.key}`}
                    title={row.title}
                    value={row.value}
                    leading={<SettingsIcon icon={Icon} tone="neutral" size={20} strokeWidth={1.75} />}
                    showChevron={Boolean(row.detail)}
                    onPress={row.detail
                      ? () => {
                        const showDetail = () => onShowDetail({ title: row.title, body: row.detail });
                        if (gate?.locked) gate.open(showDetail);
                        else showDetail();
                      }
                      : undefined}
                  />
                </Fragment>
              );
            })}
          </SettingsGroup>
          {gate?.locked ? (
            <ProGate
              testID="openclaw-permissions-gate"
              title={t('Repair permissions in one tap')}
              detail={t('See why web, commands and code are blocked, then fix them.')}
              actionLabel={t('Unlock permission details')}
              onUnlock={() => gate.open()}
            >
              <PermissionRules report={report} />
            </ProGate>
          ) : (
            <PermissionRules report={report} />
          )}
          {canRepair ? (
            <Button
              testID="openclaw-permissions-repair"
              label={t('Repair Now')}
              variant="secondary"
              loading={repairing}
              disabled={!online}
              onPress={gate?.locked ? () => gate.open(onRepair) : onRepair}
            />
          ) : null}
        </>
      ) : null}

      {approvals.length > 0 ? <View style={styles.subsection}>
        <Text style={styles.sectionTitle}>{t('Pending Requests', { ns: 'settings' })}</Text>
          <SettingsGroup density="comfortable" testID="openclaw-approvals-list">
            {approvals.map((approval, index) => {
              const expired = approval.expiresAtMs <= now;
              return (
                <Fragment key={approval.id}>
                  {index ? <SettingsDivider inset="content" /> : null}
                  <SettingsRow
                    testID={`openclaw-approval-${approval.id}`}
                    title={approval.command}
                    value={expired ? t('Expired', { ns: 'chat' }) : undefined}
                    attention={!expired}
                    showChevron={!expired && canResolveApprovals}
                    disabled={expired || !online || !canResolveApprovals}
                    onPress={() => onSelectApproval(approval)}
                  />
                </Fragment>
              );
            })}
          </SettingsGroup>
      </View> : null}
    </View>
  );
}

function PermissionRules({ report }: Readonly<{ report: PermissionsReport }>): React.JSX.Element {
  const { t } = useTranslation(['config', 'common']);
  return (
    <SettingsGroup density="comfortable" testID="openclaw-permission-rules">
      <SettingsRow
        title={t('Command permission level')}
        value={securityLabel(report.exec.effectiveSecurity, t)}
      />
      <SettingsDivider inset="content" />
      <SettingsRow
        title={t('Current confirmation')}
        value={confirmationLabel(report.exec.effectiveAsk, t)}
      />
    </SettingsGroup>
  );
}

export type DiagnosticsSectionProps = Readonly<{
  result: DoctorResult | null;
  canRepair: boolean;
  online: boolean;
  repairing: boolean;
  gate?: ManageSectionGate;
  onDiagnose: () => void;
  onRepair: () => void;
  onShowDetail: (detail: DetailRequest) => void;
}>;

export function DiagnosticsSection({
  result,
  canRepair,
  online,
  repairing,
  gate,
  onDiagnose,
  onRepair,
  onShowDetail,
}: DiagnosticsSectionProps): React.JSX.Element {
  const { t } = useTranslation(['config', 'common']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const checks = result?.checks ?? [];
  const visibleChecks = gate?.locked ? checks.slice(0, DIAGNOSTICS_FREE_CHECKS) : checks;
  const hiddenChecks = gate?.locked ? checks.slice(DIAGNOSTICS_FREE_CHECKS) : [];

  if (!result) {
    return (
      <View style={styles.stack}>
        <Button
          testID="openclaw-diagnostics-run"
          label={t('Diagnose')}
          disabled={!online}
          onPress={onDiagnose}
        />
      </View>
    );
  }

  return (
    <View testID="openclaw-diagnostics-content" style={styles.stack}>
      <View style={styles.summaryRow}>
        {result.ok ? (
          <CheckCircle2
            size={IconSize.md}
            color={theme.colors.good}
            strokeWidth={2}
          />
        ) : (
          <CircleAlert
            size={IconSize.md}
            color={theme.colors.bad}
            strokeWidth={2}
          />
        )}
        <Text
          style={[
            styles.summaryText,
            { color: result.ok ? theme.colors.good : theme.colors.bad },
          ]}
        >
          {result.ok ? t('All checks passed') : t('Issues detected')}
        </Text>
      </View>
      {result.summary ? <Text style={styles.detailText}>{result.summary}</Text> : null}
      {visibleChecks.length ? (
        <DiagnosticChecks
          testID="openclaw-diagnostics-checks"
          checks={visibleChecks}
          onShowDetail={onShowDetail}
        />
      ) : null}
      {hiddenChecks.length ? (
        <ProGate
          testID="openclaw-diagnostics-gate"
          title={t('{{total}} more checks', { total: hiddenChecks.length })}
          detail={t('Read every finding and attempt an automatic fix.')}
          actionLabel={t('Unlock full diagnostics')}
          onUnlock={() => gate?.open()}
        >
          <DiagnosticChecks
            testID="openclaw-diagnostics-hidden-checks"
            checks={hiddenChecks}
            indexOffset={visibleChecks.length}
            onShowDetail={onShowDetail}
          />
        </ProGate>
      ) : null}
      {result.raw ? (
        <SettingsGroup density="comfortable">
          <SettingsRow title={t('Details', { ns: 'chat' })} showChevron
            testID="openclaw-diagnostics-details"
            leading={<SettingsIcon icon={Code2} tone="neutral" size={20} strokeWidth={1.75} />}
            locked={gate?.locked}
            onPress={() => {
              const showRaw = () => onShowDetail({ title: t('Diagnostics'), body: result.raw ?? '' });
              if (gate?.locked) gate.open(showRaw);
              else showRaw();
            }} />
        </SettingsGroup>
      ) : null}
      <View style={styles.buttonRow}>
        <Button
          testID="openclaw-diagnostics-run"
          label={t('Diagnose')}
          variant="secondary"
          disabled={!online || repairing}
          onPress={onDiagnose}
          style={styles.buttonGrow}
        />
        {canRepair ? (
          <Button
            testID="openclaw-diagnostics-repair"
            label={t('Attempt Fix')}
            loading={repairing}
            disabled={!online}
            onPress={gate?.locked ? () => gate.open(onRepair) : onRepair}
            style={styles.buttonGrow}
          />
        ) : null}
      </View>
    </View>
  );
}

function DiagnosticChecks({
  checks,
  indexOffset = 0,
  testID,
  onShowDetail,
}: Readonly<{
  checks: DoctorResult['checks'];
  indexOffset?: number;
  testID: string;
  onShowDetail: (detail: DetailRequest) => void;
}>): React.JSX.Element {
  const { t } = useTranslation(['config', 'common']);
  return (
    <SettingsGroup density="comfortable" testID={testID}>
      {checks.map((check, offset) => {
        const index = indexOffset + offset;
        return (
          <Fragment key={`${check.name}-${index}`}>
            {offset ? <SettingsDivider inset="content" /> : null}
            <SettingsRow
              testID={`openclaw-diagnostic-check-${index}`}
              title={check.name}
              value={diagnosticStatusLabel(check.status, t)}
              leading={diagnosticIcon(check.status)}
              showChevron={Boolean(check.message)}
              onPress={check.message
                ? () => onShowDetail({ title: check.name, body: check.message ?? '' })
                : undefined}
            />
          </Fragment>
        );
      })}
    </SettingsGroup>
  );
}

export type BackupsSectionProps = Readonly<{
  backups: ReadonlyArray<Backup> | null;
  canCreate: boolean;
  canRestore: boolean;
  online: boolean;
  busy: boolean;
  gate?: ManageSectionGate;
  onCreate: () => void;
  onSelectBackup: (backup: Backup) => void;
  onDeleteBackup?: (backup: Backup) => void;
}>;

export function BackupsSection({
  backups,
  canCreate,
  canRestore,
  online,
  busy,
  gate,
  onCreate,
  onSelectBackup,
  onDeleteBackup,
}: BackupsSectionProps): React.JSX.Element {
  const { t, i18n } = useTranslation(['config', 'common']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const formatDate = useCallback((createdAt: number) => new Intl.DateTimeFormat(
    i18n.language,
    { dateStyle: 'medium', timeStyle: 'short' },
  ).format(new Date(createdAt)), [i18n.language]);

  return (
    <View testID="openclaw-backups-content" style={stylesStatic.stack}>
      <SettingsGroup density="comfortable" testID="openclaw-backups-intro">
        <View style={styles.introRow}>
          <SettingsIcon icon={Archive} tone="neutral" size={20} strokeWidth={1.75} />
          <Text style={styles.introText}>
            {t('Keeps a copy of the current OpenClaw config on this phone, so a bad change is one tap from undone.')}
          </Text>
        </View>
      </SettingsGroup>
      {canCreate ? (
        <Button
          testID="openclaw-backup-create"
          label={busy ? t('Creating backup...') : t('Create backup')}
          loading={busy}
          disabled={!online}
          onPress={gate?.locked ? () => gate.open(onCreate) : onCreate}
        />
      ) : null}
      {backups?.length ? (
        <SettingsGroup density="comfortable" testID="openclaw-backups-list">
          {backups.map((backup, index) => (
            <Fragment key={backup.id}>
              {index ? <SettingsDivider inset="content" /> : null}
              <SettingsRow
                testID={`openclaw-backup-${backup.id}`}
                title={formatDate(backup.createdAt)}
                value={canRestore ? t('Restore') : t('Read only')}
                showChevron={canRestore}
                disabled={!online || busy || !canRestore}
                onPress={() => onSelectBackup(backup)}
              />
              {onDeleteBackup ? <SettingsRow
                testID={`openclaw-backup-delete-${backup.id}`}
                title={t('Delete', { ns: 'common' })}
                destructive
                disabled={busy}
                onPress={() => onDeleteBackup(backup)}
              /> : null}
            </Fragment>
          ))}
        </SettingsGroup>
      ) : (
        <SectionEmpty
          testID="openclaw-backups-empty"
          message={t('No restore points yet. Create one before editing.')}
        />
      )}
    </View>
  );
}

export function ManageSectionLoading({ diagnostics = false }: { diagnostics?: boolean }): React.JSX.Element {
  const { t } = useTranslation(['config', 'common']);
  return <LoadingState testID="openclaw-manage-loading"
    message={diagnostics ? t('Running diagnostics…') : t('Loading settings')} />;
}

export function SectionEmpty({
  message,
  testID,
}: Readonly<{ message: string; testID?: string }>): React.JSX.Element {
  const { theme } = useAppTheme();
  return (
    <View testID={testID} style={stylesStatic.empty}>
      <Text style={[stylesStatic.emptyText, { color: theme.colors.inkSecondary }]}>
        {message}
      </Text>
    </View>
  );
}

function securityLabel(
  security: PermissionsReport['exec']['effectiveSecurity'],
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (security === 'deny') return t('Deny');
  if (security === 'allowlist') return t('Allowlist');
  return t('Full');
}

function confirmationLabel(
  confirmation: PermissionsReport['exec']['effectiveAsk'],
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (confirmation === 'always') return t('Every Command');
  if (confirmation === 'on-miss') return t('Unknown Only');
  return t('Never');
}

function diagnosticStatusLabel(
  status: string,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (status === 'pass') return t('Available');
  if (status === 'skip') return t('Not set');
  if (status === 'warn' || status === 'fail') return t('Issues detected');
  return status;
}

function diagnosticIcon(status: string): React.JSX.Element {
  return <SettingsIcon
    icon={status === 'pass' ? CheckCircle2 : status === 'warn' ? TriangleAlert : CircleAlert}
    tone={status === 'pass' ? 'success' : status === 'warn' ? 'warning' : 'danger'}
    size={20} strokeWidth={1.75} />;
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    stack: {
      gap: Space.lg,
    },
    subsection: {
      gap: Space.sm,
    },
    sectionTitle: {
      color: colors.ink,
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
      fontWeight: FontWeight.semibold,
    },
    // The opened JSON sits in a quiet well under its row: the grey belongs to
    // the content, not to the header (owner feedback 2026-09-19: the inset
    // `selected` fill on the row read as a misaligned patch).
    codeWell: {
      marginHorizontal: Space.lg,
      marginBottom: Space.lg,
      padding: Space.md,
      borderRadius: Radius.settingsGroup,
      backgroundColor: colors.surface,
      overflow: 'hidden',
    },
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    introRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Space.md,
      paddingHorizontal: Space.lg,
      paddingVertical: Space.lg,
    },
    introText: {
      flex: 1,
      color: colors.inkSecondary,
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
    },
    summaryText: {
      flex: 1,
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
      fontWeight: FontWeight.semibold,
    },
    detailText: {
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
    },
    buttonRow: {
      flexDirection: 'row',
      gap: Space.sm,
    },
    buttonGrow: {
      flex: 1,
    },
  });
}

const stylesStatic = StyleSheet.create({
  stack: {
    gap: Space.lg,
  },
  empty: {
    minHeight: ControlSize.settingsRow * 2,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Space.xl,
  },
  emptyText: {
    textAlign: 'center',
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
  },
});
