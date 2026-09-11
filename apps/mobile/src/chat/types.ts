import type { AgentAdapter } from '@clawket/agent-protocol';

export type ChatControllerOptions = {
  readOnly?: boolean;
  adapter: AgentAdapter | null;
  routeSessionKey?: string;
  debugMode?: boolean;
  showAgentAvatar?: boolean;
  chatSessionRequest?: {
    sessionKey: string;
    requestedAt: number;
    sourceRole?: string;
  } | null;
  clearChatSessionRequest?: () => void;
};
