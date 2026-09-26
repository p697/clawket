import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { savedCodexProjects, projectDescriptor } from './projects.js';
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
describe('saved Codex projects', () => {
  it('unifies legacy roots and current named multi-root projects without scanning directories', () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-projects-')); dirs.push(home);
    const root = join(home, 'app'); mkdirSync(root); mkdirSync(join(home, 'unlisted'));
    const alias = join(home, 'alias'); symlinkSync(root, alias);
    writeFileSync(join(home, '.codex-global-state.json'), JSON.stringify({
      'electron-saved-workspace-roots': [root, 'relative', 10],
      'local-projects': { p: { name: 'My product', rootPaths: [alias, join(home, 'missing')] }, bad: null },
    }));
    const projects = savedCodexProjects({ CODEX_HOME: home });
    expect(projects).toEqual([{ ...projectDescriptor(root), name: 'My product' }, { ...projectDescriptor(join(home, 'missing')), name: 'My product' }]);
    expect(projects[1].available).toBe(false);
  });
  it('fails explicitly on corrupt metadata', () => {
    const home = mkdtempSync(join(tmpdir(), 'codex-projects-')); dirs.push(home);
    writeFileSync(join(home, '.codex-global-state.json'), 'null');
    expect(() => savedCodexProjects({ CODEX_HOME: home })).toThrow('Invalid');
  });
});
