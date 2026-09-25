import type {
  BackendKind,
  ConnectionDescriptor,
  ConnectionState,
  ServiceEnvironment,
  TransportKind,
} from '@clawket/agent-protocol';

export type AccountSettingsPageStatus =
  | Readonly<{ kind: 'ready' }>
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'offline' }>
  | Readonly<{ kind: 'error'; code: string }>
  | Readonly<{
      kind: 'permission';
      reason: 'gatewayConnections' | 'appIcons' | 'generic';
    }>;

export type AccountSettingsRuntimeStatusInput = Readonly<{
  connectionInitialized: boolean;
  connectionSwitching: boolean;
  connectionCount: number;
  activeConnectionId: string | null;
  activeState: ConnectionState;
  connectionErrorCode?: string | null;
  permissionsLoading: boolean;
  permissionReason?: Extract<
    AccountSettingsPageStatus,
    { kind: 'permission' }
  >['reason'] | null;
}>;

export function resolveAccountSettingsRuntimeStatus(
  input: AccountSettingsRuntimeStatusInput,
): AccountSettingsPageStatus {
  if (
    !input.connectionInitialized
  ) {
    return { kind: 'loading' };
  }
  if (input.connectionCount <= 0) return { kind: 'empty' };
  // Local preferences stay available regardless of Agent connectivity or the
  // entitlement to add another connection. Those states belong to their page.
  return { kind: 'ready' };
}

export type AccountSettingsCapability =
  | 'subscription'
  | 'connections'
  | 'appearance'
  | 'appIcons'
  | 'help'
  | 'community'
  | 'about'
  | 'developer'
  | 'previewEnvironment'
  | 'designSystem';

export type AccountSettingsCapabilities = Readonly<
  Record<AccountSettingsCapability, boolean>
>;

export const DEFAULT_ACCOUNT_SETTINGS_CAPABILITIES: AccountSettingsCapabilities =
  Object.freeze({
    subscription: true,
    connections: true,
    appearance: true,
    appIcons: true,
    help: true,
    community: true,
    about: true,
    developer: true,
    previewEnvironment: true,
    designSystem: true,
  });

export type AccountSettingsAction =
  | 'view-pro'
  | 'restore-purchases'
  | 'add-connection'
  | 'theme'
  | 'accent'
  | 'chat-appearance'
  | 'app-icon'
  | 'app-language'
  | 'help-center'
  | 'openclaw-docs'
  | 'hermes-docs'
  | 'release-notes'
  | 'openclaw-releases'
  | 'feedback'
  | 'share'
  | 'rate'
  | 'discord'
  | 'repository'
  | 'privacy'
  | 'terms'
  | 'preview-environment'
  | 'design-system'
  | 'preview-update-announcement'
  | 'clear-cache'
  | 'reset-device';

export type AccountSettingsGroupId =
  | 'pro'
  | 'connections'
  | 'appearance'
  | 'help'
  | 'community'
  | 'about'
  | 'developer';

export type AccountSettingsConnection = ConnectionDescriptor & Readonly<{
  locked?: boolean;
}>;

export type AccountSettingsLabels = Readonly<{
  theme: string;
  accent: string;
  chatAppearance: string;
  appIcon: string;
  appVersion: string;
  previewEnvironment: string;
}>;

export type AccountSettingsRow = Readonly<{
  id: string;
  titleKey?: string;
  title?: string;
  value?: string;
  valueKey?: string;
  valueKeys?: ReadonlyArray<string>;
  action?: AccountSettingsAction;
  connectionId?: string;
  kind?: 'navigation' | 'toggle' | 'value';
  toggle?: 'debugMode';
  locked?: boolean;
  attention?: boolean;
}>;

export type AccountSettingsGroup = Readonly<{
  id: AccountSettingsGroupId;
  titleKey: string;
  rows: ReadonlyArray<AccountSettingsRow>;
}>;

export type BuildAccountSettingsGroupsInput = Readonly<{
  connections: ReadonlyArray<AccountSettingsConnection>;
  capabilities?: Partial<AccountSettingsCapabilities>;
  labels: AccountSettingsLabels;
  isPro: boolean;
  canAddConnection: boolean;
  debugMode: boolean;
}>;

const BACKEND_LABELS: Readonly<Record<BackendKind, string>> = Object.freeze({
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  youmind: 'YouMind Sprite',
  'local-model': 'Local model',
  pi: 'Pi',
});

const TRANSPORT_LABELS: Readonly<Record<TransportKind, string>> = Object.freeze({
  relay: 'Relay',
  local: 'Local',
  tailscale: 'Tailscale',
  cloudflare: 'Cloudflare',
  custom: 'Custom',
  https: 'HTTPS',
});

const ENVIRONMENT_LABELS: Readonly<Record<ServiceEnvironment, string>> = Object.freeze({
  production: 'Production',
  preview: 'Preview',
});

export function resolveAccountSettingsCapabilities(
  capabilities?: Partial<AccountSettingsCapabilities>,
): AccountSettingsCapabilities {
  return { ...DEFAULT_ACCOUNT_SETTINGS_CAPABILITIES, ...capabilities };
}

export function getConnectionValueKeys(
  connection: ConnectionDescriptor,
): readonly [string, string, string] {
  return [
    BACKEND_LABELS[connection.backendKind],
    TRANSPORT_LABELS[connection.transportKind],
    ENVIRONMENT_LABELS[connection.environment ?? 'production'],
  ];
}

export function buildAccountSettingsGroups({
  connections,
  capabilities: capabilityOverrides,
  labels,
  isPro,
  canAddConnection,
  debugMode,
}: BuildAccountSettingsGroupsInput): ReadonlyArray<AccountSettingsGroup> {
  const capabilities = resolveAccountSettingsCapabilities(capabilityOverrides);
  const groups: AccountSettingsGroup[] = [];

  if (capabilities.subscription) {
    groups.push({
      id: 'pro',
      titleKey: 'Pro',
      rows: [
        {
          id: 'pro-status',
          titleKey: 'Clawket Pro',
          valueKey: isPro ? 'Active' : 'Free',
          action: 'view-pro',
          kind: 'navigation',
          locked: !isPro,
        },
        {
          id: 'restore-purchases',
          titleKey: 'Restore Purchases',
          action: 'restore-purchases',
          kind: 'navigation',
        },
      ],
    });
  }

  if (capabilities.connections) {
    groups.push({
      id: 'connections',
      titleKey: 'Connections',
      rows: [
        ...connections.map((connection): AccountSettingsRow => ({
          id: `connection-${connection.id}`,
          title: connection.label,
          valueKeys: getConnectionValueKeys(connection),
          connectionId: connection.id,
          kind: 'navigation',
          locked: connection.locked === true,
        })),
        {
          id: 'add-connection',
          titleKey: 'Add Connection',
          action: 'add-connection',
          kind: 'navigation',
          locked: !canAddConnection,
        },
      ],
    });
  }

  if (capabilities.appearance) {
    const rows: AccountSettingsRow[] = [
      { id: 'theme', titleKey: 'Theme', value: labels.theme, action: 'theme', kind: 'navigation' },
      {
        id: 'chat-appearance',
        titleKey: 'Chat theme',
        value: labels.chatAppearance,
        action: 'chat-appearance',
        kind: 'navigation',
      },
    ];
    if (capabilities.appIcons) {
      rows.push({
        id: 'app-icon',
        titleKey: 'App Icon',
        value: labels.appIcon,
        action: 'app-icon',
        kind: 'navigation',
        locked: !isPro,
      });
    }
    groups.push({ id: 'appearance', titleKey: 'Appearance', rows });
  }

  if (capabilities.help) {
    groups.push({
      id: 'help',
      titleKey: 'Help',
      rows: [
        { id: 'help-center', titleKey: 'Help Center', action: 'help-center', kind: 'navigation' },
        { id: 'openclaw-docs', titleKey: 'OpenClaw Documentation', action: 'openclaw-docs', kind: 'navigation' },
        { id: 'hermes-docs', titleKey: 'Hermes Documentation', action: 'hermes-docs', kind: 'navigation' },
        { id: 'release-notes', titleKey: 'Release Notes', action: 'release-notes', kind: 'navigation' },
        { id: 'openclaw-releases', titleKey: 'OpenClaw Releases', action: 'openclaw-releases', kind: 'navigation' },
        { id: 'feedback', titleKey: 'Send Feedback', action: 'feedback', kind: 'navigation' },
      ],
    });
  }

  if (capabilities.community) {
    groups.push({
      id: 'community',
      titleKey: 'Community',
      rows: [
        { id: 'share', titleKey: 'Share Clawket', action: 'share', kind: 'navigation' },
        { id: 'rate', titleKey: 'Rate Clawket', action: 'rate', kind: 'navigation' },
        { id: 'discord', titleKey: 'Discord', action: 'discord', kind: 'navigation' },
      ],
    });
  }

  if (capabilities.about) {
    groups.push({
      id: 'about',
      titleKey: 'About',
      rows: [
        { id: 'version', titleKey: 'Version', value: labels.appVersion, kind: 'value' },
        { id: 'repository', titleKey: 'Open Source Repository', action: 'repository', kind: 'navigation' },
        { id: 'privacy', titleKey: 'Privacy Policy', action: 'privacy', kind: 'navigation' },
        { id: 'terms', titleKey: 'Terms of Use', action: 'terms', kind: 'navigation' },
      ],
    });
  }

  if (capabilities.developer) {
    const rows: AccountSettingsRow[] = [
      { id: 'debug-mode', titleKey: 'Debug Mode', kind: 'toggle', toggle: 'debugMode' },
    ];
    if (debugMode && capabilities.previewEnvironment) {
      rows.push({
        id: 'preview-environment',
        titleKey: 'Relay Environment',
        value: labels.previewEnvironment,
        action: 'preview-environment',
        kind: 'navigation',
      });
    }
    if (capabilities.designSystem) {
      rows.push({
        id: 'design-system',
        titleKey: 'Design System',
        action: 'design-system',
        kind: 'navigation',
      });
    }
    rows.push(
      { id: 'clear-cache', titleKey: 'Clear Cache', action: 'clear-cache', kind: 'navigation' },
      { id: 'reset-device', titleKey: 'Reset Device', action: 'reset-device', kind: 'navigation' },
    );
    groups.push({ id: 'developer', titleKey: 'Developer', rows });
  }

  return groups;
}
