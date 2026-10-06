import { afterEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { runtimeOwnerPath } from './runtime-owner.js';
import { createUpdateTarget } from './update.js';

// One event-loop turn per poll keeps the test fast while still letting child exits be reaped.
vi.mock('node:timers/promises', () => ({ setTimeout: () => new Promise(resolve => setImmediate(resolve)) }));

const configPath = '/saved/codex/runtime.json';
const oldEntry = '/installed/@p697/clawket/dist/index.js', newEntry = '/release/@p697/clawket/dist/index.js';
const servers: Server[] = [], children: ChildProcess[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const child of children.splice(0)) child.kill();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

type OwnerOptions = { backend?: string; configPath?: string; version?: string; entry?: string; busy?: boolean; laterPid?: number };
/** A real process with a managed owner record; `busy` answers stop like a runtime that is still replying, and
 * `laterPid` makes every `info` after the first name another process. */
async function owner(options: OwnerOptions = {}) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  children.push(child);
  const pid = child.pid!, methods: string[] = [], token = randomBytes(32).toString('hex'), id = randomUUID();
  let infos = 0;
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\clawket-update-${id}` : `/tmp/clawket-update-${id}.sock`;
  const server = createServer(socket => {
    let data = '';
    socket.on('data', chunk => {
      data += chunk.toString(); if (!data.includes('\n')) return;
      const request = JSON.parse(data); methods.push(request.method);
      socket.end(JSON.stringify(request.method === 'info'
        ? { id: request.id, version: options.version ?? '3.1.12', pid: infos++ && options.laterPid ? options.laterPid : pid }
        : { id: request.id, stopped: !options.busy, busy: Boolean(options.busy) }) + '\n');
      if (request.method === 'stop' && !options.busy) child.kill();
    });
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(endpoint, resolve));
  // A dead runtime's endpoint stops answering, exactly like a killed Bridge.
  child.once('exit', () => server.close());
  const backend = options.backend ?? 'codex', scope = 'configPath' in options ? options.configPath : configPath;
  const path = runtimeOwnerPath(backend, scope);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ protocol: 1, pid, token, endpoint, version: options.version ?? '3.1.12', entry: options.entry ?? oldEntry,
    node: process.execPath, backend, ...(scope ? { configPath: scope } : {}) }));
  return { child, methods, path, endpoint };
}
const lifecycle = (stop: () => Promise<void>) => ({ probe: vi.fn(async (_method?: string) => ({})), start: vi.fn(async () => {}), legacyStop: vi.fn(stop) });

it('interrupts a runtime that is still replying instead of waiting for it', async () => {
  const running = await owner({ busy: true }), control = lifecycle(async () => { running.child.kill(); });
  const target = await createUpdateTarget({ backend: 'codex', configPath, ...control });
  await target.preflight();
  await target.stop();
  expect(running.methods.filter(method => method === 'stop')).toHaveLength(1);
  expect(control.legacyStop).toHaveBeenCalledOnce();
  expect(control.probe).not.toHaveBeenCalledWith('sessions.list');
  // The runtime died without releasing its record; nothing it left can pass for an owner.
  expect(existsSync(running.path)).toBe(false);
  if (process.platform !== 'win32') expect(existsSync(running.endpoint)).toBe(false);
});

it('signals a busy owner without a lifecycle stop only after its authenticated reply names that pid', async () => {
  const scope = '/saved/local-model/runtime.json', running = await owner({ backend: 'local-model', configPath: scope, busy: true });
  const target = await createUpdateTarget({ backend: 'local-model', configPath: scope, probe: async () => ({}), start: async () => {} });
  await target.stop();
  expect(running.methods).toEqual(['info', 'stop', 'info']);
  expect(running.child.exitCode !== null || running.child.signalCode !== null).toBe(true);
});

it('falls back to the verified signal when the lifecycle stop is unavailable', async () => {
  const running = await owner({ busy: true }), control = lifecycle(async () => { throw new Error('control unavailable'); });
  const target = await createUpdateTarget({ backend: 'codex', configPath, ...control });
  await target.stop();
  expect(control.legacyStop).toHaveBeenCalledOnce();
  expect(existsSync(running.path)).toBe(false);
});

it('never interrupts a process the authenticated owner does not name', async () => {
  const running = await owner({ busy: true, laterPid: 2 ** 30 }), control = lifecycle(async () => {});
  const kill = vi.spyOn(process, 'kill');
  const target = await createUpdateTarget({ backend: 'codex', configPath, ...control });
  await expect(target.stop()).rejects.toThrow('Invalid Bridge update control response');
  expect(control.legacyStop).not.toHaveBeenCalled();
  expect(kill).not.toHaveBeenCalledWith(running.child.pid, 'SIGTERM');
});

it('judges a replacement by its live record, never by one a killed runtime left behind', async () => {
  const previous = await owner({ version: '3.1.14' }), control = lifecycle(async () => {});
  const target = await createUpdateTarget({ backend: 'codex', configPath, ...control });
  // The old runtime dies before releasing its record, as a repeated service-stop signal did to OpenClaw.
  previous.child.kill(); await once(previous.child, 'exit');
  await target.start(newEntry);
  const verifying = target.verify('3.1.15');
  await new Promise(resolve => setImmediate(resolve));
  await owner({ version: '3.1.15', entry: newEntry });
  await expect(verifying).resolves.toBeUndefined();
});

it('stops an OpenClaw replacement that the service manager started before it registered', async () => {
  const previous = await owner({ backend: 'openclaw', configPath: undefined, version: '3.1.13' });
  const control = lifecycle(async () => { previous.child.kill(); });
  const target = await createUpdateTarget({ backend: 'openclaw', ...control });
  await target.stop();
  await target.start(newEntry);
  await expect(target.stop()).resolves.toBeUndefined();
  expect(control.legacyStop).toHaveBeenCalledTimes(2);
});
