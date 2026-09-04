import type { SessionDescriptor } from '@clawket/agent-protocol';
import type { RosterConnectionGroup } from '../../connection';

export type RosterDisplayRow = Readonly<{
  key: string;
  kind: 'agent' | 'pinned_session';
  connectionId: string;
  agentId: string;
  sessionKey: string;
  name: string;
  emoji?: string;
  avatarUrl?: string;
  preview?: string;
  updatedAt: number | null;
  unreadCount: number;
  attention: SessionDescriptor['attention'];
  working: boolean;
  cached: boolean;
  locked: boolean;
}>;

export type RosterPageState =
  | 'loading'
  | 'empty'
  | 'error'
  | 'offline'
  | 'permission'
  | 'ready';

export type RosterModelOptions = Readonly<{
  pinnedSessionKeys?: Readonly<Record<string, ReadonlyArray<string>>>;
  canAccessAgent?: (connectionId: string, agentId: string) => boolean;
}>;

function sessionTitle(session: SessionDescriptor): string {
  const channel = session.channel?.trim();
  if (channel) return channel.startsWith('#') ? channel : `#${channel}`;
  return session.title;
}

function buildPinnedRows(
  group: RosterConnectionGroup,
  agentId: string,
  sessions: ReadonlyArray<SessionDescriptor>,
  pinnedKeys: ReadonlyArray<string>,
  locked: boolean,
): RosterDisplayRow[] {
  const rank = new Map(pinnedKeys.map((key, index) => [key, index]));
  return sessions
    .filter((session) => rank.has(session.key) && session.allowedActions.pin)
    .sort((a, b) => (
      (rank.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.key) ?? Number.MAX_SAFE_INTEGER)
      || (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
      || a.key.localeCompare(b.key)
    ))
    .map((session) => ({
      key: `session:${group.connection.id}:${session.key}`,
      kind: 'pinned_session' as const,
      connectionId: group.connection.id,
      agentId,
      sessionKey: session.key,
      name: sessionTitle(session),
      ...(session.preview ? { preview: session.preview } : {}),
      updatedAt: session.updatedAt,
      unreadCount: 0,
      attention: session.attention,
      working: session.hasActiveRun,
      cached: group.source === 'cache',
      locked,
    }));
}

/**
 * Flattens connection-adjacent roster groups into the exact visual order used
 * by the 3.0 directory. Pinned sessions always remain directly below their
 * owning Agent and never split a connection group.
 */
export function buildRosterRows(
  groups: ReadonlyArray<RosterConnectionGroup>,
  options: RosterModelOptions = {},
): ReadonlyArray<RosterDisplayRow> {
  const canAccessAgent = options.canAccessAgent ?? (() => true);
  const rows: RosterDisplayRow[] = [];

  for (const group of groups) {
    for (const summary of group.agents) {
      const { agent } = summary;
      const locked = !canAccessAgent(group.connection.id, agent.agentId);
      rows.push({
        key: `agent:${group.connection.id}:${agent.agentId}`,
        kind: 'agent',
        connectionId: group.connection.id,
        agentId: agent.agentId,
        sessionKey: agent.mainSessionKey,
        name: agent.name,
        ...(agent.emoji ? { emoji: agent.emoji } : {}),
        ...(agent.avatarUrl ? { avatarUrl: agent.avatarUrl } : {}),
        ...(summary.preview ? { preview: summary.preview } : {}),
        updatedAt: summary.updatedAt,
        unreadCount: summary.unreadCount,
        attention: summary.attention,
        working: summary.sessions.some((session) => session.hasActiveRun),
        cached: group.source === 'cache',
        locked,
      });
      rows.push(...buildPinnedRows(
        group,
        agent.agentId,
        summary.sessions,
        options.pinnedSessionKeys?.[`${group.connection.id}:${agent.agentId}`] ?? [],
        locked,
      ));
    }
  }

  return Object.freeze(rows);
}

export function resolveRosterPageState(input: Readonly<{
  initialized: boolean;
  connectionCount: number;
  rowCount: number;
  activeState: string;
  hasError: boolean;
  allRowsLocked?: boolean;
}>): RosterPageState {
  if (!input.initialized) return 'loading';
  if (input.connectionCount === 0 || input.rowCount === 0) return 'empty';
  if (input.allRowsLocked) return 'permission';
  if (input.activeState === 'offline' || input.activeState === 'reconnecting') return 'offline';
  if (input.hasError) return 'error';
  return 'ready';
}
