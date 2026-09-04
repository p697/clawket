import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket, { WebSocketServer, type RawData } from 'ws';

export type CompatWranglerDevParams = {
  cwd: string;
  configPath: string;
  port: number;
  inspectorPort: number;
  envVars?: Record<string, string>;
};

export class CompatWranglerDevProcess {
  private process: ChildProcessWithoutNullStreams | null = null;
  private logs = '';

  private constructor(
    private readonly cwd: string,
    private readonly configPath: string,
    private readonly port: number,
    private readonly inspectorPort: number,
    private readonly tempDirectory: string,
    private readonly envFilePath: string,
  ) {}

  static async start(params: CompatWranglerDevParams): Promise<CompatWranglerDevProcess> {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'clawket-compat-wrangler-'));
    const envFilePath = join(tempDirectory, '.env.test');
    await writeFile(
      envFilePath,
      Object.entries(params.envVars ?? {}).map(([key, value]) => `${key}=${value.replace(/\n/g, '\\n')}`).join('\n'),
      'utf8',
    );
    const runner = new CompatWranglerDevProcess(
      params.cwd,
      params.configPath,
      params.port,
      params.inspectorPort,
      tempDirectory,
      envFilePath,
    );
    try {
      await runner.startProcess();
      return runner;
    } catch (error) {
      await runner.stop();
      throw error;
    }
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  get output(): string {
    return sanitizeProcessLogs(this.logs);
  }

  async stop(): Promise<void> {
    const child = this.process;
    this.process = null;
    if (child && child.exitCode == null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise<void>((resolve) => child.once('exit', () => resolve())),
        delay(2_000).then(() => {
          if (child.exitCode == null) child.kill('SIGKILL');
        }),
      ]);
    }
    await rm(this.tempDirectory, { recursive: true, force: true });
  }

  private async startProcess(): Promise<void> {
    const wranglerEntrypoint = join(this.cwd, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
    if (!existsSync(wranglerEntrypoint)) {
      throw new Error(`Locked Wrangler entrypoint is missing: ${wranglerEntrypoint}`);
    }
    this.process = spawn(process.execPath, [
      wranglerEntrypoint,
      'dev',
      '--config', this.configPath,
      '--cwd', this.cwd,
      '--port', String(this.port),
      '--ip', '127.0.0.1',
      '--inspector-port', String(this.inspectorPort),
      '--inspector-ip', '127.0.0.1',
      '--local',
      '--persist-to', join(this.tempDirectory, 'state'),
      '--log-level', 'log',
      '--show-interactive-dev-session', 'false',
      '--env-file', this.envFilePath,
    ], {
      cwd: this.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.process.stdout.on('data', (data) => { this.logs += data.toString('utf8'); });
    this.process.stderr.on('data', (data) => { this.logs += data.toString('utf8'); });

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (this.process.exitCode != null) {
        throw new Error(`wrangler dev exited early (${this.process.exitCode})\n${this.logs}`);
      }
      try {
        const health = await fetch(`${this.baseUrl}/v1/health`);
        if (health.ok || health.status === 404) return;
      } catch {
        // Continue until the process is listening.
      }
      await delay(100);
    }
    throw new Error(`wrangler dev did not start in time\n${this.logs}`);
  }
}

export async function startCompatWranglerDevProcesses(
  params: readonly CompatWranglerDevParams[],
): Promise<CompatWranglerDevProcess[]> {
  const settled = await Promise.allSettled(params.map((entry) => CompatWranglerDevProcess.start(entry)));
  const started = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  const failure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (!failure) return started;
  await Promise.allSettled(started.map((process) => process.stop()));
  throw failure.reason;
}

export class WebSocketInbox {
  readonly received: string[] = [];
  private readonly closeResult: Promise<{ code: number; reason: string }>;

  constructor(readonly socket: WebSocket) {
    socket.on('message', (data: RawData, isBinary: boolean) => {
      if (!isBinary) this.received.push(toText(data));
    });
    this.closeResult = new Promise((resolve) => {
      socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });
  }

  async nextJson(
    predicate: (value: Record<string, unknown>) => boolean = () => true,
    timeoutMs = 10_000,
  ): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (let index = 0; index < this.received.length; index += 1) {
        const parsed = parseJson(this.received[index]);
        if (!parsed || !predicate(parsed)) continue;
        this.received.splice(index, 1);
        return parsed;
      }
      await delay(10);
    }
    throw new Error(`Timed out waiting for websocket JSON. Buffered frames: ${summarizeFrames(this.received)}`);
  }

  async nextText(predicate: (value: string) => boolean, timeoutMs = 10_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const index = this.received.findIndex(predicate);
      if (index >= 0) return this.received.splice(index, 1)[0];
      await delay(10);
    }
    throw new Error(`Timed out waiting for websocket text. Buffered frames: ${summarizeFrames(this.received)}`);
  }

  async waitForClose(timeoutMs = 10_000): Promise<{ code: number; reason: string }> {
    return Promise.race([
      this.closeResult,
      delay(timeoutMs).then(() => {
        const internals = this.socket as WebSocket & {
          _closeCode?: number;
          _closeFrameReceived?: boolean;
          _closeFrameSent?: boolean;
          _closeMessage?: Buffer;
        };
        throw new Error(
          `Timed out waiting for websocket close (readyState=${this.socket.readyState}, `
          + `closeCode=${internals._closeCode ?? '<unset>'}, `
          + `closeReason=${internals._closeMessage?.toString() || '<unset>'}, `
          + `closeReceived=${String(internals._closeFrameReceived)}, `
          + `closeSent=${String(internals._closeFrameSent)}, `
          + `buffered=${summarizeFrames(this.received) || '<empty>'}).`,
        );
      }),
    ]);
  }

  /**
   * Miniflare can leave a Node `ws` peer in CLOSING after both close frames
   * were exchanged. Observe the exact received frame before terminating that
   * stuck local transport; never synthesize a close from an OPEN socket.
   */
  async waitForCloseFrameWithMiniflareWorkaround(
    timeoutMs = 10_000,
  ): Promise<{ code: number; reason: string }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.socket.readyState === WebSocket.CLOSED) return this.closeResult;
      const internals = this.socket as WebSocket & {
        _closeCode?: number;
        _closeFrameReceived?: boolean;
        _closeFrameSent?: boolean;
        _closeMessage?: Buffer;
      };
      if (this.socket.readyState === WebSocket.CLOSING
        && internals._closeFrameReceived === true
        && internals._closeFrameSent === true
        && typeof internals._closeCode === 'number') {
        const received = {
          code: internals._closeCode,
          reason: internals._closeMessage?.toString() ?? '',
        };
        this.socket.terminate();
        await Promise.race([this.closeResult, delay(1_000)]);
        return received;
      }
      await delay(10);
    }
    return this.waitForClose(1);
  }
}

export async function openWebSocket(url: string, options?: { headers?: Record<string, string> }): Promise<WebSocketInbox> {
  const socket = new WebSocket(url, options);
  const inbox = new WebSocketInbox(socket);
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('open', onOpen);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = (code: number, reason: Buffer) => {
      cleanup();
      reject(new Error(
        `Websocket closed before open (${code} ${reason.toString() || '<no reason>'}) ${redactUrl(url)}`,
      ));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out opening websocket ${redactUrl(url)}`));
    }, 10_000);
    socket.once('open', onOpen);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
  return inbox;
}

export async function startWebSocketServer(
  port: number,
  onConnection: (socket: WebSocket) => void,
): Promise<WebSocketServer> {
  const server = new WebSocketServer({ host: '127.0.0.1', port, maxPayload: 25 * 1024 * 1024 });
  server.on('connection', onConnection);
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return server;
}

export async function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  for (const client of server.clients) {
    try {
      client.terminate();
    } catch {
      // Best-effort test cleanup.
    }
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

export function closeWebSocket(inbox: WebSocketInbox): void {
  try {
    inbox.socket.close(1000, 'compat_test_complete');
  } catch {
    // Best-effort test cleanup.
  }
}

export async function waitFor(
  predicate: () => boolean,
  message: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(20);
  }
  throw new Error(message);
}

export function wsUrl(base: string, query: Record<string, string>): string {
  const url = new URL(base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : url.protocol === 'http:' ? 'ws:' : url.protocol;
  if (!url.pathname || url.pathname === '/') url.pathname = '/ws';
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}

export function parseJson(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toText(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

function summarizeFrames(frames: readonly string[]): string {
  return frames.slice(0, 8).map((frame) => frame.length > 240 ? `${frame.slice(0, 237)}...` : frame).join(' | ');
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.searchParams.has('token')) url.searchParams.set('token', '<redacted>');
    return url.toString();
  } catch {
    return '<invalid-url>';
  }
}

function sanitizeProcessLogs(value: string): string {
  return value
    .replace(/([?&]token=)[^&\s"']+/gi, '$1<redacted>')
    .replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,"']+/gi, '$1<redacted>')
    .replace(/(relaySecret|clientToken|accessCode)(["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1$2<redacted>');
}
