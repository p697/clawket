import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeFault } from './errors.js';
import { claudeHistory } from './history.js';

/** SDK offsets count from the beginning; phone cursors load older rows before a stable index. */
export async function claudeHistoryPage(sessionId: string, cwd: string, cursor?: unknown,
  read = getSessionMessages) {
  const rows = await read(sessionId, { dir: cwd, limit: 10_001 });
  if (rows.length > 10_000) throw new ClaudeFault('This Claude conversation exceeds the mobile history limit. Open it on your computer.');
  const messages = claudeHistory(rows);
  const end = cursor === undefined ? messages.length : Number(cursor);
  if (!Number.isSafeInteger(end) || end < 0 || end > messages.length) throw new ClaudeFault('Invalid Claude history cursor');
  const start = Math.max(0, end - 100);
  return { messages: messages.slice(start, end), ...(start ? { nextCursor: String(start) } : {}) };
}
