import type { Capabilities } from './capabilities';
import type {
  AgentDescriptor,
  ApprovalRequest,
  ConnectionDescriptor,
  FinalMessage,
  PromptInput,
  SessionDescriptor,
  SessionHistory,
  Usage,
} from './descriptors';
import type { AdapterErrorCode } from './errors';
import type { ManagementOperations } from './management';

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'handshaking'
  | 'ready'
  | 'reconnecting'
  | 'offline'
  | 'error';

export type SessionUpdate =
  | { type: 'history_reconciled'; sessionKey: string; history: SessionHistory }
  | { type: 'run_started'; sessionKey: string; runId: string }
  | { type: 'agent_message_chunk'; sessionKey: string; runId: string; text: string }
  | { type: 'agent_thought_chunk'; sessionKey: string; runId: string; text: string }
  | {
      type: 'tool_call';
      sessionKey: string;
      runId: string;
      toolCallId: string;
      title: string;
      kind?: string;
      rawInput?: unknown;
    }
  | {
      type: 'tool_call_update';
      sessionKey: string;
      runId: string;
      toolCallId: string;
      status: 'running' | 'success' | 'error';
      rawOutput?: unknown;
    }
  | {
      type: 'run_finished';
      sessionKey: string;
      runId: string;
      stopReason: 'end_turn' | 'cancelled' | 'error' | 'max_tokens';
      message?: FinalMessage;
      usage?: Usage;
    }
  | { type: 'compaction'; sessionKey: string; phase: 'start' | 'end' }
  | { type: 'pairing_required'; requestId?: string }
  | { type: 'pairing_resolved'; requestId?: string; decision: 'approved' | 'rejected' }
  | { type: 'approval_requested'; sessionKey?: string; approval: ApprovalRequest }
  | {
      type: 'approval_resolved';
      approvalId: string;
      decision: string;
      kind?: ApprovalRequest['kind'];
      target?: 'device' | 'node';
    }
  | { type: 'session_info_update'; session: Partial<SessionDescriptor> & { key: string } }
  | {
      type: 'usage_update';
      sessionKey: string;
      contextUsed?: number;
      contextWindow?: number;
      costToday?: number;
    }
  | {
      type: 'system_event';
      sessionKey: string;
      kind: 'command_ack' | 'connection' | 'compaction_note' | 'info';
      text: string;
      timestampMs: number;
    }
  | {
      type: 'error';
      sessionKey?: string;
      runId?: string;
      code: AdapterErrorCode;
      message: string;
    };

export interface AgentAdapter {
  readonly connection: ConnectionDescriptor;
  readonly capabilities: Capabilities;
  readonly state: ConnectionState;
  connect(): Promise<void>;
  disconnect(): void;
  probe(timeoutMs?: number): Promise<boolean>;
  listAgents(): Promise<AgentDescriptor[]>;
  listSessions(agentId?: string): Promise<SessionDescriptor[]>;
  loadSession(key: string, options?: { limit?: number; cursor?: string }): Promise<SessionHistory>;
  prompt(key: string, input: PromptInput): Promise<{ runId: string }>;
  cancel(key: string, runId?: string): Promise<void>;
  createSession?(agentId: string, options?: { title?: string }): Promise<SessionDescriptor>;
  patchSession?(key: string, patch: { title?: string }): Promise<void>;
  resetSession?(key: string): Promise<void>;
  deleteSession?(key: string): Promise<void>;
  management?: ManagementOperations;
  on(event: 'update', listener: (update: SessionUpdate) => void): () => void;
  on(event: 'state', listener: (state: ConnectionState, reason?: string) => void): () => void;
  on(event: 'sessions', listener: (sessions: SessionDescriptor[]) => void): () => void;
}
