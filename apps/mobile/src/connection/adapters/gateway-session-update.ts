import type { AdapterErrorCode, SessionUpdate, Usage } from '@clawket/agent-protocol';

export type GatewayAdapterEvent =
  | { type: 'chatRunStart'; payload: { runId: string; sessionKey?: string } }
  | { type: 'chatDelta'; payload: { runId: string; sessionKey?: string; text: string } }
  | {
      type: 'chatTool';
      payload: {
        runId: string;
        sessionKey?: string;
        toolCallId: string;
        name: string;
        phase: 'start' | 'update' | 'result';
        args?: unknown;
        output?: unknown;
        status: 'running' | 'success' | 'error';
      };
    }
  | {
      type: 'chatFinal';
      payload: {
        runId: string;
        sessionKey?: string;
        message?: {
          role?: string;
          content?: string | Array<{ type: string; text?: string }>;
          provider?: string;
          model?: string;
        };
        usage?: Usage;
      };
    }
  | { type: 'chatAborted'; payload: { runId: string; sessionKey?: string } }
  | { type: 'chatError'; payload: { runId: string; sessionKey?: string; message: string } }
  | { type: 'chatCompaction'; payload: { runId: string; sessionKey?: string; phase: 'start' | 'end' } }
  | {
      type: 'execApprovalRequested';
      payload: {
        id: string;
        request: { command: string; cwd?: string; host?: string; sessionKey?: string };
        expiresAtMs: number;
      };
    }
  | { type: 'execApprovalResolved'; payload: { id: string; decision: string } }
  | { type: 'pairingRequired'; payload: { requestId?: string } }
  | {
      type: 'pairingResolved';
      payload: { requestId?: string; decision: 'approved' | 'rejected' };
    }
  | { type: 'error'; payload: { code: string; message: string } };

export function mapGatewayAdapterEvent(
  event: GatewayAdapterEvent,
  fallbackSessionKey: string,
  now: () => number = Date.now,
): SessionUpdate[] {
  const sessionKey = 'sessionKey' in event.payload && event.payload.sessionKey
    ? event.payload.sessionKey
    : fallbackSessionKey;

  switch (event.type) {
    case 'chatRunStart':
      return [{ type: 'run_started', sessionKey, runId: event.payload.runId }];
    case 'chatDelta':
      return [{
        type: 'agent_message_chunk',
        sessionKey,
        runId: event.payload.runId,
        text: event.payload.text,
      }];
    case 'chatTool':
      if (event.payload.phase === 'start') {
        return [{
          type: 'tool_call',
          sessionKey,
          runId: event.payload.runId,
          toolCallId: event.payload.toolCallId,
          title: event.payload.name,
          kind: event.payload.name,
          rawInput: event.payload.args,
        }];
      }
      return [{
        type: 'tool_call_update',
        sessionKey,
        runId: event.payload.runId,
        toolCallId: event.payload.toolCallId,
        status: event.payload.status,
        rawOutput: event.payload.output,
      }];
    case 'chatFinal': {
      const text = extractGatewayMessageText(event.payload.message?.content);
      return [{
        type: 'run_finished',
        sessionKey,
        runId: event.payload.runId,
        stopReason: 'end_turn',
        message: event.payload.message
          ? {
              role: 'assistant',
              content: text,
              provider: event.payload.message.provider,
              model: event.payload.message.model,
            }
          : undefined,
        usage: event.payload.usage,
      }];
    }
    case 'chatAborted':
      return [{
        type: 'run_finished',
        sessionKey,
        runId: event.payload.runId,
        stopReason: 'cancelled',
      }];
    case 'chatError':
      return [
        {
          type: 'error',
          sessionKey,
          runId: event.payload.runId,
          code: 'server',
          message: event.payload.message,
        },
        {
          type: 'run_finished',
          sessionKey,
          runId: event.payload.runId,
          stopReason: 'error',
        },
      ];
    case 'chatCompaction':
      return [{ type: 'compaction', sessionKey, phase: event.payload.phase }];
    case 'execApprovalRequested':
      return [{
        type: 'approval_requested',
        sessionKey: event.payload.request.sessionKey,
        approval: {
          kind: 'exec',
          id: event.payload.id,
          command: event.payload.request.command,
          cwd: event.payload.request.cwd,
          host: event.payload.request.host,
          expiresAtMs: event.payload.expiresAtMs,
        },
      }];
    case 'execApprovalResolved':
      return [{
        type: 'approval_resolved',
        approvalId: event.payload.id,
        decision: event.payload.decision,
      }];
    case 'pairingRequired': {
      const approvalId = event.payload.requestId ?? 'pair';
      return [{
        type: 'approval_requested',
        approval: {
          kind: 'pair',
          id: approvalId,
          target: 'device',
          displayName: null,
          platform: null,
          receivedAtMs: now(),
        },
      }];
    }
    case 'pairingResolved':
      return [{
        type: 'approval_resolved',
        approvalId: event.payload.requestId ?? 'pair',
        decision: event.payload.decision,
      }];
    case 'error':
      return [{
        type: 'error',
        code: mapGatewayErrorCode(event.payload.code),
        message: event.payload.message,
      }];
  }
}

export function mapGatewayErrorCode(code: string): AdapterErrorCode {
  const normalized = code.trim().toLowerCase();
  if (normalized.includes('frame_too_large') || /^1009(?:\s|$)/u.test(normalized)) {
    return 'frame_too_large';
  }
  if (normalized.includes('rate') || /^4008(?:\s|$)/u.test(normalized)) return 'rate_limited';
  if (normalized.includes('pairing_expired') || normalized.includes('claim_expired')) return 'pairing_expired';
  if (normalized.includes('pairing')) return 'pairing_required';
  if (normalized.includes('auth') || normalized.includes('unauthorized')) return 'unauthorized';
  if (
    normalized.startsWith('network')
    || normalized.startsWith('ws_')
    || normalized.includes('socket')
    || normalized.includes('dns')
  ) return 'network';
  if (normalized.includes('challenge') || normalized.includes('bridge')) return 'bridge_offline';
  if (normalized.includes('timeout')) return 'timeout';
  if (normalized.includes('gateway') || normalized.includes('unavailable')) return 'gateway_offline';
  if (normalized.includes('network')) return 'network';
  if (normalized.includes('unsupported')) return 'unsupported';
  return 'server';
}

export function extractGatewayMessageText(
  content?: string | Array<{ type: string; text?: string }>,
): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
}
