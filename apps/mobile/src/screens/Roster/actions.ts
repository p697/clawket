import type { AgentAdapter } from '@clawket/agent-protocol';
import type { RosterConnectionGroup } from '../../connection';
import type { RosterDisplayRow } from './model';

export type RosterAddAction = 'add_connection' | 'create_agent';
export type RosterRowAction =
  | 'pin_agent'
  | 'unpin_agent'
  | 'manage_connection'
  | 'remove_connection'
  | 'unpin_session'
  | 'rename_session';

export function assembleRosterAddActions(input: Readonly<{
  canCreateAgent: boolean;
}>): ReadonlyArray<RosterAddAction> {
  return input.canCreateAgent
    ? ['add_connection', 'create_agent']
    : ['add_connection'];
}

/**
 * Long-press menu: the full action set. Removal only appears when the row is
 * the connection's sole Agent, so it cannot silently take other Agents away.
 */
export function assembleRosterRowActions(input: Readonly<{
  row: RosterDisplayRow;
  connectionAgentCount: number;
  canRenameSession: boolean;
}>): ReadonlyArray<RosterRowAction> {
  if (input.row.kind === 'agent') {
    return [
      input.row.agentPinned ? 'unpin_agent' : 'pin_agent',
      'manage_connection',
      ...(input.connectionAgentCount === 1 ? ['remove_connection' as const] : []),
    ];
  }

  return [
    'unpin_session',
    ...(input.canRenameSession
      && !input.row.locked
      && input.row.allowedActions?.rename === true
      ? ['rename_session' as const]
      : []),
  ];
}

/**
 * Trailing swipe tray: the same actions minus removal. A destructive cell that
 * only some rows show would make the tray inconsistent; removal stays on the
 * long-press menu and the connection page, both of which confirm first.
 */
export function assembleRosterSwipeActions(input: Readonly<{
  row: RosterDisplayRow;
  canRenameSession: boolean;
}>): ReadonlyArray<RosterRowAction> {
  return assembleRosterRowActions({ ...input, connectionAgentCount: 0 });
}

export function resolveRosterCreateAgentTarget(input: Readonly<{
  activeConnectionId: string | null;
  currentAgentId: string;
  roster: ReadonlyArray<RosterConnectionGroup>;
}>): Readonly<{ connectionId: string; agentId: string }> | null {
  if (!input.activeConnectionId) return null;
  const group = input.roster.find((candidate) => (
    candidate.connection.id === input.activeConnectionId
  ));
  const agentId = group?.agents.find((candidate) => (
    candidate.agent.agentId === input.currentAgentId
  ))?.agent.agentId ?? group?.agents[0]?.agent.agentId;
  return agentId ? { connectionId: input.activeConnectionId, agentId } : null;
}

export async function renameRosterSession(input: Readonly<{
  adapter: AgentAdapter | null;
  row: RosterDisplayRow;
  title: string;
  refreshRoster: () => Promise<unknown>;
}>): Promise<boolean> {
  const title = input.title.trim();
  if (!title
    || input.row.kind !== 'pinned_session'
    || input.row.allowedActions?.rename !== true
    || input.adapter?.capabilities.sessionRename !== true
    || !input.adapter.patchSession) return false;
  await input.adapter.patchSession(input.row.sessionKey, { title });
  await input.refreshRoster();
  return true;
}
