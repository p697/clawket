import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface LocalModelLauncher { executable: string; preset: string; baseUrl: string }

/** Start the standard llama.cpp router, never replace a process occupying its port. */
export async function ensureLocalModelRouter(config: LocalModelLauncher, directory: string): Promise<void> {
  const url = new URL(config.baseUrl);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || !['', '/', '/v1'].includes(url.pathname)) {
    throw new Error('A managed model router must use a loopback HTTP URL');
  }
  if (!existsSync(config.executable) || !existsSync(config.preset)) throw new Error('Model server executable or preset does not exist');
  const ready = async () => {
    try {
      const response = await fetch(url.origin + '/models', { signal: AbortSignal.timeout(2000), redirect: 'error' });
      if (!response.ok) throw new Error('The model port is occupied by a different service');
      const body = await response.json() as { data?: { status?: unknown }[] };
      if (!Array.isArray(body.data) || !body.data.length || body.data.some(model => !model.status)) throw new Error('The model port is not a llama.cpp router');
      return true;
    } catch (error) {
      // Only connection refusal proves the port is free; a busy service can time out.
      if (error instanceof TypeError && (error.cause as { code?: string } | undefined)?.code === 'ECONNREFUSED') return false;
      throw error;
    }
  };
  if (await ready()) return;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const out = openSync(join(directory, 'router.stdout.log'), 'a', 0o600);
  const err = openSync(join(directory, 'router.stderr.log'), 'a', 0o600);
  const child = spawn(config.executable, ['--models-preset', config.preset, '--models-max', '1', '--host', '127.0.0.1', '--port', url.port || '80'], {
    cwd: directory, detached: true, windowsHide: true, stdio: ['ignore', out, err],
  });
  closeSync(out); closeSync(err);
  let failure: Error | undefined;
  child.on('error', error => { failure = error; });
  child.unref();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (failure) throw new Error(`Could not start model router: ${failure.message}`);
    if (child.exitCode !== null) throw new Error('Model router exited; see router.stderr.log');
    if (await ready()) {
      writeFileSync(join(directory, 'router-process.json'), JSON.stringify({ pid: child.pid, executable: config.executable, preset: config.preset, baseUrl: url.origin }), { mode: 0o600 });
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Model router did not start; see router.stderr.log');
}
