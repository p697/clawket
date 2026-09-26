import { normalizeMessageAttribution } from './messageAttribution';
import {
  useEffect,
  useRef,
} from 'react';
import {
  normalizeAttachmentMimeType,
  type AdapterErrorCode,
  type AgentAdapter,
  type ApprovalRequest,
  type ChatMessage,
  type ConnectionState,
  type SessionDescriptor,
  type SessionHistory,
  type SessionUpdate,
  type Usage,
} from '@clawket/agent-protocol';
import i18n from '../i18n';
import type { MessageUsage, UiMessage } from '../types/chat';
import {
  isAssistantDeliveryMirrorMessage,
  isAssistantSilentReplyMessage,
  isSilentReplyPrefixText,
} from '../utils/chat-message';

type ApprovalStatus = NonNullable<UiMessage['approval']>['status'];

export type AdapterChatUpdate =
  | Extract<SessionUpdate, { type: 'question_requested' | 'question_resolved' }>
  | {
      type: 'history_reconciled';
      sessionKey: string;
      history: SessionHistory;
      messages: UiMessage[];
      nextCursor?: string;
      hasActiveRun: boolean;
    }
  | {
      type: 'run_started';
      sessionKey: string;
      runId: string;
      activeRunId: string;
      isSending: true;
      startedAtMs: number;
    }
  | {
      type: 'agent_message_chunk';
      sessionKey: string;
      runId: string;
      text: string;
      textMode?: 'snapshot' | 'delta';
      activeRunId: string;
      isSending: true;
      visible: boolean;
      streamingMessage?: UiMessage;
    }
  | {
      type: 'agent_thought_chunk';
      sessionKey: string;
      runId: string;
      text: string;
      activeRunId: string;
      isSending: true;
    }
  | {
      type: 'tool_call';
      sessionKey: string;
      runId: string;
      toolCallId: string;
      message: UiMessage;
      merge: false;
      activeRunId: string;
      isSending: true;
    }
  | {
      type: 'tool_call_update';
      sessionKey: string;
      runId: string;
      toolCallId: string;
      message: UiMessage;
      merge: true;
      activeRunId: string;
      isSending: true;
    }
  | {
      type: 'run_finished';
      sessionKey: string;
      runId: string;
      stopReason: 'end_turn' | 'cancelled' | 'error' | 'max_tokens';
      unappliedInput?: string;
      activeRunId: null;
      isSending: false;
      finalMessage?: UiMessage;
      systemMessage?: UiMessage;
      usage?: MessageUsage;
      rawUsage?: Usage;
    }
  | {
      type: 'compaction';
      sessionKey: string;
      phase: 'start' | 'end';
      notice: string | null;
    }
  | { type: 'pairing_required'; requestId?: string }
  | { type: 'pairing_resolved'; requestId?: string; decision: 'approved' | 'rejected' }
  | {
      type: 'approval_requested';
      sessionKey?: string;
      approval: ApprovalRequest;
      message?: UiMessage;
    }
  | {
      type: 'approval_resolved';
      approvalId: string;
      decision: string;
      kind?: ApprovalRequest['kind'];
      target?: 'device' | 'node';
      status: ApprovalStatus;
      messageId: string;
    }
  | {
      type: 'session_info_update';
      session: Partial<SessionDescriptor> & { key: string };
    }
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
      message: UiMessage;
    }
  | {
      type: 'error';
      sessionKey?: string;
      runId?: string;
      code: AdapterErrorCode;
      errorMessage: string;
      message: UiMessage;
    };

export type AdapterChatEventHandlers = {
  onState?: (state: ConnectionState, reason?: string) => void;
  onSessions?: (sessions: SessionDescriptor[]) => void;
  onUpdate?: (update: AdapterChatUpdate) => void;
};

export type UseAdapterChatEventsOptions = AdapterChatEventHandlers & {
  adapter: AgentAdapter | null | undefined;
  now?: () => number;
};

type MappingOptions = {
  now?: () => number;
  translate?: (key: string) => string;
};

function mapUsage(usage: Usage | undefined): MessageUsage | undefined {
  if (!usage) return undefined;
  const mapped: MessageUsage = {
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    totalTokens: usage.total,
  };
  return Object.values(mapped).some((value) => value !== undefined) ? mapped : undefined;
}

function modelLabel(provider: string | undefined, model: string | undefined): string | undefined {
  if (!model) return undefined;
  return provider ? `${provider}/${model}` : model;
}

function stringifyUnknown(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  try {
    const serialized = JSON.stringify(value, null, 2);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

/** Convert the rendering-neutral protocol message into the current RN message model. */
export function mapAdapterChatMessage(message: ChatMessage): UiMessage | null {
  if (
    message.role === 'assistant'
    && (isAssistantDeliveryMirrorMessage(message) || isAssistantSilentReplyMessage(message))
  ) {
    return null;
  }

  const imageUris = message.attachments
    ?.filter((attachment) => attachment.type === 'image')
    .map((attachment) => {
      if (attachment.uri) return attachment.uri;
      if (!attachment.content) return undefined;
      return attachment.content.startsWith('data:')
        ? attachment.content
        : `data:${attachment.mimeType};base64,${attachment.content}`;
    })
    .filter((uri): uri is string => Boolean(uri));
  const fileAttachments = message.attachments
    ?.filter((attachment) => attachment.type === 'file')
    .map((attachment) => {
      const fileName = attachment.name?.trim();
      const uri = attachment.uri?.trim();
      return {
        mimeType: normalizeAttachmentMimeType(attachment.mimeType),
        ...(fileName ? { fileName } : {}),
        ...(uri ? { uri } : {}),
      };
    });
  const tool = message.tool;

  return {
    id: message.id,
    role: message.role,
    ...(message.attribution ? { attribution: normalizeMessageAttribution(message.attribution) } : {}),
    ...(message.sentLocally ? { sentLocally: true as const } : {}),
    text: message.text,
    userSkill: message.skill,
    idempotencyKey: message.idempotencyKey,
    timestampMs: message.timestampMs,
    imageUris: imageUris && imageUris.length > 0 ? imageUris : undefined,
    fileAttachments: fileAttachments && fileAttachments.length > 0
      ? fileAttachments
      : undefined,
    modelLabel: modelLabel(message.provider, message.model),
    usage: mapUsage(message.usage),
    toolName: tool?.name,
    toolStatus: tool?.status,
    toolSummary: tool?.summary,
    toolArgs: stringifyUnknown(tool?.input),
    toolDetail: stringifyUnknown(tool?.output),
    ...(tool?.durationMs !== undefined ? { toolDurationMs: tool.durationMs } : {}),
    ...(tool?.startedAtMs !== undefined ? { toolStartedAt: tool.startedAtMs } : {}),
    ...(tool?.finishedAtMs !== undefined ? { toolFinishedAt: tool.finishedAtMs } : {}),
  };
}

function mapApprovalStatus(decision: string): ApprovalStatus {
  const normalized = decision.trim().toLowerCase();
  if (normalized.includes('expir') || normalized.includes('timeout')) return 'expired';
  if (normalized.includes('deny') || normalized.includes('reject')) return 'denied';
  return 'allowed';
}

function mapApprovalMessage(approval: ApprovalRequest, now: () => number): UiMessage | undefined {
  if (approval.kind === 'pair') {
    return {
      id: `approval_${approval.id}`,
      role: 'system',
      text: '',
      timestampMs: approval.receivedAtMs,
      approval: {
        ...approval,
        status: 'pending',
      },
    };
  }
  if (approval.kind !== 'exec') return undefined;
  return {
    id: `approval_${approval.id}`,
    role: 'system',
    text: '',
    timestampMs: now(),
    approval: {
      kind: 'exec',
      id: approval.id,
      command: approval.command,
      decisions: approval.decisions,
      cwd: approval.cwd,
      host: approval.host,
      expiresAtMs: approval.expiresAtMs,
      status: 'pending',
    },
  };
}

/**
 * Map every backend-neutral protocol update into the current chat UI boundary.
 * Session filtering, history merge policy, and run-id arbitration stay with the
 * controller so this mapper can serve all adapters without backend branches.
 */
export function mapAdapterSessionUpdate(
  update: SessionUpdate,
  options: MappingOptions = {},
): AdapterChatUpdate {
  const now = options.now ?? Date.now;
  const translate = options.translate ?? ((key: string) => (
    key === 'Run aborted by user.'
      ? i18n.t('Run aborted by user.', { ns: 'chat' })
      : i18n.t('Compacting context...', { ns: 'chat' })
  ));

  switch (update.type) {
    case 'question_requested':
    case 'question_resolved': return update;
    case 'history_reconciled': {
      const messages = update.history.messages
        .map(mapAdapterChatMessage)
        .filter((message): message is UiMessage => message !== null);
      return {
        type: update.type,
        sessionKey: update.sessionKey,
        history: update.history,
        messages,
        nextCursor: update.history.nextCursor,
        hasActiveRun: update.history.hasActiveRun,
      };
    }
    case 'run_started':
      return {
        ...update,
        activeRunId: update.runId,
        isSending: true,
        startedAtMs: now(),
      };
    case 'agent_message_chunk': {
      const visible = !isSilentReplyPrefixText(update.text);
      return {
        ...update,
        activeRunId: update.runId,
        isSending: true,
        visible,
        ...(visible
          ? {
              streamingMessage: {
                id: 'streaming',
                role: 'assistant',
                text: update.text,
                streaming: true,
              },
            }
          : {}),
      };
    }
    case 'agent_thought_chunk':
      return {
        ...update,
        activeRunId: update.runId,
        isSending: true,
      };
    case 'tool_call':
      return {
        ...update,
        message: {
          id: `toolcall_${update.toolCallId}`,
          role: 'tool',
          text: '',
          toolName: update.kind ?? update.title,
          toolStatus: 'running',
          toolSummary: update.title,
          toolArgs: stringifyUnknown(update.rawInput),
          toolStartedAt: now(),
        },
        merge: false,
        activeRunId: update.runId,
        isSending: true,
      };
    case 'tool_call_update': {
      const timestampMs = now();
      return {
        ...update,
        message: {
          id: `toolcall_${update.toolCallId}`,
          role: 'tool',
          text: '',
          toolStatus: update.status,
          toolDetail: stringifyUnknown(update.rawOutput),
          ...(update.status === 'running' ? {} : { toolFinishedAt: timestampMs }),
        },
        merge: true,
        activeRunId: update.runId,
        isSending: true,
      };
    }
    case 'run_finished': {
      const timestampMs = now();
      const usage = mapUsage(update.usage);
      const isSilent = update.message
        ? isAssistantSilentReplyMessage({ role: 'assistant', text: update.message.content })
        : false;
      const finalMessage = update.message && !isSilent && update.message.content.trim()
        ? {
            id: `final_${update.runId}`,
            role: 'assistant' as const,
            text: update.message.content,
            timestampMs,
            modelLabel: modelLabel(update.message.provider, update.message.model),
            usage,
          }
        : undefined;
      const systemMessage = update.stopReason === 'cancelled'
        ? {
            id: `sys_abort_${update.runId}`,
            role: 'system' as const,
            text: translate('Run aborted by user.'),
            timestampMs,
          }
        : undefined;
      return {
        ...update,
        activeRunId: null,
        isSending: false,
        finalMessage,
        systemMessage,
        usage,
        rawUsage: update.usage,
      };
    }
    case 'compaction':
      return {
        ...update,
        notice: update.phase === 'start' ? translate('Compacting context...') : null,
      };
    case 'pairing_required':
    case 'pairing_resolved':
      return update;
    case 'approval_requested':
      return {
        ...update,
        message: mapApprovalMessage(update.approval, now),
      };
    case 'approval_resolved':
      return {
        ...update,
        status: mapApprovalStatus(update.decision),
        messageId: `approval_${update.approvalId}`,
      };
    case 'session_info_update':
    case 'usage_update':
      return update;
    case 'system_event':
      return {
        ...update,
        message: {
          id: `system_${update.kind}_${update.timestampMs}`,
          role: 'system',
          text: update.text,
          timestampMs: update.timestampMs,
        },
      };
    case 'error': {
      const timestampMs = now();
      return {
        ...update,
        errorMessage: update.message,
        message: {
          id: `error_${update.runId ?? update.code}_${timestampMs}`,
          role: 'system',
          text: update.message,
          timestampMs,
        },
      };
    }
  }
}

/** Subscribe once to the three AgentAdapter event channels and expose UI-ready updates. */
export function useAdapterChatEvents(options: UseAdapterChatEventsOptions): void {
  const handlersRef = useRef<AdapterChatEventHandlers>({
    onState: options.onState,
    onSessions: options.onSessions,
    onUpdate: options.onUpdate,
  });
  const nowRef = useRef(options.now ?? Date.now);

  handlersRef.current = {
    onState: options.onState,
    onSessions: options.onSessions,
    onUpdate: options.onUpdate,
  };
  nowRef.current = options.now ?? Date.now;

  useEffect(() => {
    const adapter = options.adapter;
    if (!adapter) return undefined;

    const offState = adapter.on('state', (state, reason) => {
      handlersRef.current.onState?.(state, reason);
    });
    const offSessions = adapter.on('sessions', (sessions) => {
      handlersRef.current.onSessions?.(sessions);
    });
    const offUpdate = adapter.on('update', (update) => {
      handlersRef.current.onUpdate?.(mapAdapterSessionUpdate(update, { now: nowRef.current }));
    });

    handlersRef.current.onState?.(adapter.state);

    return () => {
      offState();
      offSessions();
      offUpdate();
    };
  }, [options.adapter]);
}
