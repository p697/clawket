import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerRuntimeOwner, readRuntimeOwner, runtimeOwnerPath, queryRuntimeOwner } from './runtime-owner.js';
const releases: (() => Promise<void>)[] = [];
afterEach(async () => { for (const release of releases.splice(0)) await release(); });
it('uses authenticated private IPC, rejects busy stops, and acknowledges a single idle stop', async () => {
  let busy = true; const stop = vi.fn();
  releases.push(await registerRuntimeOwner({ backend: 'codex', configPath: '/test/scope', entry: fileURLToPath(import.meta.url), version: '3.1.11', prepare: () => !busy, stop }));
  const owner = readRuntimeOwner(runtimeOwnerPath('codex', '/test/scope'))!;
  expect(await queryRuntimeOwner(owner, 'info')).toMatchObject({ version: '3.1.11', pid: process.pid });
  if (process.platform !== 'win32') expect(statSync(owner.endpoint).mode & 0o777).toBe(0o600);
  await expect(queryRuntimeOwner({ ...owner, token: '0'.repeat(64) }, 'stop')).rejects.toThrow('without confirmation');
  expect(await queryRuntimeOwner(owner, 'stop')).toMatchObject({ stopped: false, busy: true }); expect(stop).not.toHaveBeenCalled();
  busy = false; expect(await queryRuntimeOwner(owner, 'stop')).toMatchObject({ stopped: true }); expect(stop).toHaveBeenCalledOnce();
  expect(await queryRuntimeOwner(owner, 'stop')).toMatchObject({ stopped: false }); expect(stop).toHaveBeenCalledOnce();
});
it('does not replace a live owner or let old cleanup delete a replacement record', async () => {
  const input = { backend: 'pi', configPath: '/test/pi', entry: fileURLToPath(import.meta.url), version: '3.1.11', prepare: () => true, stop: () => {} };
  const release = await registerRuntimeOwner(input); const path = runtimeOwnerPath('pi', '/test/pi');
  await expect(registerRuntimeOwner(input)).rejects.toThrow('already running');
  const replacement = { ...readRuntimeOwner(path)!, token: '1'.repeat(64) }; writeFileSync(path, JSON.stringify(replacement)); await release(); expect(readRuntimeOwner(path)?.token).toBe(replacement.token);
});
it('rejects malformed owner records with a fixed diagnostic that cannot echo secrets', async () => {
  releases.push(await registerRuntimeOwner({ backend: 'hermes', entry: fileURLToPath(import.meta.url), version: '3.1.11', prepare: () => true, stop: () => {} }));
  const path = runtimeOwnerPath('hermes'), original = readFileSync(path);
  try { writeFileSync(path, '{secret-canary'); expect(() => readRuntimeOwner(path)).toThrow(/^Invalid update owner record\.$/); } finally { writeFileSync(path, original); }
});
