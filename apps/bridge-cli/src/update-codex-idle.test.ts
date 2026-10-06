import { afterEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { runtimeOwnerPath } from './runtime-owner.js';
import { createUpdateTarget } from './update.js';

// One event-loop turn per poll keeps the test fast while still letting child exits be reaped.
vi.mock('node:timers/promises', () => ({ setTimeout: () => new Promise(resolve => setImmediate(resolve)) }));

const configPath = '/saved/codex/runtime.json';
let server: Server | undefined, child: ChildProcess | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  child?.kill(); child = undefined;
  await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve()); server = undefined;
});

/** A published Codex owner whose update admission always answers busy, as 3.1.11–3.1.13 did after one turn. */
async function busyOwner(version: string) {
  child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const pid = child.pid!, methods: string[] = [], token = randomBytes(32).toString('hex'), id = randomUUID();
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\clawket-update-${id}` : `/tmp/clawket-update-${id}.sock`;
  server = createServer(socket => {
    let data = '';
    socket.on('data', chunk => {
      data += chunk.toString(); if (!data.includes('\n')) return;
      const request = JSON.parse(data); methods.push(request.method);
      socket.end(JSON.stringify(request.method === 'info' ? { id: request.id, version, pid } : { id: request.id, stopped: false, busy: true }) + '\n');
    });
  });
  await new Promise<void>(resolve => server!.listen(endpoint, resolve));
  const path = runtimeOwnerPath('codex', configPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ protocol: 1, pid, token, endpoint, version, entry: '/installed/@p697/clawket/dist/index.js', node: process.execPath, backend: 'codex', configPath }));
  return { methods };
}
function lifecycle(active: boolean) {
  return {
    probe: vi.fn(async (method?: string) => method === 'sessions.list' ? [{ hasActiveRun: active }] : {}),
    legacyStop: vi.fn(async () => { child?.kill(); }),
    start: vi.fn(async () => {}),
  };
}

it('stops a Codex owner that only reports busy once its sessions prove idle', async () => {
  const owner = await busyOwner('3.1.12'), control = lifecycle(false);
  const progress = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const target = await createUpdateTarget({ backend: 'codex', configPath, ...control });
  await target.stop();
  expect(control.legacyStop).toHaveBeenCalledOnce();
  expect(control.probe).toHaveBeenCalledWith('sessions.list');
  expect(owner.methods.filter(method => method === 'stop')).toHaveLength(10);
  expect(progress).toHaveBeenCalledWith('clawket-update-progress {"backend":"codex","event":"waiting"}\n');
});

it('keeps waiting while a Codex session is really running and reports it as busy', async () => {
  await busyOwner('3.1.12');
  const control = lifecycle(true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => (now += 5_000));
  const target = await createUpdateTarget({ backend: 'codex', configPath, ...control });
  await expect(target.stop()).rejects.toMatchObject({ code: 'BRIDGE_BUSY' });
  expect(control.legacyStop).not.toHaveBeenCalled();
});

it('never bypasses the admission fence of a Codex version without the known defect', async () => {
  await busyOwner('3.2.0');
  const control = lifecycle(false);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => (now += 5_000));
  const target = await createUpdateTarget({ backend: 'codex', configPath, ...control });
  await expect(target.stop()).rejects.toMatchObject({ code: 'BRIDGE_BUSY' });
  expect(control.probe).not.toHaveBeenCalledWith('sessions.list');
  expect(control.legacyStop).not.toHaveBeenCalled();
});
