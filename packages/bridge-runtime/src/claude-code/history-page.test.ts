import { describe, expect, it, vi } from 'vitest';
import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import { claudeHistoryPage } from './history-page.js';
const rows = (count: number) => Array.from({ length: count }, (_, i) => ({ uuid: `m${i}`, type: 'user', message: { content: `row ${i}` } } as SessionMessage));
describe('Claude mobile history pages', () => {
  it('opens the newest rows and keeps older-page cursors stable when new messages arrive', async () => {
    const read = vi.fn().mockResolvedValue(rows(205));
    const recent = await claudeHistoryPage('native', '/project', undefined, read);
    expect(recent.messages[0].text).toBe('row 105');
    expect(recent.messages.at(-1)?.text).toBe('row 204');
    read.mockResolvedValue(rows(210));
    const older = await claudeHistoryPage('native', '/project', recent.nextCursor, read);
    expect(older.messages[0].text).toBe('row 5');
    expect(older.messages.at(-1)?.text).toBe('row 104');
    expect(older.nextCursor).toBe('5');
  });
  it('rejects invalid cursors and excessive native transcripts instead of showing an incorrect partial history', async () => {
    const read = vi.fn().mockResolvedValue(rows(2));
    await expect(claudeHistoryPage('native', '/project', '-1', read)).rejects.toThrow('cursor');
    await expect(claudeHistoryPage('native', '/project', '3', read)).rejects.toThrow('cursor');
    read.mockResolvedValue(rows(10001));
    await expect(claudeHistoryPage('native', '/project', undefined, read)).rejects.toThrow('limit');
  });
});
