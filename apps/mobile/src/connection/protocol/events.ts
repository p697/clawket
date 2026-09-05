import type { AgentEventPayload, ChatEventPayload } from '../../types';
import { isSilentReplyPrefixText } from '../../utils/chat-message';
import type { GatewayProtocolEvents } from './types';

type Emit = <K extends keyof GatewayProtocolEvents>(
  event: K,
  payload: GatewayProtocolEvents[K],
) => void;

export type RoutedEventResult = {
  pairingResolution?: GatewayProtocolEvents['pairingResolved'];
  terminalSessionChange?: boolean;
};

export function routeGatewayEvent(
  event: string,
  payload: unknown,
  emit: Emit,
  now: () => number,
): RoutedEventResult {
  switch (event) {
    case 'chat':
      return routeChatEvent(payload as ChatEventPayload, emit, now);
    case 'agent':
      routeAgentEvent(payload as AgentEventPayload, emit, now);
      return {};
    case 'exec.approval.requested':
      if (isRecord(payload)) {
        emit('execApprovalRequested', payload as GatewayProtocolEvents['execApprovalRequested']);
      }
      return {};
    case 'exec.approval.resolved':
      if (isRecord(payload)) {
        emit('execApprovalResolved', payload as GatewayProtocolEvents['execApprovalResolved']);
      }
      return {};
    case 'device.pair.requested':
    case 'node.pair.requested': {
      const requested = isRecord(payload) ? payload : {};
      const requestId = readString(requested.requestId);
      if (!requestId) return {};
      emit('pairApprovalRequested', {
        requestId,
        target: event === 'node.pair.requested' ? 'node' : 'device',
        displayName: readString(requested.displayName) ?? null,
        platform: readString(requested.platform) ?? null,
        ts: readNumber(requested.ts) ?? now(),
      });
      return {};
    }
    case 'seq.gap': {
      const gap = isRecord(payload) ? payload : {};
      emit('seqGap', {
        sessionKey: readString(gap.sessionKey),
        fromSeq: readNumber(gap.fromSeq),
        toSeq: readNumber(gap.toSeq),
      });
      return {};
    }
    case 'sessions.changed': {
      const record = isRecord(payload) ? payload : {};
      const sessions = Array.isArray(payload)
        ? payload
        : Array.isArray(record.sessions)
          ? record.sessions
          : undefined;
      emit('sessionsChanged', sessions ? { sessions } : {});
      return {};
    }
    case 'device.pair.resolved': {
      const resolved = isRecord(payload) ? payload : {};
      const decision = resolved.decision === 'approved' ? 'approved' : 'rejected';
      const requestId = readString(resolved.requestId);
      const ts = readNumber(resolved.ts) ?? now();
      if (requestId) {
        emit('pairApprovalResolved', {
          requestId,
          target: 'device',
          decision,
          ts,
        });
      }
      const pairingResolution: GatewayProtocolEvents['pairingResolved'] = {
        requestId,
        deviceId: readString(resolved.deviceId),
        decision,
      };
      return { pairingResolution };
    }
    case 'node.pair.resolved': {
      const resolved = isRecord(payload) ? payload : {};
      const requestId = readString(resolved.requestId);
      if (!requestId) return {};
      emit('pairApprovalResolved', {
        requestId,
        target: 'node',
        decision: resolved.decision === 'approved' ? 'approved' : 'rejected',
        ts: readNumber(resolved.ts) ?? now(),
      });
      return {};
    }
    default:
      return {};
  }
}

function routeChatEvent(
  payload: ChatEventPayload,
  emit: Emit,
  now: () => number,
): RoutedEventResult {
  if (!payload || typeof payload.runId !== 'string' || typeof payload.sessionKey !== 'string') {
    return {};
  }
  const { runId, sessionKey, message } = payload;
  if (payload.state === 'delta') {
    const text = extractText(message);
    if (text && !isSilentReplyPrefixText(text)) {
      emit('chatDelta', { runId, sessionKey, text });
    }
    for (const tool of extractToolBlocks(message?.content)) {
      emit('chatTool', {
        runId,
        sessionKey,
        toolCallId: tool.toolCallId || `chat_${runId}_${tool.name}_${now()}`,
        name: tool.name,
        phase: 'result',
        output: tool.output,
        status: tool.status,
      });
    }
    return {};
  }
  if (payload.state === 'final') {
    const usage = isRecord(payload.usage)
      ? payload.usage as GatewayProtocolEvents['chatFinal']['usage']
      : undefined;
    emit('chatFinal', { runId, sessionKey, message, usage });
    emit('sessionsChanged', {});
    return { terminalSessionChange: true };
  }
  if (payload.state === 'aborted') {
    emit('chatAborted', { runId, sessionKey });
    emit('sessionsChanged', {});
    return { terminalSessionChange: true };
  }
  if (payload.state === 'error') {
    emit('chatError', {
      runId,
      sessionKey,
      message: payload.errorMessage ?? 'Stream error',
    });
    emit('sessionsChanged', {});
    return { terminalSessionChange: true };
  }
  return {};
}

function routeAgentEvent(
  payload: AgentEventPayload,
  emit: Emit,
  now: () => number,
): void {
  if (!payload) return;
  const runId = readString(payload.runId);
  if (!runId) return;
  const sessionKey = readString(payload.sessionKey);
  if (payload.stream === 'compaction') {
    const phase = payload.data?.phase;
    if (phase === 'start' || phase === 'end') {
      emit('chatCompaction', { runId, sessionKey, phase });
    }
    return;
  }
  if (payload.stream === 'lifecycle') {
    if (payload.data?.phase === 'start') emit('chatRunStart', { runId, sessionKey });
    return;
  }
  if (payload.stream !== 'tool' || !payload.data) return;
  const phase = payload.data.phase;
  if (phase !== 'start' && phase !== 'update' && phase !== 'result') return;
  const hasError = Boolean(payload.data.isError || payload.data.error);
  emit('chatTool', {
    runId,
    sessionKey,
    toolCallId: payload.data.toolCallId ?? `agent_${runId}_${payload.data.name ?? 'tool'}_${now()}`,
    name: String(payload.data.name ?? 'tool'),
    phase,
    timestampMs: readNumber(payload.ts),
    args: phase === 'start' ? payload.data.args : undefined,
    output: phase === 'update'
      ? formatToolOutput(payload.data.partialResult)
      : phase === 'result'
        ? formatToolOutput(payload.data.result)
        : undefined,
    status: phase === 'result' ? (hasError ? 'error' : 'success') : 'running',
  });
}

export function extractText(message?: ChatEventPayload['message']): string {
  if (!message?.content) return '';
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
}

function extractToolBlocks(content: unknown): Array<{
  toolCallId: string;
  name: string;
  output?: string;
  status: 'success' | 'error';
}> {
  if (!Array.isArray(content)) return [];
  const blocks: Array<{
    toolCallId: string;
    name: string;
    output?: string;
    status: 'success' | 'error';
  }> = [];
  for (const value of content) {
    if (!isRecord(value)) continue;
    const type = String(value.type ?? '');
    if (!type.includes('tool') && !value.tool && !value.name && !value.function) continue;
    const fn = isRecord(value.function) ? value.function : {};
    blocks.push({
      toolCallId: readString(value.toolCallId) ?? readString(value.id) ?? '',
      name: readString(value.name ?? value.tool ?? fn.name) ?? 'tool',
      output: formatToolOutput(value.output ?? value.result ?? value.error ?? value),
      status: value.isError || value.failed || value.error ? 'error' : 'success',
    });
  }
  return blocks;
}

function formatToolOutput(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return truncate(value);
  try {
    if (isRecord(value) && typeof value.text === 'string') return truncate(value.text);
    return truncate(JSON.stringify(value, null, 2));
  } catch {
    return truncate(String(value));
  }
}

function truncate(value: string): string {
  return value.length > 120_000 ? `${value.slice(0, 120_000)}... [truncated]` : value;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
