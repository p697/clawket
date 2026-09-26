import { EventEmitter } from 'node:events';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { resolveCodexExecutable } from './executable.js';

export class CodexRpcError extends Error {
  constructor(message: string, readonly outcome: 'rejected' | 'uncertain') { super(message); }
}

/** Owned stdio endpoint: never attach to or terminate the desktop app's process. */
export class CodexRpc extends EventEmitter {
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private sequence = 0;
  private closed = false;
  private ready: Promise<void>;
  constructor(command: string, cwd: string, env = process.env) {
    super();
    const executable = resolveCodexExecutable(command);
    this.child = spawn(executable.command, [...executable.prefix, 'app-server', '--listen', 'stdio://'], { cwd, env, stdio: 'pipe', windowsHide: true });
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    this.child.stdout.on('data', (chunk: Buffer) => {
      buffer += decoder.write(chunk);
      if (Buffer.byteLength(buffer) > 32 * 1024 * 1024) { this.fail(); this.child.kill(); return; }
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        let frame: any;
        try { frame = JSON.parse(line); } catch { this.fail(); this.child.kill(); return; }
        if (!frame || typeof frame !== 'object' || Array.isArray(frame)) { this.fail(); this.child.kill(); return; }
        if (typeof frame.method === 'string') {
          this.emit(frame.id === undefined ? 'notification' : 'request', frame);
        } else {
          const call = this.pending.get(frame.id);
          if (!call) continue;
          clearTimeout(call.timer); this.pending.delete(frame.id);
          if (frame.error) call.reject(new CodexRpcError(`Codex rejected the operation (${Number(frame.error.code) || 'server'}). Check project trust and model configuration on your computer.`, 'rejected'));
          else call.resolve(frame.result);
        }
      }
    });
    this.child.stderr.resume(); // Native stderr can contain user paths and credentials; never forward it.
    this.child.on('error', () => this.fail());
    this.child.on('exit', () => this.fail());
    this.child.stdin.on('error', () => this.fail());
    this.ready = this.call('initialize', { clientInfo: { name: 'clawket', version: '3.1.0' }, capabilities: { experimentalApi: true } }).then(() => { this.write({ method: 'initialized' }); });
    void this.ready.catch(() => {});
  }
  private write(frame: object): void {
    if (this.closed || !this.child.stdin.writable) throw new Error('Codex process is unavailable');
    const text = JSON.stringify(frame) + '\n';
    if (Buffer.byteLength(text) > 8 * 1024 * 1024 || this.child.stdin.writableLength > 8 * 1024 * 1024) throw new Error('Codex request exceeds the transfer limit');
    this.child.stdin.write(text);
  }
  private call(method: string, params: object): Promise<any> {
    if (this.pending.size >= 32) return Promise.reject(new Error('Too many Codex requests'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new CodexRpcError('Codex request timed out; its outcome is unknown. Do not resend automatically.', 'uncertain')); }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async request(method: string, params: object = {}): Promise<any> { await this.ready; return this.call(method, params); }
  respond(id: string | number, result: object): void { this.write({ id, result }); }
  refuse(id: string | number): void { this.write({ id, error: { code: -32601, message: 'Unsupported remote interaction' } }); }
  private fail(): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Codex process disconnected; check your computer before continuing.')); }
    this.pending.clear(); this.emit('closed');
  }
  async stop(): Promise<void> {
    this.fail(); this.child.stdin.end();
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => { this.child.kill('SIGKILL'); resolve(); }, 3000);
      this.child.once('exit', () => { clearTimeout(timeout); resolve(); });
      this.child.kill('SIGTERM');
    });
  }
}
