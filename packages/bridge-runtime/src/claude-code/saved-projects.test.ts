import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { savedClaudeProjects } from './saved-projects.js';

it('reads only bounded absolute project keys and degrades malformed optional metadata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clawket-claude-projects-'));
  const path = join(dir, 'config.json');
  try {
    const project = join(dir, 'project');
    await writeFile(path, JSON.stringify({ projects: { [project]: { secret: 'must-not-export' }, relative: {} }, token: 'private' }));
    expect(await savedClaudeProjects(path)).toEqual([project]);
    for (const content of ['broken', '', '{"projects":[]}', 'x'.repeat(8 * 1024 * 1024 + 1)]) {
      await writeFile(path, content);
      expect(await savedClaudeProjects(path)).toEqual([]);
    }
    expect(await savedClaudeProjects(join(dir, 'missing'))).toEqual([]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
