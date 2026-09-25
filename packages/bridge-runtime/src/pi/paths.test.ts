import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { nativePiDirectory } from './paths.js';

it('discovers native session locations with Pi precedence, including project-local settings', () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-paths-')), agent = join(root, 'agent');
  mkdirSync(agent); mkdirSync(join(root, '.pi'));
  try {
    writeFileSync(join(agent, 'settings.json'), JSON.stringify({ sessionDir: 'global-history' }));
    expect(nativePiDirectory(root, agent, undefined, {})).toBe(join(root, 'global-history'));
    writeFileSync(join(root, '.pi/settings.json'), JSON.stringify({ sessionDir: 'project-history' }));
    expect(nativePiDirectory(root, agent, undefined, {})).toBe(join(root, 'project-history'));
    expect(nativePiDirectory(root, agent, undefined, { PI_CODING_AGENT_SESSION_DIR: 'env-history' })).toBe(join(root, 'env-history'));
    expect(nativePiDirectory(root, agent, 'explicit', { PI_CODING_AGENT_SESSION_DIR: 'env-history' })).toBe(join(root, 'explicit'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
