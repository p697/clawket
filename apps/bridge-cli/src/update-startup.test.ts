import { expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startCodexBackground } from './codex-lifecycle.js';
import { startClaudeBackground } from './claude-code-lifecycle.js';
import { startPiBackground } from './pi-lifecycle.js';
it('keeps updater activation stdout machine-readable for every native startup helper', async () => {
  const entry = join(homedir(), 'ready-worker.mjs');
  writeFileSync(entry, `const backend = process.argv[2]; process.on('disconnect', () => process.exit(0)); process.send({ type: backend + '.display', text: 'display-canary' }); process.send({ type: backend + '.ready' });`);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    for (const start of [startCodexBackground, startClaudeBackground, startPiBackground]) await start(['run'], join(homedir(), 'test.log'), undefined, process.execPath, entry, true);
    expect(log).not.toHaveBeenCalled();
  } finally { log.mockRestore(); }
});
