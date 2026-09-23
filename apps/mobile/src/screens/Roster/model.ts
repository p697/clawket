import type { RunActivity } from '../../connection/run-activity';
import { sessionActivityAt, type SessionDescriptor } from '@clawket/agent-protocol';
import { compareAgentSummaries, type RosterConnectionGroup } from '../../connection';

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
  /** Latest human activity; both the row's time label and its position come from it. */
  lastActivityAt: number | null;
  syncedAt: number | null;
  unreadCount: number;
  attention: SessionDescriptor['attention'];
  activity?: RunActivity['phase'];
  working: boolean;
  cached: boolean;
  locked: boolean;
  agentPinned: boolean;
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
  runActivities?: ReadonlyArray<RunActivity>;
  pinnedSessionKeys?: Readonly<Record<string, ReadonlyArray<string>>>;
  agentPreferences?: Readonly<Record<string, Readonly<{
    agentPinned: boolean;
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
): RosterDisplayRow[] {
  const cached = group.source === 'cache';
  const rank = new Map(pinnedKeys.map((key, index) => [key, index]));
  return sessions
    .filter((session) => rank.has(session.key) && session.allowedActions.pin)
    .sort((a, b) => (
      (rank.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.key) ?? Number.MAX_SAFE_INTEGER)
      || (sessionActivityAt(b) ?? 0) - (sessionActivityAt(a) ?? 0)
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
      lastActivityAt: sessionActivityAt(session),
      syncedAt: cached ? group.syncedAt : null,
      unreadCount: 0,
      attention: cached ? null : session.attention,
      working: cached ? false : session.hasActiveRun,
      cached,
      locked,
      agentPinned,
      allowedActions: { ...session.allowedActions },
    }));
}

function isAgentPinned(
  connectionId: string,
  preferences: RosterModelOptions['agentPreferences'],
  agentId: string,
): boolean {
  return preferences?.[`${connectionId}:${agentId}`]?.agentPinned === true;
}

/** Global Agent order; pinned child sessions stay with their owning Agent. */
export function buildRosterRows(
  groups: ReadonlyArray<RosterConnectionGroup>,
  options: RosterModelOptions = {},
): ReadonlyArray<RosterDisplayRow> {
  const canAccessAgent = options.canAccessAgent ?? (() => true);
  const rows: RosterDisplayRow[] = [];

  const agents = groups.flatMap((group) => group.agents.map((summary) => ({ group, summary })));
  agents.sort((left, right) => (
    Number(isAgentPinned(right.group.connection.id, options.agentPreferences, right.summary.agent.agentId))
      - Number(isAgentPinned(left.group.connection.id, options.agentPreferences, left.summary.agent.agentId))
    || compareAgentSummaries(left.summary, right.summary)
  ));
  for (const { group, summary } of agents) {
    const cached = group.source === 'cache';
    const { agent } = summary;
    const preferences = options.agentPreferences?.[
      `${group.connection.id}:${agent.agentId}`
    ];
    const locked = !canAccessAgent(group.connection.id, agent.agentId);
    const activity = !cached ? options.runActivities?.find((item) => item.connectionId === group.connection.id
      && (item.sessionKey === agent.mainSessionKey || (item.sessionKey === 'main' && agent.isMain) || summary.sessions.some((session) => session.key === item.sessionKey)))?.phase : undefined;
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
      lastActivityAt: summary.lastActivityAt,
      syncedAt: cached ? group.syncedAt : null,
      unreadCount: cached ? 0 : summary.unreadCount,
      attention: cached ? null : summary.attention,
      activity,
      working: cached ? false : Boolean(activity) || summary.sessions.some((session) => session.hasActiveRun),
      cached,
      locked,
      agentPinned: preferences?.agentPinned === true,
    });
    rows.push(...buildPinnedRows(
      group,
      agent,
      summary.sessions,
      options.pinnedSessionKeys?.[`${group.connection.id}:${agent.agentId}`] ?? [],
      locked,
      preferences?.agentPinned === true,
    ));
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
