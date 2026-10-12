import { EventEmitter } from 'node:events';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { resolveCodexExecutable } from './executable.js';

export class CodexRpcError extends Error {
  constructor(message: string, readonly outcome: 'rejected' | 'uncertain', readonly code?: 'frame_too_large' | 'native_writer_busy') { super(message); }
}

export type CodexRpcDiagnostic = Readonly<{
  reason: 'native_spawn_error' | 'native_exit' | 'native_write_error' | 'frame_too_large' | 'invalid_frame' | 'request_timeout' | 'workspace_requirements_unavailable' | 'stopped';
  pendingCount: number;
  frameBytes?: number;
}>;

/** Owned stdio endpoint: never attach to or terminate the desktop app's process. */
export class CodexRpc extends EventEmitter {
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private sequence = 0;
  private closed = false;
  private ready: Promise<void>;
  nativeVersion?: string;
  constructor(command: string, cwd: string, env = process.env) {
    super();
    const executable = resolveCodexExecutable(command);
    this.child = spawn(executable.command, [...executable.prefix, 'app-server', '--listen', 'stdio://'], { cwd, env, stdio: 'pipe', windowsHide: true });
    const decoder = new StringDecoder('utf8');
    let buffer = '', bufferedBytes = 0, discarding = false;
    this.child.stdout.on('data', (chunk: Buffer) => {
      if (this.closed) return;
      const text = decoder.write(chunk);
      let start = 0;
      while (start < text.length) {
        const end = text.indexOf('\n', start);
        const part = text.slice(start, end < 0 ? undefined : end);
        if (!discarding) {
          bufferedBytes += Buffer.byteLength(part);
          if (bufferedBytes > 32 * 1024 * 1024) {
            this.diagnose('frame_too_large', bufferedBytes);
            // A large history/tool frame must not kill an unrelated running native task.
            // Its request identity may be outside the retained prefix; all pending outcomes
            // stay uncertain. Drain to the next newline, then continue the same native process.
            for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new CodexRpcError('Codex response exceeds the transfer limit; its outcome is unknown. Refresh history before continuing.', 'uncertain', 'frame_too_large')); }
            this.pending.clear(); this.emit('gap'); buffer = ''; discarding = true;
          } else buffer += part;
        }
        if (end < 0) return;
        const line = buffer; buffer = ''; bufferedBytes = 0;
        start = end + 1;
        if (discarding) { discarding = false; continue; }
        if (!line.trim()) continue;
        let frame: any;
        try { frame = JSON.parse(line); } catch { this.fail('invalid_frame', Buffer.byteLength(line)); this.child.kill(); return; }
        if (!frame || typeof frame !== 'object' || Array.isArray(frame)) { this.fail('invalid_frame', Buffer.byteLength(line)); this.child.kill(); return; }
        if (typeof frame.method === 'string') {
          this.emit(frame.id === undefined ? 'notification' : 'request', frame);
        } else {
          const call = this.pending.get(frame.id);
          if (!call) continue;
          clearTimeout(call.timer); this.pending.delete(frame.id);
          if (frame.error) {
            // Exact native category only: never log its error text or recycle a
            // live writer merely because a read-only health request was rejected.
            if (frame.error.code === -32603 && frame.error.message === 'failed to load workspace requirements') {
              this.diagnose('workspace_requirements_unavailable');
            }
            const busy = typeof frame.error.message === 'string' && /thread [a-f0-9-]{36} already has an active writer/.test(frame.error.message);
            call.reject(new CodexRpcError(busy ? 'This conversation is controlled by another Codex process. Continue there or release it before trying again.' : `Codex rejected the operation (${Number(frame.error.code) || 'server'}). Check project trust and model configuration on your computer.`, 'rejected', busy ? 'native_writer_busy' : undefined));
          }
          else call.resolve(frame.result);
        }
      }
    });
    this.child.stderr.resume(); // Native stderr can contain user paths and credentials; never forward it.
    this.child.on('error', () => this.fail('native_spawn_error'));
    this.child.on('exit', () => this.fail('native_exit'));
    this.child.stdin.on('error', () => this.fail('native_write_error'));
    this.ready = this.call('initialize', { clientInfo: { name: 'clawket', version: '3.1.0' }, capabilities: { experimentalApi: true } }).then(result => { this.nativeVersion = typeof result?.userAgent === 'string' ? /^[^\r\n/]{1,120}\/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+[0-9A-Za-z.-]+)?(?:\s|$)/.exec(result.userAgent)?.[1] : undefined; this.write({ method: 'initialized' }); });
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
      const timer = setTimeout(() => { this.pending.delete(id); this.diagnose('request_timeout'); reject(new CodexRpcError('Codex request timed out; its outcome is unknown. Do not resend automatically.', 'uncertain')); }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async request(method: string, params: object = {}): Promise<any> { await this.ready; return this.call(method, params); }
  respond(id: string | number, result: object): void { this.write({ id, result }); }
  refuse(id: string | number): void { this.write({ id, error: { code: -32601, message: 'Unsupported remote interaction' } }); }
  private diagnose(reason: CodexRpcDiagnostic['reason'], frameBytes?: number): void {
    // No RPC method/params, transcript, stderr, paths, native errors or IDs.
    try { this.emit('diagnostic', { reason, pendingCount: this.pending.size,
      ...(frameBytes === undefined ? {} : { frameBytes }) } satisfies CodexRpcDiagnostic); } catch { /* Logging cannot break cleanup. */ }
  }
  private fail(reason: CodexRpcDiagnostic['reason'], frameBytes?: number): void {
    if (this.closed) return;
    this.closed = true;
    this.diagnose(reason, frameBytes);
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new CodexRpcError('Codex process disconnected; check your computer before continuing.', 'uncertain')); }
    this.pending.clear(); this.emit('closed');
  }
  async stop(): Promise<void> {
    this.fail('stopped'); this.child.stdin.end();
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => { this.child.kill('SIGKILL'); resolve(); }, 3000);
      this.child.once('exit', () => { clearTimeout(timeout); resolve(); });
      this.child.kill('SIGTERM');
    });
  }
}
