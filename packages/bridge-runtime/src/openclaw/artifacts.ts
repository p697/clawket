import { randomUUID } from 'node:crypto';
import { SESSION_FILE_CHUNK, SESSION_FILE_LIMIT } from '../session-files.js';

export const ARTIFACT_METHODS = ['clawket.artifacts.open', 'clawket.artifacts.read'] as const;
let retainedOrLoading = 0; // Process-wide cap across all isolated client channels.
const unavailable = () => new Error('Attachment unavailable. Refresh and retry.');
type Frame = Record<string, any>;
const parse = (text: string): Frame | null => { try { const v = JSON.parse(text); return v && typeof v === 'object' ? v : null; } catch { return null; } };

/** Only Gateway-issued exact-resource tickets, never arbitrary URLs or owner credentials. */
export function artifactDownloadUrl(value: unknown, gatewayUrl: string): URL {
  if (typeof value !== 'string' || value.length > 8192) throw unavailable();
  const origin = new URL(gatewayUrl);
  origin.protocol = origin.protocol === 'wss:' ? 'https:' : 'http:';
  const url = new URL(value, origin);
  if (url.origin !== origin.origin || url.username || url.password || url.hash
    || !/^\/api\/(?:chat\/media\/outgoing\/|artifacts\/download\/)/.test(url.pathname)) throw unavailable();
  return url;
}

/** Per authenticated full-client channel. Bytes are bounded RAM only, never a spool. */
export class OpenClawArtifacts {
  readonly methods: readonly string[];
  private active = true;
  private busy = false;
  private controller: AbortController | null = null;
  private pending = new Map<string, { resolve: (v: Frame) => void; reject: () => void; timer: ReturnType<typeof setTimeout> }>();
  private expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private entries = new Map<string, { sessionKey: string; bytes: Buffer; mimeType: string; name: string; expires: number }>();
  constructor(private readonly options: {
    nativeMethods: readonly string[]; scopes: readonly string[]; gatewayUrl: string;
    sendGateway: (text: string) => void; sendClient: (text: string) => void;
    fetch?: typeof fetch;
  }) {
    this.methods = ['artifacts.get', 'artifacts.download'].every(method => options.nativeMethods.includes(method))
      && options.scopes.some(s => s === 'operator.admin' || s === 'operator.read') ? ARTIFACT_METHODS : [];
  }
  dispose(): void {
    this.active = false; this.controller?.abort(); retainedOrLoading -= this.entries.size; this.entries.clear();
    for (const timer of this.expiryTimers.values()) clearTimeout(timer); this.expiryTimers.clear();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(); }
    this.pending.clear();
  }
  handleResponse(text: string): boolean {
    const frame = parse(text); const p = frame?.type === 'res' ? this.pending.get(frame.id) : undefined;
    if (!p) return false;
    this.pending.delete(frame!.id); clearTimeout(p.timer);
    if (frame!.ok === true && frame!.payload && typeof frame!.payload === 'object') p.resolve(frame!.payload); else p.reject();
    return true;
  }
  handleRequest(text: string): boolean {
    const f = parse(text);
    if (!this.active || f?.type !== 'req' || typeof f.id !== 'string' || !ARTIFACT_METHODS.includes(f.method)) return false;
    void this.dispatch(f).then(payload => this.reply(f.id, payload), () => this.reply(f.id));
    return true;
  }
  private reply(id: string, payload?: unknown): void {
    if (this.active) this.options.sendClient(JSON.stringify(payload === undefined
      ? { type: 'res', id, ok: false, error: { code: 'UNAVAILABLE', message: unavailable().message } }
      : { type: 'res', id, ok: true, payload }));
  }
  private request(sessionKey: string, artifactId: string, method: string): Promise<Frame> {
    return new Promise((resolve, reject) => {
      const id = `bridge-artifact-${randomUUID()}`;
      const fail = () => reject(unavailable());
      const timer = setTimeout(() => { this.pending.delete(id); fail(); }, 15_000);
      this.pending.set(id, { resolve, reject: fail, timer });
      try { this.options.sendGateway(JSON.stringify({ type: 'req', id, method, params: { sessionKey, artifactId } })); }
      catch { this.pending.delete(id); clearTimeout(timer); fail(); }
    });
  }
  private async dispatch(frame: Frame): Promise<unknown> {
    const p = frame.params;
    if (!this.methods.includes(frame.method) || !p || typeof p.sessionKey !== 'string'
      || p.sessionKey.length > 1024 || !p.sessionKey.startsWith('agent:')) throw unavailable();
    const now = Date.now();
    for (const [id, item] of this.entries) if (item.expires < now) { this.entries.delete(id); retainedOrLoading--; clearTimeout(this.expiryTimers.get(id)); this.expiryTimers.delete(id); }
    if (frame.method === ARTIFACT_METHODS[1]) {
      const item = this.entries.get(p.id);
      if (!item || item.sessionKey !== p.sessionKey || !Number.isSafeInteger(p.offset)
        || p.offset < 0 || p.offset > item.bytes.length || p.offset % SESSION_FILE_CHUNK) throw unavailable();
      const end = Math.min(p.offset + SESSION_FILE_CHUNK, item.bytes.length);
      if (end === item.bytes.length) { this.entries.delete(p.id); retainedOrLoading--; clearTimeout(this.expiryTimers.get(p.id)); this.expiryTimers.delete(p.id); }
      return { offset: p.offset, total: item.bytes.length, data: item.bytes.subarray(p.offset, end).toString('base64'), done: end === item.bytes.length };
    }
    if (this.busy || retainedOrLoading >= 2 || this.entries.size >= 2 || typeof p.artifactId !== 'string' || !p.artifactId || p.artifactId.length > 512) throw unavailable();
    this.busy = true; retainedOrLoading++;
    let retained = false;
    const controller = new AbortController(); this.controller = controller;
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const summary = await this.request(p.sessionKey, p.artifactId, 'artifacts.get');
      if (!this.active || controller.signal.aborted || summary.artifact?.id !== p.artifactId) throw unavailable();
      const preflightSize = summary.artifact.sizeBytes;
      if (preflightSize !== undefined && (!Number.isSafeInteger(preflightSize) || preflightSize < 0 || preflightSize > SESSION_FILE_LIMIT)) throw unavailable();
      // Older Gateways inline the whole Base64 response. Never dispatch a known oversized WS response.
      if (summary.artifact.download?.mode !== 'url' && (!Number.isSafeInteger(preflightSize) || preflightSize > 5 * 1024 * 1024)) throw unavailable();
      const response = await this.request(p.sessionKey, p.artifactId, 'artifacts.download');
      if (!this.active || controller.signal.aborted || response.artifact?.id !== p.artifactId) throw unavailable();
      const declaredSize = response.artifact?.sizeBytes;
      if (declaredSize !== undefined && (!Number.isSafeInteger(declaredSize) || declaredSize < 0 || declaredSize > SESSION_FILE_LIMIT)) throw unavailable();
      let bytes: Buffer;
      let mimeType = response.artifact.mimeType;
      if (response.encoding === 'base64' && typeof response.data === 'string') {
        if (response.data.length > 4 * Math.ceil(SESSION_FILE_LIMIT / 3)
          || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(response.data)) throw unavailable();
        bytes = Buffer.from(response.data, 'base64');
      } else {
        const url = artifactDownloadUrl(response.url, this.options.gatewayUrl);
        const http = await (this.options.fetch ?? fetch)(url, { redirect: 'error', signal: controller.signal });
        if (!http.ok || !http.body) throw unavailable();
        const length = http.headers.get('content-length');
        if (length !== null && (!/^\d+$/.test(length) || Number(length) > SESSION_FILE_LIMIT)) { await http.body.cancel(); throw unavailable(); }
        mimeType ??= http.headers.get('content-type')?.split(';')[0];
        const reader = http.body.getReader(); const chunks: Buffer[] = []; let total = 0;
        try {
          while (true) {
            const chunk = await reader.read(); if (chunk.done) break;
            total += chunk.value.length;
            if (total > SESSION_FILE_LIMIT || controller.signal.aborted) throw unavailable();
            chunks.push(Buffer.from(chunk.value));
          }
        } finally { await reader.cancel().catch(() => {}); }
        bytes = Buffer.concat(chunks, total);
      }
      if (!this.active || controller.signal.aborted || bytes.length > SESSION_FILE_LIMIT
        || (declaredSize !== undefined && declaredSize !== bytes.length)) throw unavailable();
      mimeType = typeof mimeType === 'string' && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mimeType) ? mimeType : 'application/octet-stream';
      const rawName = response.artifact.title;
      const name = typeof rawName === 'string' && rawName.length <= 200 && !/[/\\\x00-\x1f]/.test(rawName) && !rawName.startsWith('.') && rawName.trim()
        ? rawName : `attachment.${({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' } as Record<string, string>)[mimeType] ?? 'bin'}`;
      const id = randomUUID();
      this.entries.set(id, { sessionKey: p.sessionKey, bytes, name, mimeType, expires: Date.now() + 120_000 });
      retained = true;
      const expiry = setTimeout(() => { if (this.entries.delete(id)) retainedOrLoading--; this.expiryTimers.delete(id); }, 120_000);
      expiry.unref?.(); this.expiryTimers.set(id, expiry);
      return { id, name, mimeType, size: bytes.length };
    } finally { if (!retained) retainedOrLoading--; clearTimeout(timer); if (this.controller === controller) this.controller = null; this.busy = false; }
  }
}
