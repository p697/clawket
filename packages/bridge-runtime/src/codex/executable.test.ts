import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectCodexInstallation } from './executable.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'codex-version-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
it.each(['0.153.3', '0.158.0-alpha.2', '0.158.0+desktop.1'])('accepts an installed supported Codex version %s', async version => {
  const command = join(root, 'codex.cjs');
  writeFileSync(command, `console.log(${JSON.stringify('codex-cli ' + version)})`);
  await expect(inspectCodexInstallation(command)).resolves.toEqual({ version: 'codex-cli ' + version });
});
it.each(['0.153.2', '0.152.0-alpha.2', 'unknown', '0.158.0 invalid'])('rejects old or unrecognized Codex versions %s', async version => {
  const command = join(root, 'codex.cjs');
  writeFileSync(command, `console.log(${JSON.stringify('codex-cli ' + version)})`);
  await expect(inspectCodexInstallation(command)).rejects.toThrow('0.153.3 or newer');
});
