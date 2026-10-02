import { expect, it, vi } from 'vitest';
import { writeFileSync, existsSync, unlinkSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stableBridgeVersion, compareStableVersions, legacyEntryFromCommands, acquireUpdateLock, stageBridgeRelease, readReleaseMetadata } from './update.js';
it('accepts only stable bounded versions and compares patch/minor/major numerically', () => {
  for (const value of ['3.1.11-rc.1', '03.1.1', '3.1', 'latest', '3.1.11;run', '9007199254740992.1.1']) expect(stableBridgeVersion(value)).toBe(false);
  expect(compareStableVersions('3.1.11', '3.1.9')).toBe(1); expect(compareStableVersions('3.2.0', '3.1.99')).toBe(1); expect(compareStableVersions('3.1.10', '3.1.10')).toBe(0);
});
it('accepts only an unambiguous known legacy runtime entry and selected config', () => {
  const line = '123 node /home/.npm/_npx/x/node_modules/@p697/clawket/dist/index.js codex run --config /saved/runtime.json --foreground';
  expect(legacyEntryFromCommands(line, 'codex', '/saved/runtime.json')).toMatchObject({ pid: 123 }); expect(legacyEntryFromCommands(line, 'pi', '/saved/runtime.json')).toBe(null); expect(legacyEntryFromCommands('123 node /arbitrary/index.js codex run', 'codex')).toBe(null); expect(() => legacyEntryFromCommands(`${line}\n${line.replace('123', '124')}`, 'codex')).toThrow('Multiple');
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
