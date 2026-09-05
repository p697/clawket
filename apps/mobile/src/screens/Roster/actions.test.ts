import type { RosterDisplayRow } from './model';
import type { AgentAdapter, BackendKind } from '@clawket/agent-protocol';
import type { RosterConnectionGroup } from '../../connection';
import {
  assembleRosterAddActions,
  assembleRosterRowActions,
  isRosterAgentMuted,
  renameRosterSession,
  resolveRosterCreateAgentTarget,
} from './actions';

function row(
  kind: RosterDisplayRow['kind'],
  patch: Partial<RosterDisplayRow> = {},
): RosterDisplayRow {
  return {
    key: `${kind}:connection:agent`,
    kind,
    connectionId: 'connection',
    agentId: 'agent',
    sessionKey: 'agent:agent:main',
    name: 'Agent',
    updatedAt: 1,
    syncedAt: null,
    unreadCount: 0,
    attention: null,
    working: false,
    cached: false,
    locked: false,
    agentPinned: false,
    muted: false,
    ...patch,
  };
}

function rosterGroup(
  connectionId: string,
  backendKind: BackendKind,
  agentIds: ReadonlyArray<string>,
  mainSessionKeyFor: (agentId: string) => string,
): RosterConnectionGroup {
  return {
    connection: {
      id: connectionId,
      backendKind,
      transportKind: 'relay',
      label: connectionId,
      createdAt: 1,
      isFreeSlot: false,
    },
    source: 'live',
    syncedAt: 1,
    agents: agentIds.map((agentId, index) => ({
      agent: {
        connectionId,
        agentId,
        name: agentId,
        isMain: index === 0,
        mainSessionKey: mainSessionKeyFor(agentId),
      },
      sessions: [],
      updatedAt: null,
      lastActivityAt: null,
      unreadCount: 0,
      hasUnread: false,
      attentionCount: 0,
      attention: null,
    })),
    unreadCount: 0,
    attentionCount: 0,
    lastActivityAt: null,
  };
}

describe('Roster action assembly', () => {
  it('shows New Agent only when the active adapter can really create one', () => {
    expect(assembleRosterAddActions({ canCreateAgent: true })).toEqual([
      'add_connection',
      'create_agent',
    ]);
    expect(assembleRosterAddActions({ canCreateAgent: false })).toEqual([
      'add_connection',
    ]);
  });

  it('assembles Agent preferences and limits connection removal to sole Agents', () => {
    expect(assembleRosterRowActions({
      row: row('agent'),
      connectionAgentCount: 1,
      canRenameSession: true,
    })).toEqual(['pin_agent', 'mute_agent', 'remove_connection']);

    expect(assembleRosterRowActions({
      row: row('agent', { agentPinned: true, muted: true }),
      connectionAgentCount: 2,
      canRenameSession: true,
    })).toEqual(['unpin_agent', 'unmute_agent']);
  });

  it('always permits local unpin but hides unsupported, locked, and disallowed rename', () => {
    const pinned = row('pinned_session', {
      allowedActions: { rename: true, reset: false, delete: false, pin: true },
    });
    expect(assembleRosterRowActions({
      row: pinned,
      connectionAgentCount: 1,
      canRenameSession: true,
    })).toEqual(['unpin_session', 'rename_session']);
    expect(assembleRosterRowActions({
      row: { ...pinned, locked: true },
      connectionAgentCount: 1,
      canRenameSession: true,
    })).toEqual(['unpin_session']);
    expect(assembleRosterRowActions({
      row: { ...pinned, allowedActions: { ...pinned.allowedActions!, rename: false } },
      connectionAgentCount: 1,
      canRenameSession: true,
    })).toEqual(['unpin_session']);
    expect(assembleRosterRowActions({
      row: pinned,
      connectionAgentCount: 1,
      canRenameSession: false,
    })).toEqual(['unpin_session']);
  });

  it('targets only the active connection without branching on OpenClaw or Hermes', () => {
    const roster = [
      rosterGroup(
        'openclaw',
        'openclaw',
        ['main', 'builder'],
        (agentId) => `agent:${agentId}:main`,
      ),
      rosterGroup('hermes', 'hermes', ['main'], () => 'main'),
    ];
    expect(resolveRosterCreateAgentTarget({
      activeConnectionId: 'openclaw',
      currentAgentId: 'builder',
      roster,
    })).toEqual({ connectionId: 'openclaw', agentId: 'builder' });
    expect(resolveRosterCreateAgentTarget({
      activeConnectionId: 'hermes',
      currentAgentId: 'builder',
      roster,
    })).toEqual({ connectionId: 'hermes', agentId: 'main' });
  });

  it('scopes mute suppression to the exact connection and Agent', () => {
    const preferences = {
      'openclaw:main': { muted: true },
      'hermes:main': { muted: false },
    };
    expect(isRosterAgentMuted({ preferences, connectionId: 'openclaw', agentId: 'main' })).toBe(true);
    expect(isRosterAgentMuted({ preferences, connectionId: 'hermes', agentId: 'main' })).toBe(false);
    expect(isRosterAgentMuted({ preferences, connectionId: null, agentId: 'main' })).toBe(false);
  });

  it('writes a supported pinned-session rename through the adapter and refreshes', async () => {
    const patchSession = jest.fn(async () => undefined);
    const refreshRoster = jest.fn(async () => undefined);
    const adapter = {
      capabilities: { sessionRename: true },
      patchSession,
    } as unknown as AgentAdapter;
    const pinned = row('pinned_session', {
      sessionKey: 'agent:main:channel:ops',
      allowedActions: { rename: true, reset: false, delete: false, pin: true },
    });

    await expect(renameRosterSession({
      adapter,
      row: pinned,
      title: '  Operations  ',
      refreshRoster,
    })).resolves.toBe(true);
    expect(patchSession).toHaveBeenCalledWith('agent:main:channel:ops', { title: 'Operations' });
    expect(refreshRoster).toHaveBeenCalledTimes(1);

    await expect(renameRosterSession({
      adapter: { ...adapter, capabilities: { sessionRename: false } } as unknown as AgentAdapter,
      row: pinned,
      title: 'Hidden',
      refreshRoster,
    })).resolves.toBe(false);
    expect(patchSession).toHaveBeenCalledTimes(1);
    expect(refreshRoster).toHaveBeenCalledTimes(1);
  });
});
