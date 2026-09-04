import type { ChatMessage, SessionHistory, SessionUpdate } from '@clawket/agent-protocol';

export type YouMindCompletionChunk =
  | { mode: 'insert'; dataType: string; data: Record<string, unknown> }
  | {
      mode: 'replace';
      targetType: string;
      targetId: string;
      path: string;
      data: unknown;
    }
  | {
      mode: 'append_string' | 'append_json';
      targetType: string;
      targetId: string;
      path: string;
      data: string;
    }
  | { mode: 'event'; event: string; data?: unknown }
  | { mode: 'error'; error?: { message?: string; code?: string; status?: number } }
  | { mode?: undefined; event: string; data?: unknown; message?: string };

export type YouMindSpriteChunkState = {
  runId: string;
  terminal: boolean;
  blockTypes: Map<string, string>;
  toolNames: Map<string, string>;
};

export function createYouMindSpriteChunkState(runId: string): YouMindSpriteChunkState {
  return {
    runId,
    terminal: false,
    blockTypes: new Map(),
    toolNames: new Map(),
  };
}

export function mapYouMindSpriteChunk(
  chunk: YouMindCompletionChunk,
  sessionKey: string,
  state: YouMindSpriteChunkState,
): SessionUpdate[] {
  if (chunk.mode === 'error') {
    return finishWithError(
      sessionKey,
      state,
      chunk.error?.message ?? 'YouMind stream failed.',
      mapYouMindHttpStatus(chunk.error?.status),
    );
  }

  if (!chunk.mode && chunk.event) {
    return mapSpriteEvent(chunk.event, chunk.data, sessionKey, state);
  }

  if (chunk.mode === 'event') {
    return mapSpriteEvent(chunk.event, chunk.data, sessionKey, state);
  }

  if (chunk.mode === 'insert') {
    return mapSpriteInsert(chunk.dataType, chunk.data, sessionKey, state);
  }

  if (
    chunk.mode === 'append_string'
    && chunk.targetType === 'CompletionBlock'
  ) {
    const blockType = state.blockTypes.get(chunk.targetId);
    if (blockType === 'content') {
      return [{
        type: 'agent_message_chunk',
        sessionKey,
        runId: state.runId,
        text: chunk.data,
      }];
    }
    if (blockType === 'reasoning') {
      return [{
        type: 'agent_thought_chunk',
        sessionKey,
        runId: state.runId,
        text: chunk.data,
      }];
    }
    return [];
  }

  if (chunk.mode === 'replace') {
    if (chunk.targetType === 'Message') {
      if (chunk.path === 'error') {
        return finishWithError(sessionKey, state, readErrorMessage(chunk.data), 'server');
      }
      if (chunk.path === 'status') {
        return finishForStatus(String(chunk.data ?? ''), sessionKey, state);
      }
      return [];
    }

    if (chunk.targetType === 'Generation' && chunk.path === 'status') {
      return finishForStatus(String(chunk.data ?? ''), sessionKey, state);
    }

    if (chunk.targetType === 'CompletionBlock') {
      const toolName = state.toolNames.get(chunk.targetId);
      if (!toolName) return [];
      if (chunk.path === 'status' || chunk.path === 'tool_result' || chunk.path === 'tool_arguments') {
        return [{
          type: 'tool_call_update',
          sessionKey,
          runId: state.runId,
          toolCallId: chunk.targetId,
          status: chunk.path === 'status' ? mapToolStatus(chunk.data) : 'running',
          rawOutput: chunk.path === 'tool_result' ? chunk.data : undefined,
        }];
      }
    }
  }

  return [];
}

function mapSpriteInsert(
  dataType: string,
  data: Record<string, unknown>,
  sessionKey: string,
  state: YouMindSpriteChunkState,
): SessionUpdate[] {
  if (dataType === 'Generation') {
    const id = readString(data.id);
    if (id) state.runId = id;
    return [{ type: 'run_started', sessionKey, runId: state.runId }];
  }

  if (dataType === 'Message') {
    const role = readString(data.role);
    const id = readString(data.id);
    if (role !== 'assistant') return [];
    if (id) state.runId = id;
    const updates: SessionUpdate[] = [{ type: 'run_started', sessionKey, runId: state.runId }];
    const blocks = Array.isArray(data.blocks) ? data.blocks : [];
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      updates.push(...mapSpriteInsert(
        'CompletionBlock',
        block as Record<string, unknown>,
        sessionKey,
        state,
      ));
    }
    return updates;
  }

  if (dataType !== 'CompletionBlock') return [];
  const id = readString(data.id);
  const blockType = readString(data.type);
  if (!id || !blockType) return [];
  state.blockTypes.set(id, blockType);

  if (blockType === 'content' || blockType === 'reasoning') {
    const text = readString(data.data);
    if (!text) return [];
    return [{
      type: blockType === 'content' ? 'agent_message_chunk' : 'agent_thought_chunk',
      sessionKey,
      runId: state.runId,
      text,
    }];
  }

  if (blockType === 'tool') {
    const toolName = readString(data.tool_name ?? data.toolName) || 'tool';
    state.toolNames.set(id, toolName);
    return [{
      type: 'tool_call',
      sessionKey,
      runId: state.runId,
      toolCallId: id,
      title: toolName,
      kind: toolName,
      rawInput: data.tool_arguments ?? data.toolArguments,
    }];
  }

  return [];
}

function mapSpriteEvent(
  event: string,
  data: unknown,
  sessionKey: string,
  state: YouMindSpriteChunkState,
): SessionUpdate[] {
  const normalized = event.trim().toLowerCase().replace(/_/g, '-');
  if (normalized === 'task-started') {
    return [{ type: 'run_started', sessionKey, runId: state.runId }];
  }
  if (normalized === 'task-ended') {
    const status = readEventStatus(data);
    if (status === 'aborted' || status === 'cancelled' || status === 'canceled') {
      return finishRun(sessionKey, state, 'cancelled');
    }
    if (status === 'error' || status === 'failed') {
      return finishWithError(sessionKey, state, readErrorMessage(data), 'server');
    }
    return finishRun(sessionKey, state, 'end_turn');
  }
  if (normalized === 'aborted' || normalized === 'abort') {
    return finishRun(sessionKey, state, 'cancelled');
  }
  return [];
}

function finishForStatus(
  rawStatus: string,
  sessionKey: string,
  state: YouMindSpriteChunkState,
): SessionUpdate[] {
  const status = rawStatus.toLowerCase();
  if (status === 'success' || status === 'done' || status === 'completed' || status === 'complete') {
    return finishRun(sessionKey, state, 'end_turn');
  }
  if (status === 'abort' || status === 'aborted' || status === 'cancelled' || status === 'canceled') {
    return finishRun(sessionKey, state, 'cancelled');
  }
  if (status === 'error' || status === 'failed' || status === 'errored') {
    return finishWithError(sessionKey, state, 'YouMind run failed.', 'server');
  }
  return [];
}

function finishRun(
  sessionKey: string,
  state: YouMindSpriteChunkState,
  stopReason: 'end_turn' | 'cancelled' | 'error',
): SessionUpdate[] {
  if (state.terminal) return [];
  state.terminal = true;
  return [{ type: 'run_finished', sessionKey, runId: state.runId, stopReason }];
}

function finishWithError(
  sessionKey: string,
  state: YouMindSpriteChunkState,
  message: string,
  code: 'unauthorized' | 'rate_limited' | 'network' | 'timeout' | 'server',
): SessionUpdate[] {
  if (state.terminal) return [];
  return [
    { type: 'error', sessionKey, runId: state.runId, code, message },
    ...finishRun(sessionKey, state, 'error'),
  ];
}

function mapToolStatus(value: unknown): 'running' | 'success' | 'error' {
  const status = String(value ?? '').toLowerCase();
  if (status === 'success' || status === 'done' || status === 'completed') return 'success';
  if (status === 'error' || status === 'failed' || status === 'aborted') return 'error';
  return 'running';
}

function mapYouMindHttpStatus(status: number | undefined): 'unauthorized' | 'rate_limited' | 'server' {
  if (status === 401) return 'unauthorized';
  if (status === 429) return 'rate_limited';
  return 'server';
}

export function mapYouMindSpriteHistory(
  detail: Record<string, unknown>,
  sessionKey = 'main',
): SessionHistory {
  const rawMessages = Array.isArray(detail.messages) ? detail.messages : [];
  const messages: ChatMessage[] = [];
  for (const raw of rawMessages) {
    if (!raw || typeof raw !== 'object') continue;
    const message = raw as Record<string, unknown>;
    const role = readString(message.role);
    const id = readString(message.id) || `sprite-history-${messages.length}`;
    const timestampMs = readTimestamp(message.createdAt ?? message.created_at ?? message.createdAtMs);
    if (role === 'user') {
      messages.push({ id, role: 'user', text: readUserText(message), timestampMs });
      continue;
    }
    if (role !== 'assistant') continue;
    const blocks = Array.isArray(message.blocks) ? message.blocks : [];
    const text = blocks
      .filter((block): block is Record<string, unknown> => Boolean(block && typeof block === 'object'))
      .filter((block) => readString(block.type) === 'content')
      .map((block) => readString(block.data))
      .filter(Boolean)
      .join('');
    messages.push({ id, role: 'assistant', text, timestampMs });
  }

  const pagination = readRecord(detail.pagination);
  const nextCursor = readString(pagination?.nextCursor ?? pagination?.next_cursor);
  const sessionStatus = readRecord(detail.sessionStatus ?? detail.session_status);
  return {
    key: sessionKey,
    messages,
    nextCursor: nextCursor || undefined,
    hasActiveRun: Boolean(sessionStatus?.active) || isRunningStatus(readString(detail.status)),
  };
}

function readUserText(message: Record<string, unknown>): string {
  const direct = readString(message.content ?? message.data);
  if (direct) return direct;
  const blocks = Array.isArray(message.blocks) ? message.blocks : [];
  return blocks
    .filter((block): block is Record<string, unknown> => Boolean(block && typeof block === 'object'))
    .map((block) => readString(block.data))
    .filter(Boolean)
    .join('');
}

function isRunningStatus(status: string): boolean {
  return ['running', 'processing', 'executing', 'streaming', 'pending', 'queued', 'generating', 'ing', 'in_progress']
    .includes(status.toLowerCase());
}

function readEventStatus(value: unknown): string {
  if (typeof value === 'string') return value.toLowerCase();
  const record = readRecord(value);
  return readString(record?.status ?? record?.stopReason ?? record?.stop_reason).toLowerCase();
}

function readErrorMessage(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  const record = readRecord(value);
  return readString(record?.message ?? readRecord(record?.error)?.message) || 'YouMind run failed.';
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
