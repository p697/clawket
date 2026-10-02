import { createServer, createConnection, type Socket } from 'node:net';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { readCliVersion } from './metadata.js';

export type RuntimeOwner = {
  protocol: 1; pid: number; token: string; endpoint: string; version: string;
  entry: string; node: string; backend: string; configPath?: string; port?: number;
};
const root = () => join(homedir(), '.clawket', 'update-owners');
export function runtimeOwnerPath(backend: string, configPath?: string): string {
  const key = createHash('sha256').update(configPath ?? backend).digest('hex').slice(0, 24);
  return join(root(), `${backend}-${key}.json`);
}
export function readRuntimeOwner(path: string): RuntimeOwner | null {
  if (!existsSync(path)) return null;
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 16_384) throw new Error('Invalid update owner record. Inspect local Bridge state.');
  let value: RuntimeOwner;
  try { value = JSON.parse(readFileSync(path, 'utf8')) as RuntimeOwner; } catch { throw new Error('Invalid update owner record.'); }
  if (!value || typeof value !== 'object') throw new Error('Invalid update owner record.');
  if (value.protocol !== 1 || !Number.isInteger(value.pid) || value.pid <= 0 || !/^[a-f0-9]{64}$/.test(value.token)
    || typeof value.endpoint !== 'string' || !/^(?:\\\\\.\\pipe\\clawket-update-|\/.*\/clawket-update-)[a-f0-9-]{36}(?:\.sock)?$/.test(value.endpoint)
    || typeof value.version !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(value.version)
    || !['openclaw', 'hermes', 'hermes-relay', 'codex', 'claude-code', 'pi', 'local-model'].includes(value.backend)
    || typeof value.entry !== 'string' || typeof value.node !== 'string'
    || (value.configPath !== undefined && typeof value.configPath !== 'string')
    || (value.port !== undefined && (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535))) throw new Error('Invalid update owner record.');
  return value;
}

/** Private per-process endpoint, never exposed through Relay or a phone RPC. */
export async function registerRuntimeOwner(input: {
  backend: string; configPath?: string; prepare: () => boolean; stop: () => void;
  entry?: string; node?: string; version?: string; port?: number;
}): Promise<() => Promise<void>> {
  const path = runtimeOwnerPath(input.backend, input.configPath);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const previous = readRuntimeOwner(path);
  if (previous) {
    try { process.kill(previous.pid, 0); throw new Error('An update owner is already running at this scope.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  }
  const id = randomUUID();
  // Keep Unix socket paths below macOS's 104-byte limit, independently of HOME length.
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\clawket-update-${id}` : `/tmp/clawket-update-${id}.sock`;
  const owner: RuntimeOwner = { protocol: 1, pid: process.pid, token: randomBytes(32).toString('hex'), endpoint,
    backend: input.backend, configPath: input.configPath, port: input.port, entry: realpathSync(input.entry ?? process.argv[1]),
    node: input.node ?? process.execPath, version: input.version ?? readCliVersion() };
  const clients = new Set<Socket>();
  let stopping = false;
  const server = createServer(socket => {
    if (clients.size >= 8) { socket.destroy(); return; }
    clients.add(socket); socket.setTimeout(5000, () => socket.destroy());
    socket.on('error', () => {}); socket.once('close', () => clients.delete(socket));
    let data = '';
    socket.on('data', chunk => {
      data += chunk.toString();
      if (Buffer.byteLength(data) > 4096) { socket.destroy(); return; }
      if (!data.includes('\n')) return;
      socket.removeAllListeners('data');
      try {
        const request = JSON.parse(data) as { token?: unknown; id?: unknown; method?: unknown };
        const token = typeof request.token === 'string' ? Buffer.from(request.token) : Buffer.alloc(0);
        if (token.length !== 64 || !timingSafeEqual(token, Buffer.from(owner.token)) || typeof request.id !== 'string') { socket.destroy(); return; }
        if (request.method === 'info') socket.end(JSON.stringify({ id: request.id, version: owner.version, pid: owner.pid }) + '\n');
        else if (request.method === 'stop') {
          const ready = !stopping && input.prepare();
          if (ready) stopping = true;
          socket.end(JSON.stringify({ id: request.id, stopped: ready, busy: !ready }) + '\n', () => { if (ready) input.stop(); });
        } else socket.destroy();
      } catch { socket.destroy(); }
    });
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(endpoint, resolve); });
    if (process.platform !== 'win32') chmodSync(endpoint, 0o600);
    writeFileSync(path + '.' + id, JSON.stringify(owner), { mode: 0o600 });
    renameSync(path + '.' + id, path);
  } catch (error) { if (existsSync(path + '.' + id)) unlinkSync(path + '.' + id); server.close(); if (process.platform !== 'win32' && existsSync(endpoint)) unlinkSync(endpoint); throw error; }
  return async () => {
    for (const client of clients) client.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (readRuntimeOwner(path)?.token === owner.token) unlinkSync(path);
  };
}

export function queryRuntimeOwner(owner: RuntimeOwner, method: 'info' | 'stop'): Promise<{ version?: string; pid?: number; stopped?: boolean; busy?: boolean }> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const socket = createConnection(owner.endpoint);
    let data = '', settled = false;
    const finish = (error?: Error, result?: object) => {
      if (settled) return; settled = true; clearTimeout(timer); socket.destroy();
      error ? reject(error) : resolve(result!);
    };
    const timer = setTimeout(() => finish(new Error('Bridge update control timed out. No replacement was authorized.')), 5000);
    socket.on('error', error => finish(Object.assign(new Error('Bridge update control is unavailable.'), { code: (error as NodeJS.ErrnoException).code })));
    socket.on('connect', () => socket.write(JSON.stringify({ id, token: owner.token, method }) + '\n'));
    socket.on('data', chunk => {
      data += chunk.toString();
      if (Buffer.byteLength(data) > 4096) { finish(new Error('Invalid Bridge update control response.')); return; }
      if (!data.includes('\n')) return;
      try {
        const result = JSON.parse(data);
        if (result.id !== id || (method === 'info' && (result.pid !== owner.pid || result.version !== owner.version))
          || (method === 'stop' && (typeof result.stopped !== 'boolean' || result.busy !== !result.stopped))) throw new Error();
        finish(undefined, result);
      } catch { finish(new Error('Invalid Bridge update control response.')); }
    });
    socket.on('end', () => { if (!settled) finish(new Error('Bridge update control ended without confirmation.')); });
  });
}
