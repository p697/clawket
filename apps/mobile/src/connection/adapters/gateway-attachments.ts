import type { ChatMessage } from '@clawket/agent-protocol';
const record = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const str = (v: unknown): string | undefined => typeof v === 'string' && v.trim() ? v.trim() : undefined;

/** Keep stable references, never Gateway ticket URLs, for managed transcript attachments. */
export function extractHistoryAttachments(content: unknown): NonNullable<ChatMessage['attachments']> {
  if (!Array.isArray(content)) return [];
  return content.flatMap<NonNullable<ChatMessage['attachments']>[number]>(value => {
    const raw = record(value); if (!raw) return [];
    const block = raw.type === 'attachment' ? record(raw.attachment) : raw;
    if (!block || !['image', 'file', 'image_url', 'attachment', 'audio', 'video'].includes(String(raw.type))) return [];
    const source = record(block.source);
    const artifactId = str(block.artifactId);
    if (artifactId && artifactId.length > 512) return [];
    const mimeType = str(block.mimeType) ?? str(block.mime_type) ?? str(source?.media_type) ?? 'application/octet-stream';
    const name = str(block.name) ?? str(block.fileName) ?? str(block.label) ?? str(block.alt);
    const type = raw.type === 'image' || raw.type === 'image_url' ? 'image' as const : 'file' as const;
    if (artifactId) return [{ type, mimeType, artifactId, ...(name ? { name } : {}) }];
    const uri = str(block.uri) ?? str(record(block.image_url)?.url);
    const content = str(block.content) ?? str(block.data) ?? str(source?.data);
    return [{ type, mimeType, ...(uri ? { uri } : {}), ...(content ? { content } : {}), ...(name ? { name } : {}) }];
  });
}

/** OpenClaw consumes these standalone delivery directives before persisting chat history. */
export function stripOpenClawMediaDirectives(text: string): string {
  let fence: string | undefined;
  return text.split('\n').filter(line => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) { fence = fence?.[0] === marker[0] ? undefined : fence ?? marker; return true; }
    return Boolean(fence) || !/^\s*MEDIA:\s*(?:\/|\.\/|~\/|https?:\/\/)\S[^\r\n]*\s*$/.test(line);
  }).join('\n');
}

/** Retire legacy cached delivery text only when the same native turn contains real artifacts. */
export function reconcileOpenClawArtifactHistory(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (let start = 0; start < messages.length;) {
    let end = start + 1;
    while (end < messages.length && messages[end].role !== 'user') end++;
    const turn = messages.slice(start, end);
    const delivered = turn.some(message => message.role === 'assistant' && message.attachments?.some(a => a.artifactId));
    const managedCopies = new Map<string, number>();
    for (const message of turn) {
      const text = delivered && message.role === 'assistant' ? stripOpenClawMediaDirectives(message.text) : message.text;
      // A paged CLI projection can reintroduce the same delivered artifact under
      // its imported and rollup IDs. Native managed IDs identify the delivery;
      // repeated sends have different IDs and must remain separate.
      const artifacts = message.attachments;
      const identity = message.role === 'assistant' && artifacts?.length
        && artifacts.every(a => a.artifactId?.startsWith('artifact_managed_'))
        ? JSON.stringify([text.replace(/\s+/g, ' ').trim(), artifacts.map(a => a.artifactId).sort()]) : null;
      if (identity) {
        const previous = managedCopies.get(identity);
        if (previous !== undefined) { result[previous] = { ...message, text }; continue; }
        managedCopies.set(identity, result.length);
      }
      if (text === message.text) result.push(message);
      else if (text.trim() || message.attachments?.length) result.push({ ...message, text });
    }
    start = end;
  }
  return result;
}
