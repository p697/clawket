import React, { Fragment, useMemo } from 'react';
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
import { FloatingButton } from '../../components/ui/FloatingButton';
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
import {
  buildAccountSettingsGroups,
  resolveAccountSettingsCapabilities,
  type AccountSettingsAction,
  type AccountSettingsCapabilities,
  type AccountSettingsConnection,
  type AccountSettingsGroup,
  type AccountSettingsLabels,
  type AccountSettingsPageStatus,
  type AccountSettingsRow,
} from './model';
import { translateAccountSettingsKey } from './translation';

export type AccountSettingsScreenProps = Readonly<{
  status?: AccountSettingsPageStatus;
  connections?: ReadonlyArray<AccountSettingsConnection>;
  capabilities?: Partial<AccountSettingsCapabilities>;
  labels?: Partial<AccountSettingsLabels>;
  isPro?: boolean;
  canAddConnection?: boolean;
  replyNotificationsEnabled?: boolean;
  debugMode?: boolean;
  onBack: () => void;
  onRetry?: () => void;
  onOpenAction: (action: AccountSettingsAction) => void;
  onOpenConnection: (connectionId: string) => void;
  onOpenPaywall: (
    reason: 'gatewayConnections' | 'appIcons' | 'generic',
    onContinue?: () => void,
  ) => void;
  onReplyNotificationsChange: (enabled: boolean) => void;
  onDebugModeChange: (enabled: boolean) => void;
}>;

type SettingsGroupViewProps = Readonly<{
  group: AccountSettingsGroup;
  isPro: boolean;
  replyNotificationsEnabled: boolean;
  debugMode: boolean;
  onOpenAction: AccountSettingsScreenProps['onOpenAction'];
  onOpenConnection: AccountSettingsScreenProps['onOpenConnection'];
  onOpenPaywall: AccountSettingsScreenProps['onOpenPaywall'];
  onReplyNotificationsChange: AccountSettingsScreenProps['onReplyNotificationsChange'];
  onDebugModeChange: AccountSettingsScreenProps['onDebugModeChange'];
}>;

const SETTINGS_SKELETON_GROUPS = Object.freeze(['one', 'two', 'three', 'four']);

function SettingsLoading(): React.JSX.Element {
  const { t } = useTranslation('config');
  return (
    <View testID="account-settings-loading" style={styles.loadingGroups}>
      {SETTINGS_SKELETON_GROUPS.map((key) => (
        <View key={key} style={styles.loadingGroup}>
          <Skeleton
            testID={`account-settings-skeleton-title-${key}`}
            accessibilityLabel={t('Loading settings')}
            style={styles.loadingTitle}
          />
          <Skeleton
            testID={`account-settings-skeleton-card-${key}`}
            style={styles.loadingCard}
          />
        </View>
      ))}
    </View>
  );
}

function resolveRowTitle(
  row: AccountSettingsRow,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  return row.title ?? (row.titleKey ? translateAccountSettingsKey(t, row.titleKey) : '');
}

function resolveRowValue(
  row: AccountSettingsRow,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | undefined {
  if (row.valueKeys) {
    return row.valueKeys.map((key) => translateAccountSettingsKey(t, key)).join(' · ');
  }
  if (row.valueKey) return translateAccountSettingsKey(t, row.valueKey);
  return row.value;
}

function SettingsGroupView({
  group,
  isPro,
  replyNotificationsEnabled,
  debugMode,
  onOpenAction,
  onOpenConnection,
  onOpenPaywall,
  onReplyNotificationsChange,
  onDebugModeChange,
}: SettingsGroupViewProps): React.JSX.Element {
  const { t } = useTranslation('config');

  const openRow = (row: AccountSettingsRow) => {
    if (row.action === 'view-pro' && !isPro) {
      onOpenPaywall('generic');
      return;
    }
    if (row.locked) {
      onOpenPaywall(
        row.action === 'app-icon' ? 'appIcons' : 'gatewayConnections',
        row.connectionId
          ? () => onOpenConnection(row.connectionId!)
          : row.action
            ? () => onOpenAction(row.action!)
            : undefined,
      );
      return;
    }
    if (row.connectionId) {
      onOpenConnection(row.connectionId);
      return;
    }
    if (row.action) onOpenAction(row.action);
  };

  return (
    <View testID={`account-settings-group-${group.id}`} style={styles.groupSection}>
      <Text style={styles.groupTitle}>{translateAccountSettingsKey(t, group.titleKey)}</Text>
      <SettingsGroup>
        {group.rows.map((row, index) => {
          const title = resolveRowTitle(row, t);
          const value = resolveRowValue(row, t);
          const toggleValue = row.toggle === 'replyNotifications'
            ? replyNotificationsEnabled
            : debugMode;
          const onToggle = row.toggle === 'replyNotifications'
            ? onReplyNotificationsChange
            : onDebugModeChange;

          return (
            <Fragment key={row.id}>
              {index > 0 ? <SettingsDivider inset="content" /> : null}
              <SettingsRow
                testID={`account-settings-row-${row.id}`}
                title={title}
                value={value}
                attention={row.attention}
                locked={row.locked}
                showChevron={row.kind === 'navigation' && !row.locked}
                onPress={row.kind === 'navigation' ? () => openRow(row) : undefined}
                trailing={row.kind === 'toggle' ? (
                  <ThemedSwitch
                    testID={`account-settings-toggle-${row.toggle}`}
                    accessibilityLabel={title}
                    value={toggleValue}
                    onValueChange={onToggle}
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

function StatusBanner({
  status,
  canAddConnection,
  onRetry,
  onOpenAction,
  onOpenPaywall,
}: Readonly<{
  status: AccountSettingsPageStatus;
  canAddConnection: boolean;
  onRetry?: () => void;
  onOpenAction: AccountSettingsScreenProps['onOpenAction'];
  onOpenPaywall: AccountSettingsScreenProps['onOpenPaywall'];
}>): React.JSX.Element | null {
  const { t } = useTranslation('config');

  if (status.kind === 'offline') {
    return (
      <Banner
        testID="account-settings-offline"
        message={t('Offline · showing cached settings')}
      />
    );
  }
  if (status.kind === 'error') {
    return (
      <Banner
        testID="account-settings-error"
        tone="bad"
        message={t('Settings unavailable · {{code}}', { code: status.code })}
        actionLabel={onRetry ? t('Retry', { ns: 'common' }) : undefined}
        onAction={onRetry}
      />
    );
  }
  if (status.kind === 'empty') {
    const addConnection = () => {
      if (canAddConnection) onOpenAction('add-connection');
      else onOpenPaywall('gatewayConnections', () => onOpenAction('add-connection'));
    };
    return (
      <Banner
        testID="account-settings-empty"
        message={t('No connections yet')}
        actionLabel={t('Add', { ns: 'common' })}
        onAction={addConnection}
      />
    );
  }
  if (status.kind === 'permission') {
    return (
      <Banner
        testID="account-settings-permission"
        message={t('Pro unlocks more settings')}
        actionLabel={t('View Pro')}
        onAction={() => onOpenPaywall(status.reason)}
      />
    );
  }
  return null;
}

export function AccountSettingsScreen({
  status = { kind: 'ready' },
  connections = [],
  capabilities: capabilityOverrides,
  labels: labelOverrides,
  isPro = false,
  canAddConnection = true,
  replyNotificationsEnabled = false,
  debugMode = false,
  onBack,
  onRetry,
  onOpenAction,
  onOpenConnection,
  onOpenPaywall,
  onReplyNotificationsChange,
  onDebugModeChange,
}: AccountSettingsScreenProps): React.JSX.Element {
  const { t } = useTranslation('config');
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const capabilities = useMemo(
    () => resolveAccountSettingsCapabilities(capabilityOverrides),
    [capabilityOverrides],
  );
  const labels = useMemo<AccountSettingsLabels>(() => ({
    theme: labelOverrides?.theme ?? t('Follow System'),
    accent: labelOverrides?.accent ?? t('Blue'),
    chatAppearance: labelOverrides?.chatAppearance ?? t('Default'),
    appIcon: labelOverrides?.appIcon ?? t('Default'),
    speechLanguage: labelOverrides?.speechLanguage ?? t('Follow System'),
    appVersion: labelOverrides?.appVersion ?? t('Unknown'),
    previewEnvironment: labelOverrides?.previewEnvironment ?? t(debugMode ? 'Preview' : 'Production'),
  }), [debugMode, labelOverrides, t]);
  const groups = useMemo(() => buildAccountSettingsGroups({
    connections,
    capabilities,
    labels,
    isPro,
    canAddConnection,
    debugMode,
  }), [canAddConnection, capabilities, connections, debugMode, isPro, labels]);
  const contentInsets = useMemo(() => ({
    paddingBottom: insets.bottom + Space.xl,
  }), [insets.bottom]);
  const headerInsets = useMemo(() => ({
    paddingTop: insets.top + Space.sm,
  }), [insets.top]);

  return (
    <View
      testID="account-settings-screen"
      style={[styles.screen, { backgroundColor: theme.colors.canvasGrouped }]}
    >
      <View testID="account-settings-header" style={[styles.header, headerInsets]}>
        <FloatingButton
          testID="account-settings-back"
          icon={ChevronLeft}
          accessibilityLabel={t('Back', { ns: 'common' })}
          onPress={onBack}
        />
        <Text style={[styles.title, { color: theme.colors.ink }]}>{t('Settings')}</Text>
        <View style={styles.headerSlot} />
      </View>

      <ScrollView
        testID="account-settings-scroll"
        automaticallyAdjustContentInsets={false}
        contentContainerStyle={[styles.content, contentInsets]}
        showsVerticalScrollIndicator={false}
      >
        {status.kind === 'loading' ? <SettingsLoading /> : (
          <>
            <StatusBanner
              status={status}
              canAddConnection={canAddConnection}
              onRetry={onRetry}
              onOpenAction={onOpenAction}
              onOpenPaywall={onOpenPaywall}
            />
            {!isPro && capabilities.subscription && status.kind !== 'permission' ? (
              <Banner
                testID="account-settings-pro-banner"
                message={t('Unlock every connection and agent')}
                actionLabel={t('View Pro')}
                onAction={() => onOpenPaywall('generic')}
              />
            ) : null}
            {groups.map((group) => (
              <SettingsGroupView
                key={group.id}
                group={group}
                isPro={isPro}
                replyNotificationsEnabled={replyNotificationsEnabled}
                debugMode={debugMode}
                onOpenAction={onOpenAction}
                onOpenConnection={onOpenConnection}
                onOpenPaywall={onOpenPaywall}
                onReplyNotificationsChange={onReplyNotificationsChange}
                onDebugModeChange={onDebugModeChange}
              />
            ))}
          </>
        )}
      </ScrollView>
    </View>
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
    gap: Space.lg,
  },
  loadingGroup: {
    gap: Space.sm,
  },
  loadingTitle: {
    width: '24%',
    height: LineHeight.secondary,
    marginHorizontal: Space.xs,
  },
  loadingCard: {
    height: ControlSize.rosterRow,
  },
});
