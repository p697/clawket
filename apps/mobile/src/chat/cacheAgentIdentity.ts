import { resolveAgentDisplayName } from "../services/agent-display-name";
import type { AgentInfo } from "../types/agent";
import { agentIdFromSessionKey } from "./agentActivity";

export type CachedAgentIdentity = {
  agentId: string;
  agentName?: string;
  agentEmoji?: string;
};

function readAgentName(agent?: AgentInfo): string | undefined {
  return resolveAgentDisplayName(agent);
}

export function resolveCachedAgentIdentity(
  agents: AgentInfo[],
  currentAgentId: string,
  sessionKey: string | null,
): CachedAgentIdentity {
  const agentId = sessionKey
    ? (agentIdFromSessionKey(sessionKey) ?? currentAgentId)
    : currentAgentId;
  const matchedAgent = agents.find((agent) => agent.id === agentId);

  return {
    agentId,
    agentName: readAgentName(matchedAgent),
    agentEmoji: matchedAgent?.identity?.emoji,
  };
}
