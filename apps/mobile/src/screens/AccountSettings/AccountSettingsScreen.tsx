import React, { Fragment, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Languages, Cable, Palette, Bell, CircleHelp, Info } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccountPreferenceSheet } from './AccountPreferenceSheet';
import { useAppLanguage } from '../../i18n/AppLanguageProvider';
import { APP_LANGUAGE_NAMES } from '../../i18n/language';
import type { AccountSettingsSection } from '../../navigation/root-stack';
import { Banner } from '../../components/ui/Banner';
import { ConnectionStatusPill } from '../../components/ui/ConnectionStatusPill';
import { SettingsIcon } from '../../components/ui/SettingsIcon';
import { AccountProCard } from './AccountProCard';
import { AccountSettingsPageHeader } from './AccountSettingsPageHeader';
import {
  SettingsDivider,
  SettingsGroup,
  SettingsRow,
} from '../../components/ui/SettingsGroup';
import { Skeleton } from '../../components/ui/Skeleton';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  LineHeight,
  Space,
} from '../../theme/tokens';
import {
  resolveAccountSettingsCapabilities,
  type AccountSettingsAction,
  type AccountSettingsCapabilities,
  type AccountSettingsConnection,
  type AccountSettingsLabels,
  type AccountSettingsPageStatus,
} from './model';

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
  onOpenSection?: (section: AccountSettingsSection) => void;
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

/** Connection state for the header title slot; product banners stay in the content flow. */
function ConnectionStatus({
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
        testID="account-settings-offline"
        placement="inline"
        status="offline"
        message={t('Offline · showing cached settings')}
      />
    );
  }
  if (status.kind === 'error') {
    return (
      <ConnectionStatusPill
        testID="account-settings-error"
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

function StatusBanner({
  status,
  canAddConnection,
  onOpenAction,
  onOpenPaywall,
}: Readonly<{
  status: AccountSettingsPageStatus;
  canAddConnection: boolean;
  onOpenAction: AccountSettingsScreenProps['onOpenAction'];
  onOpenPaywall: AccountSettingsScreenProps['onOpenPaywall'];
}>): React.JSX.Element | null {
  const { t } = useTranslation('config');

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
  debugMode = false,
  onBack,
  onOpenSection,
  onRetry,
  onOpenAction,
  onOpenPaywall,
}: AccountSettingsScreenProps): React.JSX.Element {
  const { t } = useTranslation('config');
  const { theme } = useAppTheme();
  const { language } = useAppLanguage();
  const [languagePickerVisible, setLanguagePickerVisible] = useState(false);
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
  const contentInsets = useMemo(() => ({
    paddingBottom: insets.bottom + Space.xl,
  }), [insets.bottom]);

  return (
    <View
      testID="account-settings-screen"
      style={[styles.screen, { backgroundColor: theme.colors.canvasGrouped }]}
    >
      <AccountSettingsPageHeader testID="account-settings" title={t('Settings')} onBack={onBack}
        status={status.kind === 'offline' || status.kind === 'error'
          ? <ConnectionStatus status={status} onRetry={onRetry} />
          : undefined} />

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
              onOpenAction={onOpenAction}
              onOpenPaywall={onOpenPaywall}
            />
            {capabilities.subscription ? (
              <AccountProCard testID="account-settings-membership" title={t('Clawket Pro')}
                status={isPro ? t('Active') : t('View Pro')} onPress={() => onOpenSection?.('pro')} />
            ) : null}
            <SettingsGroup density="comfortable" testID="account-settings-categories">
              {[
                { section: 'connections' as const, title: t('My connections'), icon: Cable, enabled: capabilities.connections, value: String(connections.length) },
                { section: 'appearance' as const, title: t('Appearance'), icon: Palette, enabled: capabilities.appearance, value: labels.theme },
                { section: 'notifications' as const, title: t('Chat & notifications'), icon: Bell, enabled: capabilities.notifications || capabilities.voice },
                { section: 'language' as const, title: t('App language'), icon: Languages, enabled: true,
                  value: language === 'system' ? t('Follow System') : APP_LANGUAGE_NAMES[language] },
              ].filter((entry) => entry.enabled).map((entry, index) => (
                <Fragment key={entry.section}>
                  {index > 0 ? <SettingsDivider inset="icon" /> : null}
                  <SettingsRow testID={entry.section === 'language' ? 'account-settings-app-language' : `account-settings-category-${entry.section}`} title={entry.title}
                    value={entry.value} leading={<SettingsIcon icon={entry.icon} tone="neutral" size={20} strokeWidth={1.75} />}
                    showChevron onPress={() => entry.section === 'language' ? setLanguagePickerVisible(true) : onOpenSection?.(entry.section)} />
                </Fragment>
              ))}
            </SettingsGroup>
            {capabilities.help || capabilities.community || capabilities.about ? (
              <SettingsGroup density="comfortable" testID="account-settings-support">
                {[
                  { section: 'help' as const, title: t('Help & feedback'), icon: CircleHelp, enabled: capabilities.help || capabilities.community },
                  { section: 'about' as const, title: t('About'), icon: Info, enabled: capabilities.about },
                ].filter((entry) => entry.enabled).map((entry, index) => (
                  <Fragment key={entry.section}>
                    {index > 0 ? <SettingsDivider inset="icon" /> : null}
                    <SettingsRow testID={`account-settings-category-${entry.section}`} title={entry.title}
                      leading={<SettingsIcon icon={entry.icon} tone="neutral" size={20} strokeWidth={1.75} />}
                      showChevron onPress={() => onOpenSection?.(entry.section)} />
                  </Fragment>
                ))}
              </SettingsGroup>
            ) : null}
          </>
        )}
      </ScrollView>
      {languagePickerVisible ? (
        <AccountPreferenceSheet preference="app-language" onClose={() => setLanguagePickerVisible(false)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Space.lg,
    paddingTop: Space.sm,
    gap: Space.xl,
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
