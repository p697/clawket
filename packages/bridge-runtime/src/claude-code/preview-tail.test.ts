import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, expect, it, vi } from 'vitest';
import { claudePreviewTail, claudeTranscriptSize } from './preview-tail.js';
import { ClaudeCatalog } from './catalog.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

it('reads a bounded tail of a large native transcript and ignores later tool output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawket-claude-preview-')); directories.push(root);
  const cwd = join(root, 'project'), sessionId = '00000000-0000-4000-8000-000000000001';
  const nativeDir = join(root, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  await mkdir(cwd);
  await mkdir(nativeDir, { recursive: true });
  const line = (row: unknown) => `${JSON.stringify(row)}\n`;
  await writeFile(join(nativeDir, `${sessionId}.jsonl`), 'x'.repeat(9 * 1024 * 1024) + '\n'
    + line({ type: 'user', uuid: 'u', timestamp: '2026-09-27T10:00:00.000Z', message: { content: 'First prompt' } })
    + line({ type: 'assistant', uuid: 'a', timestamp: '2026-09-27T10:01:00.000Z', message: { model: 'claude-native', content: [{ type: 'text', text: '**Latest reply**' }] } })
    + line({ type: 'user', uuid: 'tool', timestamp: '2026-09-27T10:02:00.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 'call', content: 'secret result' }] } }));
  expect(await claudeTranscriptSize(sessionId, cwd, root)).toBeGreaterThan(8 * 1024 * 1024);
  expect(await claudePreviewTail(sessionId, cwd, root))
    .toEqual({ preview: 'Latest reply', lastActivityAt: Date.parse('2026-09-27T10:01:00.000Z'), model: 'claude-native' });
  expect(await claudePreviewTail('../outside', cwd, root)).toBeUndefined();
  const previous = process.env.CLAUDE_CONFIG_DIR;
  try {
    process.env.CLAUDE_CONFIG_DIR = root;
    const catalog = new ClaudeCatalog({ project: cwd, device: false }, { listSessions: vi.fn(async () => [{
      sessionId, cwd, summary: 'First prompt', lastModified: 1,
      fileSize: (await claudeTranscriptSize(sessionId, cwd, root))!,
    }]) as any, getSessionMessages }, async () => []);
    expect((await catalog.discover()).sessions[0].preview).toBe('Latest reply');
    expect(await catalog.readModel(sessionId, cwd)).toBe('claude-native');
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
  }
});
