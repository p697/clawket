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
export function codexMessages(turns: any[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const turn of turns) {
    for (const item of turn.items ?? []) {
      if (typeof item.id !== 'string') continue;
      const timestampMs = typeof turn.startedAt === 'number' ? turn.startedAt * 1000 : undefined;
      const base = { id: item.id, timestampMs };
      if (item.type === 'userMessage') {
        const text = (item.content ?? []).filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n');
        const attachments: NonNullable<ChatMessage['attachments']> = [];
        for (const part of item.content ?? []) {
          if (part.type !== 'image' || typeof part.url !== 'string' || part.url.length > 8 * 1024 * 1024) continue;
          const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]*={0,2})$/.exec(part.url);
          if (match) attachments.push({ type: 'image', mimeType: match[1], content: match[2] });
        }
        messages.push({ ...base, role: 'user', text, ...(typeof item.clientId === 'string' && item.clientId && item.clientId.length <= 200 ? { idempotencyKey: item.clientId } : {}), ...(attachments.length ? { attachments } : {}) });
      } else if (item.type === 'agentMessage' || item.type === 'plan') {
        messages.push({ ...base, role: 'assistant', text: String(item.text ?? '') });
      } else {
        const tool = codexTool(item);
        if (tool) messages.push({ ...base, id: `toolcall_${item.id}`, role: 'tool', text: '', tool });
        const image = codexGeneratedImage(item);
        if (image) messages.push({ ...image, timestampMs });
      }
    }
    const failure = codexTurnFailure(turn);
    if (failure) messages.push(failure);
  }
  return messages;
}
