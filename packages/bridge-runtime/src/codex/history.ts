import type { ChatMessage } from '@clawket/agent-protocol';

export function codexTool(item: any): ChatMessage['tool'] | undefined {
  const names: Record<string, string> = { commandExecution: 'exec', fileChange: 'apply_patch', mcpToolCall: item.tool ?? 'MCP', dynamicToolCall: item.tool ?? 'tool', webSearch: 'web_search', collabAgentToolCall: item.tool ?? 'agent', imageView: 'view_image', imageGeneration: 'image_generation' };
  if (!names[item.type]) return undefined;
  const failed = ['failed', 'declined', 'interrupted'].includes(item.status) || (typeof item.exitCode === 'number' && item.exitCode !== 0) || !!item.error;
  return { callId: item.id, name: names[item.type], status: failed ? 'error' : item.status === 'inProgress' ? 'running' : item.status === 'completed' || item.type === 'webSearch' ? 'success' : 'unknown',
    input: item.type === 'commandExecution' ? { command: item.command, cwd: item.cwd } : item.type === 'fileChange' ? { changes: item.changes } : item.arguments ?? { query: item.query, path: item.path },
    output: String(item.aggregatedOutput ?? (item.result ? JSON.stringify(item.result) : item.error ? JSON.stringify(item.error) : item.type === 'fileChange' ? JSON.stringify(item.changes) : '')).slice(0, 32000) };
}
export function codexMessages(turns: any[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const turn of turns) for (const item of turn.items ?? []) {
    if (typeof item.id !== 'string') continue;
    const timestampMs = typeof turn.startedAt === 'number' ? turn.startedAt * 1000 : undefined;
    const base = { id: item.id, timestampMs };
    if (item.type === 'userMessage') {
      const text = (item.content ?? []).filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n');
      const attachments: NonNullable<ChatMessage['attachments']> = [];
      for (const part of item.content ?? []) {
        if (part.type !== 'image' || typeof part.url !== 'string' || part.url.length > 6 * 1024 * 1024) continue;
        const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]*={0,2})$/.exec(part.url);
        if (match) attachments.push({ type: 'image', mimeType: match[1], content: match[2] });
      }
      messages.push({ ...base, role: 'user', text, ...(attachments.length ? { attachments } : {}) });
    } else if (item.type === 'agentMessage' || item.type === 'plan') {
      messages.push({ ...base, role: 'assistant', text: String(item.text ?? '') });
    } else {
      const tool = codexTool(item);
      if (tool) messages.push({ ...base, id: `toolcall_${item.id}`, role: 'tool', text: '', tool });
    }
  }
  return messages;
}
