import React, { Fragment, useCallback, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { FloatingButton } from '../../components/ui/FloatingButton';
import { Sheet } from '../../components/ui/Sheet';
import {
  SettingsDivider,
  SettingsGroup,
  SettingsRow,
} from '../../components/ui/SettingsGroup';
import { Skeleton } from '../../components/ui/Skeleton';
import { ThemedSwitch } from '../../components/ui/ThemedSwitch';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Space,
} from '../../theme/tokens';
import type { AccountSettingsPageStatus } from './model';
import {
  AccountPreferenceSheet,
  isAccountPreferenceAction,
  type AccountPreferenceAction,
} from './AccountPreferenceSheet';
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
  onPreferenceChanged?: (preference: AccountPreferenceAction, value: string) => void;
  onOpenPaywall: (
    reason: Extract<AccountSettingsPageStatus, { kind: 'permission' }>['reason'],
  ) => void;
}>;

type SectionGroupViewProps = Readonly<{
  group: AccountSettingsSectionGroup;
  data: AccountSettingsSectionData;
  onAction: AccountSettingsSectionScreenProps['onAction'];
  onOpenPreference: (preference: AccountPreferenceAction) => void;
  onOpenPaywall: AccountSettingsSectionScreenProps['onOpenPaywall'];
  onRequestRemove: (connectionId: string, label: string) => void;
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
  onOpenPreference,
  onOpenPaywall,
  onRequestRemove,
}: SectionGroupViewProps): React.JSX.Element {
  const { t } = useTranslation('config');
  const { theme } = useAppTheme();

  const openRow = (row: AccountSettingsSectionRow) => {
    if (row.disabled) return;
    if (row.locked) {
      onOpenPaywall(row.paywallReason ?? 'generic');
      return;
    }
    if (row.action && isAccountPreferenceAction(row.action)) {
      onOpenPreference(row.action);
      return;
    }
    if (row.action === 'remove-connection' && row.connectionId) {
      onRequestRemove(
        row.connectionId,
        group.title ?? t('Connection', { ns: 'common' }),
      );
      return;
    }
    if (row.action) {
      onAction({
        action: row.action,
        ...(row.connectionId ? { connectionId: row.connectionId } : {}),
      });
    }
  };

  return (
    <View testID={`account-settings-section-group-${group.id}`} style={styles.groupSection}>
      {group.title || group.titleKey ? (
        <Text style={[styles.groupTitle, { color: theme.colors.inkSecondary }]}>
          {group.title ?? translateAccountSettingsKey(t, group.titleKey ?? '')}
        </Text>
      ) : null}
      <SettingsGroup>
        {group.rows.map((row, index) => {
          const title = resolveRowTitle(row, t);
          const toggleValue = row.toggle === 'replyNotifications'
            ? data.replyNotificationsEnabled === true
            : data.debugMode === true;
          return (
            <Fragment key={row.id}>
              {index > 0 ? <SettingsDivider inset="content" /> : null}
              <SettingsRow
                testID={`account-settings-section-row-${row.id}`}
                title={title}
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
        <Skeleton
          key={key}
          testID={`account-settings-section-skeleton-${key}`}
          accessibilityLabel={t('Loading settings')}
          style={styles.loadingCard}
        />
      ))}
    </View>
  );
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
  if (status.kind === 'offline') {
    return (
      <Banner
        testID="account-settings-section-offline"
        message={t('Offline · showing cached settings')}
      />
    );
  }
  if (status.kind === 'error') {
    return (
      <Banner
        testID="account-settings-section-error"
        tone="bad"
        message={t('Settings unavailable · {{code}}', { code: status.code })}
        actionLabel={onRetry ? t('Retry', { ns: 'common' }) : undefined}
        onAction={onRetry}
      />
    );
  }
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
  onPreferenceChanged,
  onOpenPaywall,
}: AccountSettingsSectionScreenProps): React.JSX.Element {
  const { t } = useTranslation('config');
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [preference, setPreference] = useState<AccountPreferenceAction | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<Readonly<{
    connectionId: string;
    label: string;
  }> | null>(null);
  const [pendingMaintenance, setPendingMaintenance] = useState<Extract<
    AccountSettingsSectionAction,
    'clear-cache' | 'reset-device'
  > | null>(null);
  const labels = useMemo<AccountSettingsSectionLabels>(() => ({
    theme: data.labels?.theme ?? t('Follow System'),
    accent: data.labels?.accent ?? t('Blue'),
    chatAppearance: data.labels?.chatAppearance ?? t('Default'),
    appIcon: data.labels?.appIcon ?? t('Default'),
    speechLanguage: data.labels?.speechLanguage ?? t('Follow System'),
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
        <View
          testID="account-settings-section-header"
          style={[styles.header, { paddingTop: insets.top + Space.sm }]}
        >
          <FloatingButton
            testID="account-settings-section-back"
            icon={ChevronLeft}
            accessibilityLabel={t('Back', { ns: 'common' })}
            onPress={onBack}
          />
          <Text
            testID="account-settings-section-title"
            style={[styles.title, { color: theme.colors.ink }]}
            numberOfLines={1}
          >
            {translateAccountSettingsKey(t, model.titleKey)}
          </Text>
          <View style={styles.headerSlot} />
        </View>

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
                onOpenPreference={setPreference}
                onOpenPaywall={onOpenPaywall}
                onRequestRemove={(connectionId, label) => {
                  setPendingRemoval({ connectionId, label });
                }}
              />
            ))}
          </ScrollView>
        )}
      </View>
      <Sheet
        testID="account-settings-remove-confirm"
        visible={pendingRemoval !== null}
        title={t('Remove connection')}
        closeAccessibilityLabel={t('Close', { ns: 'common' })}
        onClose={() => setPendingRemoval(null)}
      >
        <View style={styles.confirmContent}>
          <Text style={[styles.confirmText, { color: theme.colors.inkSecondary }]}>
            {t('Are you sure you want to delete "{{name}}"?', {
              name: pendingRemoval?.label ?? t('Connection', { ns: 'common' }),
            })}
          </Text>
          <View style={styles.confirmActions}>
            <Button
              testID="account-settings-remove-cancel"
              label={t('Cancel', { ns: 'common' })}
              variant="secondary"
              style={styles.confirmAction}
              onPress={() => setPendingRemoval(null)}
            />
            <Button
              testID="account-settings-remove-action"
              label={t('Remove', { ns: 'common' })}
              variant="destructive"
              style={styles.confirmAction}
              onPress={() => {
                if (!pendingRemoval) return;
                onAction({
                  action: 'remove-connection',
                  connectionId: pendingRemoval.connectionId,
                });
                setPendingRemoval(null);
              }}
            />
          </View>
        </View>
      </Sheet>
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
      {preference ? (
        <AccountPreferenceSheet
          preference={preference}
          onClose={() => setPreference(null)}
          onChanged={onPreferenceChanged}
        />
      ) : null}
    </Fragment>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSlot: {
    width: ControlSize.floatingButton,
    height: ControlSize.floatingButton,
  },
  title: {
    flex: 1,
    marginHorizontal: Space.md,
    textAlign: 'center',
    fontSize: FontSize.title,
    lineHeight: LineHeight.title,
    fontWeight: FontWeight.semibold,
  },
  content: {
    paddingHorizontal: Space.lg,
    gap: Space.lg,
  },
  groupSection: {
    gap: Space.sm,
  },
  groupTitle: {
    paddingHorizontal: Space.xs,
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.regular,
  },
  loadingGroups: {
    flex: 1,
    paddingHorizontal: Space.lg,
    gap: Space.lg,
  },
  loadingCard: {
    height: ControlSize.rosterRow,
  },
  confirmContent: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.xl,
    gap: Space.lg,
  },
  confirmText: {
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.regular,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: Space.sm,
  },
  confirmAction: {
    flex: 1,
  },
});
