import type { SessionDescriptor } from '@clawket/agent-protocol';
import type { RosterConnectionGroup } from '../../connection';

export type RosterDisplayRow = Readonly<{
  key: string;
  kind: 'agent' | 'pinned_session';
  connectionId: string;
  agentId: string;
  sessionKey: string;
  name: string;
  avatarName?: string;
  emoji?: string;
  avatarUrl?: string;
  preview?: string;
  subtitle?: RosterConnectionGroup['agents'][number]['subtitle'];
  sessionKind?: SessionDescriptor['kind'];
  updatedAt: number | null;
  syncedAt: number | null;
  unreadCount: number;
  attention: SessionDescriptor['attention'];
  working: boolean;
  cached: boolean;
  locked: boolean;
  agentPinned: boolean;
  muted: boolean;
  allowedActions?: SessionDescriptor['allowedActions'];
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
  agentPreferences?: Readonly<Record<string, Readonly<{
    agentPinned: boolean;
    muted: boolean;
  }>>>;
  canAccessAgent?: (connectionId: string, agentId: string) => boolean;
}>;

function sessionTitle(session: SessionDescriptor): string {
  const channel = session.channel?.trim();
  if (channel) return channel.startsWith('#') ? channel : `#${channel}`;
  return session.title;
}

function buildPinnedRows(
  group: RosterConnectionGroup,
  agent: RosterConnectionGroup['agents'][number]['agent'],
  sessions: ReadonlyArray<SessionDescriptor>,
  pinnedKeys: ReadonlyArray<string>,
  locked: boolean,
  agentPinned: boolean,
  muted: boolean,
): RosterDisplayRow[] {
  const cached = group.source === 'cache';
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
      agentId: agent.agentId,
      sessionKey: session.key,
      name: sessionTitle(session),
      avatarName: agent.name,
      ...(agent.emoji ? { emoji: agent.emoji } : {}),
      ...(agent.avatarUrl ? { avatarUrl: agent.avatarUrl } : {}),
      ...(session.preview ? { preview: session.preview } : {}),
      sessionKind: session.kind,
      updatedAt: session.updatedAt,
      syncedAt: cached ? group.syncedAt : null,
      unreadCount: 0,
      attention: cached ? null : session.attention,
      working: cached ? false : session.hasActiveRun,
      cached,
      locked,
      agentPinned,
      muted,
      allowedActions: { ...session.allowedActions },
    }));
}

function compareAgentPriority(
  connectionId: string,
  preferences: RosterModelOptions['agentPreferences'],
  cached: boolean,
  left: RosterConnectionGroup['agents'][number],
  right: RosterConnectionGroup['agents'][number],
): number {
  const leftPinned = preferences?.[`${connectionId}:${left.agent.agentId}`]?.agentPinned === true;
  const rightPinned = preferences?.[`${connectionId}:${right.agent.agentId}`]?.agentPinned === true;
  return Number(rightPinned) - Number(leftPinned)
    || (cached ? 0 : Number(right.attentionCount > 0) - Number(left.attentionCount > 0))
    || (cached ? 0 : Number(right.hasUnread) - Number(left.hasUnread))
    || (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
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
    const cached = group.source === 'cache';
    const sortedAgents = group.agents
      .map((summary, index) => ({ summary, index }))
      .sort((left, right) => (
        compareAgentPriority(
          group.connection.id,
          options.agentPreferences,
          cached,
          left.summary,
          right.summary,
        ) || left.index - right.index
      ));
    for (const { summary } of sortedAgents) {
      const { agent } = summary;
      const preferences = options.agentPreferences?.[
        `${group.connection.id}:${agent.agentId}`
      ];
      const locked = !canAccessAgent(group.connection.id, agent.agentId);
      rows.push({
        key: `agent:${group.connection.id}:${agent.agentId}`,
        kind: 'agent',
        connectionId: group.connection.id,
        agentId: agent.agentId,
        sessionKey: agent.mainSessionKey,
        name: agent.name,
        avatarName: agent.name,
        ...(agent.emoji ? { emoji: agent.emoji } : {}),
        ...(agent.avatarUrl ? { avatarUrl: agent.avatarUrl } : {}),
        ...(summary.subtitle
          ? { subtitle: summary.subtitle }
          : summary.preview
            ? { preview: summary.preview }
            : {}),
        updatedAt: summary.updatedAt,
        syncedAt: cached ? group.syncedAt : null,
        unreadCount: cached ? 0 : summary.unreadCount,
        attention: cached ? null : summary.attention,
        working: cached ? false : summary.sessions.some((session) => session.hasActiveRun),
        cached,
        locked,
        agentPinned: preferences?.agentPinned === true,
        muted: preferences?.muted === true,
      });
      rows.push(...buildPinnedRows(
        group,
        agent,
        summary.sessions,
        options.pinnedSessionKeys?.[`${group.connection.id}:${agent.agentId}`] ?? [],
        locked,
        preferences?.agentPinned === true,
        preferences?.muted === true,
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
