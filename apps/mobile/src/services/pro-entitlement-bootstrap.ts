import type { ConnectionDescriptor } from '@clawket/agent-protocol';

import type { RosterConnectionGroup } from '../connection/registry/roster-cache';
import type { CachedSessionMeta } from './chat-cache';

export type ProEntitlementBootstrapInput = Readonly<{
  connections: ReadonlyArray<ConnectionDescriptor>;
  roster: ReadonlyArray<RosterConnectionGroup>;
  cachedSessions: ReadonlyArray<CachedSessionMeta>;
}>;

/**
 * Detects legacy OpenClaw use that needs the one-time 3.0 grace period.
 * Hermes and YouMind deliberately do not use agent-id heuristics: their sole
 * descriptors are always main agents, even when their cached ids are not
 * literally `main`.
 */
export function hasCachedNonMainAgentSession({
  connections,
  roster,
  cachedSessions,
}: ProEntitlementBootstrapInput): boolean {
  const connectionsById = new Map(connections.map((connection) => [connection.id, connection]));
  const agentsByScope = new Map(roster.flatMap((group) => group.agents.map(({ agent }) => (
    [`${group.connection.id}:${agent.agentId}`, agent] as const
  ))));

  return cachedSessions.some((session) => {
    const connection = connectionsById.get(session.gatewayConfigId);
    if (connection?.backendKind !== 'openclaw') return false;
    const descriptor = agentsByScope.get(`${connection.id}:${session.agentId}`);
    if (descriptor) return !descriptor.isMain;
    return session.agentId.trim() !== 'main';
  });
}
