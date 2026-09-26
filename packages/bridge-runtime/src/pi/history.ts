import type { ChatMessage, Usage } from '@clawket/agent-protocol';

export function piUsage(value: any): Usage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return { input: value.input, output: value.output, cacheRead: value.cacheRead, cacheWrite: value.cacheWrite, total: value.totalTokens, costUsd: value.cost?.total };
}
export function piText(content: unknown): string {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.filter(p => p?.type === 'text').map(p => p.text ?? '').join('\n') : '';
}
/** Stable IDs from Pi entries; tool results update their original calls, never invent assistant prose. */
export function piMessages(entries: any[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const entry of entries) {
    // Context edits affect future model context only; Pi keeps the original transcript visible.
    const m = entry.type === 'custom_message'
      ? (entry.display ? { role: 'system', content: entry.content } : {})
      : entry.type === 'compaction' || entry.type === 'branch_summary'
        ? { role: 'system', content: entry.summary }
        : entry.message ?? entry;
    const id = entry.id ?? `pi-${result.length}`;
    const timestampMs = typeof m.timestamp === 'number' ? m.timestamp : Date.parse(entry.timestamp);
    if (m.role === 'toolResult') {
      const tool = result.find(row => row.tool?.callId === m.toolCallId);
      if (tool?.tool) { tool.tool.status = m.isError ? 'error' : 'success'; tool.tool.output = piText(m.content).slice(0, 32_000); }
      else result.push({ id, role: 'tool', text: '', timestampMs, tool: { name: m.toolName ?? 'tool', callId: m.toolCallId, status: m.isError ? 'error' : 'success', output: piText(m.content).slice(0, 32_000) } });
      continue;
    }
    if (!['user', 'assistant', 'system'].includes(m.role)) continue;
    const text = piText(m.content);
    const attachments = Array.isArray(m.content) ? m.content.filter((p: any) => p.type === 'image').map((p: any) => ({ type: 'image' as const, mimeType: p.mimeType, content: p.data })) : [];
    if (text || attachments.length) result.push({ id, role: m.role, text: text.slice(0, 128_000), timestampMs, model: m.model, provider: m.provider, usage: piUsage(m.usage), ...(attachments.length ? { attachments } : {}) });
    if (Array.isArray(m.content)) for (const part of m.content) {
      if (part.type === 'toolCall') result.push({ id: part.id, role: 'tool', text: '', timestampMs, tool: { name: part.name, callId: part.id, input: JSON.stringify(part.arguments ?? {}).length <= 32000 ? part.arguments : { preview: JSON.stringify(part.arguments).slice(0, 32000) }, status: 'unknown' } });
    }
  }
  return result;
}
/** JSONL sessions form a tree. Project only the current leaf's ancestors. Never open/migrate native files. */
export function piBranch(entries: any[]): any[] {
  const indexed = new Map(entries.filter(e => typeof e.id === 'string').map(e => [e.id, e]));
  let leaf = entries.filter(e => typeof e.id === 'string').at(-1);
  const branch: any[] = [], seen = new Set<string>();
  while (leaf && !seen.has(leaf.id)) { seen.add(leaf.id); branch.push(leaf); leaf = indexed.get(leaf.parentId); }
  return branch.reverse();
}
