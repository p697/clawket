import type { AgentAdapter, ChatMessage } from '@clawket/agent-protocol';
import { sha256 } from 'js-sha256';
import { sanitizeUserMessageText } from '../utils/chat-message';

const MAX_MESSAGES = 10_000;
const MAX_TEXT = 2_000_000;
export type ConversationExport = Readonly<{
  title: string;
  messages: ReadonlyArray<{ role: 'user' | 'assistant'; text: string; timestampMs?: number; attachments: string[] }>;
}>;
const fingerprint = (messages: readonly ChatMessage[]) => sha256(JSON.stringify(messages.map(({ id, role, text, attachments }) => ({ id, role, text, attachments }))));

/** Capture a stable, complete text transcript; never label a truncated page as an export. */
export async function loadConversationExport(adapter: AgentAdapter, key: string, title: string, signal: AbortSignal): Promise<ConversationExport> {
  const check = () => { if (signal.aborted) throw new Error('export_cancelled'); };
  const seen = new Map<string, string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let sessionId: string | undefined;
  let firstFingerprint = '';
  let textLength = 0;
  let messages: ChatMessage[] = [];
  for (let page = 0; page < 100; page += 1) {
    check();
    const snapshot = await adapter.loadSession(key, { limit: 100, ...(cursor ? { cursor } : {}) });
    check();
    if (snapshot.key !== key || (page && snapshot.sessionId !== sessionId)) throw new Error('export_changed');
    if (snapshot.hasActiveRun) throw new Error('export_running');
    if (!page) { sessionId = snapshot.sessionId; firstFingerprint = fingerprint(snapshot.messages); }
    const additions: ChatMessage[] = [];
    for (const message of snapshot.messages) {
      const signature = fingerprint([message]);
      if (seen.has(message.id)) {
        if (seen.get(message.id) !== signature) throw new Error('export_changed');
        continue;
      }
      seen.set(message.id, signature);
      textLength += message.text.length + (message.attachments ?? []).reduce((sum, item) => sum + (item.name?.length ?? 0), 0);
      if (seen.size > MAX_MESSAGES || textLength > MAX_TEXT) throw new Error('export_too_large');
      additions.push({ id: message.id, role: message.role, text: message.role === 'user' ? sanitizeUserMessageText(message.text) : message.text, timestampMs: message.timestampMs, tool: message.tool ? { name: message.tool.name, status: message.tool.status } : undefined,
        attachments: message.attachments?.map(item => ({ type: item.type, mimeType: item.mimeType, name: item.name })) });
    }
    messages = [...additions, ...messages];
    if (!snapshot.nextCursor) {
      const latest = await adapter.loadSession(key, { limit: 100 });
      check();
      if (latest.key !== key || latest.hasActiveRun || latest.sessionId !== sessionId || fingerprint(latest.messages) !== firstFingerprint) throw new Error('export_changed');
      return { title: title.trim().slice(0, 200), messages: messages
        .filter((message): message is ChatMessage & { role: 'user' | 'assistant' } => (message.role === 'user' || message.role === 'assistant') && !message.tool)
        .map(message => ({ role: message.role, text: message.text,
          ...(message.timestampMs ? { timestampMs: message.timestampMs } : {}),
          attachments: (message.attachments ?? []).map(item => item.name || item.mimeType) })) };
    }
    if (cursors.has(snapshot.nextCursor)) throw new Error('export_changed');
    cursor = snapshot.nextCursor; cursors.add(cursor);
  }
  throw new Error('export_too_large');
}

export function formatConversationExport(value: ConversationExport, format: 'markdown' | 'json', labels: { user: string; assistant: string }): string {
  if (format === 'json') return JSON.stringify({ version: 1, ...value }, null, 2);
  return `# ${value.title.replace(/[\r\n]/g, ' ')}\n\n${value.messages.map(message => {
    const time = message.timestampMs && Number.isFinite(message.timestampMs) ? ` · ${new Date(message.timestampMs).toISOString()}` : '';
    return `## ${labels[message.role]}${time}\n\n${message.text}${message.attachments.length ? `\n\n${message.attachments.join('\n')}` : ''}`;
  }).join('\n\n---\n\n')}\n`;
}
