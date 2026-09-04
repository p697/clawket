import type {
  AgentDescriptor,
  Capabilities,
  SessionActions,
  SessionDescriptor,
} from '@clawket/agent-protocol';

import type { RosterConnectionGroup } from '../../connection';
import {
  buildSessionDescriptorBoardRows,
  summarizeSessionBoardRows,
  type SessionBoardKind,
  type SessionBoardRow,
  type SessionBoardStatus,
} from './list-model';

export const SESSION_PANEL_VISIBLE_ROW_CAPACITY = 8;

export type SessionPanelMode = 'grouped' | 'list';
export type SessionPanelQuickFilter = 'all' | 'attention' | 'working';
export type SessionPanelKindFilter = 'all' | SessionBoardKind;
export type SessionPanelAction = keyof SessionActions;
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
  id: string;
  connectionId: string;
  agentId: string;
  agentName: string;
  channel: string | null;
  hasActiveRun: boolean;
  attention: Exclude<SessionDescriptor['attention'], undefined>;
  source: Exclude<SessionDescriptor['source'], undefined> | null;
  allowedActions: SessionActions;
}>;

export type SessionPanelChannelGroup = Readonly<{
  key: string;
  label: string | null;
  rows: ReadonlyArray<SessionPanelRow>;
}>;

export type SessionPanelSection = Readonly<{
  kind: 'main' | 'channel' | 'direct_group' | 'subagent' | 'cron';
  rows: ReadonlyArray<SessionPanelRow>;
  channelGroups?: ReadonlyArray<SessionPanelChannelGroup>;
  completedRows?: ReadonlyArray<SessionPanelRow>;
}>;

export type SessionPanelAgentGroup = Readonly<{
  agent: AgentDescriptor;
  count: number;
  sections: ReadonlyArray<SessionPanelSection>;
}>;

export type SessionPanelSummary = Readonly<{
  active: number;
  recent: number;
  idle: number;
}>;

function statusRank(status: SessionBoardStatus): number {
  if (status === 'active') return 3;
  if (status === 'recent') return 2;
  return 1;
}

function compareRows(a: SessionPanelRow, b: SessionPanelRow): number {
  return statusRank(b.status) - statusRank(a.status)
    || Number(b.hasActiveRun) - Number(a.hasActiveRun)
    || b.updatedAt - a.updatedAt
    || a.key.localeCompare(b.key);
}

export function buildSessionPanelRows(
  group: RosterConnectionGroup | null | undefined,
  options?: { now?: number },
): ReadonlyArray<SessionPanelRow> {
  if (!group) return Object.freeze([]);
  const sessions = group.agents.flatMap((summary) => summary.sessions);
  const boardByKey = new Map(
    buildSessionDescriptorBoardRows(sessions, options).map((row) => [row.key, row]),
  );
  const rows: SessionPanelRow[] = group.agents.flatMap((summary) => summary.sessions.flatMap((session) => {
    const board = boardByKey.get(session.key);
    if (!board) return [];
    return [{
      ...board,
      id: `${session.connectionId}:${session.agentId}:${session.key}`,
      connectionId: session.connectionId,
      agentId: session.agentId,
      agentName: summary.agent.name,
      channel: session.channel?.trim() || null,
      hasActiveRun: session.hasActiveRun,
      attention: session.attention ?? null,
      source: session.source ?? null,
      allowedActions: { ...session.allowedActions },
    } satisfies SessionPanelRow];
  }));
  return Object.freeze(rows.sort(compareRows));
}

export function filterSessionPanelRows(
  rows: ReadonlyArray<SessionPanelRow>,
  options: Readonly<{
    query: string;
    quickFilter: SessionPanelQuickFilter;
    kindFilter: SessionPanelKindFilter;
  }>,
): ReadonlyArray<SessionPanelRow> {
  const query = options.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (options.quickFilter === 'attention' && row.attention === null) return false;
    if (options.quickFilter === 'working' && !row.hasActiveRun) return false;
    if (options.kindFilter !== 'all' && row.kind !== options.kindFilter) return false;
    return !query || row.searchableText.includes(query);
  });
}

function channelGroups(rows: ReadonlyArray<SessionPanelRow>): ReadonlyArray<SessionPanelChannelGroup> {
  const grouped = new Map<string, SessionPanelRow[]>();
  for (const row of rows) {
    const key = row.channelLabel?.toLowerCase() ?? '';
    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, channelRows]) => ({
      key: key || 'other',
      label: channelRows[0]?.channelLabel ?? null,
      rows: channelRows.sort(compareRows),
    }));
}

function buildSections(rows: ReadonlyArray<SessionPanelRow>): ReadonlyArray<SessionPanelSection> {
  const main = rows.filter((row) => row.kind === 'main');
  const channel = rows.filter((row) => row.kind === 'channel');
  const directGroup = rows.filter((row) => (
    row.kind === 'direct' || row.kind === 'group' || row.kind === 'other'
  ));
  const subagent = rows.filter((row) => row.kind === 'subagent');
  const runningSubagents = subagent.filter((row) => row.hasActiveRun);
  const completedSubagents = subagent.filter((row) => !row.hasActiveRun);
  const cron = rows.filter((row) => row.kind === 'cron');
  const sections: SessionPanelSection[] = [];
  if (main.length) sections.push({ kind: 'main', rows: main.sort(compareRows) });
  if (channel.length) {
    sections.push({ kind: 'channel', rows: [], channelGroups: channelGroups(channel) });
  }
  if (directGroup.length) {
    sections.push({ kind: 'direct_group', rows: directGroup.sort(compareRows) });
  }
  if (subagent.length) {
    sections.push({
      kind: 'subagent',
      rows: runningSubagents.sort(compareRows),
      completedRows: completedSubagents.sort(compareRows),
    });
  }
  if (cron.length) sections.push({ kind: 'cron', rows: cron.sort(compareRows) });
  return sections;
}

export function buildSessionPanelGroups(
  rows: ReadonlyArray<SessionPanelRow>,
  agents: ReadonlyArray<AgentDescriptor>,
  currentAgentId: string,
): ReadonlyArray<SessionPanelAgentGroup> {
  return agents
    .map((agent, index) => ({ agent, index }))
    .sort((left, right) => (
      Number(right.agent.agentId === currentAgentId) - Number(left.agent.agentId === currentAgentId)
      || left.index - right.index
    ))
    .map(({ agent }) => {
      const agentRows = rows.filter((row) => row.agentId === agent.agentId);
      return {
        agent,
        count: agentRows.length,
        sections: buildSections(agentRows),
      } satisfies SessionPanelAgentGroup;
    });
}

export function summarizeSessionPanelRows(
  rows: ReadonlyArray<SessionPanelRow>,
): SessionPanelSummary {
  return summarizeSessionBoardRows([...rows]);
}

export function availableSessionActions(
  row: SessionPanelRow,
  capabilities: Pick<
    Capabilities,
    'sessionRename' | 'sessionReset' | 'sessionDelete'
  >,
): ReadonlyArray<SessionPanelAction> {
  const actions: SessionPanelAction[] = [];
  if (row.allowedActions.pin) actions.push('pin');
  if (row.allowedActions.rename && capabilities.sessionRename) actions.push('rename');
  if (row.allowedActions.reset && capabilities.sessionReset) actions.push('reset');
  if (row.allowedActions.delete && capabilities.sessionDelete) actions.push('delete');
  return actions;
}

export function shouldShowSessionPanelQuickFilters(
  rowCount: number,
  visibleCapacity = SESSION_PANEL_VISIBLE_ROW_CAPACITY,
): boolean {
  return rowCount > Math.max(0, visibleCapacity);
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
