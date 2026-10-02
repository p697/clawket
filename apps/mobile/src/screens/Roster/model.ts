import type { RunActivity } from '../../connection/run-activity';
import { sessionActivityAt, type BackendKind, type SessionDescriptor } from '@clawket/agent-protocol';
import { compareAgentSummaries, type RosterConnectionGroup } from '../../connection';
import { formatPreviewLine } from '../../utils/chat-message';

export type RosterDisplayRow = Readonly<{
  key: string;
  kind: 'agent' | 'pinned_session';
  connectionId: string;
  /** The row's product: it picks the official face or corner mark on the avatar. */
  backendKind: BackendKind;
  agentId: string;
  sessionKey: string;
  name: string;
  avatarName?: string;
  emoji?: string;
  avatarUrl?: string;
  preview?: string;
  sessionKind?: SessionDescriptor['kind'];
  /** A conversation row's platform and project, which pick its badge glyph. */
  sessionChannel?: string;
  sessionProject?: boolean;
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

/**
 * The conversation's own title, as the Session Panel shows it. OpenClaw's `channel` names the
 * platform (`slack`), not the conversation, so `#channel` made every Slack conversation shown on
 * home read `#slack` (device review 2026-09-27); it stays only as the fallback for an untitled one.
 * The platform itself is the avatar badge.
 */
function sessionTitle(session: SessionDescriptor): string {
  const title = session.title?.trim();
  if (title && title !== session.key) return title;
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
      backendKind: group.connection.backendKind,
      agentId: agent.agentId,
      sessionKey: session.key,
      name: sessionTitle(session),
      avatarName: agent.name,
      ...(agent.emoji ? { emoji: agent.emoji } : {}),
      ...(agent.avatarUrl ? { avatarUrl: agent.avatarUrl } : {}),
      ...optionalPreview(session.preview),
      sessionKind: session.kind,
      ...(session.channel?.trim() ? { sessionChannel: session.channel.trim() } : {}),
      ...(session.project ? { sessionProject: true } : {}),
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

/** List rows show one plain line: Markdown markers from raw message text are dropped. */
function optionalPreview(text: string | undefined): { preview?: string } {
  const preview = formatPreviewLine(text);
  return preview ? { preview } : {};
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
      backendKind: group.connection.backendKind,
      agentId: agent.agentId,
      sessionKey: agent.mainSessionKey,
      name: agent.name,
      avatarName: agent.name,
      ...(agent.emoji ? { emoji: agent.emoji } : {}),
      ...(agent.avatarUrl ? { avatarUrl: agent.avatarUrl } : {}),
      ...optionalPreview(summary.preview),
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

/**
 * Whether Agent rows carry their backend's corner mark (owner decision 2026-09-27): only when the
 * roster mixes two or more backends. Counting backends rather than connections keeps a roster of
 * several OpenClaw Gateways unmarked — every mark would be the same crab and tell nothing apart.
 */
export function resolveRosterBackendMarks(rows: ReadonlyArray<Pick<RosterDisplayRow, 'backendKind'>>): boolean {
  return new Set(rows.map((row) => row.backendKind)).size >= 2;
}

/** Product names are brand names in every language; the local model has no brand. */
const BACKEND_NAMES: Readonly<Record<BackendKind, string | null>> = {
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  pi: 'Pi',
  codex: 'Codex',
  'claude-code': 'Claude Code',
  'local-model': null,
};

/**
 * The backend a screen reader adds after the Agent's name when the roster shows backend marks,
 * unless the name already says it ("Claude Code", "Pi · project").
 */
export function rosterBackendAccessibilityName(row: Pick<RosterDisplayRow, 'backendKind' | 'name'>): string | null {
  const brand = BACKEND_NAMES[row.backendKind];
  if (!brand) return null;
  return row.name.toLocaleLowerCase().startsWith(brand.toLocaleLowerCase()) ? null : brand;
}

/**
 * The connection whose rows carry the live dot (owner decision 2026-09-26).
 * Only the active connection has a live adapter; the dot tells its Agents
 * apart from the cached rows of other connections, so a roster drawn from a
 * single connection shows none. The recovery window keeps the dot steady
 * while the header reports the reconnect; offline, paused or still connecting
 * shows none.
 */
export function resolveRosterLiveConnectionId(input: Readonly<{
  rows: ReadonlyArray<Pick<RosterDisplayRow, 'connectionId'>>;
  activeConnectionId: string | null;
  activeState: string;
  recovering: boolean;
  offline: boolean;
}>): string | null {
  const { activeConnectionId } = input;
  if (!activeConnectionId || input.offline) return null;
  if (input.activeState !== 'ready' && !input.recovering) return null;
  const connectionIds = new Set(input.rows.map((row) => row.connectionId));
  if (connectionIds.size < 2 || !connectionIds.has(activeConnectionId)) return null;
  return activeConnectionId;
}

export function resolveRosterPageState(input: Readonly<{
  initialized: boolean;
  connectionCount: number;
  rowCount: number;
  activeState: string;
  hasError: boolean;
  allRowsLocked?: boolean;
  /** The active connection has not delivered a live roster yet (first connect without a cache). */
  awaitingRoster?: boolean;
}>): RosterPageState {
  if (!input.initialized) return 'loading';
  // Never claim "no agents" while the first roster is still on its way.
  if (input.awaitingRoster && input.rowCount === 0 && !input.hasError
    && (input.activeState === 'connecting' || input.activeState === 'handshaking' || input.activeState === 'ready')) return 'loading';
  if (input.connectionCount === 0 || input.rowCount === 0) return 'empty';
  if (input.allRowsLocked) return 'permission';
  if (input.activeState === 'offline' || input.activeState === 'reconnecting') return 'offline';
  if (input.hasError) return 'error';
  return 'ready';
}
