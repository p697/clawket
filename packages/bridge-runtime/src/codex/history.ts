import type { ChatMessage } from '@clawket/agent-protocol';

/** Only the native generated-image result is delivery evidence; view_image/tool screenshots are not. */
export function codexGeneratedImage(item: any): ChatMessage | undefined {
  if (item.type !== 'imageGeneration' || item.status !== 'completed' || item.failure || typeof item.id !== 'string') return undefined;
  const result = item.result;
  if (typeof result !== 'string' || !result || result.length > 4 * Math.ceil(5 * 1024 * 1024 / 3)
    || (result.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(result))) return undefined;
  const prefix = Buffer.from(result.slice(0, 32), 'base64');
  const mimeType = prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
    : prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255 ? 'image/jpeg'
      : prefix.toString('ascii', 0, 4) === 'RIFF' && prefix.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : undefined;
  return mimeType ? { id: `${item.id}:image`, role: 'assistant', text: '', attachments: [{ type: 'image', mimeType, content: result }] } : undefined;
}

/** Native errors may contain private provider bodies. Expose fixed copy only. */
function unsupportedChatGptModel(error: any): boolean {
  let message = error?.message;
  if (typeof message !== 'string' || message.length > 16384) return false;
  if (message.startsWith('{')) {
    try {
      const response = JSON.parse(message);
      if (response.type !== 'error' || response.status !== 400 || response.error?.type !== 'invalid_request_error') return false;
      message = response.error.message;
    } catch { return false; }
  }
  return typeof message === 'string' && /^The '[A-Za-z0-9._-]{1,200}' model is not supported when using Codex with a ChatGPT account\.$/.test(message);
}

export function codexTurnFailure(turn: any): (Pick<ChatMessage, 'id' | 'text' | 'timestampMs'> & { role: 'system' }) | undefined {
  if (turn?.status !== 'failed' || typeof turn.id !== 'string' || !turn.id || turn.id.length > 200) return undefined;
  const code = turn.error?.codexErrorInfo;
  const timestamp = typeof turn.completedAt === 'number' ? turn.completedAt : turn.startedAt;
  return { id: `codex-turn-error:${turn.id}`, role: 'system',
    text: code === 'unauthorized' ? 'Model authentication failed. Sign in again on your computer.'
      : unsupportedChatGptModel(turn.error) ? 'This model is unavailable in the current Codex runtime. Choose another model or update Codex on your computer.'
      : "The agent couldn't complete this reply. Please try again.",
    ...(typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp >= 0 ? { timestampMs: timestamp * 1000 } : {}) };
}

/** Canonical End always has an action; Begin has null action/results and no status. */
function completedWebSearch(item: any): boolean {
  const action = item.action;
  if (typeof item.query !== 'string' || !action || typeof action !== 'object' || Array.isArray(action)
    || (item.results !== undefined && item.results !== null && !Array.isArray(item.results))) return false;
  const optionalString = (value: unknown) => value === undefined || value === null || typeof value === 'string';
  switch (action.type) {
    case 'search': return optionalString(action.query) && (action.queries === undefined || action.queries === null
      || (Array.isArray(action.queries) && action.queries.every((query: unknown) => typeof query === 'string')));
    case 'openPage': return optionalString(action.url);
    case 'findInPage': return optionalString(action.url) && optionalString(action.pattern);
    case 'other': return true;
    default: return false;
  }
}

export function codexTool(item: any): ChatMessage['tool'] | undefined {
  const names: Record<string, string> = { commandExecution: 'exec', fileChange: 'apply_patch', mcpToolCall: item.tool ?? 'MCP', dynamicToolCall: item.tool ?? 'tool', webSearch: 'web_search', collabAgentToolCall: item.tool ?? 'agent', imageView: 'view_image', imageGeneration: 'image_generation' };
  if (!names[item.type]) return undefined;
  const failed = ['failed', 'declined', 'interrupted'].includes(item.status) || (typeof item.exitCode === 'number' && item.exitCode !== 0) || !!item.error;
  // Native ImageView enters canonical history only after its completed event.
  // Other tools without an execution status still lack outcome evidence.
  const implicitCompleted = item.status === undefined && (item.type === 'imageView' || (item.type === 'webSearch' && completedWebSearch(item)));
  const result = item.type === 'webSearch' && Array.isArray(item.results) && item.results.length > 0 ? item.results : item.result;
  return { callId: item.id, name: names[item.type], statusReported: true, status: failed ? 'error' : item.status === 'inProgress' ? 'running' : item.status === 'completed' || implicitCompleted ? 'success' : 'unknown',
    input: item.type === 'commandExecution' ? { command: item.command, cwd: item.cwd } : item.type === 'fileChange' ? { changes: item.changes } : item.arguments ?? { query: item.query, path: item.path },
    output: item.type === 'imageGeneration' ? (item.status === 'completed' && !item.failure ? 'Image generated' : '')
      : String(item.aggregatedOutput ?? (result ? JSON.stringify(result) : item.error ? JSON.stringify(item.error) : item.type === 'fileChange' ? JSON.stringify(item.changes) : '')).slice(0, 32000) };
}

/** Native turn clocks are Unix seconds; only a confirmed successful terminal turn dates its reply. */
export function codexReplyTimestamp(turn: any): number | undefined {
  const completed = turn?.completedAt, started = turn?.startedAt;
  if (turn?.status !== 'completed' || !Number.isSafeInteger(completed) || completed <= 0
    || !Number.isFinite(new Date(completed * 1000).getTime())
    || (started != null && (!Number.isSafeInteger(started) || started < 0 || completed < started))) return undefined;
  return completed * 1000;
}

/** Mirrors native last_agent_message, retaining phase-less provider compatibility. */
export function codexFinalReplyId(items: any[], allowLegacy = true): string | undefined {
  let id: string | undefined;
  for (const item of items) if (item.type === 'agentMessage' && typeof item.id === 'string'
    && typeof item.text === 'string' && item.text.trim()
    && (item.phase === 'final_answer' || (allowLegacy && item.phase == null))) id = item.id;
  return id;
}

/** Validated native lifecycle clocks (Unix ms) of one item, kept beside the unchanged native item. */
export type CodexItemClock = { startedAtMs?: number; completedAtMs?: number };

const validClock = (value: unknown): value is number => typeof value === 'number'
  && Number.isSafeInteger(value) && value > 0 && value <= 8.64e15;

/** Native millisecond item clocks are optional; malformed or reversed pairs are not evidence. */
export function codexItemClock(started: unknown, completed?: unknown): CodexItemClock | undefined {
  if ((started != null && !validClock(started)) || (completed != null && !validClock(completed))) return undefined;
  if (validClock(started) && validClock(completed) && completed < started) return undefined;
  if (!validClock(started) && !validClock(completed)) return undefined;
  return { ...(validClock(started) ? { startedAtMs: started } : {}), ...(validClock(completed) ? { completedAtMs: completed } : {}) };
}

export function codexItemTimestamp(started: unknown, completed?: unknown): number | undefined {
  const clock = codexItemClock(started, completed);
  return clock?.startedAtMs ?? clock?.completedAtMs;
}

/** Commands, MCP and dynamic tools report their native run time; other values are not evidence. */
function codexNativeDuration(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8.64e15 ? value : undefined;
}

/**
 * Timing of one tool call from its lifecycle clock. Only a settled call has a
 * completion or a duration; the native per-call duration wins over the clock span.
 */
export function codexToolTiming(item: any, status: NonNullable<ChatMessage['tool']>['status'], clock?: CodexItemClock):
  Pick<NonNullable<ChatMessage['tool']>, 'startedAtMs' | 'finishedAtMs' | 'durationMs'> {
  const settled = status === 'success' || status === 'error';
  const startedAtMs = clock?.startedAtMs;
  const finishedAtMs = settled ? clock?.completedAtMs : undefined;
  const durationMs = !settled ? undefined : codexNativeDuration(item?.durationMs)
    ?? (startedAtMs !== undefined && finishedAtMs !== undefined && finishedAtMs >= startedAtMs ? finishedAtMs - startedAtMs : undefined);
  return { ...(startedAtMs !== undefined ? { startedAtMs } : {}), ...(finishedAtMs !== undefined ? { finishedAtMs } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}) };
}

/** Codex Desktop keeps native lifecycle clocks beside its turn state; malformed maps are not evidence. */
export function codexDesktopItemClock(turn: any, item: any): CodexItemClock | undefined {
  const entry = (name: string) => {
    const map = turn?.[name];
    return map && typeof map === 'object' && !Array.isArray(map) && typeof item?.id === 'string' && Object.hasOwn(map, item.id) ? map[item.id] : undefined;
  };
  if (item?.type === 'agentMessage') return codexItemClock(entry('aeonAssistantMessageStartedAtMsById'), entry('agentMessageCompletedAtMsById'));
  if (item?.type !== 'commandExecution') return undefined;
  const started = entry('commandExecutionStartedAtMsById'), duration = codexNativeDuration(item.durationMs);
  return codexItemClock(started, validClock(started) && duration !== undefined ? started + duration : undefined);
}

/** Item types that produce a history row; others never affect presentation order. */
function rendersHistoryRow(item: any): boolean {
  return item.type === 'userMessage' || item.type === 'agentMessage' || item.type === 'plan' || codexTool(item) !== undefined;
}

/**
 * Native item lists record an item when it completes, so a long command lands
 * after replies written while it ran. Live presentation follows start order;
 * restore it only when every rendered item has a native start clock.
 */
function codexStartOrder(items: any[], clocks: Map<string, CodexItemClock> | undefined): any[] {
  if (!clocks) return items;
  const rendered = items.filter(item => typeof item?.id === 'string' && rendersHistoryRow(item));
  const start = (item: any) => codexItemClock(clocks.get(item.id)?.startedAtMs, clocks.get(item.id)?.completedAtMs)?.startedAtMs;
  if (rendered.length < 2 || rendered.some(item => start(item) === undefined)) return items;
  return rendered.map((item, index) => ({ item, index, at: start(item)! }))
    .sort((a, b) => a.at - b.at || a.index - b.index).map(entry => entry.item);
}

export function codexMessages(turns: any[], options: { unconfirmedLegacyTurnId?: string } = {}): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const turn of turns) {
    const items = turn.items ?? [];
    const clocks: Map<string, CodexItemClock> | undefined = turn.itemClocks instanceof Map ? turn.itemClocks : undefined;
    const completedAtMs = codexReplyTimestamp(turn);
    const finalReplyId = codexFinalReplyId(items,
      options.unconfirmedLegacyTurnId === undefined || turn.id !== options.unconfirmedLegacyTurnId);
    for (const item of codexStartOrder(items, clocks)) {
      if (typeof item.id !== 'string') continue;
      const timestampMs = typeof turn.startedAt === 'number' ? turn.startedAt * 1000 : undefined;
      const clock = codexItemClock(clocks?.get(item.id)?.startedAtMs, clocks?.get(item.id)?.completedAtMs);
      const itemTimestampMs = clock?.startedAtMs ?? clock?.completedAtMs;
      const base = { id: item.id, timestampMs, ...(typeof turn.id === 'string' && turn.id.length > 0 && turn.id.length <= 256 ? { turnId: turn.id } : {}) };
      if (item.type === 'userMessage') {
        const text = (item.content ?? []).filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n');
        const attachments: NonNullable<ChatMessage['attachments']> = [];
        for (const part of item.content ?? []) {
          if (part.type !== 'image' || typeof part.url !== 'string' || part.url.length > 8 * 1024 * 1024) continue;
          const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]*={0,2})$/.exec(part.url);
          if (match) attachments.push({ type: 'image', mimeType: match[1], content: match[2] });
        }
        messages.push({ ...base, timestampMs: itemTimestampMs ?? timestampMs,
          role: 'user', text, ...(typeof item.clientId === 'string' && item.clientId && item.clientId.length <= 200 ? { idempotencyKey: item.clientId } : {}), ...(attachments.length ? { attachments } : {}) });
      } else if (item.type === 'agentMessage' || item.type === 'plan') {
        messages.push({ ...base, timestampMs: (item.id === finalReplyId ? completedAtMs : undefined) ?? itemTimestampMs ?? timestampMs,
          role: 'assistant', text: String(item.text ?? '') });
      } else {
        const tool = codexTool(item);
        if (tool) messages.push({ ...base, id: `toolcall_${item.id}`, timestampMs: itemTimestampMs ?? timestampMs, role: 'tool', text: '',
          tool: { ...tool, ...codexToolTiming(item, tool.status, clock) } });
        const image = codexGeneratedImage(item);
        if (image) messages.push({ ...image, timestampMs: completedAtMs ?? timestampMs, ...(base.turnId ? { turnId: base.turnId } : {}) });
      }
    }
    const failure = codexTurnFailure(turn);
    if (failure) messages.push(failure);
  }
  return messages;
}
