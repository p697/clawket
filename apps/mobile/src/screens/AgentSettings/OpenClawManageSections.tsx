import React, { Fragment, useCallback, useMemo } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import type {
  ApprovalRequest,
  Backup,
  ConfigView,
  DoctorResult,
  PermissionsReport,
} from '@clawket/agent-protocol';
import {
  CheckCircle2,
  CircleAlert,
  Code2,
  Globe2,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/ui/Button';
import {
  SettingsDivider,
  SettingsGroup,
  SettingsRow,
} from '../../components/ui/SettingsGroup';
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
} from '../../theme/tokens';
import { permissionStatusKey } from './openclaw-manage-model';
import { translateAgentSettingsKey } from './translation';

const MONOSPACE_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

type DetailRequest = Readonly<{
  title: string;
  body: string;
}>;

export type ConfigurationSectionProps = Readonly<{
  view: ConfigView | null;
  canEdit: boolean;
  online: boolean;
  onEdit: () => void;
}>;

export function ConfigurationSection({
  view,
  canEdit,
  online,
  onEdit,
}: ConfigurationSectionProps): React.JSX.Element {
  const { t } = useTranslation(['config', 'common']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);

  if (!view?.config) {
    return (
      <SectionEmpty
        testID="openclaw-configuration-empty"
        message={t('No config returned from Gateway.')}
      />
    );
  }

  return (
    <View testID="openclaw-configuration-content" style={styles.stack}>
      <View style={styles.codeBlock}>
        <Text selectable style={styles.codeText}>
          {JSON.stringify(view.config, null, 2)}
        </Text>
      </View>
      {canEdit ? (
        <Button
          testID="openclaw-configuration-edit"
          label={t('common:Edit')}
          variant="secondary"
          disabled={!online}
          onPress={onEdit}
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
          <SettingsGroup testID="openclaw-permission-report">
            {permissionRows.map((row, index) => {
              const Icon = row.icon;
              return (
                <Fragment key={row.key}>
                  {index ? <SettingsDivider inset="content" /> : null}
                  <SettingsRow
                    testID={`openclaw-permission-${row.key}`}
                    title={row.title}
                    value={row.value}
                    leading={(
                      <Icon
                        size={IconSize.sm}
                        color={theme.colors.inkSecondary}
                        strokeWidth={2}
                      />
                    )}
                    showChevron={Boolean(row.detail)}
                    onPress={row.detail
                      ? () => onShowDetail({ title: row.title, body: row.detail })
                      : undefined}
                  />
                </Fragment>
              );
            })}
          </SettingsGroup>
          <SettingsGroup testID="openclaw-permission-rules">
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
          {canRepair ? (
            <Button
              testID="openclaw-permissions-repair"
              label={t('Repair Now')}
              variant="secondary"
              loading={repairing}
              disabled={!online}
              onPress={onRepair}
            />
          ) : null}
        </>
      ) : null}

      <View style={styles.subsection}>
        <Text style={styles.sectionTitle}>{t('Pending Requests', { ns: 'settings' })}</Text>
        {approvals.length ? (
          <SettingsGroup testID="openclaw-approvals-list">
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
        ) : (
          <SectionEmpty
            testID="openclaw-approvals-empty"
            message={t('No available settings')}
          />
        )}
      </View>
    </View>
  );
}

export type DiagnosticsSectionProps = Readonly<{
  result: DoctorResult | null;
  canRepair: boolean;
  online: boolean;
  repairing: boolean;
  onDiagnose: () => void;
  onRepair: () => void;
  onShowDetail: (detail: DetailRequest) => void;
}>;

export function DiagnosticsSection({
  result,
  canRepair,
  online,
  repairing,
  onDiagnose,
  onRepair,
  onShowDetail,
}: DiagnosticsSectionProps): React.JSX.Element {
  const { t } = useTranslation(['config', 'common']);
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);

  if (!result) {
    return (
      <View style={styles.stack}>
        <SectionEmpty
          testID="openclaw-diagnostics-empty"
          message={t('No available settings')}
        />
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
      {result.checks.length ? (
        <SettingsGroup testID="openclaw-diagnostics-checks">
          {result.checks.map((check, index) => (
            <Fragment key={`${check.name}-${index}`}>
              {index ? <SettingsDivider inset="content" /> : null}
              <SettingsRow
                testID={`openclaw-diagnostic-check-${index}`}
                title={check.name}
                value={diagnosticStatusLabel(check.status, t)}
                leading={diagnosticIcon(check.status, theme.colors)}
                showChevron={Boolean(check.message)}
                onPress={check.message
                  ? () => onShowDetail({ title: check.name, body: check.message ?? '' })
                  : undefined}
              />
            </Fragment>
          ))}
        </SettingsGroup>
      ) : null}
      {result.raw ? (
        <View style={styles.codeBlock}>
          <Text selectable style={styles.codeText}>{result.raw}</Text>
        </View>
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
            onPress={onRepair}
            style={styles.buttonGrow}
          />
        ) : null}
      </View>
    </View>
  );
}

export type BackupsSectionProps = Readonly<{
  backups: ReadonlyArray<Backup> | null;
  canCreate: boolean;
  canRestore: boolean;
  online: boolean;
  busy: boolean;
  onCreate: () => void;
  onSelectBackup: (backup: Backup) => void;
}>;

export function BackupsSection({
  backups,
  canCreate,
  canRestore,
  online,
  busy,
  onCreate,
  onSelectBackup,
}: BackupsSectionProps): React.JSX.Element {
  const { t, i18n } = useTranslation(['config', 'common']);
  const formatDate = useCallback((createdAt: number) => new Intl.DateTimeFormat(
    i18n.language,
    { dateStyle: 'medium', timeStyle: 'short' },
  ).format(new Date(createdAt)), [i18n.language]);

  return (
    <View testID="openclaw-backups-content" style={stylesStatic.stack}>
      {canCreate ? (
        <Button
          testID="openclaw-backup-create"
          label={busy ? t('Creating backup...') : t('common:Create')}
          loading={busy}
          disabled={!online}
          onPress={onCreate}
        />
      ) : null}
      {backups?.length ? (
        <SettingsGroup testID="openclaw-backups-list">
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
            </Fragment>
          ))}
        </SettingsGroup>
      ) : (
        <SectionEmpty
          testID="openclaw-backups-empty"
          message={t('No backups yet')}
        />
      )}
    </View>
  );
}

export function ManageSectionLoading(): React.JSX.Element {
  return (
    <View testID="openclaw-manage-loading" style={stylesStatic.stack}>
      <Skeleton style={stylesStatic.skeletonControl} />
      <Skeleton style={stylesStatic.skeletonGroup} />
      <Skeleton style={stylesStatic.skeletonGroup} />
    </View>
  );
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

function diagnosticIcon(
  status: string,
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
): React.JSX.Element {
  if (status === 'pass') {
    return <CheckCircle2 size={IconSize.sm} color={colors.good} strokeWidth={2} />;
  }
  if (status === 'warn') {
    return <TriangleAlert size={IconSize.sm} color={colors.warn} strokeWidth={2} />;
  }
  return <CircleAlert size={IconSize.sm} color={colors.bad} strokeWidth={2} />;
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
    codeBlock: {
      borderRadius: Radius.card,
      backgroundColor: colors.surfaceFloating,
      padding: Space.lg,
      overflow: 'hidden',
    },
    codeText: {
      color: colors.ink,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontFamily: MONOSPACE_FONT,
    },
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
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
  skeletonControl: {
    minHeight: ControlSize.floatingButton,
  },
  skeletonGroup: {
    minHeight: ControlSize.settingsRow * 2,
  },
});
