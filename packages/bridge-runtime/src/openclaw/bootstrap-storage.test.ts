import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { issueLegacyOpenClawBootstrapToken } from '../openclaw.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function setup(sql: string) {
  const root = await mkdtemp(join(tmpdir(), 'clawket-bootstrap-store-'));
  roots.push(root);
  await mkdir(join(root, 'state'));
  await mkdir(join(root, 'devices'));
  const file = join(root, 'state', 'openclaw.sqlite');
  const db = new DatabaseSync(file);
  db.exec(sql);
  db.close();
  await writeFile(join(root, 'devices', 'bootstrap.json'), '{}\n');
  return { root, file };
}

const request = { deviceId: 'device', publicKey: 'public-key', role: 'operator', scopes: ['operator.read'] };

it('rejects legacy issuance after SQLite migration without changing either store', async () => {
  const { root, file } = await setup('CREATE TABLE device_bootstrap_tokens (token TEXT); INSERT INTO device_bootstrap_tokens VALUES (\'existing\')');
  const before = await readFile(file);
  await expect(issueLegacyOpenClawBootstrapToken({ ...request, stateDir: root })).rejects.toThrow('legacy bootstrap');
  expect(await readFile(file)).toEqual(before);
  expect(await readFile(join(root, 'devices', 'bootstrap.json'), 'utf8')).toBe('{}\n');
});

it('keeps legacy issuance when an unrelated SQLite database has no bootstrap table', async () => {
  const { root, file } = await setup('CREATE TABLE unrelated (id TEXT)');
  const before = await readFile(file);
  const issued = await issueLegacyOpenClawBootstrapToken({ ...request, stateDir: root });
  expect(issued.strategy).toBe('legacy-bound');
  expect(JSON.parse(await readFile(join(root, 'devices', 'bootstrap.json'), 'utf8'))[issued.token].deviceId).toBe('device');
  expect(await readFile(file)).toEqual(before);
});

it('fails closed on an unreadable database rather than issuing an unverified token', async () => {
  const { root, file } = await setup('CREATE TABLE unrelated (id TEXT)');
  await writeFile(file, 'corrupt database');
  await expect(issueLegacyOpenClawBootstrapToken({ ...request, stateDir: root })).rejects.toThrow();
  expect(await readFile(join(root, 'devices', 'bootstrap.json'), 'utf8')).toBe('{}\n');
});
