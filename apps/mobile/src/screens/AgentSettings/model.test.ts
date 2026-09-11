import {
  CAPABILITY_MATRIX,
  type AgentDescriptor,
  type Capabilities,
  type ConnectionDescriptor,
} from '@clawket/agent-protocol';
import {
  buildAgentSettingsModel,
  formatCount,
  formatUsd,
  resolveAgentSettingsPageState,
} from './model';

const TRANSPORT_BY_BACKEND: Readonly<Record<ConnectionDescriptor['backendKind'], ConnectionDescriptor['transportKind']>> = {
  openclaw: 'relay',
  hermes: 'relay',
  youmind: 'https',
};

const MAIN_SESSION_BY_BACKEND: Readonly<Record<ConnectionDescriptor['backendKind'], string>> = {
  openclaw: 'agent:main:main',
  hermes: 'main',
  youmind: 'main',
};

function connection(
  backendKind: ConnectionDescriptor['backendKind'] = 'openclaw',
): ConnectionDescriptor {
  return {
    id: `connection-${backendKind}`,
    backendKind,
    transportKind: TRANSPORT_BY_BACKEND[backendKind],
    label: 'Studio',
    createdAt: 1,
    isFreeSlot: true,
  };
}

function agent(backendKind: ConnectionDescriptor['backendKind'] = 'openclaw'): AgentDescriptor {
  return {
    connectionId: `connection-${backendKind}`,
    agentId: 'main',
    name: 'Lucy',
    emoji: 'L',
    isMain: true,
    mainSessionKey: MAIN_SESSION_BY_BACKEND[backendKind],
  };
}

function capabilities(
  backendKind: keyof typeof CAPABILITY_MATRIX,
  patch: Partial<Capabilities> = {},
): Capabilities {
  return { ...CAPABILITY_MATRIX[backendKind], ...patch };
}

describe('Agent settings descriptor model', () => {
  it('builds the complete capability-backed OpenClaw groups and locks Pro rows', () => {
    const model = buildAgentSettingsModel({
      connection: connection(),
      agent: agent(),
      capabilities: capabilities('openclaw'),
      connectionState: 'ready',
      isPro: false,
      summary: {
        currentModel: 'deepseek-v4-flash',
        installedSkillCount: 105,
        cronJobCount: 6,
        hasCronFailure: true,
        todayCostUsd: 1.2,
        toolCount: 63,
        pendingConnectionCount: 1,
      },
    });

    expect(model.identity).toEqual({
      name: 'Lucy',
      detail: 'Studio · OpenClaw',
      editable: true,
      locked: false,
    });
    expect(model.groups[0]?.rows.map((row) => row.id)).toEqual([
      'models',
      'skills',
      'cron',
      'files',
      'usage',
    ]);
    expect(model.groups[1]?.rows.map((row) => row.id)).toEqual([
      'connection',
      'openclaw',
      'tools',
      'channels-devices',
      'logs',
    ]);
    expect(model.groups.flatMap((group) => group.rows)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'models', value: 'deepseek-v4-flash' }),
      expect.objectContaining({ id: 'skills', value: '105' }),
      expect.objectContaining({ id: 'cron', value: '6', attention: true }),
      expect.objectContaining({ id: 'usage', value: '$1.20' }),
      expect.objectContaining({ id: 'connection', value: 'Online' }),
      expect.objectContaining({ id: 'tools', value: '63' }),
      expect.objectContaining({ id: 'channels-devices', value: '1', attention: true }),
      expect.objectContaining({ id: 'openclaw', locked: false }),
      expect.objectContaining({ id: 'logs', locked: true }),
    ]));
  });

  it('hides every false capability without branching on backend identity', () => {
    const hermes = buildAgentSettingsModel({
      connection: connection('hermes'),
      agent: agent('hermes'),
      capabilities: capabilities('hermes'),
      connectionState: 'ready',
      isPro: true,
    });
    expect(hermes.groups.flatMap((group) => group.rows).map((row) => row.id)).toEqual([
      'models',
      'skills',
      'cron',
      'files',
      'usage',
      'connection',
    ]);
    expect(hermes.identity.editable).toBe(true);

    const sprite = buildAgentSettingsModel({
      connection: connection('youmind'),
      agent: agent('youmind'),
      capabilities: capabilities('youmind'),
      connectionState: 'ready',
      isPro: true,
      identityDetail: 'owner@example.com',
    });
    expect(sprite.identity).toMatchObject({
      detail: 'owner@example.com',
      editable: false,
    });
    expect(sprite.groups[0]?.rows).toEqual([]);
    expect(sprite.groups[1]?.rows.map((row) => row.id)).toEqual(['connection']);
  });

  it('shows the combined channels row when any contributing capability is true', () => {
    const base = capabilities('youmind', { devices: true });
    const model = buildAgentSettingsModel({
      connection: connection('youmind'),
      agent: agent('youmind'),
      capabilities: base,
      connectionState: 'offline',
      isPro: true,
    });
    expect(model.groups[1]?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'connection', value: 'Offline', attention: true }),
      expect.objectContaining({ id: 'channels-devices' }),
    ]));
  });

  it('locks the entire model for a permission-gated Agent', () => {
    const model = buildAgentSettingsModel({
      connection: connection(),
      agent: agent(),
      capabilities: capabilities('openclaw'),
      connectionState: 'ready',
      isPro: true,
      permissionDenied: true,
    });
    expect(model.identity).toMatchObject({ editable: false, locked: true });
    expect(model.groups.flatMap((group) => group.rows).every((row) => row.locked)).toBe(true);
  });

  it.each([
    [{ initialized: false, hasAgent: false, connectionState: 'idle' }, 'loading'],
    [{ initialized: true, hasAgent: false, connectionState: 'ready' }, 'empty'],
    [{ initialized: true, hasAgent: true, connectionState: 'ready', permissionDenied: true }, 'permission'],
    [{ initialized: true, hasAgent: true, connectionState: 'error' }, 'error'],
    [{ initialized: true, hasAgent: true, connectionState: 'ready', hasError: true }, 'error'],
    [{ initialized: true, hasAgent: true, connectionState: 'reconnecting' }, 'offline'],
    [{ initialized: true, hasAgent: true, connectionState: 'ready' }, 'ready'],
  ] as const)('resolves page state precedence', (input, expected) => {
    expect(resolveAgentSettingsPageState(input)).toBe(expected);
  });

  it('formats compact tail values without leaking invalid numbers', () => {
    expect(formatCount(3.9)).toBe('3');
    expect(formatCount(-4)).toBe('0');
    expect(formatCount(Number.NaN)).toBeUndefined();
    expect(formatUsd(1.2)).toBe('$1.20');
    expect(formatUsd(12.49)).toBe('$12.49');
    expect(formatUsd(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});
