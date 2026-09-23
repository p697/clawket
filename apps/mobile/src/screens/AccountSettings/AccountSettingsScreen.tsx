import React, { Fragment, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Languages, Cable, Palette, CircleHelp, Info, SunMoon, Image, Download } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccountPreferenceSheet, type AccountPreferenceAction } from './AccountPreferenceSheet';
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
import { ListSkeleton } from '../../components/ui/ListSkeleton';
import { useAppTheme } from '../../theme';
import {
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
  debugMode?: boolean;
  onBack: () => void;
  onOpenSection?: (section: AccountSettingsSection) => void;
  onRetry?: () => void;
  onOpenAction: (action: AccountSettingsAction) => void;
  onOpenConnection: (connectionId: string) => void;
  /** Present only when a saved connection has verified legacy Bridge evidence. */
  onUpgradeBridge?: () => void;
  onOpenPaywall: (
    reason: 'gatewayConnections' | 'appIcons' | 'generic',
    onContinue?: () => void,
  ) => void;
  /** Theme, app icon and app language are picked in place on the home page. */
  onPreferenceChanged?: (preference: AccountPreferenceAction, value: string) => void;
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
          <ListSkeleton
            testID={`account-settings-skeleton-card-${key}`}
            rows={2}
            icon
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
  onUpgradeBridge,
  onRetry,
  onOpenAction,
  onOpenPaywall,
  onPreferenceChanged,
}: AccountSettingsScreenProps): React.JSX.Element {
  const { t } = useTranslation('config');
  const { theme } = useAppTheme();
  const { language } = useAppLanguage();
  const [preference, setPreference] = useState<AccountPreferenceAction | null>(null);
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
                { section: 'language' as const, title: t('App language'), icon: Languages, enabled: true,
                  value: language === 'system' ? t('Follow System') : APP_LANGUAGE_NAMES[language] },
              ].filter((entry) => entry.enabled).map((entry, index) => (
                <Fragment key={entry.section}>
                  {index > 0 ? <SettingsDivider inset="icon" /> : null}
                  <SettingsRow testID={entry.section === 'language' ? 'account-settings-app-language' : `account-settings-category-${entry.section}`} title={entry.title}
                    value={entry.value} leading={<SettingsIcon icon={entry.icon} tone="neutral" size={20} strokeWidth={1.75} />}
                    showChevron onPress={() => entry.section === 'language' ? setPreference('app-language') : onOpenSection?.(entry.section)} />
                  {entry.section === 'connections' && onUpgradeBridge ? (
                    <>
                      <SettingsDivider inset="icon" />
                      <SettingsRow testID="account-settings-bridge-upgrade"
                        title={t('Update your Bridge', { ns: 'chat' })}
                        leading={<SettingsIcon icon={Download} tone="neutral" size={20} strokeWidth={1.75} />}
                        showChevron onPress={onUpgradeBridge} />
                    </>
                  ) : null}
                </Fragment>
              ))}
            </SettingsGroup>
            {capabilities.appearance ? (
              // Appearance gets its own card (owner request 2026-09-19): the three
              // rows sit on the home page without stretching the category card.
              <SettingsGroup density="comfortable" testID="account-settings-appearance">
                {[
                  { id: 'theme' as const, title: t('Theme'), icon: SunMoon, value: labels.theme, enabled: true, locked: false,
                    open: () => setPreference('theme') },
                  { id: 'chat-appearance' as const, title: t('Chat theme'), icon: Palette, value: labels.chatAppearance, enabled: true, locked: false,
                    open: () => onOpenAction('chat-appearance') },
                  { id: 'app-icon' as const, title: t('App Icon'), icon: Image, value: labels.appIcon, enabled: capabilities.appIcons, locked: !isPro,
                    open: () => setPreference('app-icon') },
                ].filter((entry) => entry.enabled).map((entry, index) => (
                  <Fragment key={entry.id}>
                    {index > 0 ? <SettingsDivider inset="icon" /> : null}
                    <SettingsRow testID={`account-settings-row-${entry.id}`} title={entry.title} value={entry.value}
                      leading={<SettingsIcon icon={entry.icon} tone="neutral" size={20} strokeWidth={1.75} />}
                      locked={entry.locked} showChevron={!entry.locked}
                      onPress={() => entry.locked ? onOpenPaywall('appIcons', entry.open) : entry.open()} />
                  </Fragment>
                ))}
              </SettingsGroup>
            ) : null}
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
      {preference ? (
        <AccountPreferenceSheet preference={preference} onClose={() => setPreference(null)} onChanged={onPreferenceChanged} />
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
    paddingTop: Space.lg,
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
    minHeight: 0,
    height: Space.md,
    marginHorizontal: Space.xs,
  },
});
