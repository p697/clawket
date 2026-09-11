import type {
  AgentDescriptor,
  ConnectionDescriptor,
} from '@clawket/agent-protocol';

import type { RosterConnectionGroup } from '../connection/registry/roster-cache';
import type { CachedSessionMeta } from './chat-cache';
import { hasCachedNonMainAgentSession } from './pro-entitlement-bootstrap';

function connection(id: string, backendKind: ConnectionDescriptor['backendKind']): ConnectionDescriptor {
  return {
    id,
    backendKind,
    transportKind: backendKind === 'youmind' ? 'https' : 'local',
    label: id,
    createdAt: 1,
    isFreeSlot: false,
  };
}

function agent(connectionId: string, agentId: string, isMain: boolean): AgentDescriptor {
  return {
    connectionId,
    agentId,
    name: agentId,
    isMain,
    mainSessionKey: `agent:${agentId}:main`,
  };
}

function group(
  item: ConnectionDescriptor,
  agents: ReadonlyArray<AgentDescriptor>,
): RosterConnectionGroup {
  return {
    connection: item,
    source: 'cache',
    syncedAt: 1,
    agents: agents.map((descriptor) => ({
      agent: descriptor,
      sessions: [],
      updatedAt: null,
      lastActivityAt: null,
      unreadCount: 0,
      hasUnread: false,
      attentionCount: 0,
      attention: undefined,
    })),
    unreadCount: 0,
    attentionCount: 0,
    lastActivityAt: null,
  };
}

function cached(connectionId: string, agentId: string): CachedSessionMeta {
  return {
    storageKey: `${connectionId}:${agentId}`,
    gatewayConfigId: connectionId,
    agentId,
    sessionKey: `agent:${agentId}:main`,
    messageCount: 1,
    updatedAt: 1,
  };
}

describe('hasCachedNonMainAgentSession', () => {
  it('uses an OpenClaw roster descriptor so a configured main key stays main', () => {
    const home = connection('home', 'openclaw');
    expect(hasCachedNonMainAgentSession({
      connections: [home],
      roster: [group(home, [agent('home', 'primary', true)])],
      cachedSessions: [cached('home', 'primary')],
    })).toBe(false);
  });

  it('detects descriptor-backed and legacy uncached OpenClaw secondary agents', () => {
    const home = connection('home', 'openclaw');
    expect(hasCachedNonMainAgentSession({
      connections: [home],
      roster: [group(home, [agent('home', 'main', true), agent('home', 'writer', false)])],
      cachedSessions: [cached('home', 'writer')],
    })).toBe(true);
    expect(hasCachedNonMainAgentSession({
      connections: [home],
      roster: [],
      cachedSessions: [cached('home', 'researcher')],
    })).toBe(true);
  });

  it('never treats Hermes, YouMind, unknown connections, or OpenClaw main as secondary', () => {
    const hermes = connection('hermes', 'hermes');
    const sprite = connection('sprite', 'youmind');
    const openclaw = connection('openclaw', 'openclaw');
    expect(hasCachedNonMainAgentSession({
      connections: [hermes, sprite, openclaw],
      roster: [],
      cachedSessions: [
        cached('hermes', 'hermes'),
        cached('sprite', 'sprite'),
        cached('missing', 'writer'),
        cached('openclaw', 'main'),
      ],
    })).toBe(false);
  });
});
