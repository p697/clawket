import React, { Fragment, useCallback, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner } from '../../components/ui/Banner';
import { ConnectionStatusPill } from '../../components/ui/ConnectionStatusPill';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { AccountSettingsPageHeader } from './AccountSettingsPageHeader';
import { AccountProCard } from './AccountProCard';
import { AccountSettingsRowIcon, accountSettingsRowHasIcon } from './AccountSettingsRowIcon';
import {
  SettingsDivider,
  SettingsGroup,
  SettingsRow,
} from '../../components/ui/SettingsGroup';
import { ListSkeleton } from '../../components/ui/ListSkeleton';
import { ThemedSwitch } from '../../components/ui/ThemedSwitch';
import { useAppTheme } from '../../theme';
import {
  FontSize,
  FontWeight,
  LineHeight,
  Space,
} from '../../theme/tokens';
import type { AccountSettingsPageStatus } from './model';
import {
  buildAccountSettingsSectionModel,
  type AccountSettingsSectionAction,
  type AccountSettingsDetailSection,
  type AccountSettingsSectionActionRequest,
  type AccountSettingsSectionCapabilities,
  type AccountSettingsSectionData,
  type AccountSettingsSectionGroup,
  type AccountSettingsSectionLabels,
  type AccountSettingsSectionRow,
} from './section-model';
import { translateAccountSettingsKey } from './translation';

export type AccountSettingsSectionScreenProps = Readonly<{
  section: AccountSettingsDetailSection;
  status?: AccountSettingsPageStatus;
  data?: AccountSettingsSectionData;
  capabilities?: Partial<AccountSettingsSectionCapabilities>;
  onBack: () => void;
  onRetry?: () => void;
  onAction: (request: AccountSettingsSectionActionRequest) => void;
  onOpenPaywall: (
    reason: Extract<AccountSettingsPageStatus, { kind: 'permission' }>['reason'],
    onContinue?: () => void,
  ) => void;
}>;

type SectionGroupViewProps = Readonly<{
  group: AccountSettingsSectionGroup;
  data: AccountSettingsSectionData;
  onAction: AccountSettingsSectionScreenProps['onAction'];
  onOpenPaywall: AccountSettingsSectionScreenProps['onOpenPaywall'];
}>;

const SECTION_SKELETONS = Object.freeze(['one', 'two', 'three']);

function resolveRowTitle(
  row: AccountSettingsSectionRow,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  return row.title ?? (row.titleKey
    ? translateAccountSettingsKey(t, row.titleKey, row.titleNamespace ?? 'config')
    : '');
}

function resolveRowValue(
  row: AccountSettingsSectionRow,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | undefined {
  return row.value ?? (row.valueKey
    ? translateAccountSettingsKey(t, row.valueKey, row.valueNamespace ?? 'config')
    : undefined);
}

function SectionGroupView({
  group,
  data,
  onAction,
  onOpenPaywall,
}: SectionGroupViewProps): React.JSX.Element {
  const { t } = useTranslation('config');
  const { theme } = useAppTheme();
  // Preference pickers (theme, app icon, app language) live on the settings home page.
  const openAvailableRow = (row: AccountSettingsSectionRow) => {
    if (row.action) onAction({ action: row.action });
  };
  const openRow = (row: AccountSettingsSectionRow) => {
    if (row.disabled) return;
    if (row.locked) {
      onOpenPaywall(
        row.paywallReason ?? 'generic',
        row.action ? () => openAvailableRow(row) : undefined,
      );
      return;
    }
    openAvailableRow(row);
  };

  return (
    <View testID={`account-settings-section-group-${group.id}`} style={styles.groupSection}>
      {group.title || group.titleKey ? (
        <Text style={[styles.groupTitle, { color: theme.colors.inkSecondary }]}>
          {group.title ?? translateAccountSettingsKey(t, group.titleKey ?? '')}
        </Text>
      ) : null}
      {group.id === 'pro' && group.rows[0]?.id === 'pro-status' ? (
        <AccountProCard testID="account-settings-section-row-pro-status"
          title={resolveRowTitle(group.rows[0], t)} status={resolveRowValue(group.rows[0], t) ?? ''}
          onPress={() => openRow(group.rows[0])} />
      ) : null}
      <SettingsGroup density="comfortable">
        {group.rows.filter((row) => row.id !== 'pro-status').map((row, index) => {
          const title = resolveRowTitle(row, t);
          const toggleValue = row.toggle === 'simulateFreeAccount'
            ? data.simulateFreeAccount === true
            : data.debugMode === true;
          return (
            <Fragment key={row.id}>
              {index > 0 ? <SettingsDivider inset={accountSettingsRowHasIcon(row) ? "icon" : "content"} /> : null}
              <SettingsRow
                testID={`account-settings-section-row-${row.id}`}
                title={title}
                leading={accountSettingsRowHasIcon(row) ? <AccountSettingsRowIcon row={row} /> : undefined}
                destructive={row.action === 'reset-device'}
                value={resolveRowValue(row, t)}
                locked={row.locked}
                disabled={row.disabled}
                showChevron={row.kind === 'navigation' && !row.locked && !row.disabled}
                onPress={row.kind === 'navigation' ? () => openRow(row) : undefined}
                trailing={row.kind === 'toggle' ? (
                  <ThemedSwitch
                    testID={`account-settings-section-toggle-${row.toggle}`}
                    accessibilityLabel={title}
                    value={toggleValue}
                    disabled={row.disabled}
                    onValueChange={(enabled) => {
                      if (row.action && !row.disabled) {
                        onAction({ action: row.action, enabled });
                      }
                    }}
                  />
                ) : undefined}
              />
            </Fragment>
          );
        })}
      </SettingsGroup>
    </View>
  );
}

function SectionLoading(): React.JSX.Element {
  const { t } = useTranslation('config');
  return (
    <View testID="account-settings-section-loading" style={styles.loadingGroups}>
      {SECTION_SKELETONS.map((key) => (
        <ListSkeleton
          key={key}
          testID={`account-settings-section-skeleton-${key}`}
          accessibilityLabel={t('Loading settings')}
          rows={2}
          icon
        />
      ))}
    </View>
  );
}

/** Connection state for the header title slot; product banners stay in the content flow. */
function SectionConnectionStatus({
  status,
  onRetry,
}: Readonly<{
  status: AccountSettingsPageStatus;
  onRetry?: () => void;
}>): React.JSX.Element | null {
  const { t } = useTranslation('config');
  if (status.kind === 'offline') {
    return (
      <ConnectionStatusPill
        testID="account-settings-section-offline"
        placement="inline"
        status="offline"
        message={t('Offline · showing cached settings')}
      />
    );
  }
  if (status.kind === 'error') {
    return (
      <ConnectionStatusPill
        testID="account-settings-section-error"
        placement="inline"
        status="error"
        message={t('Settings unavailable · {{code}}', { code: status.code })}
        actionLabel={onRetry ? t('Retry', { ns: 'common' }) : undefined}
        onAction={onRetry}
      />
    );
  }
  return null;
}

function SectionStatus({
  status,
  onRetry,
  onOpenPaywall,
}: Readonly<{
  status: AccountSettingsPageStatus;
  onRetry?: () => void;
  onOpenPaywall: AccountSettingsSectionScreenProps['onOpenPaywall'];
}>): React.JSX.Element | null {
  const { t } = useTranslation('config');
  if (status.kind === 'empty') {
    return (
      <Banner
        testID="account-settings-section-empty"
        message={t('No settings available')}
        actionLabel={onRetry ? t('Retry', { ns: 'common' }) : undefined}
        onAction={onRetry}
      />
    );
  }
  if (status.kind === 'permission') {
    return (
      <Banner
        testID="account-settings-section-permission"
        message={t('Pro unlocks more settings')}
        actionLabel={t('View Pro')}
        onAction={() => onOpenPaywall(status.reason)}
      />
    );
  }
  return null;
}

export function AccountSettingsSectionScreen({
  section,
  status = { kind: 'ready' },
  data = {},
  capabilities,
  onBack,
  onRetry,
  onAction,
  onOpenPaywall,
}: AccountSettingsSectionScreenProps): React.JSX.Element {
  const { t } = useTranslation('config');
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [pendingMaintenance, setPendingMaintenance] = useState<Extract<
    AccountSettingsSectionAction,
    'clear-cache' | 'reset-device'
  > | null>(null);
  const labels = useMemo<AccountSettingsSectionLabels>(() => ({
    theme: data.labels?.theme ?? t('Follow System'),
    accent: data.labels?.accent ?? t('Blue'),
    chatAppearance: data.labels?.chatAppearance ?? t('Default'),
    appIcon: data.labels?.appIcon ?? t('Default'),
    appVersion: data.labels?.appVersion ?? t('Unknown'),
    previewEnvironment: data.labels?.previewEnvironment ?? t(data.debugMode ? 'Preview' : 'Production'),
  }), [data.debugMode, data.labels, t]);
  const model = useMemo(() => buildAccountSettingsSectionModel({
    section,
    capabilities,
    data,
    labels,
  }), [capabilities, data, labels, section]);
  const dispatchAction = useCallback((request: AccountSettingsSectionActionRequest) => {
    if (request.action === 'clear-cache' || request.action === 'reset-device') {
      setPendingMaintenance(request.action);
      return;
    }
    onAction(request);
  }, [onAction]);
  const maintenanceConfirmationCopy = pendingMaintenance === 'clear-cache'
    ? {
      title: t('Clear Cache'),
      message: t('This removes cached conversations and favorites from this device. Your connections stay signed in.'),
      confirmLabel: t('Clear Cache'),
    }
    : pendingMaintenance === 'reset-device'
      ? {
        title: t('Reset Device'),
        message: t('This removes all connections and the device identity. You will need to pair again.'),
        confirmLabel: t('Reset'),
      }
      : null;

  return (
    <Fragment>
      <View
        testID="account-settings-section-screen"
        style={[styles.screen, { backgroundColor: theme.colors.canvasGrouped }]}
      >
        <AccountSettingsPageHeader testID="account-settings-section"
          title={translateAccountSettingsKey(t, model.titleKey)} onBack={onBack}
          status={status.kind === 'offline' || status.kind === 'error'
            ? <SectionConnectionStatus status={status} onRetry={onRetry} />
            : undefined} />

        {status.kind === 'loading' ? <SectionLoading /> : (
          <ScrollView
            testID="account-settings-section-scroll"
            automaticallyAdjustContentInsets={false}
            contentContainerStyle={[
              styles.content,
              { paddingBottom: insets.bottom + Space.xl },
            ]}
            showsVerticalScrollIndicator={false}
          >
            <SectionStatus
              status={status}
              onRetry={onRetry}
              onOpenPaywall={onOpenPaywall}
            />
            {!model.supported ? (
              <Banner
                testID="account-settings-section-unsupported"
                message={t('Not supported by this backend')}
              />
            ) : model.groups.map((sectionGroup) => (
              <SectionGroupView
                key={sectionGroup.id}
                group={sectionGroup}
                data={data}
                onAction={dispatchAction}
                onOpenPaywall={onOpenPaywall}
              />
            ))}
          </ScrollView>
        )}
      </View>
      {pendingMaintenance && maintenanceConfirmationCopy ? (
        <ConfirmationModal
          visible
          title={maintenanceConfirmationCopy.title}
          message={maintenanceConfirmationCopy.message}
          cancelLabel={t('Cancel', { ns: 'common' })}
          confirmLabel={maintenanceConfirmationCopy.confirmLabel}
          destructive
          testID={`account-settings-${pendingMaintenance}-confirmation`}
          onClose={() => setPendingMaintenance(null)}
          onConfirm={() => {
            const action = pendingMaintenance;
            setPendingMaintenance(null);
            onAction({ action });
          }}
        />
      ) : null}
    </Fragment>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Space.lg,
    paddingTop: Space.lg,
    gap: Space.xl,
  },
  groupSection: {
    gap: Space.sm,
  },
  groupTitle: {
    paddingHorizontal: Space.lg,
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.regular,
  },
  loadingGroups: {
    flex: 1,
    paddingHorizontal: Space.lg,
    gap: Space.lg,
  },
});
