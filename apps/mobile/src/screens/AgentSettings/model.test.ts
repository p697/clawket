import {
  CAPABILITY_MATRIX,
  type AgentDescriptor,
  type Capabilities,
  type ConnectionDescriptor,
} from '@clawket/agent-protocol';
import {
  buildAgentSettingsModel,
  formatCount,
  formatTokens,
  formatUsd,
  resolveAgentSettingsPageState,
} from './model';

const NOW = new Date(2026, 8, 11, 12, 0, 0).getTime();

const TRANSPORT_BY_BACKEND: Readonly<Record<ConnectionDescriptor['backendKind'], ConnectionDescriptor['transportKind']>> = {
  openclaw: 'relay',
  hermes: 'relay',
  'local-model': 'relay', youmind: 'https',
};

const MAIN_SESSION_BY_BACKEND: Readonly<Record<ConnectionDescriptor['backendKind'], string>> = {
  openclaw: 'agent:main:main',
  hermes: 'main',
  youmind: 'main',
  'local-model': 'main',
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
  it('builds the stat cards and the connection group for OpenClaw and locks Pro rows', () => {
    const input = {
      connection: connection(),
      agent: agent(),
      capabilities: capabilities('openclaw'),
      connectionState: 'ready' as const,
      isPro: false,
      now: NOW,
      summary: {
        modelCount: 16,
        installedSkillCount: 105,
        cronJobCount: 6,
        cronFailureCount: 2,
        hasCronFailure: true,
        fileCount: 7,
        todayCostUsd: 1.2,
        todayTokens: 965_200,
        lastHeartbeatAt: NOW - 19 * 60_000 - 10_000,
        toolCount: 63,
        pendingConnectionCount: 1,
      },
    };
    const model = buildAgentSettingsModel(input);

    // The Gateway heartbeat is one shared value; with several Agents it cannot be attributed.
    expect(buildAgentSettingsModel({ ...input, agentCount: 2 }).identity.activeMinutesAgo).toBeNull();
    expect(buildAgentSettingsModel({ ...input, agentCount: 1 }).identity.activeMinutesAgo).toBe(19);
    expect(model.identity).toEqual({
      name: 'Lucy',
      detail: 'Studio · OpenClaw',
      backendLabel: 'OpenClaw',
      activeMinutesAgo: 19,
      editable: true,
      locked: false,
    });
    expect(model.stats.map((stat) => [stat.id, stat.placement])).toEqual([
      ['cron', 'hero'],
      ['usage', 'hero'],
      ['models', 'tile'],
      ['skills', 'tile'],
      ['files', 'tile'],
    ]);
    expect(model.stats).toEqual([
      expect.objectContaining({
        id: 'cron',
        title: 'Cron jobs',
        value: '6',
        detail: { key: '{{count}} failed', params: { count: 2 }, tone: 'bad' },
        attention: true,
        locked: false,
      }),
      expect.objectContaining({
        id: 'usage',
        title: 'Cost today',
        value: '$1.20',
        detail: { key: '{{value}} tokens', params: { value: '965.2K' }, tone: 'neutral' },
        attention: false,
      }),
      expect.objectContaining({ id: 'models', title: 'Models', value: '16', detail: undefined }),
      expect.objectContaining({ id: 'skills', title: 'Skills', value: '105' }),
      expect.objectContaining({ id: 'files', title: 'Files', value: '7' }),
    ]);
    expect(model.groups).toHaveLength(1);
    expect(model.groups[0]?.title).toBe('Studio');
    expect(model.groups[0]?.rows.map((row) => [row.id, row.placement])).toEqual([
      ['connection', 'primary'],
      ['openclaw', 'advanced'],
      ['tools', 'advanced'],
      ['channels-devices', 'advanced'],
      ['logs', 'advanced'],
    ]);
    expect(model.groups[0]?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'connection', value: 'Online', attention: false }),
      expect.objectContaining({ id: 'tools', value: '63' }),
      expect.objectContaining({ id: 'channels-devices', value: '1', attention: true }),
      expect.objectContaining({ id: 'openclaw', locked: false }),
      expect.objectContaining({ id: 'logs', locked: true }),
    ]));
  });

  it('degrades the cost card to tokens and drops captions when a number is missing', () => {
    const build = (summary: Parameters<typeof buildAgentSettingsModel>[0]['summary']) => buildAgentSettingsModel({
      connection: connection(),
      agent: agent(),
      capabilities: capabilities('openclaw'),
      connectionState: 'ready',
      isPro: true,
      now: NOW,
      summary,
    });

    const tokensOnly = build({ todayTokens: 12_000, cronJobCount: 3, cronFailureCount: 0 });
    expect(tokensOnly.stats.find((stat) => stat.id === 'usage')).toMatchObject({
      title: 'Tokens today',
      value: '12K',
      detail: undefined,
    });
    expect(tokensOnly.stats.find((stat) => stat.id === 'cron')).toMatchObject({
      value: '3',
      detail: undefined,
      attention: false,
    });
    expect(tokensOnly.identity.activeMinutesAgo).toBeNull();


    const nothing = build({});
    expect(nothing.stats.find((stat) => stat.id === 'usage')).toMatchObject({
      title: 'Cost today',
      value: undefined,
      detail: undefined,
    });
    expect(nothing.stats.every((stat) => stat.value === undefined)).toBe(true);
  });

  it('hides every false capability without branching on backend identity', () => {
    const hermes = buildAgentSettingsModel({
      connection: connection('hermes'),
      agent: agent('hermes'),
      capabilities: capabilities('hermes'),
      connectionState: 'ready',
      isPro: true,
      now: NOW,
      summary: { lastHeartbeatAt: NOW - 60_000 },
    });
    expect(hermes.stats.map((stat) => stat.id)).toEqual(['cron', 'usage', 'models', 'skills', 'files']);
    expect(hermes.groups.flatMap((group) => group.rows).map((row) => row.id)).toEqual(['connection']);
    expect(hermes.identity.editable).toBe(true);
    // Hermes declares no heartbeat, so a stray timestamp never becomes an activity line.
    expect(hermes.identity.activeMinutesAgo).toBeNull();

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
    expect(sprite.stats).toEqual([]);
    expect(sprite.groups.map((group) => group.rows.map((row) => row.id))).toEqual([['connection']]);
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
    expect(model.groups[0]?.rows).toEqual(expect.arrayContaining([
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
    expect(model.stats.every((stat) => stat.locked)).toBe(true);
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
    expect(formatTokens(965_200)).toBe('965.2K');
    expect(formatTokens(1_000_000)).toBe('1M');
    expect(formatTokens(-5)).toBe('0');
    expect(formatTokens(Number.NaN)).toBeUndefined();
  });
});
