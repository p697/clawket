import type {
  AgentDescriptor,
  Capabilities,
  SessionActions,
  SessionDescriptor,
} from '@clawket/agent-protocol';

import type { RosterConnectionGroup } from '../../connection';
import { cronSessionName } from '../../utils/chat-message';
import {
  buildSessionDescriptorBoardRows,
  type SessionBoardRow,
  type SessionBoardStatus,
} from './list-model';

export type SessionPanelAction = keyof SessionActions | 'export';
export type SessionPanelRenamePayload = Readonly<{
  title: string;
}>;
export type SessionPanelPageState =
  | 'loading'
  | 'empty'
  | 'error'
  | 'offline'
  | 'permission'
  | 'ready';

export type SessionPanelRow = SessionBoardRow & Readonly<{
  project?: SessionDescriptor['project'];
  id: string;
  connectionId: string;
  agentId: string;
  agentName: string;
  channel: string | null;
  hasActiveRun: boolean;
  attention: Exclude<SessionDescriptor['attention'], undefined>;
  source: Exclude<SessionDescriptor['source'], undefined> | null;
  allowedActions: SessionActions;
  pinned: boolean;
  unread: boolean;
}>;

/** Kind chips beside the channel chips; `all` and `channel:<label>` complete the set. */
export type SessionPanelKindFilter = 'direct_group' | 'subagent' | 'cron';
export type SessionPanelFilter = 'all' | SessionPanelKindFilter | `channel:${string}`;

export type SessionPanelChip = Readonly<{
  key: SessionPanelFilter;
  /** Channel display label; kind chips and `all` carry `null` and are translated by the view. */
  label: string | null;
  count: number;
}>;

export type SessionPanelListItem =
  | Readonly<{ type: 'row'; row: SessionPanelRow }>
  | Readonly<{ type: 'subagents'; count: number }>;

export type SessionPanelAgentOption = Readonly<{
  agent: AgentDescriptor;
  count: number;
}>;

export type SessionPanelFilterKind = 'all' | 'channel' | SessionPanelKindFilter;

const CHANNEL_FILTER_PREFIX = 'channel:';
const KIND_FILTER_ORDER: ReadonlyArray<SessionPanelKindFilter> = ['direct_group', 'subagent', 'cron'];

function statusRank(status: SessionBoardStatus): number {
  if (status === 'active') return 3;
  if (status === 'recent') return 2;
  return 1;
}

function compareRows(a: SessionPanelRow, b: SessionPanelRow): number {
  return Number(b.kind === 'main') - Number(a.kind === 'main')
    || Number(b.pinned) - Number(a.pinned)
    || statusRank(b.status) - statusRank(a.status)
    || Number(b.hasActiveRun) - Number(a.hasActiveRun)
    || b.updatedAt - a.updatedAt
    || a.key.localeCompare(b.key);
}

export function channelFilterKey(channelLabel: string): `channel:${string}` {
  return `${CHANNEL_FILTER_PREFIX}${channelLabel.toLowerCase()}`;
}

export function resolveSessionPanelFilterKind(filter: SessionPanelFilter): SessionPanelFilterKind {
  if (filter.startsWith(CHANNEL_FILTER_PREFIX)) return 'channel';
  return filter as SessionPanelFilterKind;
}

function kindFilterOf(row: SessionPanelRow): SessionPanelKindFilter | null {
  if (row.kind === 'subagent') return 'subagent';
  if (row.kind === 'cron') return 'cron';
  if (row.kind === 'direct' || row.kind === 'group' || row.kind === 'other') return 'direct_group';
  return null;
}

function matchesFilter(row: SessionPanelRow, filter: SessionPanelFilter): boolean {
  if (filter === 'all') return true;
  if (filter.startsWith(CHANNEL_FILTER_PREFIX)) {
    return row.kind === 'channel'
      && row.channelLabel !== null
      && channelFilterKey(row.channelLabel) === filter;
  }
  return kindFilterOf(row) === filter;
}

export function buildSessionPanelRows(
  group: RosterConnectionGroup | null | undefined,
  options?: Readonly<{
    now?: number;
    recentFirst?: boolean;
    pinnedSessionKeys?: Readonly<Record<string, ReadonlyArray<string>>>;
  }>,
): ReadonlyArray<SessionPanelRow> {
  if (!group) return Object.freeze([]);
  const sessions = group.agents.flatMap((summary) => summary.sessions);
  const boardByKey = new Map(
    buildSessionDescriptorBoardRows(sessions, { now: options?.now }).map((row) => [row.key, row]),
  );
  const rows: SessionPanelRow[] = group.agents.flatMap((summary) => {
    const scope = `${summary.agent.connectionId}:${summary.agent.agentId}`;
    const pinnedKeys = new Set(options?.pinnedSessionKeys?.[scope] ?? []);
    const unreadKeys = new Set(summary.unreadSessionKeys ?? []);
    return summary.sessions.flatMap((session) => {
      const board = boardByKey.get(session.key);
      if (!board) return [];
      return [{
        ...board,
        project: session.project,
        id: `${session.connectionId}:${session.agentId}:${session.key}`,
        connectionId: session.connectionId,
        agentId: session.agentId,
        agentName: summary.agent.name,
        channel: session.channel?.trim() || null,
        hasActiveRun: session.hasActiveRun,
        attention: session.attention ?? null,
        source: session.source ?? null,
        allowedActions: { ...session.allowedActions },
        pinned: pinnedKeys.has(session.key),
        unread: unreadKeys.has(session.key),
      } satisfies SessionPanelRow];
    });
  });
  return Object.freeze(rows.sort(options?.recentFirst
    ? (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt || a.key.localeCompare(b.key)
    : compareRows));
}

/** The panel shows one Agent at a time; the header pill switches between them. */
export function buildSessionPanelAgents(
  rows: ReadonlyArray<SessionPanelRow>,
  agents: ReadonlyArray<AgentDescriptor>,
): ReadonlyArray<SessionPanelAgentOption> {
  return agents.map((agent) => ({
    agent,
    count: rows.filter((row) => row.agentId === agent.agentId).length,
  }));
}

/**
 * Channel chips first (busiest channel first), then the kind chips that have rows.
 * A panel with nothing but the main conversation returns no chips at all.
 */
export function buildSessionPanelChips(
  rows: ReadonlyArray<SessionPanelRow>,
): ReadonlyArray<SessionPanelChip> {
  const channels = new Map<string, SessionPanelChip>();
  const kinds = new Map<SessionPanelKindFilter, number>();
  for (const row of rows) {
    if (row.kind === 'channel' && row.channelLabel) {
      const key = channelFilterKey(row.channelLabel);
      const current = channels.get(key);
      channels.set(key, {
        key,
        label: row.channelLabel,
        count: (current?.count ?? 0) + 1,
      });
      continue;
    }
    const kind = kindFilterOf(row);
    if (kind) kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  const chips: SessionPanelChip[] = [
    ...[...channels.values()].sort((left, right) => (
      right.count - left.count || (left.label ?? '').localeCompare(right.label ?? '')
    )),
    ...KIND_FILTER_ORDER.flatMap((kind) => {
      const count = kinds.get(kind);
      return count ? [{ key: kind, label: null, count } satisfies SessionPanelChip] : [];
    }),
  ];
  if (chips.length === 0) return Object.freeze([]);
  return Object.freeze([{ key: 'all', label: null, count: rows.length }, ...chips]);
}

export function filterSessionPanelRows(
  rows: ReadonlyArray<SessionPanelRow>,
  options: Readonly<{
    agentId: string;
    filter: SessionPanelFilter;
    query: string;
    /** The localized title the row renders, so a search matches what people read. */
    displayTitle?: (row: SessionPanelRow) => string;
  }>,
): ReadonlyArray<SessionPanelRow> {
  const query = options.query.trim().toLowerCase();
  return rows.filter((row) => (
    row.agentId === options.agentId
    && matchesFilter(row, options.filter)
    && (
      !query
      || row.searchableText.includes(query)
      || Boolean(options.displayTitle?.(row).toLowerCase().includes(query))
    )
  ));
}

/**
 * Rows already carry the panel order. In the unfiltered list the finished
 * sub-agent runs fold into one trailing row so live work stays visible.
 */
export function buildSessionPanelListItems(
  rows: ReadonlyArray<SessionPanelRow>,
  filter: SessionPanelFilter,
): ReadonlyArray<SessionPanelListItem> {
  if (filter !== 'all') return rows.map((row) => ({ type: 'row', row }));
  const items: SessionPanelListItem[] = [];
  let completedSubagents = 0;
  for (const row of rows) {
    if (row.kind === 'subagent' && !row.hasActiveRun) {
      completedSubagents += 1;
      continue;
    }
    items.push({ type: 'row', row });
  }
  if (completedSubagents > 0) items.push({ type: 'subagents', count: completedSubagents });
  return items;
}

export function availableSessionActions(
  row: SessionPanelRow,
  capabilities: Pick<
    Capabilities,
    'sessionRename' | 'sessionReset' | 'sessionDelete'
  >,
): ReadonlyArray<SessionPanelAction> {
  const actions: SessionPanelAction[] = row.hasActiveRun ? [] : ['export'];
  if (row.allowedActions.pin) actions.push('pin');
  if (row.allowedActions.rename && capabilities.sessionRename) actions.push('rename');
  if (row.allowedActions.reset && capabilities.sessionReset) actions.push('reset');
  if (row.allowedActions.delete && capabilities.sessionDelete) actions.push('delete');
  return actions;
}

/**
 * The editable part of a row title. An untitled row carries its key as the title and a
 * scheduled run carries the Gateway's English kind prefix; the view localizes both.
 */
export function sessionPanelRowName(row: Pick<SessionPanelRow, 'key' | 'kind' | 'title'>): string {
  if (row.title === row.key) return '';
  return row.kind === 'cron' ? cronSessionName(row.title) : row.title.trim();
}

export function normalizeSessionRenameTitle(
  draft: string,
  currentTitle: string,
): string | null {
  const title = draft.trim();
  if (!title || title === currentTitle.trim()) return null;
  return title;
}

export function resolveSessionPanelPageState(input: Readonly<{
  initialized: boolean;
  hasPermission: boolean;
  rowCount: number;
  activeState: string;
  hasError: boolean;
}>): SessionPanelPageState {
  if (!input.initialized) return 'loading';
  if (!input.hasPermission) return 'permission';
  if (input.activeState === 'offline' || input.activeState === 'reconnecting') return 'offline';
  if (input.hasError) return 'error';
  if (input.rowCount === 0) return 'empty';
  return 'ready';
}
