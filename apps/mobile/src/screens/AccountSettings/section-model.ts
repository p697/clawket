import type {
  ConnectionState,
} from '@clawket/agent-protocol';
import type { AccountSettingsSection } from '../../navigation/root-stack';
import {
  getConnectionValueKeys,
  type AccountSettingsAction,
  type AccountSettingsConnection,
  type AccountSettingsPageStatus,
} from './model';

export type AccountSettingsDetailSection = AccountSettingsSection;

export type AccountSettingsSectionCapability =
  | 'subscription'
  | 'connections'
  | 'connectionManagement'
  | 'relayStats'
  | 'appearance'
  | 'appIcons'
  | 'voice'
  | 'notifications'
  | 'help'
  | 'community'
  | 'wecom'
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
  connectionManagement: true,
  relayStats: true,
  appearance: true,
  appIcons: true,
  voice: true,
  notifications: true,
  help: true,
  community: true,
  wecom: true,
  about: true,
  developer: true,
  previewEnvironment: true,
  designSystem: true,
});

export type AccountSettingsRelayStats = Readonly<{
  state: ConnectionState;
  uptimeMs?: number;
  serverVersion?: string;
}>;

export type AccountSettingsSectionConnection = AccountSettingsConnection & Readonly<{
  state?: ConnectionState;
  supportsRelayStats?: boolean;
  relayStats?: AccountSettingsRelayStats;
}>;

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
  connections?: ReadonlyArray<AccountSettingsSectionConnection>;
  labels?: Partial<AccountSettingsSectionLabels>;
  isPro?: boolean;
  canAddConnection?: boolean;
  replyNotificationsEnabled?: boolean;
  debugMode?: boolean;
}>;

export type AccountSettingsSectionAction = AccountSettingsAction
  | 'open-connection'
  | 'reconnect-connection'
  | 'remove-connection'
  | 'set-reply-notifications'
  | 'set-debug-mode';

export type AccountSettingsSectionActionRequest = Readonly<{
  action: AccountSettingsSectionAction;
  connectionId?: string;
  enabled?: boolean;
}>;

export type AccountSettingsSectionRow = Readonly<{
  id: string;
  titleKey?: string;
  title?: string;
  valueKey?: string;
  value?: string;
  titleNamespace?: 'common' | 'config' | 'console';
  valueNamespace?: 'common' | 'config' | 'console';
  kind: 'navigation' | 'toggle' | 'value';
  action?: AccountSettingsSectionAction;
  toggle?: 'replyNotifications' | 'debugMode';
  connectionId?: string;
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
  connections: 'connections',
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
    connections: 'Connections',
    appearance: 'Appearance',
    voice: 'Voice',
    notifications: 'Notifications',
    help: 'Help',
    community: 'Community',
    about: 'About',
    developer: 'Developer',
  });

const CONNECTION_STATE_KEYS: Readonly<Record<ConnectionState, string>> = Object.freeze({
  idle: 'Offline',
  connecting: 'Connecting',
  handshaking: 'Connecting',
  ready: 'Online',
  reconnecting: 'Connecting',
  offline: 'Offline',
  error: 'Error',
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
    valueNamespace: 'console',
  };
}

function group(
  id: string,
  rows: ReadonlyArray<AccountSettingsSectionRow>,
  title?: string,
): AccountSettingsSectionGroup {
  return { id, rows, ...(title ? { title } : {}) };
}

function buildConnectionGroups(
  data: AccountSettingsSectionData,
  capabilities: AccountSettingsSectionCapabilities,
): ReadonlyArray<AccountSettingsSectionGroup> {
  const connections = data.connections ?? [];
  const groups = connections.map((connection) => {
    const [backend, transport, environment] = getConnectionValueKeys(connection);
    const rows: AccountSettingsSectionRow[] = [
      { id: `${connection.id}-backend`, titleKey: 'Backend', valueKey: backend, kind: 'value' },
      { id: `${connection.id}-transport`, titleKey: 'Transport', valueKey: transport, kind: 'value' },
      {
        id: `${connection.id}-environment`,
        titleKey: 'Environment',
        titleNamespace: 'console',
        valueKey: environment,
        kind: 'value',
      },
    ];

    if (connection.state) {
      rows.push({
        id: `${connection.id}-status`,
        titleKey: 'Status',
        valueKey: CONNECTION_STATE_KEYS[connection.state],
        valueNamespace: 'common',
        kind: 'value',
      });
    }

    if (connection.supportsRelayStats) {
      if (!capabilities.relayStats) {
        rows.push(gateRow({
          id: `${connection.id}-relay-statistics`,
          titleKey: 'Relay',
          kind: 'value',
        }, false));
      } else if (!connection.relayStats) {
        rows.push({
          id: `${connection.id}-relay-statistics`,
          titleKey: 'Relay',
          valueKey: 'Unknown',
          kind: 'value',
        });
      } else {
        rows.push({
          id: `${connection.id}-relay-status`,
          titleKey: 'Relay',
          valueKey: CONNECTION_STATE_KEYS[connection.relayStats.state],
          valueNamespace: 'common',
          kind: 'value',
        });
        if (connection.relayStats.uptimeMs !== undefined) {
          rows.push({
            id: `${connection.id}-relay-uptime`,
            titleKey: 'Uptime',
            titleNamespace: 'common',
            value: formatAccountSettingsUptime(connection.relayStats.uptimeMs),
            kind: 'value',
          });
        }
        if (connection.relayStats.serverVersion?.trim()) {
          rows.push({
            id: `${connection.id}-relay-version`,
            titleKey: 'Version',
            value: connection.relayStats.serverVersion.trim(),
            kind: 'value',
          });
        }
      }
    }

    rows.push(
      gateRow(navigationRow(
        `${connection.id}-open`,
        'Edit Connection',
        'open-connection',
        { connectionId: connection.id },
      ), capabilities.connectionManagement),
      gateRow(navigationRow(
        `${connection.id}-reconnect`,
        'Reconnect',
        'reconnect-connection',
        { connectionId: connection.id, titleNamespace: 'common' },
      ), capabilities.connectionManagement),
      gateRow(navigationRow(
        `${connection.id}-remove`,
        'Remove',
        'remove-connection',
        { connectionId: connection.id, titleNamespace: 'common' },
      ), capabilities.connectionManagement),
    );
    return group(`connection-${connection.id}`, rows, connection.label);
  });

  groups.push(group('connection-add', [navigationRow(
    'add-connection',
    'Add Connection',
    'add-connection',
    {
      locked: data.canAddConnection === false,
      paywallReason: 'gatewayConnections',
    },
  )]));
  return groups;
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
          locked: !data.isPro,
          paywallReason: 'generic',
        }),
        navigationRow('restore-purchases', 'Restore Purchases', 'restore-purchases'),
      ])];
    case 'connections':
      return buildConnectionGroups(data, capabilities);
    case 'appearance':
      return [group('appearance', [
        navigationRow('theme', 'Theme', 'theme', { value: labels.theme }),
        navigationRow('accent', 'Accent Color', 'accent', { value: labels.accent }),
        navigationRow('chat-appearance', 'Chat Appearance', 'chat-appearance', {
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
        navigationRow('openclaw-docs', 'OpenClaw Documentation', 'openclaw-docs'),
        navigationRow('hermes-docs', 'Hermes Documentation', 'hermes-docs'),
        navigationRow('release-notes', 'Release Notes', 'release-notes'),
        navigationRow('openclaw-releases', 'OpenClaw Releases', 'openclaw-releases'),
        navigationRow('feedback', 'Send Feedback', 'feedback'),
      ])];
    case 'community':
      return [group('community', [
        navigationRow('share', 'Share Clawket', 'share'),
        navigationRow('rate', 'Rate Clawket', 'rate'),
        navigationRow('discord', 'Discord', 'discord'),
        gateRow(navigationRow('wecom', 'WeCom', 'wecom'), capabilities.wecom),
      ])];
    case 'about':
      return [group('about', [
        { id: 'version', titleKey: 'Version', value: labels.appVersion, kind: 'value' },
        navigationRow('repository', 'Open Source Repository', 'repository'),
        navigationRow('privacy', 'Privacy Policy', 'privacy'),
        navigationRow('terms', 'Terms of Use', 'terms'),
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
        ...(data.debugMode ? [gateRow(navigationRow(
          'preview-environment',
          'Relay Environment',
          'preview-environment',
          { value: labels.previewEnvironment },
        ), capabilities.previewEnvironment)] : []),
        gateRow(navigationRow(
          'design-system',
          'Design System',
          'design-system',
        ), capabilities.designSystem),
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

export function formatAccountSettingsUptime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(' ');
}
