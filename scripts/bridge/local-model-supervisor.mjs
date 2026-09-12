import { spawn } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const retryDelay = attempts => Math.min(300_000, 30_000 * 2 ** Math.min(Math.max(0, attempts - 1), 4));
export function diagnostic(line) {
  line = line.trim();
  if (line === 'Local model Bridge is running. Keep this process open; press Ctrl+C to stop.') return 'bridge_ready';
  if (line === 'local-model relay transport connected') return 'socket_open';
  if (/^local-model relay transport error(?: code=[A-Z0-9_]{1,40})?$/.test(line)) return 'socket_error';
  if (line === 'local-model relay readiness timeout') return 'readiness_timeout';
  if (line === 'local-model relay ready') return 'relay_ready';
  if (/^local-model relay retry attempt=\d+ delayMs=\d+$/.test(line)) return 'relay_retry';
  if (/^local-model relay closed code=\d{4}$/.test(line)) return 'relay_closed';
  return 'child_output_redacted';
}
function paths(config) {
  const canonical = realpathSync(config);
  const key = createHash('sha256').update(process.platform === 'win32' ? canonical.toLowerCase() : canonical).digest('hex').slice(0, 24);
  const directory = join(dirname(canonical), 'windows-service');
  return { config: canonical, directory, pipe: process.platform === 'win32' ? `\\\\.\\pipe\\clawket-local-model-${key}` : join(directory, 'control.sock') };
}
export async function control(config, action) {
  const p = paths(config);
  const token = JSON.parse(readFileSync(join(p.directory, 'control.json'), 'utf8')).token;
  return new Promise((resolveResult, reject) => {
    const socket = connect(p.pipe);
    let data = '';
    socket.setTimeout(3000, () => socket.destroy(new Error('Control timeout')));
    socket.on('connect', () => socket.write(JSON.stringify({ action, token }) + '\n'));
    socket.on('data', chunk => { data += chunk; if (data.length > 4096) socket.destroy(new Error('Invalid control response')); });
    socket.on('end', () => { try { resolveResult(JSON.parse(data)); } catch { reject(new Error('Invalid control response')); } });
    socket.on('error', reject);
  });
}
export async function supervise(config) {
  const p = paths(config);
  mkdirSync(p.directory, { recursive: true, mode: 0o700 });
  const manifest = JSON.parse(readFileSync(join(p.directory, 'installation.json'), 'utf8'));
  if (realpathSync(manifest.config) !== p.config) throw new Error('Installation config mismatch');
  const token = randomBytes(32).toString('hex');
  let child = null, retry = null, stopping = false, attempts = 0, ready = false;
  let stopDeadline = null;
  const log = (event, fields = {}) => {
    const file = join(p.directory, 'supervisor.jsonl');
    if (existsSync(file) && statSync(file).size > 1024 * 1024) renameSync(file, file + '.previous');
    appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), event, ...fields }) + '\n', { mode: 0o600 });
  };
  const server = createServer(socket => {
    let input = '';
    socket.setTimeout(3000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', chunk => {
      input += chunk;
      if (input.length > 1024) { socket.destroy(); return; }
      if (!input.includes('\n')) return;
      try {
        const request = JSON.parse(input);
        if (request.token !== token) { socket.destroy(); return; }
        socket.end(JSON.stringify({ pid: process.pid, childPid: child?.pid ?? null, ready, stopping, attempts }));
        if (request.action === 'stop') stop();
      } catch { socket.destroy(); }
    });
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(p.pipe, yes); });
  // The exclusive pipe is acquired before publishing control state or spawning.
  writeFileSync(join(p.directory, 'control.json'), JSON.stringify({ token }), { mode: 0o600 });
  const finished = () => { if (stopDeadline) clearTimeout(stopDeadline); server.close(); log('supervisor_stopped'); };
  function stop() {
    if (stopping) return;
    stopping = true; ready = false;
    if (retry) clearTimeout(retry); retry = null;
    log('stop_requested');
    if (!child) { finished(); return; }
    const owned = child;
    if (owned.connected) owned.send({ type: 'clawket.local-model.stop' }, () => {});
    stopDeadline = setTimeout(() => { if (child === owned) owned.kill(); }, 10_000);
  }
  function launch() {
    retry = null;
    if (stopping) return;
    ready = false;
    const owned = spawn(manifest.node, [manifest.cli, 'local-model', 'run', '--config', p.config], {
      cwd: p.directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    child = owned; log('child_started', { pid: owned.pid });
    for (const stream of [owned.stdout, owned.stderr]) {
      let buffer = '';
      stream.on('data', chunk => {
        if (child !== owned || stopping) return;
        buffer += chunk.toString();
        for (let end; (end = buffer.indexOf('\n')) >= 0;) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          const event = diagnostic(line);
          // Neither arbitrary child output nor configuration is written to logs.
          if (event === 'bridge_ready' && stream === owned.stdout) { ready = true; attempts = 0; }
          if (event === 'relay_closed') ready = false;
          if (event === 'relay_ready') ready = true;
          const closed = /^local-model relay closed code=(\d{4})$/.exec(line.trim());
          const retrying = /^local-model relay retry attempt=(\d+) delayMs=(\d+)$/.exec(line.trim());
          const error = /^local-model relay transport error code=([A-Z0-9_]{1,40})$/.exec(line.trim());
          if (event !== 'child_output_redacted') log(event, closed ? { code: Number(closed[1]) }
            : retrying ? { attempt: Number(retrying[1]), delayMs: Number(retrying[2]) } : error ? { code: error[1] } : {});
        }
        if (buffer.length > 4096) buffer = '';
      });
    }
    owned.on('error', () => log('child_spawn_error'));
    owned.on('close', code => {
      if (child !== owned) return;
      child = null; ready = false; log('child_exited', { code });
      if (stopping) { finished(); return; }
      const delayMs = retryDelay(++attempts);
      log('child_retry', { attempts, delayMs });
      retry = setTimeout(launch, delayMs);
    });
  }
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  log('supervisor_started', { pid: process.pid }); launch();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, config] = process.argv.slice(2);
  try {
    if (!config) throw new Error('Config required');
    if (action === 'run') await supervise(config);
    else if (action === 'start') {
      try { console.log(JSON.stringify(await control(config, 'status'))); }
      catch {
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'run', resolve(config)], { detached: true, windowsHide: true, stdio: 'ignore' });
        child.unref(); console.log('Background start requested');
      }
    } else if (action === 'status' || action === 'stop') console.log(JSON.stringify(await control(config, action)));
    else throw new Error('Unsupported action');
  } catch (error) {
    console.error(error?.code === 'EADDRINUSE' ? 'Supervisor already running' : 'Supervisor unavailable; check installation and supervisor.jsonl');
    process.exitCode = 1;
  }
}
