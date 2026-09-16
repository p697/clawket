export type BackendKind = 'openclaw' | 'hermes' | 'youmind' | 'local-model';

export type TransportKind =
  | 'relay'
  | 'local'
  | 'tailscale'
  | 'cloudflare'
  | 'custom'
  | 'https';

export type ServiceEnvironment = 'production' | 'preview';

/** Exact platform-neutral shape of the pre-3.0 OpenClaw bootstrap record. */
export interface OpenClawBootstrapConfig {
  token: string;
  strategy: 'mobile-setup' | 'legacy-bound';
  expiresAtMs?: number;
  access?: 'full' | 'limited' | 'node';
}

/** Exact platform-neutral shape of the pre-3.0 Relay configuration. */
export interface RelayGatewayConfig {
  serverUrl: string;
  gatewayId: string;
  clientToken?: string;
  displayName?: string;
  protocolVersion?: number;
  supportsBootstrap?: boolean;
}

/** Exact platform-neutral shape of the pre-3.0 Hermes configuration. */
export interface HermesGatewayConfig {
  bridgeUrl: string;
  displayName?: string;
}

/** Credential-bearing record. Only the connection registry may persist it. */
export interface ConnectionRecord {
  id: string;
  backendKind: BackendKind;
  transportKind: TransportKind;
  label: string;
  environment?: ServiceEnvironment;
  createdAt: number;
  url: string;
  auth?: { token?: string; password?: string };
  bootstrap?: OpenClawBootstrapConfig;
  relay?: RelayGatewayConfig;
  hermes?: HermesGatewayConfig;
  youmind?: { authScopeKey: string };
  debugMode?: boolean;
}

/** Credential-free connection view that is safe for UI and protocol consumers. */
export interface ConnectionDescriptor {
  id: string;
  backendKind: BackendKind;
  transportKind: TransportKind;
  label: string;
  environment?: ServiceEnvironment;
  createdAt: number;
  bridgeOutdated?: boolean;
  isFreeSlot: boolean;
}

export interface AgentDescriptor {
  connectionId: string;
  agentId: string;
  name: string;
  emoji?: string;
  avatarUrl?: string;
  isMain: boolean;
  mainSessionKey: string;
}

export type SessionKind =
  | 'main'
  | 'channel'
  | 'direct'
  | 'group'
  | 'subagent'
  | 'cron'
  | 'other';

export interface SessionActions {
  rename: boolean;
  reset: boolean;
  delete: boolean;
  pin: boolean;
}

export interface SessionDescriptor {
  connectionId: string;
  agentId: string;
  key: string;
  kind: SessionKind;
  title: string;
  channel?: string;
  /** Last backend write to the session record; may move on housekeeping (heartbeats, metadata patches). */
  updatedAt: number | null;
  /**
   * Last activity a person took part in: a user message or a run whose output
   * reaches the user. Adapters that can separate this from housekeeping must set
   * it (`null` when the session never had such activity); adapters that cannot
   * leave it undefined and consumers fall back to `updatedAt` via
   * `sessionActivityAt`.
   */
  lastActivityAt?: number | null;
  preview?: string;
  model?: string;
  modelProvider?: string;
  sessionId?: string;
  hasActiveRun: boolean;
  attention?: 'approval' | 'error' | 'cron_failed' | null;
  parentSessionKey?: string;
  source?: 'bridge' | 'native';
  allowedActions: SessionActions;
}

/** Session kinds a person takes part in; sub-agent and scheduled runs are background work. */
export const HUMAN_SESSION_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'main',
  'channel',
  'direct',
  'group',
  'other',
]);

/**
 * Timestamp that orders and unread-marks a session: `lastActivityAt` when the
 * adapter reports it, otherwise the backend `updatedAt`.
 */
export function sessionActivityAt(
  session: Pick<SessionDescriptor, 'updatedAt' | 'lastActivityAt'>,
): number | null {
  const value = session.lastActivityAt === undefined ? session.updatedAt : session.lastActivityAt;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export interface PromptAttachment {
  type: 'image' | 'file';
  mimeType: string;
  content: string;
  name?: string;
}

export interface PromptInput {
  text: string;
  attachments?: PromptAttachment[];
  skillId?: string;
  thinkingLevel?: string;
  idempotencyKey: string;
}

export interface Usage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
  costUsd?: number;
}

/** Rendering-neutral subset of the existing mobile `UiMessage` model. */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  text: string;
  timestampMs?: number;
  idempotencyKey?: string;
  skill?: { id: string; name: string };
  attachments?: Array<{
    type: 'image' | 'file';
    mimeType: string;
    content?: string;
    uri?: string;
    name?: string;
  }>;
  provider?: string;
  model?: string;
  usage?: Usage;
  tool?: {
    name: string;
    status: 'running' | 'success' | 'error' | 'unknown';
    callId?: string;
    summary?: string;
    input?: unknown;
    output?: unknown;
    durationMs?: number;
    startedAtMs?: number;
    finishedAtMs?: number;
  };
}

export interface SessionHistory {
  key: string;
  messages: ChatMessage[];
  nextCursor?: string;
  hasActiveRun: boolean;
  /** Backend recovery snapshot; absent on peers that do not expose live runs. */
  activeRun?: { runId: string; text: string; startedAtMs?: number; sessionAbortable?: boolean };
  sessionId?: string;
  thinkingLevel?: string;
}

export interface FinalMessage {
  role: 'assistant';
  content: string;
  provider?: string;
  model?: string;
}

export type ApprovalRequest =
  | {
      kind: 'exec';
      id: string;
      command: string;
      cwd?: string;
      host?: string;
      expiresAtMs: number;
    }
  | {
      kind: 'plugin';
      id: string;
      pluginId: string;
      title: string;
      expiresAtMs: number;
    }
  | {
      kind: 'pair';
      id: string;
      target: 'device' | 'node';
      displayName: string | null;
      platform: string | null;
      receivedAtMs: number;
    };
