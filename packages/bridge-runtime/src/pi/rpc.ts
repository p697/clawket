import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';

/** Pi owns provider credentials/configuration. Only its documented JSONL RPC crosses this boundary. */
export class PiRpc extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private sequence = 0;
  private pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private readonly command: string, private readonly args: string[], private readonly cwd: string, private readonly env = process.env) { super(); }
  start(): void {
    if (this.child) return;
    const child = spawn(this.command, this.args, { cwd: this.cwd, env: this.env, stdio: 'pipe', windowsHide: true });
    this.child = child;
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    child.stdout.on('data', chunk => {
      buffer += decoder.write(chunk);
      if (Buffer.byteLength(buffer) > 16 * 1024 * 1024) { this.fail('Pi response exceeded the supported size'); child.kill(); return; }
      let end: number;
      // readline treats U+2028 as a separator on some hosts; JSONL is LF only.
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let event: any;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.type === 'response') {
          const pending = this.pending.get(event.id);
          if (!pending) continue;
          this.pending.delete(event.id); clearTimeout(pending.timer);
          event.success ? pending.resolve(event.data) : pending.reject(new Error('Pi rejected the operation. Check the project configuration and Pi logs on your computer.'));
        } else this.emit('event', event);
      }
    });
    // Drain diagnostics without forwarding provider tokens, local paths or extension output.
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => this.fail('Pi input closed'));
    child.on('error', () => this.fail('Pi could not start. Install Pi and check its executable path.'));
    child.on('close', () => { if (this.child === child) this.child = null; this.fail('Pi exited. Reopen the session to continue; interrupted prompts are never replayed.'); this.emit('exit'); });
  }
  request<T = any>(type: string, params: object = {}): Promise<T> {
    this.start();
    const id = `clawket-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Pi request timed out; its outcome may be unknown.')); }, type === 'prompt' ? 24 * 60 * 60 * 1000 : 30_000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ ...params, type, id }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  send(value: object): void {
    if (!this.child || this.child.stdin.destroyed) throw new Error('Pi is offline');
    if (this.child.stdin.writableLength > 8 * 1024 * 1024) throw new Error('Pi input is busy');
    this.child.stdin.write(JSON.stringify(value) + '\n');
  }
  private fail(message: string): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(message)); }
    this.pending.clear();
  }
  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.fail('Pi stopped');
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      child.once('close', () => { clearTimeout(timer); resolve(); });
      child.stdin.end();
    });
  }
}
