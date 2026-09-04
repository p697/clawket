import type { ConnectionDescriptor } from '@clawket/agent-protocol';
import {
  buildAccountSettingsGroups,
  getConnectionValueKeys,
  resolveAccountSettingsCapabilities,
  type AccountSettingsLabels,
} from './model';

const labels: AccountSettingsLabels = {
  theme: 'System',
  accent: 'Blue',
  chatAppearance: 'Default',
  appIcon: 'Default',
  speechLanguage: 'System',
  appVersion: '3.0.0',
  previewEnvironment: 'Preview',
};

function connection(
  patch: Partial<ConnectionDescriptor> = {},
): ConnectionDescriptor {
  return {
    id: 'connection-one',
    backendKind: 'openclaw',
    transportKind: 'relay',
    label: 'Studio',
    environment: 'preview',
    createdAt: 1,
    isFreeSlot: true,
    ...patch,
  };
}

describe('AccountSettings model', () => {
  it('builds every specified group and keeps backend and transport identity separate', () => {
    const groups = buildAccountSettingsGroups({
      connections: [connection()],
      labels,
      isPro: false,
      canAddConnection: false,
      debugMode: true,
    });

    expect(groups.map((group) => group.id)).toEqual([
      'pro',
      'connections',
      'appearance',
      'voice',
      'notifications',
      'help',
      'community',
      'about',
      'developer',
    ]);
    expect(getConnectionValueKeys(connection())).toEqual([
      'OpenClaw',
      'Relay',
      'Preview',
    ]);
    expect(groups.find((group) => group.id === 'connections')?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'connection-connection-one',
          title: 'Studio',
          valueKeys: ['OpenClaw', 'Relay', 'Preview'],
        }),
        expect.objectContaining({ id: 'add-connection', locked: true }),
      ]),
    );
    expect(groups.find((group) => group.id === 'appearance')?.rows).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'app-icon', locked: true })]),
    );
    expect(groups.find((group) => group.id === 'developer')?.rows).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'preview-environment' })]),
    );
  });

  it('downgrades unavailable capability groups without inspecting a backend kind', () => {
    const groups = buildAccountSettingsGroups({
      connections: [connection({ backendKind: 'hermes', transportKind: 'local' })],
      capabilities: {
        subscription: false,
        appIcons: false,
        voice: false,
        notifications: false,
        community: false,
        developer: false,
      },
      labels,
      isPro: true,
      canAddConnection: true,
      debugMode: true,
    });

    expect(groups.map((group) => group.id)).toEqual([
      'connections',
      'appearance',
      'help',
      'about',
    ]);
    expect(groups.find((group) => group.id === 'appearance')?.rows.map((row) => row.id)).toEqual([
      'theme',
      'accent',
      'chat-appearance',
    ]);
  });

  it('hides Preview outside Debug Mode and defaults only omitted capabilities', () => {
    const capabilities = resolveAccountSettingsCapabilities({ designSystem: false });
    expect(capabilities.designSystem).toBe(false);
    expect(capabilities.connections).toBe(true);

    const groups = buildAccountSettingsGroups({
      connections: [],
      capabilities,
      labels,
      isPro: true,
      canAddConnection: true,
      debugMode: false,
    });
    expect(groups.find((group) => group.id === 'developer')?.rows.map((row) => row.id)).toEqual([
      'debug-mode',
      'clear-cache',
      'reset-device',
    ]);
  });
});
