import { expect, it, vi } from 'vitest';
import { writeFileSync, existsSync, unlinkSync, mkdirSync, readFileSync, mkdtempSync, symlinkSync, realpathSync, rmSync } from 'node:fs';
import * as childProcess from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { stableBridgeVersion, compareStableVersions, legacyEntryFromCommands, acquireUpdateLock, stageBridgeRelease, readReleaseMetadata, createUpdateTarget, describeUpdateResult } from './update.js';

vi.mock('node:child_process', async importOriginal => {
  const original = await importOriginal<typeof childProcess>();
  return { ...original, execFileSync: vi.fn(original.execFileSync) };
});

function legacyInstall() {
  const directory = mkdtempSync(join(homedir(), 'legacy-entry-'));
  const packageDirectory = join(directory, 'node_modules', '@p697', 'clawket');
  const entry = join(packageDirectory, 'dist', 'index.js');
  mkdirSync(dirname(entry), { recursive: true });
  writeFileSync(entry, '// legacy Bridge fixture');
  const metadata = join(packageDirectory, 'package.json');
  writeFileSync(metadata, JSON.stringify({ name: '@p697/clawket', version: '3.1.10', bin: { clawket: 'dist/index.js' } }));
  const bin = join(directory, 'node_modules', '.bin', 'clawket');
  mkdirSync(dirname(bin), { recursive: true });
  symlinkSync(relative(dirname(bin), entry), bin, 'file');
  return { directory, entry: realpathSync(entry), bin, metadata };
}
const commandLine = (entry: string, args: string, pid = 123) => `${pid} node ${entry.replace(/\\/g, '/')} ${args}`;
it('accepts only stable bounded versions and compares patch/minor/major numerically', () => {
  for (const value of ['3.1.11-rc.1', '03.1.1', '3.1', 'latest', '3.1.11;run', '9007199254740992.1.1']) expect(stableBridgeVersion(value)).toBe(false);
  expect(compareStableVersions('3.1.11', '3.1.9')).toBe(1); expect(compareStableVersions('3.2.0', '3.1.99')).toBe(1); expect(compareStableVersions('3.1.10', '3.1.10')).toBe(0);
});
it('accepts only an unambiguous known legacy runtime entry and selected config', () => {
  const line = '123 node /home/.npm/_npx/x/node_modules/@p697/clawket/dist/index.js codex run --config /saved/runtime.json --foreground';
  expect(legacyEntryFromCommands(line, 'codex', '/saved/runtime.json')).toMatchObject({ pid: 123 }); expect(legacyEntryFromCommands(line, 'pi', '/saved/runtime.json')).toBe(null); expect(legacyEntryFromCommands('123 node /arbitrary/index.js codex run', 'codex')).toBe(null); expect(() => legacyEntryFromCommands(`${line}\n${line.replace('123', '124')}`, 'codex')).toThrow('Multiple');
});
it.each([
  ['openclaw', 'run --service'],
  ['hermes', 'hermes run --port 4319'],
  ['hermes-relay', 'hermes relay run'],
  ['codex', 'codex run --config /saved/runtime.json --foreground'],
  ['claude-code', 'claude-code run --config /saved/runtime.json --foreground'],
  ['pi', 'pi pair --config /saved/runtime.json --foreground'],
])('resolves a real npm executable symlink for legacy %s without changing scope', (backend, args) => {
  const fixture = legacyInstall();
  const config = ['codex', 'claude-code', 'pi'].includes(backend) ? '/saved/runtime.json' : undefined;
  expect(legacyEntryFromCommands(commandLine(fixture.bin, args), backend, config)).toEqual({ pid: 123, entry: fixture.entry });
});
it('resolves global npm bin links and captures the bundle instead of a mutable launcher', () => {
  const fixture = legacyInstall(), globalBin = join(fixture.directory, 'bin', 'clawket');
  mkdirSync(dirname(globalBin)); symlinkSync(fixture.bin, globalBin, 'file');
  const args = 'codex run --config /saved/runtime.json --foreground';
  expect(legacyEntryFromCommands(commandLine(globalBin, args), 'codex', '/saved/runtime.json')).toEqual({ pid: 123, entry: fixture.entry });
  expect(() => legacyEntryFromCommands(`${commandLine(globalBin, args)}\n${commandLine(fixture.entry, args, 124)}`, 'codex', '/saved/runtime.json')).toThrow('Multiple legacy codex');
});
it('retains exact backend/config and runtime-command checks for npm links', () => {
  const { bin } = legacyInstall();
  const line = commandLine(bin, 'codex run --config /saved/runtime.json --foreground');
  expect(legacyEntryFromCommands(line, 'pi', '/saved/runtime.json')).toBeNull();
  expect(legacyEntryFromCommands(line, 'codex', '/other/runtime.json')).toBeNull();
  expect(legacyEntryFromCommands(commandLine(bin, 'codex status --config /saved/runtime.json'), 'codex', '/saved/runtime.json')).toBeNull();
  expect(legacyEntryFromCommands(commandLine(bin, 'codex run', 0), 'codex')).toBeNull();
});
it.each(['broken', 'loop', 'arbitrary-target', 'directory', 'plain-file', 'unknown-launcher'])('rejects a %s executable without trusting its name', invalid => {
  const fixture = legacyInstall();
  unlinkSync(fixture.bin);
  if (invalid === 'plain-file') writeFileSync(fixture.bin, '// named clawket, but not a package entry');
  else if (invalid === 'broken') symlinkSync(join(fixture.directory, 'missing.js'), fixture.bin, 'file');
  else if (invalid === 'loop') symlinkSync(fixture.bin, fixture.bin, 'file');
  else if (invalid === 'arbitrary-target') {
    const arbitrary = join(fixture.directory, 'index.js'); writeFileSync(arbitrary, '// unrelated'); symlinkSync(arbitrary, fixture.bin, 'file');
  } else if (invalid === 'directory') {
    rmSync(fixture.entry); mkdirSync(fixture.entry); symlinkSync(fixture.entry, fixture.bin, 'dir');
  } else symlinkSync(fixture.entry, fixture.bin, 'file');
  const invoked = invalid === 'unknown-launcher' ? join(fixture.directory, 'clawket') : fixture.bin;
  if (invalid === 'unknown-launcher') symlinkSync(fixture.entry, invoked, 'file');
  expect(legacyEntryFromCommands(commandLine(invoked, 'codex run'), 'codex')).toBeNull();
});
it.each([
  '{malformed',
  JSON.stringify({ name: 'unrelated', bin: { clawket: 'dist/index.js' } }),
  JSON.stringify({ name: '@p697/clawket', bin: { clawket: 'dist/other.js' } }),
  JSON.stringify({ name: '@p697/clawket' }),
  ' '.repeat(16_385),
])('rejects an invalid or untrusted package behind an npm link', metadata => {
  const fixture = legacyInstall(); writeFileSync(fixture.metadata, metadata);
  expect(legacyEntryFromCommands(commandLine(fixture.bin, 'codex run'), 'codex')).toBeNull();
});
it('accepts the npm single-bin manifest form but requires readable package metadata', () => {
  const fixture = legacyInstall();
  writeFileSync(fixture.metadata, JSON.stringify({ name: '@p697/clawket', bin: './dist/index.js' }));
  expect(legacyEntryFromCommands(commandLine(fixture.bin, 'codex run'), 'codex')?.entry).toBe(fixture.entry);
  unlinkSync(fixture.metadata);
  expect(legacyEntryFromCommands(commandLine(fixture.bin, 'codex run'), 'codex')).toBeNull();
});
it('captures a legacy npm-link target for rollback before any lifecycle mutation', async () => {
  const fixture = legacyInstall(), configPath = '/saved/runtime.json';
  const ps = vi.mocked(childProcess.execFileSync).mockReturnValueOnce(commandLine(fixture.bin, `codex run --config ${configPath} --foreground`));
  const start = vi.fn(async () => {}), legacyStop = vi.fn(async () => {}), probe = vi.fn(async (_method?: string) => ({}));
  try {
    const input = { backend: 'codex', configPath, probe, start, legacyStop };
    if (process.platform === 'win32') await expect(createUpdateTarget(input)).rejects.toThrow('legacy codex Bridge runtime entry could not be verified');
    else {
      const target = await createUpdateTarget(input);
      expect(target).toMatchObject({ running: true, previousEntry: fixture.entry });
      await target.preflight();
      // The runtime must still answer; no idle proof is required because updates interrupt replies.
      expect(probe).toHaveBeenLastCalledWith();
    }
    expect(start).not.toHaveBeenCalled(); expect(legacyStop).not.toHaveBeenCalled();
  } finally { ps.mockReset(); }
});
it('identifies the failed backend/scope without printing the config path or stopping anything', async () => {
  const configPath = '/private/credential-canary/runtime.json';
  const ps = vi.mocked(childProcess.execFileSync).mockReturnValueOnce('');
  const start = vi.fn(async () => {}), legacyStop = vi.fn(async () => {});
  try {
    await expect(createUpdateTarget({ backend: 'codex', configPath, probe: async () => ({}), start, legacyStop })).rejects.toThrow(/^The legacy codex Bridge runtime entry could not be verified \(selected configuration\)\. Stop that Bridge explicitly, then rerun update\.$/);
    expect(start).not.toHaveBeenCalled(); expect(legacyStop).not.toHaveBeenCalled();
  } finally { ps.mockReset(); }
});
it('fails closed for live and malformed update locks', () => {
  const path = join(homedir(), 'update-test.lock'); acquireUpdateLock(path); expect(existsSync(path)).toBe(true); expect(() => acquireUpdateLock(path)).toThrow('still running'); writeFileSync(path, '{bad'); expect(() => acquireUpdateLock(path)).toThrow('Invalid update lock'); unlinkSync(path);
});

it('stages installs in fresh directories and rejects unsupported packages before runtime mutation', async () => {
  const fakeNpm = join(homedir(), 'npm-cli.js'), record = join(homedir(), 'npm-args.json');
  writeFileSync(fakeNpm, `const fs = require('node:fs'), path = require('node:path'); const args = process.argv.slice(2); fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify(args)); const prefix = args[args.indexOf('--prefix') + 1]; const dir = path.join(prefix, 'node_modules', '@p697', 'clawket'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@p697/clawket', version: '3.1.11' }));`);
  vi.stubEnv('npm_execpath', fakeNpm);
  try { await expect(stageBridgeRelease('3.1.11')).rejects.toThrow('does not support');
    const args = JSON.parse(readFileSync(record, 'utf8')); expect(args).toContain('--ignore-scripts'); expect(args).toContain('--registry=https://registry.npmjs.org'); expect(args).toContain('@p697/clawket@3.1.11');
    expect(existsSync(join(homedir(), '.clawket', 'runtime', 'active.json'))).toBe(false);
  } finally { vi.unstubAllEnvs(); }
});

it('bounds release metadata while reading and never echoes malformed payloads', async () => {
  await expect(readReleaseMetadata(Response.json({ version: '3.1.11' }))).resolves.toEqual({ version: '3.1.11' });
  await expect(readReleaseMetadata(new Response('x'.repeat(128 * 1024 + 1)))).rejects.toThrow(/^Invalid Bridge release metadata\.$/);
  await expect(readReleaseMetadata(new Response('{secret-canary'))).rejects.toThrow(/^Invalid Bridge release metadata\.$/);
});
it('validates supported packages in distinct snapshots without activating either install', async () => {
  const fakeNpm = join(homedir(), 'npm-cli.js');
  writeFileSync(fakeNpm, `const fs = require('node:fs'), path = require('node:path'); const args = process.argv.slice(2); const dir = path.join(args[args.indexOf('--prefix') + 1], 'node_modules', '@p697', 'clawket'); fs.mkdirSync(path.join(dir, 'dist'), { recursive: true }); fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@p697/clawket', version: '3.1.11', clawket: { updateProtocol: 1 } })); fs.writeFileSync(path.join(dir, 'dist', 'index.js'), "console.log('clawket update');");`);
  vi.stubEnv('npm_execpath', fakeNpm);
  try { const first = await stageBridgeRelease('3.1.11'), second = await stageBridgeRelease('3.1.11'); expect(first).not.toBe(second); expect(existsSync(first)).toBe(true); expect(existsSync(second)).toBe(true); expect(existsSync(join(homedir(), '.clawket/runtime/active.json'))).toBe(false); }
  finally { vi.unstubAllEnvs(); }
});
it('describes each runtime outcome in words instead of bare states', () => {
  expect(describeUpdateResult({ backend: 'codex', state: 'failed', reason: 'stop_unverified' })).toBe('codex: needs attention: check it with clawket status');
  expect(describeUpdateResult({ backend: 'openclaw', state: 'failed', reason: 'update_not_applied' })).toBe('openclaw: not changed');
  expect(describeUpdateResult({ backend: 'hermes', state: 'restored', version: '3.1.13' })).toBe('hermes: restarted on 3.1.13');
  expect(describeUpdateResult({ backend: 'pi', state: 'restored', version: 'latest;rm' })).toBe('pi: restarted on its previous installation');
  expect(describeUpdateResult({ backend: 'pi', state: 'failed', reason: 'restore_unverified' })).toBe('pi: needs attention: check it with clawket status');
  expect(describeUpdateResult({ backend: 'codex', state: 'updated' })).toBe('codex: running the updated Bridge');
});
