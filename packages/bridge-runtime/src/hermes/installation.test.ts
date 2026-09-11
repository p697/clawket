import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { resolveHermesCommand, resolveHermesSourcePath } from './installation.js';

describe('Hermes installation discovery', () => {
  it('resolves current and legacy installations without requiring shell PATH changes', () => {
    const home = mkdtempSync(join(tmpdir(), 'clawket-hermes-install-'));
    try {
      const options = { home, env: {} };
      expect(resolveHermesSourcePath(options)).toBe(join(home, '.hermes/hermes-agent'));
      expect(resolveHermesCommand(options)).toBe('hermes');
      const source = join(home, '.local/share/hermes-agent');
      mkdirSync(join(source, 'hermes_cli'), { recursive: true });
      const command = join(home, '.local/bin/hermes');
      mkdirSync(join(home, '.local/bin'), { recursive: true });
      writeFileSync(command, '#!/bin/sh\n', { mode: 0o700 });
      expect(resolveHermesSourcePath(options)).toBe(source);
      expect(resolveHermesCommand(options)).toBe(command);
      const custom = join(home, 'custom');
      mkdirSync(custom);
      writeFileSync(join(custom, 'hermes'), '#!/bin/sh\n', { mode: 0o700 });
      expect(resolveHermesCommand({ home, env: { PATH: custom } })).toBe(join(custom, 'hermes'));
      expect(resolveHermesSourcePath({ home, env: { HERMES_SOURCE_PATH: '/explicit/source' } })).toBe('/explicit/source');
      expect(resolveHermesCommand({ home, env: { HERMES_COMMAND: '/explicit/hermes' } })).toBe('/explicit/hermes');
    } finally { rmSync(home, { recursive: true }); }
  });
});
