import type { AgentAdapter } from '@clawket/agent-protocol';
import type { RosterConnectionGroup } from '../../connection';
import type { RosterDisplayRow } from './model';

export type RosterAddAction = 'add_connection' | 'create_agent';
export type RosterRowAction =
  | 'pin_agent'
  | 'unpin_agent'
  | 'mute_agent'
  | 'unmute_agent'
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

export function assembleRosterRowActions(input: Readonly<{
  row: RosterDisplayRow;
  connectionAgentCount: number;
  canRenameSession: boolean;
}>): ReadonlyArray<RosterRowAction> {
  if (input.row.kind === 'agent') {
    return [
      input.row.agentPinned ? 'unpin_agent' : 'pin_agent',
      input.row.muted ? 'unmute_agent' : 'mute_agent',
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

export function isRosterAgentMuted(input: Readonly<{
  preferences: Readonly<Record<string, Readonly<{ muted: boolean }>>>;
  connectionId: string | null;
  agentId: string;
}>): boolean {
  if (!input.connectionId) return false;
  return input.preferences[`${input.connectionId}:${input.agentId}`]?.muted === true;
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
