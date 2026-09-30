import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { inspectCodexInstallation, resolveCodexExecutable } from './executable.js';

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

function executable(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '', { mode: 0o755 });
  return realpathSync(path);
}
const bundledPath = (directory: string, app: string) => join(directory, app, 'Contents', 'Resources',
  ...(app === 'Codex.app' ? ['codex'] : ['codex-cli', 'CodexCLI.app', 'Contents', 'MacOS', 'codex']));
it.each(['Codex.app', 'ChatGPT.app'])('discovers %s without a PATH CLI', app => {
  const desktop = executable(bundledPath(root, app));
  expect(resolveCodexExecutable('codex', 'darwin', '', [root])).toEqual({ command: desktop, prefix: [] });
});
it('prefers the desktop runtime over PATH CLI and honors explicit commands', () => {
  const desktop = executable(bundledPath(root, 'Codex.app'));
  const cli = executable(join(root, 'bin', 'codex'));
  expect(resolveCodexExecutable('codex', 'darwin', dirname(cli), [root]).command).toBe(desktop);
  expect(resolveCodexExecutable(cli, 'darwin', dirname(cli), [root]).command).toBe(cli);
  const explicit = join(root, 'missing-codex');
  expect(resolveCodexExecutable(explicit, 'darwin', '', [root]).command).toBe(explicit);
  expect(resolveCodexExecutable('custom-codex', 'darwin', '', [root]).command).toBe('custom-codex');
});
it('falls back to PATH only when no executable desktop runtime exists', () => {
  const desktop = bundledPath(root, 'Codex.app');
  mkdirSync(desktop, { recursive: true });
  const cli = executable(join(root, 'bin', 'codex'));
  expect(resolveCodexExecutable('codex', 'darwin', dirname(cli), [root]).command).toBe(cli);
});
it('recognizes the desktop codex-cli/bin layout without a standalone CLI', () => {
  const desktop = executable(join(root, 'ChatGPT.app', 'Contents', 'Resources', 'codex-cli', 'bin', 'codex'));
  expect(resolveCodexExecutable('codex', 'darwin', '', [root])).toEqual({ command: desktop, prefix: [] });
});
it('does not treat an app shell, directory or non-executable resource as Codex', () => {
  const path = bundledPath(root, 'Codex.app');
  mkdirSync(path, { recursive: true });
  expect(resolveCodexExecutable('codex', 'darwin', '', [root]).command).toBe('codex');
  rmSync(path, { recursive: true });
  executable(path); chmodSync(path, 0o644);
  if (process.platform !== 'win32') expect(resolveCodexExecutable('codex', 'darwin', '', [root]).command).toBe('codex');
});
it('checks user Applications before system Applications and skips missing bundles', () => {
  const user = join(root, 'user'); const system = join(root, 'system');
  const systemBinary = executable(bundledPath(system, 'Codex.app'));
  expect(resolveCodexExecutable('codex', 'darwin', '', [user, system]).command).toBe(systemBinary);
  const userBinary = executable(bundledPath(user, 'ChatGPT.app'));
  expect(resolveCodexExecutable('codex', 'darwin', '', [user, system]).command).toBe(userBinary);
});
it.each(['linux', 'win32'])('does not use macOS app bundles on %s', platform => {
  executable(bundledPath(root, 'Codex.app'));
  expect(resolveCodexExecutable('codex', platform as NodeJS.Platform, '', [root]).command).toBe('codex');
});
