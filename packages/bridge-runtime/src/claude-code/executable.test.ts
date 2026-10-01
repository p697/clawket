import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { inspectClaudeInstallation, resolveClaudeExecutable } from './executable.js';

vi.mock('node:child_process', async importOriginal => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, execFile: vi.fn(original.execFile) };
});

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'claude-executable-')); vi.mocked(execFile).mockClear(); });
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

function executable(path: string): string {
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, '', { mode: 0o755 });
  return realpathSync(path);
}
function desktopPath(directory: string, platform: NodeJS.Platform, version = '2.1.284'): string {
  return platform === 'darwin' ? join(directory, version, 'claude.app', 'Contents', 'MacOS', 'claude')
    : join(directory, version, 'claude.exe');
}
const search = (platform: NodeJS.Platform) => ({ platform, home: root, searchPath: join(root, 'bin'), desktopDirectories: [join(root, 'desktop')] });

it.each(['darwin', 'win32'] as const)('discovers Desktop without a standalone CLI on %s', platform => {
  const desktop = executable(desktopPath(join(root, 'desktop'), platform));
  expect(resolveClaudeExecutable('claude', search(platform))).toBe(desktop);
});
it.each(['darwin', 'win32'] as const)('prefers Desktop when both installations exist on %s', platform => {
  const desktop = executable(desktopPath(join(root, 'desktop'), platform));
  executable(join(root, 'bin', platform === 'win32' ? 'claude.exe' : 'claude'));
  executable(join(root, '.local', 'bin', platform === 'win32' ? 'claude.exe' : 'claude'));
  expect(resolveClaudeExecutable('claude', search(platform))).toBe(desktop);
});
it.each(['darwin', 'win32', 'linux'] as const)('retains CLI-only discovery on %s', platform => {
  const cli = executable(join(root, 'bin', platform === 'win32' ? 'claude.exe' : 'claude'));
  expect(resolveClaudeExecutable('claude', search(platform))).toBe(cli);
});
it.each(['darwin', 'win32'] as const)('retains native CLI fallback outside PATH on %s', platform => {
  const cli = executable(join(root, '.local', 'bin', platform === 'win32' ? 'claude.exe' : 'claude'));
  expect(resolveClaudeExecutable('claude', search(platform))).toBe(cli);
});
it('discovers the default macOS Desktop user-data path and its older bare-binary layout', () => {
  const directory = join(root, 'Library', 'Application Support', 'Claude', 'claude-code');
  const bare = executable(join(directory, '2.1.281', 'claude'));
  expect(resolveClaudeExecutable('claude', { platform: 'darwin', home: root, searchPath: '' })).toBe(bare);
  const bundle = executable(desktopPath(directory, 'darwin'));
  expect(resolveClaudeExecutable('claude', { platform: 'darwin', home: root, searchPath: '' })).toBe(bundle);
});
it('discovers Windows Desktop under APPDATA and the default roaming profile', () => {
  vi.stubEnv('APPDATA', join(root, 'custom-roaming'));
  const roaming = executable(desktopPath(join(root, 'custom-roaming', 'Claude', 'claude-code'), 'win32'));
  expect(resolveClaudeExecutable('claude', { platform: 'win32', home: root, searchPath: '' })).toBe(roaming);
  vi.stubEnv('APPDATA', '');
  const fallback = executable(desktopPath(join(root, 'AppData', 'Roaming', 'Claude', 'claude-code'), 'win32'));
  expect(resolveClaudeExecutable('claude', { platform: 'win32', home: root, searchPath: '' })).toBe(fallback);
});
it('orders cached versions numerically and ignores incomplete downloads and unrelated folders', () => {
  const directory = join(root, 'desktop');
  executable(desktopPath(directory, 'darwin', '2.1.9'));
  const latest = executable(desktopPath(directory, 'darwin', '2.1.10'));
  executable(desktopPath(directory, 'darwin', 'not-a-version'));
  mkdirSync(join(directory, '2.1.11'));
  expect(resolveClaudeExecutable('claude', search('darwin'))).toBe(latest);
});
it('skips app shells, directories, non-executable downloads and VM guest runtimes', () => {
  const path = desktopPath(join(root, 'desktop'), 'darwin');
  mkdirSync(path, { recursive: true });
  const cli = executable(join(root, 'bin', 'claude'));
  executable(join(root, 'Library', 'Application Support', 'Claude', 'claude-code-vm', '2.1.284', 'claude'));
  executable(join(root, 'Applications', 'Claude.app', 'Contents', 'MacOS', 'Claude'));
  expect(resolveClaudeExecutable('claude', search('darwin'))).toBe(cli);
  rmSync(path, { recursive: true }); executable(path); chmodSync(path, 0o644);
  if (process.platform !== 'win32') expect(resolveClaudeExecutable('claude', search('darwin'))).toBe(cli);
});
it('honors explicit paths and custom commands without substituting Desktop for a missing override', () => {
  executable(desktopPath(join(root, 'desktop'), 'darwin'));
  const cli = executable(join(root, 'bin', 'custom-claude'));
  expect(resolveClaudeExecutable(cli, search('darwin'))).toBe(cli);
  expect(resolveClaudeExecutable('custom-claude', search('darwin'))).toBe(cli);
  expect(() => resolveClaudeExecutable(join(root, 'missing'), search('darwin'))).toThrow('--claude-command');
  expect(() => resolveClaudeExecutable('missing-command', search('darwin'))).toThrow('--claude-command');
});
it('resolves an npm Windows command shim to its installed JS entry', () => {
  executable(join(root, 'bin', 'claude.cmd'));
  const entry = executable(join(root, 'bin', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'));
  expect(resolveClaudeExecutable('claude', search('win32'))).toBe(entry);
});
it('does not interpret an empty PATH entry as the current working directory', () => {
  expect(() => resolveClaudeExecutable('claude', { ...search('darwin'), searchPath: '' })).toThrow('Claude Desktop');
});
it.each(['2.1.280', '2.1.284', '3.0.0'])('accepts installed Claude Code %s', async version => {
  const command = join(root, 'claude.cjs'); writeFileSync(command, `console.log('${version} (Claude Code)')`);
  await expect(inspectClaudeInstallation(command)).resolves.toEqual({ version: `${version} (Claude Code)`, executable: realpathSync(command) });
});
it.each(['2.1.279', '2.0.300', '1.9.999', 'unknown'])('rejects unsupported Claude Code %s', async version => {
  const command = join(root, 'claude.cjs'); writeFileSync(command, `console.log('${version}')`);
  await expect(inspectClaudeInstallation(command)).rejects.toThrow('2.1.280 or newer');
});
it.each(['darwin', 'win32'] as const)('does not silently retry CLI after selected Desktop fails on %s', async platform => {
  const desktop = executable(desktopPath(join(root, 'desktop'), platform));
  executable(join(root, 'bin', platform === 'win32' ? 'claude.exe' : 'claude'));
  vi.mocked(execFile).mockImplementationOnce(((_command: unknown, _args: unknown, _options: unknown, done: any) => {
    done(new Error('native details must not escape'), '', '');
    return {};
  }) as typeof execFile);
  await expect(inspectClaudeInstallation('claude', search(platform))).rejects.toThrow('Check Claude Desktop');
  expect(execFile).toHaveBeenCalledTimes(1);
  expect(vi.mocked(execFile).mock.calls[0][0]).toBe(desktop);
});
it('does not silently retry CLI after selected Desktop reports an unsupported version', async () => {
  const desktop = executable(desktopPath(join(root, 'desktop'), 'darwin'));
  executable(join(root, 'bin', 'claude'));
  vi.mocked(execFile).mockImplementationOnce(((_command: unknown, _args: unknown, _options: unknown, done: any) => {
    done(null, '2.1.279 (Claude Code)', ''); return {};
  }) as typeof execFile);
  await expect(inspectClaudeInstallation('claude', search('darwin'))).rejects.toThrow('2.1.280 or newer');
  expect(execFile).toHaveBeenCalledTimes(1);
  expect(vi.mocked(execFile).mock.calls[0][0]).toBe(desktop);
});
