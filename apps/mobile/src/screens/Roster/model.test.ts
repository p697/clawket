import type {
  AgentDescriptor,
  ConnectionDescriptor,
  SessionDescriptor,
} from '@clawket/agent-protocol';
import type { RosterConnectionGroup } from '../../connection';
import { buildRosterRows, resolveRosterLiveConnectionId, resolveRosterPageState } from './model';

const actions = { rename: true, reset: true, delete: true, pin: true };

function connection(id: string): ConnectionDescriptor {
  return {
    id,
    backendKind: 'openclaw',
    transportKind: 'relay',
    label: id,
    createdAt: 1,
    isFreeSlot: id === 'one',
  };
}

function agent(connectionId: string, agentId: string): AgentDescriptor {
  return {
    connectionId,
    agentId,
    name: agentId === 'main' ? 'Main' : 'Builder',
    emoji: agentId === 'main' ? 'C' : undefined,
    isMain: agentId === 'main',
    mainSessionKey: `agent:${agentId}:main`,
  };
}

function session(
  connectionId: string,
  agentId: string,
  key: string,
  patch: Partial<SessionDescriptor> = {},
): SessionDescriptor {
  return {
    connectionId,
    agentId,
    key,
    kind: 'channel',
    title: 'General',
    channel: 'general',
    updatedAt: 100,
    preview: 'Latest work',
    hasActiveRun: false,
    attention: null,
    allowedActions: actions,
    ...patch,
  };
}

function group(id: string, source: 'live' | 'cache' = 'live'): RosterConnectionGroup {
  const main = agent(id, 'main');
  const builder = agent(id, 'builder');
  const mainSessions = [
    session(id, 'main', main.mainSessionKey, { kind: 'main', title: 'Main' }),
    session(id, 'main', 'agent:main:channel:general'),
  ];
  return {
    connection: connection(id),
    source,
    syncedAt: 100,
    agents: [
      {
        agent: main,
        sessions: mainSessions,
        preview: 'Main preview',
        lastActivityAt: 100,
        unreadCount: 2,
        hasUnread: true,
        attentionCount: 1,
        attention: 'approval',
      },
      {
        agent: builder,
        sessions: [session(id, 'builder', builder.mainSessionKey, { kind: 'main' })],
        lastActivityAt: 90,
        unreadCount: 0,
        hasUnread: false,
        attentionCount: 0,
        attention: null,
      },
    ],
    unreadCount: 2,
    attentionCount: 1,
    lastActivityAt: 100,
  };
}

describe('Roster model', () => {
  it('keeps pinned sessions with their Agent while interleaving connections by activity', () => {
    const cachedSource = group('two', 'cache');
    const cachedGroup: RosterConnectionGroup = {
      ...cachedSource,
      agents: cachedSource.agents.map((summary, index) => index === 0
        ? {
            ...summary,
            sessions: summary.sessions.map((entry) => ({
              ...entry,
              hasActiveRun: true,
            })),
          }
        : summary),
    };
    const rows = buildRosterRows([group('one'), cachedGroup], {
      pinnedSessionKeys: {
        'one:main': ['agent:main:channel:general'],
        'two:main': ['agent:main:channel:general'],
      },
    });

    expect(rows.map((row) => row.key)).toEqual([
      'agent:one:main',
      'session:one:agent:main:channel:general',
      'agent:two:main',
      'session:two:agent:main:channel:general',
      'agent:one:builder',
      'agent:two:builder',
    ]);
    expect(rows[1]).toMatchObject({
      name: '#general',
      kind: 'pinned_session',
      avatarName: 'Main',
      emoji: 'C',
      sessionKind: 'channel',
    });
    expect(rows.filter((row) => row.connectionId === 'two').every((row) => (
      row.cached
      && row.syncedAt === 100
      && row.unreadCount === 0
      && row.attention === null
      && row.working === false
    ))).toBe(true);
  });

  it('pins an Agent above newer Agents on other connections', () => {
    const rows = buildRosterRows([group('one'), group('two')], {
      agentPreferences: { 'two:builder': { agentPinned: true } },
    });
    expect(rows[0]).toMatchObject({ connectionId: 'two', agentId: 'builder', agentPinned: true });
    expect(rows.map((row) => `${row.connectionId}:${row.agentId}`)).toEqual([
      'two:builder', 'one:main', 'two:main', 'one:builder',
    ]);
  });

  it('uses live work phases even before a session list snapshot catches up', () => {
    const rows = buildRosterRows([group('one'), group('two'), group('cached', 'cache')], {
      runActivities: [
        { connectionId: 'one', sessionKey: 'agent:main:main', runId: 'r1', phase: 'tool' },
        { connectionId: 'cached', sessionKey: 'agent:main:main', runId: 'r2', phase: 'thinking' },
      ],
    });
    expect(rows.find((row) => row.connectionId === 'one' && row.agentId === 'main')).toMatchObject({ working: true, activity: 'tool' });
    expect(rows.filter((row) => row.connectionId !== 'one').every((row) => !row.working)).toBe(true);
  });

  it('projects registry-provided semantic subtitles without inspecting the backend', () => {
    const source = group('sprite');
    const rows = buildRosterRows([{
      ...source,
      agents: source.agents.map((summary, index) => index === 0
        ? { ...summary, subtitle: { kind: 'backend' as const, label: 'YouMind' } }
        : summary),
    }]);

    expect(rows[0]).toMatchObject({
      kind: 'agent',
      subtitle: { kind: 'backend', label: 'YouMind' },
    });
    expect(rows[0]).not.toHaveProperty('preview');
  });

  it('locks inaccessible Agents and their pinned sessions without hiding them', () => {
    const rows = buildRosterRows([group('one')], {
      pinnedSessionKeys: { 'one:main': ['agent:main:channel:general'] },
      canAccessAgent: (_connectionId, agentId) => agentId === 'main',
    });

    expect(rows.find((row) => row.agentId === 'main')?.locked).toBe(false);
    expect(rows.find((row) => row.agentId === 'builder')?.locked).toBe(true);
  });

  it('lifts locally pinned Agents and otherwise keeps the registry activity order', () => {
    const source = group('one');
    const builder = source.agents[1];
    // Registry order is by human activity; `quiet` is the most recent but has
    // no unread or attention, `main` has both yet is older.
    const quiet = {
      ...source.agents[0],
      agent: { ...source.agents[0].agent, agentId: 'quiet', name: 'Quiet' },
      attention: null,
      attentionCount: 0,
      hasUnread: false,
      unreadCount: 0,
      lastActivityAt: 200,
    };
    const rows = buildRosterRows([{
      ...source,
      agents: [quiet, source.agents[0], builder],
    }], {
      agentPreferences: {
        'one:builder': { agentPinned: true },
      },
    });

    expect(rows.filter((row) => row.kind === 'agent').map((row) => row.agentId)).toEqual([
      'builder',
      'quiet',
      'main',
    ]);
    expect(rows[0]).toMatchObject({ agentPinned: true });
    expect(rows.find((row) => row.agentId === 'main')).toMatchObject({
      unreadCount: 2,
      attention: 'approval',
      lastActivityAt: 100,
    });
  });

  it('keeps the same order for a cached snapshot and a live one', () => {
    const live = group('one');
    const cached = group('one', 'cache');
    const order = (rows: ReturnType<typeof buildRosterRows>) => rows.map((row) => row.key);

    expect(order(buildRosterRows([cached]))).toEqual(order(buildRosterRows([live])));
  });

  it('labels pinned session rows with their own human activity time', () => {
    const source = group('one');
    const channel = source.agents[0].sessions[1];
    const rows = buildRosterRows([{
      ...source,
      agents: [{
        ...source.agents[0],
        sessions: [
          source.agents[0].sessions[0],
          { ...channel, updatedAt: 900, lastActivityAt: 300 },
        ],
      }, source.agents[1]],
    }], { pinnedSessionKeys: { 'one:main': [channel.key] } });

    expect(rows[1]).toMatchObject({ kind: 'pinned_session', lastActivityAt: 300 });
  });

  it.each([
    [{ initialized: false, connectionCount: 0, rowCount: 0, activeState: 'idle', hasError: false }, 'loading'],
    [{ initialized: true, connectionCount: 0, rowCount: 0, activeState: 'idle', hasError: false }, 'empty'],
    [{ initialized: true, connectionCount: 1, rowCount: 1, activeState: 'ready', hasError: false, allRowsLocked: true }, 'permission'],
    [{ initialized: true, connectionCount: 1, rowCount: 1, activeState: 'offline', hasError: true }, 'offline'],
    [{ initialized: true, connectionCount: 1, rowCount: 1, activeState: 'ready', hasError: true }, 'error'],
    [{ initialized: true, connectionCount: 1, rowCount: 1, activeState: 'ready', hasError: false }, 'ready'],
  ] as const)('resolves the page state deterministically', (input, expected) => {
    expect(resolveRosterPageState(input)).toBe(expected);
  });
});

describe('resolveRosterLiveConnectionId', () => {
  const mixed = [{ connectionId: 'one' }, { connectionId: 'two' }, { connectionId: 'one' }];
  const live = (patch: Partial<Parameters<typeof resolveRosterLiveConnectionId>[0]> = {}) => (
    resolveRosterLiveConnectionId({
      rows: mixed,
      activeConnectionId: 'one',
      activeState: 'ready',
      recovering: false,
      offline: false,
      ...patch,
    })
  );

  it('marks the ready active connection only when the roster mixes connections', () => {
    expect(live()).toBe('one');
    expect(live({ rows: [{ connectionId: 'one' }, { connectionId: 'one' }] })).toBeNull();
    // Rows of another connection alone never borrow the dot.
    expect(live({ rows: [{ connectionId: 'two' }, { connectionId: 'three' }] })).toBeNull();
    expect(live({ rows: [] })).toBeNull();
    expect(live({ activeConnectionId: null })).toBeNull();
  });

  it('holds the dot through the recovery window and drops it offline, paused or connecting', () => {
    expect(live({ activeState: 'reconnecting', recovering: true })).toBe('one');
    expect(live({ activeState: 'reconnecting' })).toBeNull();
    expect(live({ activeState: 'connecting' })).toBeNull();
    expect(live({ activeState: 'idle' })).toBeNull();
    expect(live({ activeState: 'ready', offline: true })).toBeNull();
  });
});
