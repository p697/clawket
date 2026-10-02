import { afterEach, expect, it } from 'vitest';
import { build } from 'esbuild';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { readRuntimeOwner, runtimeOwnerPath, queryRuntimeOwner } from './runtime-owner.js';
import { createUpdateTarget } from './update.js';
import { activateUpdate } from './update-transaction.js';
const children: ChildProcess[] = [];
afterEach(async () => { for (const child of children.splice(0)) if (child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); } });
it.each(['codex', 'openclaw'])('replaces a real %s process and retains exact config/history bytes', async backend => {
  const directory = join(homedir(), 'process-smoke-' + backend); mkdirSync(directory);
  const config = join(directory, 'runtime.json'), history = join(directory, 'history.json');
  writeFileSync(config, '{"identity":"existing","credential":"test-canary"}'); writeFileSync(history, 'saved-history');
  const entry = fileURLToPath(new URL('./runtime-owner.ts', import.meta.url));
  const worker = async (name: string, version: string) => {
    const outfile = join(directory, name + '.mjs');
    await build({ stdin: { contents: `import { registerRuntimeOwner } from ${JSON.stringify(entry)};
      const interval = setInterval(() => {}, 1000);
      const release = await registerRuntimeOwner({ backend: ${JSON.stringify(backend)}, configPath: ${JSON.stringify(config)}, version: ${JSON.stringify(version)}, prepare: () => true, stop: () => process.emit('SIGTERM') });
      process.once('SIGTERM', async () => { clearInterval(interval); await release(); process.exit(0); });`, resolveDir: directory }, outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
    return realpathSync(outfile);
  };
  const oldEntry = await worker('old', '3.1.10'), newEntry = await worker('new', '3.1.11');
  const start = async (path: string) => {
    const child = spawn(process.execPath, [path], { env: { ...process.env, HOME: homedir(), USERPROFILE: homedir() }, stdio: 'ignore' }); children.push(child);
    for (let i = 0; i < 100; i++) { const owner = readRuntimeOwner(runtimeOwnerPath(backend, config)); if (owner?.entry === path) { await queryRuntimeOwner(owner, 'info'); return; } if (child.exitCode !== null) throw new Error('Worker exited'); await delay(20); }
    throw new Error('Worker did not become ready');
  };
  await start(oldEntry); const old = readRuntimeOwner(runtimeOwnerPath(backend, config))!;
  const target = await createUpdateTarget({ backend, configPath: config, probe: async () => { const owner = readRuntimeOwner(runtimeOwnerPath(backend, config)); if (!owner) throw Object.assign(new Error(), { code: 'ECONNREFUSED' }); return queryRuntimeOwner(owner, 'info'); }, start, legacyStop: async () => { await queryRuntimeOwner(readRuntimeOwner(runtimeOwnerPath(backend, config))!, 'stop'); } });
  expect(await activateUpdate([target], newEntry, '3.1.11')).toEqual([{ backend, state: 'updated' }]);
  const next = readRuntimeOwner(runtimeOwnerPath(backend, config))!; expect(next.pid).not.toBe(old.pid); expect(next.version).toBe('3.1.11'); expect(children[0].exitCode).toBe(0);
  expect(readFileSync(config, 'utf8')).toBe('{"identity":"existing","credential":"test-canary"}'); expect(readFileSync(history, 'utf8')).toBe('saved-history');
}, 15_000);
