import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  inspectHermesProcess,
  proveClawketHermesGateway,
  recordClawketHermesGateway,
  type HermesGatewayScope,
} from './gateway-process.js';
import { cleanupTempDirectories, createTempDirectory } from './test-helpers.js';

const posix = process.platform !== 'win32';
const standIns: ChildProcess[] = [];

afterEach(async () => {
  for (const child of standIns.splice(0)) child.kill('SIGKILL');
  await cleanupTempDirectories();
});

async function createScope(): Promise<HermesGatewayScope> {
  const root = await createTempDirectory();
  return {
    ownerPath: join(root, 'clawket', 'hermes-gateway-owner.json'),
    apiBaseUrl: 'http://127.0.0.1:8642',
    hermesHomePath: join(root, 'hermes'),
  };
}

/** A real process whose command line reads like `hermes gateway run --replace`. */
async function startGatewayStandIn(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', 'gateway', 'run', '--replace'], {
    stdio: 'ignore',
  });
  standIns.push(child);
  await once(child, 'spawn');
  return child;
}

async function writeRecord(scope: HermesGatewayScope, record: unknown): Promise<void> {
  await mkdir(dirname(scope.ownerPath), { recursive: true });
  await writeFile(scope.ownerPath, typeof record === 'string' ? record : JSON.stringify(record), 'utf8');
}

describe('Clawket-started Hermes gateway evidence', () => {
  it.skipIf(!posix)('records a spawned gateway and proves only that exact live process', async () => {
    const gateway = await startGatewayStandIn();
    const scope = await createScope();

    await expect(recordClawketHermesGateway(scope, gateway.pid!)).resolves.toBe(true);
    expect(JSON.parse(await readFile(scope.ownerPath, 'utf8'))).toEqual({
      version: 1,
      pid: gateway.pid,
      startedAt: expect.stringMatching(/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/),
      apiBaseUrl: scope.apiBaseUrl,
      hermesHomePath: scope.hermesHomePath,
    });
    expect((await stat(scope.ownerPath)).mode & 0o777).toBe(0o600);
    await expect(proveClawketHermesGateway(scope)).resolves.toEqual({ owned: true, pid: gateway.pid });
    await expect(proveClawketHermesGateway({ ...scope, apiBaseUrl: 'http://127.0.0.1:8643' }))
      .resolves.toEqual({ owned: false, reason: 'other_scope' });
    await expect(proveClawketHermesGateway({ ...scope, hermesHomePath: `${scope.hermesHomePath}-profile` }))
      .resolves.toEqual({ owned: false, reason: 'other_scope' });

    gateway.kill('SIGKILL');
    await once(gateway, 'exit');
    await expect(proveClawketHermesGateway(scope)).resolves.toEqual({ owned: false, reason: 'process_changed' });
  });

  it.skipIf(posix)('fails closed where a process start time cannot be read', async () => {
    const gateway = await startGatewayStandIn();
    const scope = await createScope();

    await expect(inspectHermesProcess(gateway.pid!)).resolves.toBeNull();
    await expect(recordClawketHermesGateway(scope, gateway.pid!)).resolves.toBe(false);
    await expect(proveClawketHermesGateway(scope)).resolves.toEqual({ owned: false, reason: 'no_record' });
  });

  it('rejects missing, corrupted, reused-PID and non-gateway evidence', async () => {
    const scope = await createScope();
    const identity = { startedAt: 'Wed Oct 1 01:39:23 2026', command: '/venv/bin/python /opt/hermes gateway run --replace' };
    const record = { version: 1, pid: 4242, startedAt: identity.startedAt, apiBaseUrl: scope.apiBaseUrl, hermesHomePath: scope.hermesHomePath };
    const live = async () => identity;

    await expect(proveClawketHermesGateway(scope, live)).resolves.toEqual({ owned: false, reason: 'no_record' });
    for (const corrupted of ['{"version":1,"pid":', '[]', { ...record, version: 2 }, { ...record, pid: -1 },
      { ...record, pid: 1.5 }, { ...record, startedAt: '' }, { ...record, hermesHomePath: 7 }]) {
      await writeRecord(scope, corrupted);
      await expect(proveClawketHermesGateway(scope, live)).resolves.toEqual({ owned: false, reason: 'invalid_record' });
    }

    await writeRecord(scope, record);
    await expect(proveClawketHermesGateway(scope, async () => null))
      .resolves.toEqual({ owned: false, reason: 'process_changed' });
    await expect(proveClawketHermesGateway(scope, async () => ({ ...identity, startedAt: 'Thu Oct 2 09:00:00 2026' })))
      .resolves.toEqual({ owned: false, reason: 'process_changed' });
    await expect(proveClawketHermesGateway(scope, async () => ({ ...identity, command: 'node server.js --port 8642' })))
      .resolves.toEqual({ owned: false, reason: 'process_changed' });
    await expect(proveClawketHermesGateway(scope, live)).resolves.toEqual({ owned: true, pid: 4242 });
  });

  it('does not record a process that exited or is not a gateway', async () => {
    const scope = await createScope();

    await expect(recordClawketHermesGateway(scope, 4242, async () => null)).resolves.toBe(false);
    await expect(recordClawketHermesGateway(scope, 4242, async () => ({ startedAt: 'Wed Oct 1 01:39:23 2026', command: 'node server.js' })))
      .resolves.toBe(false);
    await expect(readFile(scope.ownerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
