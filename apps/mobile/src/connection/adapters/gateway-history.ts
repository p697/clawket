import type { ChatMessage } from '@clawket/agent-protocol';
import { ChatCacheService, type CachedMessage } from '../../services/chat-cache';

export type GatewayHistoryCache = {
  load(
    connectionId: string,
    agentId: string,
    sessionKey: string,
    limit: number,
  ): Promise<ChatMessage[]>;
};

export const DEFAULT_GATEWAY_HISTORY_CACHE: GatewayHistoryCache = {
  async load(connectionId, agentId, sessionKey, limit) {
    const page = await ChatCacheService.getTimelinePage(connectionId, agentId, sessionKey, {
      pageSize: limit,
    });
    return page.messages.map(cachedMessageToChatMessage);
  },
};

export function mapGatewayHistoryMessage(
  sessionKey: string,
  value: unknown,
  index: number,
): ChatMessage | null {
  if (!isRecord(value)) return null;
  const role = normalizeRole(value.role);
  const timestampMs = normalizeTimestamp(value.timestampMs ?? value.timestamp ?? value.ts);
  const content = value.content;
  const id = readNonEmptyString(value.id)
    || readNonEmptyString(value.messageId)
    || (isRecord(value.__openclaw) ? readNonEmptyString(value.__openclaw.id) : undefined)
    || `${sessionKey}:history:${timestampMs ?? 'unknown'}:${index}`;
  const message: ChatMessage = {
    id,
    role,
    text: extractHistoryText(content),
    ...(timestampMs !== undefined ? { timestampMs } : {}),
    ...(readNonEmptyString(value.idempotencyKey)
      ? { idempotencyKey: readNonEmptyString(value.idempotencyKey) }
      : {}),
    ...(readNonEmptyString(value.provider) ? { provider: readNonEmptyString(value.provider) } : {}),
    ...(readNonEmptyString(value.model) ? { model: readNonEmptyString(value.model) } : {}),
  };
  const usage = normalizeUsage(value.usage);
  if (usage) message.usage = usage;
  const attachments = extractHistoryAttachments(content);
  if (attachments.length > 0) message.attachments = attachments;
  const tool = extractHistoryTool(value, content, role);
  if (tool) message.tool = tool;
  return message;
}

export function mergeGatewayHistory(
  remoteMessages: ChatMessage[],
  cachedMessages: ChatMessage[],
): ChatMessage[] {
  const unique = (messages: ChatMessage[]) => {
    const seen = new Set<string>();
    return messages.filter((message) => {
      if (seen.has(message.id)) return false;
      seen.add(message.id);
      return true;
    });
  };
  remoteMessages = unique(remoteMessages);
  cachedMessages = unique(cachedMessages);
  if (cachedMessages.length === 0) return remoteMessages;
  if (remoteMessages.length === 0) return cachedMessages;

  const remoteIds = new Set(remoteMessages.map((message) => message.id));
  const remoteIdempotencyKeys = new Set(
    remoteMessages
      .map((message) => message.idempotencyKey)
      .filter((value): value is string => Boolean(value)),
  );
  const remoteTimestamps = remoteMessages
    .map((message) => message.timestampMs)
    .filter((value): value is number => typeof value === 'number');
  const earliestRemoteTimestamp = remoteTimestamps.length > 0
    ? Math.min(...remoteTimestamps)
    : undefined;
  const matchedRemote = new Set<number>();
  const optimisticCacheTail = cachedMessages.filter((message) => {
    if (remoteIds.has(message.id)) return false;
    if (message.tool?.callId && remoteMessages.some((remote) => remote.tool?.callId === message.tool?.callId
      && remote.role === message.role)) return false;
    if (message.idempotencyKey && remoteIdempotencyKeys.has(message.idempotencyKey)) return false;
    // Local optimistic IDs/timestamps differ from the Gateway's persisted IDs.
    // Match copies one-to-one so a repeated user message is never collapsed.
    const optimisticUser = message.role === 'user' && /^usr_\d+/.test(message.id);
    const optimisticAssistant = message.role === 'assistant' && /^(final_|abort_)/.test(message.id);
    const optimistic = optimisticUser || optimisticAssistant;
    const confirmedCopy = message.id.startsWith('h_') || optimisticAssistant;
    const canonicalIndex = remoteMessages.findIndex((remote, index) => (
      (!optimistic || !matchedRemote.has(index))
      && (optimisticUser || confirmedCopy)
      && remote.role === message.role
      && remote.text === message.text
      && (remote.text.length > 0 || Boolean(remote.tool?.callId && remote.tool.callId === message.tool?.callId))
      && typeof remote.timestampMs === 'number'
      && typeof message.timestampMs === 'number'
      && Math.abs(remote.timestampMs - message.timestampMs) <= (optimistic ? 60_000 : 2_000)
      && (!message.tool || remote.tool?.callId === message.tool.callId)
      && (!message.attachments?.length || remote.attachments?.length === message.attachments.length)
    ));
    if (canonicalIndex >= 0) {
      if (optimistic) matchedRemote.add(canonicalIndex);
      return false;
    }
    return earliestRemoteTimestamp === undefined
      || message.timestampMs === undefined
      || message.timestampMs >= earliestRemoteTimestamp;
  });

  // Untimed cached activity predates the authoritative snapshot. Appending it
  // after new replies made old tools look newest on every reconciliation.
  const untimed = optimisticCacheTail.filter((message) => message.timestampMs === undefined);
  const timed = optimisticCacheTail.filter((message) => message.timestampMs !== undefined);
  return [...untimed, ...remoteMessages, ...timed]
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const leftTimestamp = left.message.timestampMs;
      const rightTimestamp = right.message.timestampMs;
      if (leftTimestamp === undefined && rightTimestamp === undefined) return left.index - right.index;
      if (leftTimestamp === undefined) return -1;
      if (rightTimestamp === undefined) return 1;
      return leftTimestamp - rightTimestamp || left.index - right.index;
    })
    .map(({ message }) => message);
}

function cachedMessageToChatMessage(message: CachedMessage): ChatMessage {
  const timestampMs = message.timestampMs ?? message.toolFinishedAt ?? message.toolStartedAt;
  const attachments: NonNullable<ChatMessage['attachments']> = [
    ...(message.imageUris ?? []).map((uri) => ({
      type: 'image' as const,
      mimeType: 'image/*',
      uri,
    })),
    ...(message.fileAttachments ?? []).map((file) => ({
      type: 'file' as const,
      mimeType: file.mimeType,
      ...(file.uri ? { uri: file.uri } : {}),
      ...(file.fileName ? { name: file.fileName } : {}),
    })),
  ];
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    ...(timestampMs !== undefined ? { timestampMs } : {}),
    ...(message.idempotencyKey ? { idempotencyKey: message.idempotencyKey } : {}),
    ...(message.modelLabel ? { model: message.modelLabel } : {}),
    ...(message.usage
      ? {
          usage: {
            input: message.usage.inputTokens,
            output: message.usage.outputTokens,
            cacheRead: message.usage.cacheReadTokens,
            cacheWrite: message.usage.cacheWriteTokens,
            total: message.usage.totalTokens,
          },
        }
      : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(message.toolName
      ? {
          tool: {
            name: message.toolName,
            status: message.toolStatus ?? 'success',
            callId: message.id.replace(/^tool(?:call|result)_/, ''),
            summary: message.toolSummary,
            input: message.toolArgs,
            output: message.toolDetail,
            durationMs: message.toolDurationMs,
            startedAtMs: message.toolStartedAt,
            finishedAtMs: message.toolFinishedAt,
          },
        }
      : {}),
  };
}

function extractHistoryText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(isRecord)
    .filter((block) => block.type === 'text' || block.type === 'content')
    .map((block) => typeof block.text === 'string' ? block.text : '')
    .join('');
}

function extractHistoryAttachments(content: unknown): NonNullable<ChatMessage['attachments']> {
  if (!Array.isArray(content)) return [];
  const attachments: NonNullable<ChatMessage['attachments']> = [];
  for (const raw of content) {
    if (!isRecord(raw)) continue;
    const type = raw.type;
    if (type !== 'image' && type !== 'file' && type !== 'image_url') continue;
    const imageUrl = isRecord(raw.image_url) ? readNonEmptyString(raw.image_url.url) : undefined;
    const uri = readNonEmptyString(raw.uri) ?? imageUrl;
    const source = isRecord(raw.source) ? raw.source : null;
    const base64 = readNonEmptyString(raw.content)
      ?? readNonEmptyString(raw.data)
      ?? readNonEmptyString(source?.data);
    attachments.push({
      type: type === 'file' ? 'file' : 'image',
      mimeType: readNonEmptyString(raw.mimeType)
        ?? readNonEmptyString(raw.mime_type)
        ?? readNonEmptyString(source?.media_type)
        ?? 'application/octet-stream',
      ...(base64 ? { content: base64 } : {}),
      ...(uri ? { uri } : {}),
      ...(readNonEmptyString(raw.name) ? { name: readNonEmptyString(raw.name) } : {}),
    });
  }
  return attachments;
}

function extractHistoryTool(
  message: Record<string, unknown>,
  content: unknown,
  role: ChatMessage['role'],
): ChatMessage['tool'] | undefined {
  if (role === 'tool') {
    const hasError = message.isError === true || Boolean(message.error);
    const callId = readNonEmptyString(message.toolCallId)
      ?? readNonEmptyString(message.tool_call_id)
      ?? readNonEmptyString(message.id);
    const durationMs = readFiniteNumber(message.toolDurationMs);
    const startedAtMs = readFiniteNumber(message.toolStartedAt);
    const finishedAtMs = readFiniteNumber(message.toolFinishedAt);
    return {
      name: readNonEmptyString(message.toolName)
        ?? readNonEmptyString(message.name)
        ?? readNonEmptyString(message.tool)
        ?? 'tool',
      status: hasError ? 'error' : 'success',
      ...(callId ? { callId } : {}),
      ...(message.toolArgs !== undefined
        ? { input: message.toolArgs }
        : message.args !== undefined
          ? { input: message.args }
          : message.input !== undefined
            ? { input: message.input }
            : {}),
      ...(message.output !== undefined
        ? { output: message.output }
        : message.result !== undefined
          ? { output: message.result }
          : message.toolOutput !== undefined
            ? { output: message.toolOutput }
          : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(startedAtMs !== undefined ? { startedAtMs } : {}),
      ...(finishedAtMs !== undefined ? { finishedAtMs } : {}),
    };
  }
  if (role !== 'assistant' || !Array.isArray(content)) return undefined;
  const toolCall = content.find((block) => (
    isRecord(block) && String(block.type ?? '').toLowerCase() === 'toolcall'
  ));
  if (!isRecord(toolCall)) return undefined;
  const callId = readNonEmptyString(toolCall.toolCallId)
    ?? readNonEmptyString(toolCall.tool_call_id)
    ?? readNonEmptyString(toolCall.id);
  return {
    name: readNonEmptyString(toolCall.toolName)
      ?? readNonEmptyString(toolCall.name)
      ?? readNonEmptyString(toolCall.tool)
      ?? 'tool',
    status: 'running',
    ...(callId ? { callId } : {}),
    ...(toolCall.arguments !== undefined
      ? { input: toolCall.arguments }
      : toolCall.args !== undefined
        ? { input: toolCall.args }
        : toolCall.input !== undefined
          ? { input: toolCall.input }
        : {}),
  };
}

function normalizeRole(value: unknown): ChatMessage['role'] {
  if (value === 'user' || value === 'assistant' || value === 'system' || value === 'tool') return value;
  if (value === 'toolResult') return 'tool';
  return 'system';
}

function normalizeTimestamp(value: unknown): number | undefined {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value > 0 && value < 10_000_000_000 ? value * 1_000 : value;
}

function normalizeUsage(value: unknown): ChatMessage['usage'] | undefined {
  if (!isRecord(value)) return undefined;
  const usage = {
    input: readFiniteNumber(value.input),
    output: readFiniteNumber(value.output),
    cacheRead: readFiniteNumber(value.cacheRead),
    cacheWrite: readFiniteNumber(value.cacheWrite),
    total: readFiniteNumber(value.total),
    costUsd: readFiniteNumber(value.costUsd),
  };
  return Object.values(usage).some((entry) => entry !== undefined) ? usage : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
