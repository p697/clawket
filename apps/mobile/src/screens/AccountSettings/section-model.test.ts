import type { ConnectionDescriptor } from '@clawket/agent-protocol';
import {
  buildAccountSettingsSectionModel,
  formatAccountSettingsUptime,
  resolveAccountSettingsSectionCapabilities,
  type AccountSettingsDetailSection,
  type AccountSettingsSectionLabels,
} from './section-model';

const labels: AccountSettingsSectionLabels = {
  theme: 'Dark',
  accent: 'Blue',
  chatAppearance: 'Compact',
  appIcon: 'Light',
  speechLanguage: 'Japanese',
  appVersion: '3.0.0',
  previewEnvironment: 'Preview',
};

function connection(
  patch: Partial<ConnectionDescriptor> = {},
): ConnectionDescriptor {
  return {
    id: 'studio',
    backendKind: 'openclaw',
    transportKind: 'relay',
    label: 'Studio',
    environment: 'preview',
    createdAt: 1,
    isFreeSlot: true,
    ...patch,
  };
}

describe('AccountSettings section model', () => {
  it('keeps advanced connection details scoped without duplicating lifecycle controls', () => {
    const model = buildAccountSettingsSectionModel({
      section: 'connections',
      labels,
      data: {
        connectionId: 'hermes',
        isPro: false,
        connections: [connection(), connection({ id: 'hermes', backendKind: 'hermes', label: 'Hermes' })],
      },
    });
    expect(model.groups.map(({ id }) => id)).toEqual(['connection-hermes']);
    const rows = model.groups.flatMap(({ rows }) => rows);
    expect(rows.find(({ id }) => id === 'hermes-backend')?.valueKey).toBe('Hermes');
    expect(rows.some(({ action }) => action === 'set-free-connection')).toBe(true);
    expect(rows.some(({ action }) => ['reconnect-connection', 'remove-connection', 'add-connection'].includes(action ?? ''))).toBe(false);
  });

  it('builds every root and fine-grained descriptor route', () => {
    const sections: ReadonlyArray<AccountSettingsDetailSection> = [
      'pro',
      'connections',
      'appearance',
      'voice',
      'notifications',
      'help',
      'community',
      'about',
      'developer',
    ];

    const models = sections.map((section) => buildAccountSettingsSectionModel({
      section,
      labels,
    }));

    expect(models.map((model) => model.titleKey)).toEqual([
      'Clawket Pro',
      'Connections',
      'Appearance',
      'Voice',
      'Chat & notifications',
      'Help & feedback',
      'Community',
      'About',
      'Developer',
    ]);
    expect(models.every((model) => model.supported && model.groups.length > 0)).toBe(true);
  });

  it('renders descriptor-provided Relay stats without branching on backend identity', () => {
    const model = buildAccountSettingsSectionModel({
      section: 'connections',
      labels,
      data: {
        connections: [{
          ...connection({ backendKind: 'hermes' }),
          state: 'ready',
          supportsRelayStats: true,
          relayStats: {
            state: 'ready',
            uptimeMs: ((24 * 60) + 125) * 60_000,
            serverVersion: '2026.9.5',
          },
        }],
      },
    });

    const rows = model.groups[0]?.rows ?? [];
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'studio-backend', valueKey: 'Hermes' }),
      expect.objectContaining({ id: 'studio-transport', valueKey: 'Relay' }),
      expect.objectContaining({ id: 'studio-environment', valueKey: 'Preview' }),
      expect.objectContaining({ id: 'studio-status', valueKey: 'Online' }),
      expect.objectContaining({ id: 'studio-relay-status', valueKey: 'Online' }),
      expect.objectContaining({ id: 'studio-relay-uptime', value: '1d 2h 5m' }),
      expect.objectContaining({ id: 'studio-relay-version', value: '2026.9.5' }),
    ]));
  });

  it('makes unsupported sections and row-level downgrades explicit', () => {
    const unsupported = buildAccountSettingsSectionModel({
      section: 'about',
      labels,
      capabilities: { about: false },
    });
    expect(unsupported).toMatchObject({ supported: false, groups: [] });

    const connectionModel = buildAccountSettingsSectionModel({
      section: 'connections',
      labels,
      capabilities: { relayStats: false, connectionManagement: false },
      data: {
        connections: [{
          ...connection(),
          supportsRelayStats: true,
          relayStats: { state: 'ready' },
        }],
      },
    });
    const rows = connectionModel.groups[0]?.rows ?? [];
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'studio-relay-statistics',
        disabled: true,
        valueKey: 'Unavailable',
      }),
      expect.objectContaining({
        id: 'studio-reconnect',
        disabled: true,
        valueKey: 'Unavailable',
      }),
    ]));

    const developerModel = buildAccountSettingsSectionModel({
      section: 'developer',
      labels,
      data: { debugMode: true },
    });
    expect(developerModel.groups[0]?.rows.map((row) => row.id)).toEqual([
      'debug-mode',
      'preview-environment',
      'design-system',
      'clear-cache',
      'reset-device',
    ]);
  });

  it('keeps paywall locks separate from backend capability gates', () => {
    const appearance = buildAccountSettingsSectionModel({
      section: 'appearance',
      labels,
      data: { isPro: false },
    });
    expect(appearance.groups[0]?.rows.find((row) => row.id === 'app-icon')).toMatchObject({
      locked: true,
      paywallReason: 'appIcons',
    });

    const unavailableAppearance = buildAccountSettingsSectionModel({
      section: 'appearance',
      labels,
      data: { isPro: false },
      capabilities: { appIcons: false },
    });
    expect(
      unavailableAppearance.groups[0]?.rows.find((row) => row.id === 'app-icon'),
    ).toMatchObject({
      locked: false,
      disabled: true,
      valueKey: 'Unavailable',
    });
  });

  it('models the 24-hour free-connection switch without unlocking a locked reconnect', () => {
    const model = buildAccountSettingsSectionModel({
      section: 'connections',
      labels,
      data: {
        isPro: false,
        connections: [
          { ...connection(), isFreeConnection: true },
          {
            ...connection({ id: 'work', label: 'Work', isFreeSlot: false }),
            locked: true,
            freeSwitchAvailable: false,
            freeSwitchStatus: 'Available tomorrow',
          },
        ],
      },
    });

    expect(model.groups[0]?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'studio-free-connection',
        kind: 'value',
        valueKey: 'Current',
      }),
    ]));
    expect(model.groups[1]?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'work-reconnect',
        locked: true,
        paywallReason: 'gatewayConnections',
      }),
      expect.objectContaining({
        id: 'work-set-free-connection',
        action: 'set-free-connection',
        disabled: true,
        value: 'Available tomorrow',
      }),
    ]));
    expect(model.groups[1]?.rows.find((row) => row.id === 'work-remove')?.locked).not.toBe(true);
  });

  it('defaults only omitted capabilities and fail-closes malformed uptime values', () => {
    const capabilities = resolveAccountSettingsSectionCapabilities({ designSystem: false });
    expect(capabilities.designSystem).toBe(false);
    expect(capabilities.connections).toBe(true);
    expect(formatAccountSettingsUptime(Number.NaN)).toBe('—');
    expect(formatAccountSettingsUptime(-1)).toBe('—');
    expect(formatAccountSettingsUptime(59_000)).toBe('0m');
  });
});
