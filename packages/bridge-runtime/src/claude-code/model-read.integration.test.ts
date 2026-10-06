import { expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeSession } from './session.js';
import { inspectClaudeInstallation } from './executable.js';

it('reads the installed runtime model before sending any prompt, and confirms a session-only switch', async () => {
  if (process.env.CLAWKET_CLAUDE_MODEL_READ_LIVE !== '1') throw new Error('Set CLAWKET_CLAUDE_MODEL_READ_LIVE=1 for the explicit native model-read test.');
  const installed = await inspectClaudeInstallation();
  const project = mkdtempSync(join(tmpdir(), 'clawket-model-read-'));
  mkdirSync(join(project, '.claude'));
  writeFileSync(join(project, '.claude/settings.json'), JSON.stringify({ model: 'haiku' }));
  const session = new ClaudeSession({ key: 'isolated-model-read', cwd: project, executable: installed.executable, settingSources: ['project'], tools: [] });
  const updates: unknown[] = []; session.on('update', update => updates.push(update));
  try {
    const models = await session.models();
    expect(models.length).toBeGreaterThan(0);
    expect(session.currentModel).toContain('haiku');
    expect(session.sessionId).toBeUndefined();
    await session.setModel('sonnet');
    await session.models();
    expect(session.currentModel).toContain('sonnet');
    expect(session.activeRun).toBeUndefined();
    expect(updates).toEqual([]);
    expect(JSON.parse(readFileSync(join(project, '.claude/settings.json'), 'utf8'))).toEqual({ model: 'haiku' });
    console.log(`Verified Claude ${installed.version}: ${models.length} native models, two pre-prompt model reads and zero turns.`);
  } finally { await session.close(); rmSync(project, { recursive: true, force: true }); }
}, 60_000);
