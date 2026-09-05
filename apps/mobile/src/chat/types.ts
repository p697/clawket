import type { AgentAdapter } from '@clawket/agent-protocol';

export type ChatControllerOptions = {
  adapter: AgentAdapter | null;
  debugMode?: boolean;
  showAgentAvatar?: boolean;
  chatSessionRequest?: {
    sessionKey: string;
    requestedAt: number;
    sourceRole?: string;
  } | null;
  clearChatSessionRequest?: () => void;
};
