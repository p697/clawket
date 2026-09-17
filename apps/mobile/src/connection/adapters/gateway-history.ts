import type { ChatMessage } from '@clawket/agent-protocol';
import { ChatCacheService, type CachedMessage } from '../../services/chat-cache';
import { readMalformedToolName, stableMessageId, stripCliResumeContext } from '../../utils/chat-message';

export type GatewayHistoryCache = {
  load(
    connectionId: string,
    agentId: string,
    sessionKey: string,
    limit: number,
  ): Promise<ChatMessage[]>;
};

// Cache-only provenance; never sent over the wire. Some older Gateways supply
// page-relative fallback IDs, so keep the original projected row ID as well.
type CachedHistoryMessage = ChatMessage & { cacheRowId?: string };

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
  const rawKey = readNonEmptyString(value.idempotencyKey)
    ?? (isRecord(value.__openclaw) ? readNonEmptyString(value.__openclaw.idempotencyKey) : undefined);
  // OpenClaw persists its user transcript event under `${runId}:user`.
  // Normalize only our generated send-key format with explicit OpenClaw metadata;
  // arbitrary external/Hermes identities remain opaque.
  const idempotencyKey = role === 'user' && isRecord(value.__openclaw)
    && rawKey && /^\d{13}_[a-z0-9]{1,8}:user$/.test(rawKey)
    ? rawKey.slice(0, -5) : rawKey;
  const id = readNonEmptyString(value.id)
    || readNonEmptyString(value.messageId)
    || (isRecord(value.__openclaw) ? readNonEmptyString(value.__openclaw.id) : undefined)
    || `${sessionKey}:history:${timestampMs ?? 'unknown'}:${index}`;
  const message: ChatMessage = {
    id,
    role,
    text: role === 'user' && isRecord(value.__openclaw) && value.__openclaw.importedFrom === 'claude-cli'
      ? stripCliResumeContext(extractHistoryText(content)) : extractHistoryText(content),
    ...(timestampMs !== undefined ? { timestampMs } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(readNonEmptyString(value.provider) ? { provider: readNonEmptyString(value.provider) } : {}),
    ...(readNonEmptyString(value.model) ? { model: readNonEmptyString(value.model) } : {}),
  };
  const malformedTool = role === 'assistant' && isRecord(value.__openclaw)
    && value.__openclaw.importedFrom === 'claude-cli' ? readMalformedToolName(message.text) : undefined;
  if (malformedTool && message.text.trimEnd().endsWith('</function_results>')) {
    return { ...message, role: 'tool', text: '', tool: {
      name: malformedTool, callId: `unverified:${id}`, status: 'unknown', input: message.text,
    } };
  }
  const usage = normalizeUsage(value.usage);
  if (usage) message.usage = usage;
  const attachments = extractHistoryAttachments(content);
  if (attachments.length > 0) message.attachments = attachments;
  const tool = extractHistoryTool(value, content, role);
  if (tool) message.tool = tool;
  return message;
}

/** CLI history may coalesce tool calls and results inside assistant/user content. */
export function mapGatewayHistoryMessages(sessionKey: string, values: unknown[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const names = new Map<string, string>();
  values.forEach((value, index) => {
    if (!isRecord(value) || !Array.isArray(value.content)
        || (value.role !== 'assistant' && value.role !== 'user')) {
      const mapped = mapGatewayHistoryMessage(sessionKey, value, index);
      if (mapped) messages.push(mapped);
      return;
    }
    const typeOf = (block: unknown) => isRecord(block) ? String(block.type ?? '').toLowerCase().replace(/_/g, '') : '';
    const hasTools = value.content.some(block => ['toolcall', 'tooluse', 'toolresult'].includes(typeOf(block)));
    if (!hasTools) {
      const mapped = mapGatewayHistoryMessage(sessionKey, value, index);
      if (mapped) messages.push(mapped);
      return;
    }
    const base = mapGatewayHistoryMessage(sessionKey, { ...value, content: [] }, index)!;
    const plain = value.content.filter(block => !['toolcall', 'tooluse', 'toolresult'].includes(typeOf(block)));
    if (plain.length) {
      const mapped = mapGatewayHistoryMessage(sessionKey, { ...value, content: plain }, index);
      if (mapped) messages.push(mapped);
    }
    value.content.forEach((block, blockIndex) => {
      if (!isRecord(block)) return;
      const type = typeOf(block);
      const callId = readNonEmptyString(block.tool_use_id) ?? readNonEmptyString(block.toolCallId)
        ?? readNonEmptyString(block.tool_call_id) ?? readNonEmptyString(block.id);
      if (!callId) return;
      if (type === 'toolcall' || type === 'tooluse') {
        const name = readNonEmptyString(block.name) ?? readNonEmptyString(block.toolName) ?? 'tool';
        names.set(callId, name);
        const mapped = mapGatewayHistoryMessage(sessionKey, { ...value, role: 'assistant',
          id: `${base.id}:call:${blockIndex}`, content: [{ ...block, type: 'toolCall', id: callId, name }] }, index);
        if (mapped) messages.push(mapped);
      } else if (type === 'toolresult') {
        const mapped = mapGatewayHistoryMessage(sessionKey, { ...value, role: 'toolResult',
          id: `${base.id}:result:${blockIndex}`, toolCallId: callId,
          toolName: readNonEmptyString(block.name) ?? names.get(callId) ?? 'tool',
          content: block.content ?? block.output ?? block.result ?? '',
          isError: block.is_error === true || block.isError === true,
        }, index);
        if (mapped) messages.push(mapped);
      }
    });
  });
  return messages;
}

/** OpenClaw CLI imports can persist both tool-separated text and a final rollup. */
export function preserveOpenClawCliHistorySegments(
  sessionKey: string, values: unknown[], messages: ChatMessage[],
): ChatMessage[] {
  const redundantIds = new Set<string>();
  // A resumed CLI can echo the just-persisted mobile input into chat.history.
  // Require adjacent wire rows, our send identity, an exact resume envelope,
  // text-only content and a bounded forward timestamp; never dedupe by text alone.
  values.forEach((value, index) => {
    const previous = values[index - 1];
    if (!isRecord(value) || !isRecord(previous)) return;
    const meta = isRecord(value.__openclaw) ? value.__openclaw : {};
    const original = mapGatewayHistoryMessage(sessionKey, previous, index - 1);
    const echo = mapGatewayHistoryMessage(sessionKey, value, index);
    const textOnly = (content: unknown) => typeof content === 'string'
      || (Array.isArray(content) && content.every(block => isRecord(block) && block.type === 'text'));
    if (original?.role !== 'user' || echo?.role !== 'user'
      || !isRecord(previous.__openclaw) || previous.__openclaw.importedFrom
      || !original.idempotencyKey || !/^\d{13}_[a-z0-9]{1,8}$/.test(original.idempotencyKey)
      || meta.importedFrom !== 'claude-cli' || !readNonEmptyString(meta.cliSessionId)
      || !(readNonEmptyString(value.id) || readNonEmptyString(meta.id))
      || echo.idempotencyKey || !textOnly(previous.content) || !textOnly(value.content)
      || original.timestampMs === undefined || echo.timestampMs === undefined
      || echo.timestampMs < original.timestampMs || echo.timestampMs - original.timestampMs > 60_000) return;
    const raw = extractHistoryText(value.content);
    const prompt = stripCliResumeContext(raw);
    if (prompt !== raw && prompt.trim() && prompt.trim() === original.text.trim()) redundantIds.add(echo.id);
  });
  const finalMetadata = new Map<string, ChatMessage>();
  let userSendKey: string | undefined;
  let cliSessionId: string | undefined;
  let segments: ChatMessage[] = [];
  const normalized = (text: string) => text.replace(/\s+/g, ' ').trim();
  values.forEach((value, index) => {
    if (!isRecord(value)) return;
    const meta = isRecord(value.__openclaw) ? value.__openclaw : {};
    const message = mapGatewayHistoryMessage(sessionKey, value, index);
    if (!message) return;
    if (redundantIds.has(message.id)) return;
    if (value.role === 'user' && message.text.trim()) {
      userSendKey = readNonEmptyString(meta.idempotencyKey)?.replace(/:user$/, '');
      cliSessionId = undefined;
      segments = [];
      return;
    }
    if (value.role !== 'assistant') return;
    if (meta.importedFrom === 'claude-cli') {
      const source = readNonEmptyString(meta.cliSessionId);
      if (cliSessionId && cliSessionId !== source) segments = [];
      cliSessionId = source;
      if (message.role === 'assistant' && message.text.trim()) segments.push(message);
      return;
    }
    const textOnly = typeof value.content === 'string' || (Array.isArray(value.content)
      && value.content.every(block => isRecord(block) && block.type === 'text'));
    if (userSendKey && cliSessionId && segments.length && textOnly
      && value.provider === 'claude-cli' && meta.idempotencyKey === `cli-assistant:${userSendKey}`
      && normalized(message.text) === normalized(segments.map(segment => segment.text).join('\n\n'))) {
      redundantIds.add(message.id);
      finalMetadata.set(segments[segments.length - 1].id, message);
    }
    segments = [];
  });
  return messages.filter(message => !redundantIds.has(message.id)).map(message => {
    const final = finalMetadata.get(message.id);
    return final ? { ...message, usage: final.usage ?? message.usage } : message;
  });
}

export function mergeGatewayHistory(
  remoteMessages: ChatMessage[],
  cachedMessages: ChatMessage[],
  options?: { openclawUserEchoes?: boolean; hermesToolAliases?: unknown },
): ChatMessage[] {
  if (isRecord(options?.hermesToolAliases)) {
    const aliases = new Map(Object.entries(options.hermesToolAliases).slice(0, 512)
      .filter((entry): entry is [string, string] => entry[0].length > 0 && entry[0].length <= 256
        && typeof entry[1] === 'string' && entry[1].length > 0 && entry[1].length <= 256));
    cachedMessages = cachedMessages.map(message => {
      const callId = message.tool?.callId && aliases.get(message.tool.callId);
      return callId && remoteMessages.some(remote => remote.tool?.callId === callId
        && remote.role === message.role && remote.tool.name === message.tool?.name)
        ? { ...message, tool: { ...message.tool!, callId } } : message;
    });
  }
  if (options?.openclawUserEchoes) {
    cachedMessages = cachedMessages.map((message) => message.role === 'user'
      && message.idempotencyKey && /^\d{13}_[a-z0-9]{1,8}:user$/.test(message.idempotencyKey)
      ? { ...message, idempotencyKey: message.idempotencyKey.slice(0, -5) } : message);
  }
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

  // A persisted echo can omit image bytes. Recover local attachments only by
  // exact send identity, never by caption/time (two sends may share both).
  remoteMessages = remoteMessages.map((remote) => {
    if (remote.role !== 'user' || !remote.idempotencyKey || remote.attachments?.length) return remote;
    const local = cachedMessages.find((cached) => cached.role === 'user'
      && cached.idempotencyKey === remote.idempotencyKey && cached.attachments?.length);
    return local ? { ...remote, attachments: local.attachments } : remote;
  });
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
  const precedingUsers = (messages: ChatMessage[]) => {
    let user: ChatMessage | undefined;
    return messages.map(message => {
      if (message.role === 'user') user = message;
      return user;
    });
  };
  const remoteUsers = precedingUsers(remoteMessages);
  const cachedUsers = precedingUsers(cachedMessages);
  const sameUserTurn = (cached: ChatMessage | undefined, remote: ChatMessage | undefined) => {
    // A truncated page can omit its user anchor. Keep the existing bounded
    // fallback there; known different turns must never acknowledge each other.
    if (!cached || !remote) return true;
    if (cached.idempotencyKey && remote.idempotencyKey) return cached.idempotencyKey === remote.idempotencyKey;
    if (cached.id === remote.id) return true;
    if (cached.text !== remote.text || remote.timestampMs === undefined) return false;
    const rowId = (cached as CachedHistoryMessage).cacheRowId ?? cached.id;
    return rowId === stableMessageId('user', remote.timestampMs, remote.text)
      || (cached.timestampMs !== undefined && Math.abs(cached.timestampMs - remote.timestampMs) <= 2_000);
  };
  const matchedRemote = new Set<number>();
  const optimisticCacheTail = cachedMessages.filter((message, cachedIndex) => {
    if (remoteIds.has(message.id)) return false;
    if (message.tool?.callId && remoteMessages.some((remote) => remote.tool?.callId === message.tool?.callId
      && remote.role === message.role)) return false;
    if (message.idempotencyKey && remoteIdempotencyKeys.has(message.idempotencyKey)) return false;
    // Local optimistic IDs/timestamps differ from the Gateway's persisted IDs.
    // Match copies one-to-one so a repeated user message is never collapsed.
    const cacheRowId = (message as CachedHistoryMessage).cacheRowId ?? message.id;
    const optimisticUser = message.role === 'user' && /^usr_\d+/.test(cacheRowId);
    const optimisticAssistant = message.role === 'assistant' && /^(final_|abort_|stream_segment_)/.test(cacheRowId);
    // Old cache-only finals were parsed again as history, baking the local
    // completion time into a fresh h_ ID. They have no authoritative source ID.
    const legacyProjectedAssistant = message.role === 'assistant'
      && message.id === cacheRowId && /^h_assistant_/.test(cacheRowId);
    const optimistic = optimisticUser || optimisticAssistant;
    const confirmedCopy = cacheRowId.startsWith('h_') || optimisticAssistant;
    const canonicalIndex = remoteMessages.findIndex((remote, index) => (
      (!optimistic || !matchedRemote.has(index))
      && (message.role !== 'assistant' || sameUserTurn(cachedUsers[cachedIndex], remoteUsers[index]))
      && (optimisticUser || confirmedCopy)
      && remote.role === message.role
      && !(remote.idempotencyKey && message.idempotencyKey && remote.idempotencyKey !== message.idempotencyKey)
      && remote.text === message.text
      && (remote.text.length > 0 || Boolean(remote.tool?.callId && remote.tool.callId === message.tool?.callId))
      && typeof remote.timestampMs === 'number'
      && typeof message.timestampMs === 'number'
      // Older caches kept the projected server ID but a live display timestamp.
      // Recover that exact identity without widening text-only time matching.
      && (cacheRowId === stableMessageId(remote.role, remote.timestampMs, remote.text)
        || Math.abs(remote.timestampMs - message.timestampMs) <= (optimistic ? 60_000 : 2_000)
        || (legacyProjectedAssistant && cachedUsers[cachedIndex] && remoteUsers[index]
          && Math.abs(remote.timestampMs - message.timestampMs) <= 60_000))
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

function cachedMessageToChatMessage(message: CachedMessage): CachedHistoryMessage {
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
    id: readNonEmptyString(message.historyMessageId) ?? message.id,
    cacheRowId: message.id,
    role: message.role,
    text: message.role === 'user' ? stripCliResumeContext(message.text) : message.text,
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
