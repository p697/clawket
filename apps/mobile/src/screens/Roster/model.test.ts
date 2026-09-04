import type {
  AgentDescriptor,
  ConnectionDescriptor,
  SessionDescriptor,
} from '@clawket/agent-protocol';
import type { RosterConnectionGroup } from '../../connection';
import { buildRosterRows, resolveRosterPageState } from './model';

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
        updatedAt: 100,
        lastActivityAt: 100,
        unreadCount: 2,
        hasUnread: true,
        attentionCount: 1,
        attention: 'approval',
      },
      {
        agent: builder,
        sessions: [session(id, 'builder', builder.mainSessionKey, { kind: 'main' })],
        updatedAt: 90,
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
  it('keeps pinned sessions immediately below their Agent and connection groups adjacent', () => {
    const rows = buildRosterRows([group('one'), group('two', 'cache')], {
      pinnedSessionKeys: {
        'one:main': ['agent:main:channel:general'],
      },
    });

    expect(rows.map((row) => row.key)).toEqual([
      'agent:one:main',
      'session:one:agent:main:channel:general',
      'agent:one:builder',
      'agent:two:main',
      'agent:two:builder',
    ]);
    expect(rows[1]).toMatchObject({ name: '#general', kind: 'pinned_session' });
    expect(rows.slice(3).every((row) => row.cached)).toBe(true);
  });

  it('locks inaccessible Agents and their pinned sessions without hiding them', () => {
    const rows = buildRosterRows([group('one')], {
      pinnedSessionKeys: { 'one:main': ['agent:main:channel:general'] },
      canAccessAgent: (_connectionId, agentId) => agentId === 'main',
    });

    expect(rows.find((row) => row.agentId === 'main')?.locked).toBe(false);
    expect(rows.find((row) => row.agentId === 'builder')?.locked).toBe(true);
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
