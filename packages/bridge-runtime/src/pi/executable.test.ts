import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { inspectPiInstallation, resolvePiExecutable } from './executable.js';

it('resolves npm symlinks and Windows command shims without executing a shell', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-executable-')));
  try {
    const entry = join(root, 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
    mkdirSync(join(root, 'node_modules/@earendil-works/pi-coding-agent/dist/bundle'), { recursive: true });
    writeFileSync(entry, ''); writeFileSync(join(root, 'pi.cmd'), ''); symlinkSync(entry, join(root, 'pi'));
    expect(resolvePiExecutable('pi', 'darwin', root)).toEqual({ command: process.execPath, prefix: [entry] });
    expect(resolvePiExecutable('pi', 'win32', `/missing;${root}`)).toEqual({ command: process.execPath, prefix: [entry] });
    expect(resolvePiExecutable('missing', 'darwin', root)).toEqual({ command: 'missing', prefix: [] });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('checks the minimum supported RPC version and reports missing installations', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-version-'));
  try {
    const entry = join(root, 'cli.cjs');
    writeFileSync(entry, "console.log('0.87.0')");
    await expect(inspectPiInstallation(entry)).rejects.toThrow('0.87.1');
    writeFileSync(entry, "console.log('0.87.1')");
    expect(await inspectPiInstallation(entry)).toEqual({ version: '0.87.1' });
    await expect(inspectPiInstallation(join(root, 'missing'))).rejects.toThrow('could not start');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
