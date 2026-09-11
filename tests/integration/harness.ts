import { createServer } from 'node:net';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Failed to resolve free port'));
        return;
      }
      const port = addr.port;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    server.on('error', reject);
  });
}

export class WranglerDevProcess {
  private readonly cwd: string;
  private readonly configPath: string;
  private readonly port: number;
  private readonly envFilePath: string;
  private readonly persistencePath: string;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private logs = '';

  private constructor(
    cwd: string,
    configPath: string,
    port: number,
    envFilePath: string,
    persistencePath: string,
  ) {
    this.cwd = cwd;
    this.configPath = configPath;
    this.port = port;
    this.envFilePath = envFilePath;
    this.persistencePath = persistencePath;
  }

  static async start(params: {
    cwd: string;
    configPath: string;
    port: number;
    persistencePath?: string;
    envVars?: Record<string, string>;
  }): Promise<WranglerDevProcess> {
    const tempDir = await mkdtemp(join(tmpdir(), 'clawket-relay-it-'));
    const envFilePath = join(tempDir, '.env.test');
    const envLines = Object.entries(params.envVars ?? {})
      .map(([k, v]) => `${k}=${v.replace(/\n/g, '\\n')}`)
      .join('\n');
    await writeFile(envFilePath, envLines, 'utf8');

    const runner = new WranglerDevProcess(
      params.cwd,
      params.configPath,
      params.port,
      envFilePath,
      params.persistencePath ?? join(tempDir, 'state'),
    );
    await runner.boot();
    return runner;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async stop(): Promise<void> {
    const proc = this.proc;
    this.proc = null;

    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL');
          resolve();
        }, 2_000);
        proc.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    try {
      await rm(this.envFilePath, { force: true });
      await rm(join(this.envFilePath, '..'), { force: true, recursive: true });
    } catch {
      // best effort cleanup
    }
  }

  private async boot(): Promise<void> {
    const args = [
      join(this.cwd, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
      'dev',
      '--config',
      this.configPath,
      '--cwd',
      this.cwd,
      '--port',
      String(this.port),
      '--ip',
      '127.0.0.1',
      '--local',
      '--persist-to',
      this.persistencePath,
      '--log-level',
      'error',
      '--show-interactive-dev-session',
      'false',
      '--env-file',
      this.envFilePath,
    ];

    this.proc = spawn(process.execPath, args, {
      windowsHide: true,
      cwd: this.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.proc.stdout.on('data', (buf) => {
      this.logs += buf.toString('utf8');
    });
    this.proc.stderr.on('data', (buf) => {
      this.logs += buf.toString('utf8');
    });

    const timeoutAt = Date.now() + 25_000;
    while (Date.now() < timeoutAt) {
      if (this.proc.exitCode != null) {
        throw new Error(`wrangler dev exited early (${this.proc.exitCode})\n${this.logs}`);
      }
      try {
        const health = await fetch(`${this.baseUrl}/v1/health`);
        if (health.ok || health.status === 404) return;
      } catch {
        // retry
      }
      await sleep(250);
    }

    throw new Error(`wrangler dev did not start in time\n${this.logs}`);
  }
}

export async function runWrangler(args: string[], cwd: string): Promise<string> {
  const proc = spawn('npx', ['wrangler', ...args], {
    cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  proc.stdout.on('data', (buf) => {
    output += buf.toString('utf8');
  });
  proc.stderr.on('data', (buf) => {
    output += buf.toString('utf8');
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    proc.once('error', reject);
    proc.once('exit', (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    throw new Error(`wrangler ${args.join(' ')} failed (${exitCode})\n${output}`);
  }

  return output;
}

export async function waitForMessage(ws: WebSocket, timeoutMs = 5_000): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for websocket message'));
    }, timeoutMs);

    const onMessage = (event: MessageEvent) => {
      cleanup();
      if (typeof event.data === 'string') resolve(event.data);
      else if (event.data instanceof ArrayBuffer) resolve(new TextDecoder().decode(event.data));
      else resolve(String(event.data));
    };

    const onError = () => {
      cleanup();
      reject(new Error('WebSocket error while waiting for message'));
    };

    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('error', onError);
    };

    ws.addEventListener('message', onMessage);
    ws.addEventListener('error', onError);
  });
}

export async function openWebSocket(url: string, timeoutMs = 5_000): Promise<WebSocket> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out opening websocket: ${url}`));
    }, timeoutMs);

    const onOpen = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error(`WebSocket open failed: ${url}`));
    };

    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('error', onError);
    };

    ws.addEventListener('open', onOpen);
    ws.addEventListener('error', onError);
  });
  return ws;
}

export function closeWebSocket(ws: WebSocket): void {
  try {
    ws.close();
  } catch {
    // ignore
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
