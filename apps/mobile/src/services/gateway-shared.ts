import type { ConnectionState, SessionInfo } from '../types';
import type { AgentEventPayload, ChatEventPayload, ConnectChallengePayload } from '../types';
import { isSilentReplyPrefixText } from '../utils/chat-message';

export const MIN_PROTOCOL_VERSION = 3;
export const PROTOCOL_VERSION = 4;

export const RECONNECT_BASE_MS = 800;
export const RECONNECT_MAX_MS = 15_000;
export const REQUEST_TIMEOUT_MS = 15_000;
export const REQUEST_TIMEOUT_RECONNECT_COOLDOWN_MS = 8_000;
export const CONNECT_REQUEST_TIMEOUT_MS = 8_000;
export const FORCE_RECONNECT_DEBOUNCE_MS = 8_000;
export const RELAY_LOOKUP_TIMEOUT_MS = 3_500;
export const RELAY_LOOKUP_TTL_FALLBACK_MS = 5 * 60 * 1000;
export const RELAY_BOOTSTRAP_TIMEOUT_MS = 12_000;
export const WS_OPEN_TIMEOUT_MS = 10_000;
export const CHALLENGE_TIMEOUT_MS = 20_000;
export const PAIRING_WAIT_TIMEOUT_MS = 5 * 60 * 1000;
export const SESSION_LIST_CACHE_TTL_MS = 5_000;
export const AGENT_LIST_CACHE_TTL_MS = 5_000;
export const AGENT_IDENTITY_CACHE_TTL_MS = 30_000;

export type GatewayEvents = {
  connection: { state: ConnectionState; reason?: string };
  chatDelta: { runId: string; sessionKey: string; text: string };
  chatTool: {
    runId: string;
    sessionKey?: string;
    toolCallId: string;
    name: string;
    phase: 'start' | 'update' | 'result';
    timestampMs?: number;
    args?: unknown;
    output?: string;
    status: 'running' | 'success' | 'error';
  };
  chatFinal: {
    runId: string;
    sessionKey?: string;
    message?: { role?: string; content?: string | Array<{ type: string; text?: string }>; provider?: string; model?: string };
    usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number };
  };
  chatAborted: { runId: string; sessionKey?: string };
  chatError: { runId: string; sessionKey?: string; message: string };
  chatRunStart: { runId: string; sessionKey?: string };
  chatCompaction: { runId: string; sessionKey?: string; phase: 'start' | 'end' };
  pairingRequired: { requestId?: string };
  pairingResolved: { requestId?: string; deviceId?: string; decision: 'approved' | 'rejected' };
  execApprovalRequested: {
    id: string;
    request: {
      command: string;
      commandArgv?: string[];
      cwd?: string;
      host?: string;
      security?: string;
      sessionKey?: string;
    };
    createdAtMs: number;
    expiresAtMs: number;
  };
  execApprovalResolved: {
    id: string;
    decision: string;
  };
  seqGap: { sessionKey?: string; fromSeq?: number; toSeq?: number };
  health: { status?: string; ts?: number; [key: string]: unknown };
  tick: Record<string, never>;
  error: { code: string; message: string; retryable?: boolean; hint?: string };
};

export type Listener<T> = (event: T) => void;

export type ListenerStore = {
  [K in keyof GatewayEvents]: Set<Listener<GatewayEvents[K]>>;
};

export type PendingRequest = {
  id: string;
  method: string;
  startedAt: number;
  traced: boolean;
  resolve: (payload: unknown) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export class GatewayRequestError extends Error {
  readonly code: string;
  readonly details?: unknown;
  readonly retryable?: boolean;
  readonly retryAfterMs?: number;

  constructor(input: {
    code: string;
    message: string;
    details?: unknown;
    retryable?: boolean;
    retryAfterMs?: number;
  }) {
    super(`[${input.code}] ${input.message}`);
    this.name = 'GatewayRequestError';
    this.code = input.code;
    this.details = input.details;
    this.retryable = input.retryable;
    this.retryAfterMs = input.retryAfterMs;
  }
}

export type GatewayConnectErrorDetails = {
  code?: string;
  reason?: string;
  requestId?: string;
  recommendedNextStep?: string;
  canRetryWithDeviceToken?: boolean;
  pauseReconnect?: boolean;
};

export function readGatewayConnectErrorDetails(error: unknown): GatewayConnectErrorDetails {
  const rawDetails = error instanceof GatewayRequestError ? error.details : undefined;
  const details = rawDetails && typeof rawDetails === 'object' && !Array.isArray(rawDetails)
    ? rawDetails as Record<string, unknown>
    : {};
  const readString = (value: unknown): string | undefined => (
    typeof value === 'string' && value.trim() ? value.trim() : undefined
  );
  return {
    code: readString(details.code) ?? (error instanceof GatewayRequestError ? readString(error.code) : undefined),
    reason: readString(details.reason),
    requestId: readString(details.requestId),
    recommendedNextStep: readString(details.recommendedNextStep),
    canRetryWithDeviceToken: typeof details.canRetryWithDeviceToken === 'boolean'
      ? details.canRetryWithDeviceToken
      : undefined,
    pauseReconnect: typeof details.pauseReconnect === 'boolean' ? details.pauseReconnect : undefined,
  };
}

export function isGatewayConnectErrorCode(error: unknown, ...codes: string[]): boolean {
  const code = readGatewayConnectErrorDetails(error).code?.toUpperCase();
  return Boolean(code && codes.some((candidate) => candidate.toUpperCase() === code));
}

export type TimedValue<T> = {
  value: T;
  expiresAt: number;
};

export type GatewayInfo = {
  version: string;
  connId: string;
  uptimeMs: number;
  host?: string;
  ip?: string;
  platform?: string;
  authMode?: string;
  updateAvailable?: { currentVersion: string; latestVersion: string };
};

export type SessionsListResult = {
  sessions?: SessionInfo[];
  defaults?: {
    contextTokens?: number | null;
  };
};

export type ChatHistoryResult = {
  messages: Array<{ role: string; content: unknown }>;
  sessionId?: string;
  thinkingLevel?: string;
};

export type ExtractableMessage = {
  role?: string;
  content?: string | Array<{ type: string; text?: string }>;
};

export type GatewayEventFrame = { type: 'event'; event: string; payload?: unknown };

export type GatewayMessageContext = {
  connectRequestCompleted: boolean;
  connectRequestInFlight: boolean;
  connectAttemptId: number;
  activeRoute: 'direct' | 'relay';
  connectStartedAt: number;
  state: ConnectionState;
  pendingRequests: Map<string, PendingRequest>;
  ws: WebSocket | null;
  pairingPending: boolean;
  lastTickAt: number | null;
  listeners: ListenerStore;
  emit: <K extends keyof GatewayEvents>(event: K, payload: GatewayEvents[K]) => void;
  logTelemetry: (event: string, fields: Record<string, unknown>) => void;
  clearChallengeTimer: () => void;
  handleConnectChallenge: (payload: ConnectChallengePayload) => Promise<void>;
  invalidateSessionMetadataCache: () => void;
  clearReconnectBlock: () => void;
  clearPairingTimer: () => void;
  scheduleReconnect: () => void;
};

export type GatewayChatPayload = ChatEventPayload;
export type GatewayAgentPayload = AgentEventPayload;

export function extractText(message?: ExtractableMessage): string {
  if (!message?.content) return '';
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
}

function buildToolEvent(payload: {
  name?: unknown;
  args?: unknown;
  result?: unknown;
  partialResult?: unknown;
  meta?: unknown;
  error?: unknown;
  isError?: unknown;
}): { name: string; summary: string; detail: string; status: 'success' | 'error' } {
  const name = String(payload.name ?? 'tool');
  const status: 'success' | 'error' = payload.isError || payload.error ? 'error' : 'success';
  const summarySource = payload.meta ?? payload.partialResult ?? payload.result ?? payload.args ?? `${name} running`;
  const summaryRaw = typeof summarySource === 'string' ? summarySource : JSON.stringify(summarySource);
  const summary = summaryRaw.length > 120 ? `${summaryRaw.slice(0, 120)}...` : summaryRaw;
  const detailRaw = JSON.stringify(payload);
  const detail = detailRaw.length > 2000 ? `${detailRaw.slice(0, 2000)}...` : detailRaw;
  return { name, summary, detail, status };
}

export function formatToolOutput(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    return value.length > 120_000 ? `${value.slice(0, 120_000)}... [truncated]` : value;
  }
  let text: string;
  try {
    if (typeof value === 'object' && value !== null) {
      const record = value as Record<string, unknown>;
      if (typeof record.text === 'string') {
        text = record.text;
      } else if (Array.isArray(record.content)) {
        const parts = (record.content as Array<Record<string, unknown>>)
          .filter((item) => item.type === 'text' && typeof item.text === 'string')
          .map((item) => item.text as string);
        text = parts.length > 0 ? parts.join('\n') : JSON.stringify(value, null, 2);
      } else {
        text = JSON.stringify(value, null, 2);
      }
    } else {
      text = JSON.stringify(value, null, 2);
    }
  } catch {
    text = String(value);
  }
  return text.length > 120_000 ? `${text.slice(0, 120_000)}... [truncated]` : text;
}

export function extractToolBlocks(
  content?: unknown,
): Array<{ toolCallId: string; name: string; summary: string; detail: string; status: 'success' | 'error' }> {
  if (!Array.isArray(content)) return [];
  const out: Array<{ toolCallId: string; name: string; summary: string; detail: string; status: 'success' | 'error' }> = [];

  for (const raw of content) {
    if (!raw || typeof raw !== 'object') continue;
    const block = raw as Record<string, unknown>;
    const type = String(block.type ?? '');
    const hasToolSignals = type.includes('tool') || !!block.tool || !!block.name || !!block.function;
    if (!hasToolSignals) continue;
    const toolCallId = typeof block.toolCallId === 'string'
      ? block.toolCallId
      : typeof block.id === 'string'
        ? block.id
        : '';
    out.push({
      toolCallId,
      ...buildToolEvent({
        name: block.name ?? block.tool ?? (block.function as Record<string, unknown> | undefined)?.name,
        args: block.input ?? block.args,
        result: block.output ?? block.result,
        error: block.error,
        isError: block.isError ?? block.failed,
        meta: block.summary,
      }),
    });
  }

  return out;
}

export function handleGatewayRawMessage(context: GatewayMessageContext, rawData: unknown): void {
  let parsed: unknown;
  try {
    parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
  } catch {
    context.emit('error', { code: 'invalid_json', message: 'Failed to parse server message' });
    return;
  }

  if (!isGatewayFrame(parsed)) return;

  // Relay worker emits keepalive ticks as a top-level frame
  // (`{ type: 'tick', ts }`) instead of a standard event envelope.
  // Treat that transport-level heartbeat the same as a gateway tick event
  // so the client watchdog does not misclassify healthy relay sessions as stale.
  if ((parsed as { type?: string }).type === 'tick') {
    context.lastTickAt = Date.now();
    context.emit('tick', {} as GatewayEvents['tick']);
    return;
  }

  if (isResFrame(parsed)) {
    handleGatewayResponse(context, parsed);
  } else if (isEventFrame(parsed)) {
    handleGatewayEvent(context, parsed as GatewayEventFrame);
  }
}

function handleGatewayResponse(context: GatewayMessageContext, frame: {
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: {
    message?: string;
    code?: string;
    details?: unknown;
    retryable?: boolean;
    retryAfterMs?: number;
  };
}): void {
  const pending = context.pendingRequests.get(frame.id);
  if (!pending) return;
  context.pendingRequests.delete(frame.id);
  clearTimeout(pending.timeout);

  if (pending.traced) {
    context.logTelemetry(frame.ok ? 'req_ok' : 'req_err', {
      attemptId: context.connectAttemptId,
      route: context.activeRoute,
      requestId: pending.id,
      method: pending.method,
      durationMs: Date.now() - pending.startedAt,
      ...(frame.ok
        ? {}
        : {
          errorCode: frame.error?.code ?? 'unknown',
          errorMessage: frame.error?.message ?? 'Request failed',
        }),
    });
  }

  if (frame.ok) {
    pending.resolve(frame.payload);
    return;
  }

  const errMsg = frame.error?.message ?? 'Request failed';
  const errCode = frame.error?.code ?? 'unknown';
  pending.reject(new GatewayRequestError({
    code: errCode,
    message: errMsg,
    details: frame.error?.details,
    retryable: frame.error?.retryable,
    retryAfterMs: frame.error?.retryAfterMs,
  }));
}

function handleGatewayEvent(context: GatewayMessageContext, frame: GatewayEventFrame): void {
  switch (frame.event) {
    case 'connect.challenge': {
      if (context.connectRequestCompleted) {
        context.logTelemetry('challenge_ignored', {
          attemptId: context.connectAttemptId,
          route: context.activeRoute,
          reason: 'already_connected',
        });
        return;
      }
      if (context.connectRequestInFlight) {
        context.logTelemetry('challenge_ignored', {
          attemptId: context.connectAttemptId,
          route: context.activeRoute,
          reason: 'connect_in_flight',
        });
        return;
      }
      context.connectRequestInFlight = true;
      context.clearChallengeTimer();
      context.logTelemetry('challenge_received', {
        attemptId: context.connectAttemptId,
        route: context.activeRoute,
        elapsedMs: Date.now() - context.connectStartedAt,
      });
      context.handleConnectChallenge(frame.payload as ConnectChallengePayload)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          context.emit('error', { code: 'challenge_failed', message });
        })
        .finally(() => {
          context.connectRequestInFlight = false;
          context.connectRequestCompleted = context.state === 'ready';
        });
      return;
    }
    case 'chat':
      handleGatewayChatEvent(context, frame.payload as ChatEventPayload);
      return;
    case 'agent':
      handleGatewayAgentEvent(context, frame.payload as AgentEventPayload);
      return;
    case 'exec.approval.requested':
      context.emit('execApprovalRequested', frame.payload as GatewayEvents['execApprovalRequested']);
      return;
    case 'exec.approval.resolved':
      context.emit('execApprovalResolved', frame.payload as GatewayEvents['execApprovalResolved']);
      return;
    case 'seq.gap': {
      const gapPayload = frame.payload as GatewayEvents['seqGap'] | undefined;
      context.emit('seqGap', {
        sessionKey: gapPayload?.sessionKey,
        fromSeq: gapPayload?.fromSeq,
        toSeq: gapPayload?.toSeq,
      });
      return;
    }
    case 'health':
      context.emit('health', (frame.payload ?? {}) as GatewayEvents['health']);
      return;
    case 'tick':
      context.lastTickAt = Date.now();
      context.emit('tick', {} as GatewayEvents['tick']);
      return;
    case 'device.pair.resolved': {
      const resolved = frame.payload as { requestId?: string; deviceId?: string; decision?: string } | undefined;
      const decision = resolved?.decision === 'approved' ? 'approved' : 'rejected';
      context.emit('pairingResolved', {
        requestId: resolved?.requestId,
        deviceId: resolved?.deviceId,
        decision,
      });
      if (decision === 'approved' && context.pairingPending) {
        context.pairingPending = false;
        context.clearReconnectBlock();
        context.clearPairingTimer();
        context.ws?.close();
        context.scheduleReconnect();
      }
      return;
    }
    case 'system-presence':
    default:
      return;
  }
}

function handleGatewayChatEvent(context: GatewayMessageContext, payload: ChatEventPayload): void {
  const { runId, sessionKey, state, message, errorMessage, usage } = payload;

  switch (state) {
    case 'delta': {
      const text = extractText(message);
      if (text && !isSilentReplyPrefixText(text)) {
        context.emit('chatDelta', { runId, sessionKey, text });
      }
      for (const tool of extractToolBlocks(message?.content)) {
        context.emit('chatTool', {
          runId,
          sessionKey,
          toolCallId: tool.toolCallId || `chat_${runId}_${tool.name}_${Date.now()}`,
          name: tool.name,
          phase: 'result',
          args: undefined,
          output: tool.detail,
          status: tool.status,
        });
      }
      return;
    }
    case 'final': {
      const usageData = (usage && typeof usage === 'object')
        ? usage as { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number }
        : undefined;
      context.invalidateSessionMetadataCache();
      context.emit('chatFinal', { runId, sessionKey, message, usage: usageData });
      return;
    }
    case 'aborted':
      context.invalidateSessionMetadataCache();
      context.emit('chatAborted', { runId, sessionKey });
      return;
    case 'error':
      context.invalidateSessionMetadataCache();
      context.emit('chatError', { runId, sessionKey, message: errorMessage ?? 'Stream error' });
      return;
    default:
      return;
  }
}

function handleGatewayAgentEvent(context: GatewayMessageContext, payload: AgentEventPayload): void {
  const runId = payload.runId;
  const sessionKey = payload.sessionKey;

  if (payload.stream === 'compaction') {
    const phase = payload.data?.phase;
    if (phase === 'start' || phase === 'end') {
      context.emit('chatCompaction', { runId, sessionKey, phase });
    }
    return;
  }

  if (payload.stream === 'lifecycle') {
    if (payload.data?.phase === 'start') {
      context.emit('chatRunStart', { runId, sessionKey: sessionKey || undefined });
    }
    return;
  }

  if (payload.stream !== 'tool') return;
  const data = payload.data;
  if (!runId || !data) return;

  const phase = data.phase;
  if (phase !== 'start' && phase !== 'update' && phase !== 'result') return;

  const toolCallId = data.toolCallId ?? `agent_${runId}_${data.name ?? 'tool'}_${Date.now()}`;
  const name = String(data.name ?? 'tool');
  const timestampMs = typeof payload.ts === 'number' && Number.isFinite(payload.ts)
    ? payload.ts
    : undefined;
  const hasError = !!(data.isError || data.error);
  const status: 'running' | 'success' | 'error' = phase === 'result'
    ? (hasError ? 'error' : 'success')
    : 'running';
  const output = phase === 'update'
    ? formatToolOutput(data.partialResult)
    : phase === 'result'
      ? formatToolOutput(data.result)
      : undefined;

  context.emit('chatTool', {
    runId,
    sessionKey: sessionKey || undefined,
    toolCallId,
    name,
    phase,
    timestampMs,
    args: phase === 'start' ? data.args : undefined,
    output: output ?? undefined,
    status,
  });
}

export function isAbortLikeError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'AbortError') return true;
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  return lowered === 'aborted' || lowered.includes('abort');
}

export function isInvalidRequestError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes('invalid_request');
}

export function isNonceMismatchError(message: string): boolean {
  return message.toLowerCase().includes('device nonce mismatch');
}

export function isDeviceSignatureInvalidError(message: string): boolean {
  return message.toLowerCase().includes('device signature invalid');
}

export function isBootstrapTokenUnsupportedError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('invalid_request')
    && normalized.includes('invalid connect params')
    && normalized.includes('/auth')
    && normalized.includes('unexpected property')
    && normalized.includes('bootstraptoken');
}

function isGatewayFrame(value: unknown): value is { type: string } {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

function isResFrame(value: unknown): value is { type: 'res'; id: string; ok: boolean; payload?: unknown; error?: { message?: string; code?: string } } {
  return isGatewayFrame(value) && (value as { type?: string }).type === 'res' && typeof (value as { id?: unknown }).id === 'string';
}

function isEventFrame(value: unknown): value is GatewayEventFrame {
  return isGatewayFrame(value) && (value as { type?: string }).type === 'event' && typeof (value as { event?: unknown }).event === 'string';
}
