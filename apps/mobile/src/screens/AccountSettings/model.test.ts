import type { ConnectionDescriptor } from '@clawket/agent-protocol';
import {
  buildAccountSettingsGroups,
  getConnectionValueKeys,
  resolveAccountSettingsCapabilities,
  resolveAccountSettingsRuntimeStatus,
  type AccountSettingsLabels,
} from './model';

const labels: AccountSettingsLabels = {
  theme: 'System',
  accent: 'Blue',
  chatAppearance: 'Default',
  appIcon: 'Default',
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
  it('keeps local preferences available through connection failures and membership changes', () => {
    const ready = {
      connectionInitialized: true,
      connectionSwitching: false,
      connectionCount: 1,
      activeConnectionId: 'connection-one',
      activeState: 'ready' as const,
      permissionsLoading: false,
      permissionReason: null,
    };

    expect(resolveAccountSettingsRuntimeStatus({
      ...ready,
      permissionsLoading: true,
    })).toEqual({ kind: 'ready' });
    expect(resolveAccountSettingsRuntimeStatus({ ...ready, connectionInitialized: false })).toEqual({ kind: 'loading' });
    expect(resolveAccountSettingsRuntimeStatus({
      ...ready,
      connectionCount: 0,
      activeConnectionId: null,
      activeState: 'idle',
    })).toEqual({ kind: 'empty' });
    expect(resolveAccountSettingsRuntimeStatus({
      ...ready,
      activeState: 'reconnecting',
    })).toEqual({ kind: 'ready' });
    expect(resolveAccountSettingsRuntimeStatus({
      ...ready,
      permissionReason: 'gatewayConnections',
    })).toEqual({ kind: 'ready' });
    expect(resolveAccountSettingsRuntimeStatus({
      ...ready,
      connectionErrorCode: 'probe',
    })).toEqual({ kind: 'ready' });
    expect(resolveAccountSettingsRuntimeStatus(ready)).toEqual({ kind: 'ready' });
  });

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
    expect(groups.find((group) => group.id === 'pro')?.rows).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'pro-status', locked: true })]),
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
    expect(groups.find((group) => group.id === 'pro')?.rows).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'pro-status', locked: false })]),
    );
  });
});
