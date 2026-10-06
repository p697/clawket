import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import { lastVisiblePreview } from '../session-preview.js';
import { claudeHistory, claudeHistoryModel } from './history.js';

const MAX_TAIL_BYTES = 4 * 1024 * 1024;
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

function transcriptPath(sessionId: string, cwd: string, configDir: string): string | undefined {
  if (!UUID.test(sessionId) || !isAbsolute(cwd) || !isAbsolute(configDir)) return undefined;
  return join(configDir, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`);
}

export async function claudeTranscriptSize(sessionId: string, cwd: string, configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')): Promise<number | undefined> {
  const path = transcriptPath(sessionId, cwd, configDir);
  if (!path) return undefined;
  try { const info = await lstat(path); return info.isFile() && info.nlink === 1 ? info.size : undefined; }
  catch { return undefined; }
}

/** Large native JSONL files need a bounded roster excerpt, not a full SDK history projection. */
export async function claudePreviewTail(sessionId: string, cwd: string, configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')):
  Promise<{ preview?: string; lastActivityAt: number | null; model?: string } | undefined> {
  const path = transcriptPath(sessionId, cwd, configDir);
  if (!path) return undefined;
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size <= 0) return undefined;
    const length = Math.min(info.size, MAX_TAIL_BYTES);
    const bytes = Buffer.alloc(length);
    const offset = info.size - length;
    let read = 0;
    while (read < length) {
      const next = await handle.read(bytes, read, length - read, offset + read);
      if (!next.bytesRead) break;
      read += next.bytesRead;
    }
    const lines = bytes.subarray(0, read).toString('utf8').split('\n');
    if (offset > 0) lines.shift(); // The first line may begin in the middle of a JSON record.
    const rows: SessionMessage[] = [];
    for (let index = 0; index < lines.length; index++) {
      let entry: unknown;
      try { entry = JSON.parse(lines[index]); } catch { continue; }
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const row = entry as Record<string, unknown>;
      if ((row.type !== 'user' && row.type !== 'assistant') || row.isSidechain === true || row.parent_agent_id || row.parent_tool_use_id) continue;
      rows.push(row as SessionMessage);
    }
    const visible = lastVisiblePreview(claudeHistory(rows));
    const model = claudeHistoryModel(rows);
    return visible || model ? { lastActivityAt: null, ...visible, ...(model ? { model } : {}) } : undefined;
  } finally { await handle.close(); }
}
