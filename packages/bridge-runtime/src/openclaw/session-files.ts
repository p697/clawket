import { randomUUID } from 'node:crypto';
import { SESSION_FILE_METHODS, SessionFileStore } from '../session-files.js';
type Frame = Record<string, any>;
const parse = (text: string): Frame | null => { try { const value = JSON.parse(text); return value && typeof value === 'object' ? value : null; } catch { return null; } };
/** Bound to one authenticated local Gateway client channel, never a shared or remote Gateway. */
export class OpenClawSessionFiles {
  readonly methods: readonly string[];
  private readonly files = new SessionFileStore();
  private readonly pending = new Map<string, { timer: ReturnType<typeof setTimeout>; resolve: (payload: Frame) => void; reject: () => void }>();
  private active = true;
  private listing = false;
  constructor(private readonly options: { nativeMethods: readonly string[]; scopes: readonly string[]; sendGateway: (value: string) => void; sendClient: (value: string) => void }) {
    this.methods = (options.scopes.includes('operator.admin') || options.scopes.includes('operator.read'))
      && ['chat.history', 'agents.files.list'].every(method => options.nativeMethods.includes(method)) ? SESSION_FILE_METHODS : [];
  }
  dispose(): void { this.active = false; this.files.clear(); for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(); } this.pending.clear(); }
  handleResponse(text: string): boolean {
    const frame = parse(text); const request = frame?.type === 'res' ? this.pending.get(frame.id) : undefined;
    if (!request) return false;
    this.pending.delete(frame!.id); clearTimeout(request.timer);
    if (frame!.ok === true && frame!.payload && typeof frame!.payload === 'object') request.resolve(frame!.payload); else request.reject();
    return true;
  }
  handleRequest(text: string): boolean {
    const frame = parse(text);
    if (!this.active || frame?.type !== 'req' || typeof frame.id !== 'string' || !SESSION_FILE_METHODS.includes(frame.method)) return false;
    void this.dispatch(frame).then(payload => this.reply(frame.id, true, payload), () => this.reply(frame.id, false));
    return true;
  }
  private reply(id: string, ok: boolean, payload?: unknown): void {
    if (this.active) this.options.sendClient(JSON.stringify(ok ? { type: 'res', id, ok, payload } : { type: 'res', id, ok, error: { code: 'UNAVAILABLE', message: 'Session files are unavailable. Refresh and retry.' } }));
  }
  private request(method: string, params: unknown): Promise<Frame> {
    if (!this.active) return Promise.reject(new Error('unavailable'));
    return new Promise((resolve, reject) => {
      const id = `bridge-files-${randomUUID()}`;
      const fail = () => reject(new Error('unavailable'));
      const timer = setTimeout(() => { this.pending.delete(id); fail(); }, 10_000);
      this.pending.set(id, { timer, resolve, reject: fail });
      this.options.sendGateway(JSON.stringify({ type: 'req', id, method, params }));
    });
  }
  private async dispatch(frame: Frame): Promise<unknown> {
    if (!this.methods.includes(frame.method)) throw new Error('unsupported');
    const payload = frame.params; const key = payload?.sessionKey;
    if (typeof key !== 'string' || key.length > 1024) throw new Error('invalid');
    const match = /^agent:([a-zA-Z0-9_-]{1,128}):.+$/.exec(key);
    if (!match) throw new Error('invalid');
    if (frame.method === SESSION_FILE_METHODS[1]) return this.files.read(key, payload.id, payload.offset);
    if (this.listing) throw new Error('busy');
    this.listing = true;
    try {
      const history = await this.request('chat.history', { sessionKey: key, limit: 200 });
      const workspace = await this.request('agents.files.list', { agentId: match[1] });
      if (!this.active || typeof workspace.workspace !== 'string' || workspace.agentId !== match[1] || !Array.isArray(history.messages)) throw new Error('unavailable');
      return { files: this.files.list(key, history.messages, [workspace.workspace]) };
    } finally { this.listing = false; }
  }
}
