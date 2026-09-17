import type { AccountSettingsDetailSection } from '../../navigation/root-stack';
import type {
  AccountSettingsAction,
  AccountSettingsPageStatus,
} from './model';

export type { AccountSettingsDetailSection };

export type AccountSettingsSectionCapability =
  | 'subscription'
  | 'connections'
  | 'appearance'
  | 'appIcons'
  | 'voice'
  | 'notifications'
  | 'help'
  | 'community'
  | 'about'
  | 'developer'
  | 'previewEnvironment'
  | 'designSystem';

export type AccountSettingsSectionCapabilities = Readonly<
  Record<AccountSettingsSectionCapability, boolean>
>;

export const DEFAULT_ACCOUNT_SETTINGS_SECTION_CAPABILITIES:
AccountSettingsSectionCapabilities = Object.freeze({
  subscription: true,
  connections: true,
  appearance: true,
  appIcons: true,
  voice: true,
  notifications: true,
  help: true,
  community: true,
  about: true,
  developer: true,
  previewEnvironment: true,
  designSystem: true,
});

export type AccountSettingsSectionLabels = Readonly<{
  theme: string;
  accent: string;
  chatAppearance: string;
  appIcon: string;
  speechLanguage: string;
  appVersion: string;
  previewEnvironment: string;
}>;

export type AccountSettingsSectionData = Readonly<{
  labels?: Partial<AccountSettingsSectionLabels>;
  isPro?: boolean;
  canAddConnection?: boolean;
  replyNotificationsEnabled?: boolean;
  debugMode?: boolean;
}>;

export type AccountSettingsSectionAction = AccountSettingsAction
  | 'advanced-settings'
  | 'set-reply-notifications'
  | 'set-debug-mode';

export type AccountSettingsSectionActionRequest = Readonly<{
  action: AccountSettingsSectionAction;
  enabled?: boolean;
}>;

export type AccountSettingsSectionRow = Readonly<{
  id: string;
  titleKey?: string;
  title?: string;
  valueKey?: string;
  value?: string;
  titleNamespace?: 'common' | 'config' | 'settings';
  valueNamespace?: 'common' | 'config' | 'settings';
  kind: 'navigation' | 'toggle' | 'value';
  action?: AccountSettingsSectionAction;
  toggle?: 'replyNotifications' | 'debugMode';
  disabled?: boolean;
  locked?: boolean;
  paywallReason?: Extract<AccountSettingsPageStatus, { kind: 'permission' }>['reason'];
}>;

export type AccountSettingsSectionGroup = Readonly<{
  id: string;
  title?: string;
  titleKey?: string;
  rows: ReadonlyArray<AccountSettingsSectionRow>;
}>;

export type AccountSettingsSectionModel = Readonly<{
  section: AccountSettingsDetailSection;
  titleKey: string;
  supported: boolean;
  groups: ReadonlyArray<AccountSettingsSectionGroup>;
}>;

export type BuildAccountSettingsSectionInput = Readonly<{
  section: AccountSettingsDetailSection;
  capabilities?: Partial<AccountSettingsSectionCapabilities>;
  data?: AccountSettingsSectionData;
  labels: AccountSettingsSectionLabels;
}>;

const SECTION_CAPABILITY: Readonly<
  Record<AccountSettingsDetailSection, AccountSettingsSectionCapability>
> = Object.freeze({
  pro: 'subscription',
  appearance: 'appearance',
  voice: 'voice',
  notifications: 'notifications',
  help: 'help',
  community: 'community',
  about: 'about',
  developer: 'developer',
});

const SECTION_TITLE_KEYS: Readonly<Record<AccountSettingsDetailSection, string>> =
  Object.freeze({
    pro: 'Clawket Pro',
    appearance: 'Appearance',
    voice: 'Voice',
    notifications: 'Chat & notifications',
    help: 'Help & feedback',
    community: 'Community',
    about: 'About',
    developer: 'Developer',
  });

function navigationRow(
  id: string,
  titleKey: string,
  action: AccountSettingsSectionAction,
  input: Partial<AccountSettingsSectionRow> = {},
): AccountSettingsSectionRow {
  return { id, titleKey, action, kind: 'navigation', ...input };
}

function gateRow(
  row: AccountSettingsSectionRow,
  available: boolean,
): AccountSettingsSectionRow {
  if (available) return row;
  return {
    ...row,
    disabled: true,
    locked: false,
    value: undefined,
    valueKey: 'Unavailable',
    valueNamespace: 'settings',
  };
}

function group(
  id: string,
  rows: ReadonlyArray<AccountSettingsSectionRow>,
  title?: string,
): AccountSettingsSectionGroup {
  return { id, rows, ...(title ? { title } : {}) };
}

function buildSectionGroups(
  section: AccountSettingsDetailSection,
  data: AccountSettingsSectionData,
  labels: AccountSettingsSectionLabels,
  capabilities: AccountSettingsSectionCapabilities,
): ReadonlyArray<AccountSettingsSectionGroup> {
  switch (section) {
    case 'pro':
      return [group('pro', [
        navigationRow('pro-status', 'Clawket Pro', 'view-pro', {
          valueKey: data.isPro ? 'Active' : 'Free',
        }),
        navigationRow('restore-purchases', 'Restore Purchases', 'restore-purchases'),
      ])];
    case 'appearance':
      return [group('appearance', [
        navigationRow('theme', 'Theme', 'theme', { value: labels.theme }),
        navigationRow('chat-appearance', 'Chat theme', 'chat-appearance', {
          value: labels.chatAppearance,
        }),
        gateRow(navigationRow('app-icon', 'App Icon', 'app-icon', {
          value: labels.appIcon,
          locked: !data.isPro,
          paywallReason: 'appIcons',
        }), capabilities.appIcons),
      ])];
    case 'voice':
      return [group('voice', [
        navigationRow('speech-language', 'Recognition Language', 'speech-language', {
          value: labels.speechLanguage,
        }),
      ])];
    case 'notifications':
      return [group('notifications', [
        gateRow(navigationRow('speech-language', 'Recognition Language', 'speech-language', { value: labels.speechLanguage }), capabilities.voice),
        {
          id: 'reply-notifications',
          titleKey: 'Reply Notifications',
          kind: 'toggle',
          toggle: 'replyNotifications',
          action: 'set-reply-notifications',
        },
      ])];
    case 'help':
      return [group('help', [
        navigationRow('help-center', 'Help Center', 'help-center'),
        navigationRow('feedback', 'Send Feedback', 'feedback'),
        navigationRow('release-notes', 'Release Notes', 'release-notes'),
      ]), group('community', [
        gateRow(navigationRow('discord', 'Discord', 'discord'), capabilities.community),
        gateRow(navigationRow('share', 'Share Clawket', 'share'), capabilities.community),
        gateRow(navigationRow('rate', 'Rate Clawket', 'rate'), capabilities.community),
      ])];
    case 'community':
      return [group('community', [
        navigationRow('share', 'Share Clawket', 'share'),
        navigationRow('rate', 'Rate Clawket', 'rate'),
        navigationRow('discord', 'Discord', 'discord'),
      ])];
    case 'about':
      return [group('about', [
        { id: 'version', titleKey: 'Version', value: labels.appVersion, kind: 'value' },
        navigationRow('repository', 'Open Source Repository', 'repository'),
        navigationRow('privacy', 'Privacy Policy', 'privacy'),
        navigationRow('terms', 'Terms of Use', 'terms'),
        gateRow(navigationRow('advanced-settings', 'Advanced settings', 'advanced-settings'), capabilities.developer),
      ])];
    case 'developer':
      return [group('developer', [
        {
          id: 'debug-mode',
          titleKey: 'Debug Mode',
          kind: 'toggle',
          toggle: 'debugMode',
          action: 'set-debug-mode',
        },
        ...(data.debugMode ? [gateRow({
          id: 'preview-environment',
          titleKey: 'Relay Environment',
          value: labels.previewEnvironment,
          kind: 'value',
        }, capabilities.previewEnvironment)] : []),
        gateRow(navigationRow(
          'design-system',
          'Design System',
          'design-system',
        ), capabilities.designSystem),
        ...(data.debugMode ? [navigationRow(
          'preview-update-announcement',
          'Preview update announcement',
          'preview-update-announcement',
        )] : []),
        navigationRow('clear-cache', 'Clear Cache', 'clear-cache'),
        navigationRow('reset-device', 'Reset Device', 'reset-device'),
      ])];
  }
}

export function resolveAccountSettingsSectionCapabilities(
  capabilities?: Partial<AccountSettingsSectionCapabilities>,
): AccountSettingsSectionCapabilities {
  return { ...DEFAULT_ACCOUNT_SETTINGS_SECTION_CAPABILITIES, ...capabilities };
}

export function buildAccountSettingsSectionModel({
  section,
  capabilities: capabilityOverrides,
  data = {},
  labels,
}: BuildAccountSettingsSectionInput): AccountSettingsSectionModel {
  const capabilities = resolveAccountSettingsSectionCapabilities(capabilityOverrides);
  const supported = capabilities[SECTION_CAPABILITY[section]];
  return {
    section,
    titleKey: SECTION_TITLE_KEYS[section],
    supported,
    groups: supported ? buildSectionGroups(section, data, labels, capabilities) : [],
  };
}
