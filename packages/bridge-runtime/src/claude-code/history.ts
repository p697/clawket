import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ChatMessage } from '@clawket/agent-protocol';

type Block = Record<string, unknown>;

function record(value: unknown): value is Block {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function blocks(value: unknown): Block[] {
  return Array.isArray(value) ? value.filter(record) : [];
}

function outputText(content: unknown): string {
  if (typeof content === 'string') return content.slice(0, 32_000);
  return blocks(content).filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text).join('\n').slice(0, 32_000);
}

/** Read-only projection. Native UUIDs and tool-use IDs survive live/history reconciliation. */
export function claudeHistory(messages: readonly SessionMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  const tools = new Map<string, ChatMessage>();
  const seen = new Set<string>();
  let imageBytes = 0;
  for (const entry of messages) {
    if (!entry || typeof entry.uuid !== 'string' || seen.has(entry.uuid)
      || entry.parent_tool_use_id || !record(entry.message)) continue;
    seen.add(entry.uuid);
    if (entry.type !== 'user' && entry.type !== 'assistant') continue;
    const content = entry.message.content;
    const parts: Block[] = typeof content === 'string' ? [{ type: 'text', text: content }] : blocks(content);
    const localText = parts.length === 1 && parts[0].type === 'text' && typeof parts[0].text === 'string' ? parts[0].text : undefined;
    // setModel writes native local-command records into the transcript, not human turns.
    // Match only that complete envelope; ordinary text discussing commands stays visible.
    if (entry.type === 'user' && localText !== undefined && (
      /^\s*<command-name>\/model<\/command-name>\s*<command-message>model<\/command-message>\s*<command-args>[^<]*<\/command-args>\s*$/.test(localText)
      || /^\s*<local-command-stdout>Set model to [\s\S]*<\/local-command-stdout>\s*$/.test(localText)
      || /^\[Request interrupted by user(?: for tool use)?\]$/.test(localText)
    )) continue;
    const userText: string[] = [];
    const attachments: NonNullable<ChatMessage['attachments']> = [];
    for (let index = 0; index < parts.length; index++) {
      const block = parts[index];
      if (block.type === 'text' && typeof block.text === 'string' && block.text.length) {
        if (entry.type === 'user') { userText.push(block.text); continue; }
        result.push({ id: `${entry.uuid}:text:${index}`, role: entry.type, text: block.text,
          ...(entry.type === 'assistant' && typeof entry.message.model === 'string' ? { model: entry.message.model } : {}) });
      } else if (block.type === 'tool_use' && entry.type === 'assistant'
        && typeof block.id === 'string' && typeof block.name === 'string' && !tools.has(block.id)) {
        const row: ChatMessage = { id: `toolcall_${block.id}`, role: 'tool', text: '',
          tool: { name: block.name, callId: block.id, status: 'unknown', input: block.input } };
        tools.set(block.id, row);
        result.push(row);
      } else if (block.type === 'tool_result' && entry.type === 'user' && typeof block.tool_use_id === 'string') {
        const row = tools.get(block.tool_use_id);
        // A result whose call predates this page must not masquerade as a human message.
        if (row?.tool) {
          row.tool.status = block.is_error === true ? 'error' : 'success';
          row.tool.output = outputText(block.content);
        }
      } else if (block.type === 'image' && entry.type === 'user' && record(block.source)) {
        const { type, media_type: mimeType, data } = block.source;
        if (type !== 'base64' || typeof mimeType !== 'string' || typeof data !== 'string'
          || !/^image\/(png|jpeg|webp|gif)$/.test(mimeType) || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) continue;
        imageBytes += Buffer.byteLength(data);
        if (imageBytes > 5 * 1024 * 1024) continue;
        attachments.push({ type: 'image', mimeType, content: data });
      }
    }
    if (entry.type === 'user' && (userText.length || attachments.length)) {
      result.push({ id: entry.uuid, role: 'user', text: userText.join('\n'),
        ...(attachments.length ? { attachments } : {}) });
    }
  }
  return result;
}
