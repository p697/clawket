export interface AgentIdentity {
  name?: string;
  emoji?: string;
  avatar?: string;
  avatarUrl?: string;
}

export interface AgentInfo {
  connectionId?: string;
  id: string;
  name?: string;
  identity?: AgentIdentity;
}

export interface AgentsListResult {
  defaultId: string;
  mainKey: string;
  agents: AgentInfo[];
}

export interface AgentCreateResult {
  ok: boolean;
  agentId: string;
  name: string;
  workspace: string;
}

export interface AgentUpdateResult {
  ok: boolean;
  agentId: string;
}

export interface AgentDeleteResult {
  ok: boolean;
  agentId: string;
  removedBindings?: number;
}
