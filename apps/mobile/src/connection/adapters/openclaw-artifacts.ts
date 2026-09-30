import type { ArtifactOperations, SessionFileChunk } from '@clawket/agent-protocol';

const LIMIT = 10 * 1024 * 1024;
const CHUNK = 128 * 1024;
const unavailable = () => new Error('Attachment unavailable');
/** Native direct connections use exact-resource tickets; Relay must use negotiated Bridge RPCs. */
export class OpenClawArtifactReader {
  private generation = 0;
  private sequence = 0;
  private expiry?: ReturnType<typeof setTimeout>;
  private controller: AbortController | undefined;
  private bytes: { id: string; key: string; data: Uint8Array; expires: number } | undefined;
  constructor(private readonly request: (method: string, params: object) => Promise<any>, private readonly gatewayUrl: string) {}
  clear(): void { clearTimeout(this.expiry); this.generation++; this.controller?.abort(); this.controller = undefined; this.bytes = undefined; }
  readonly operations: ArtifactOperations = {
    open: async (sessionKey, artifactId) => {
      this.clear();
      const generation = this.generation;
      const controller = new AbortController(); this.controller = controller;
      const timer = setTimeout(() => controller.abort(), 45_000);
      try {
        const summary = await this.request('artifacts.get', { sessionKey, artifactId });
        if (generation !== this.generation || controller.signal.aborted || summary.artifact?.id !== artifactId) throw unavailable();
        const preflightSize = summary.artifact.sizeBytes;
        if (preflightSize !== undefined && (!Number.isSafeInteger(preflightSize) || preflightSize < 0 || preflightSize > LIMIT)) throw unavailable();
        if (summary.artifact.download?.mode !== 'url' && (!Number.isSafeInteger(preflightSize) || preflightSize > 5 * 1024 * 1024)) throw unavailable();
        const result = await this.request('artifacts.download', { sessionKey, artifactId });
        if (generation !== this.generation || controller.signal.aborted || result.artifact?.id !== artifactId) throw unavailable();
        const size = result.artifact.sizeBytes;
        if (size !== undefined && (!Number.isSafeInteger(size) || size < 0 || size > LIMIT)) throw unavailable();
        let data: Uint8Array;
        if (result.encoding === 'base64' && typeof result.data === 'string') {
          if (result.data.length > 4 * Math.ceil(LIMIT / 3) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(result.data)) throw unavailable();
          data = Uint8Array.from(atob(result.data), c => c.charCodeAt(0));
        } else {
          const base = new URL(this.gatewayUrl); base.protocol = base.protocol === 'wss:' ? 'https:' : 'http:';
          if (typeof result.url !== 'string' || result.url.length > 8192) throw unavailable();
          const url = new URL(result.url, base);
          const prefix = base.pathname.replace(/\/$/, '');
          if (url.origin !== base.origin || url.username || url.password || url.hash
            || !url.pathname.startsWith(`${prefix}/api/`) || !/^\/(?:chat\/media\/outgoing\/|artifacts\/download\/)/.test(url.pathname.slice(`${prefix}/api`.length))) throw unavailable();
          const response = await fetch(url.toString(), { redirect: 'error', signal: controller.signal, credentials: 'omit' });
          const length = response.headers.get('content-length');
          // RN fetch buffers bodies. Require a bounded length before decoding; unknown sizes fail closed.
          if (!response.ok || length === null || !/^\d+$/.test(length) || Number(length) > LIMIT) throw unavailable();
          data = new Uint8Array(await response.arrayBuffer());
        }
        if (generation !== this.generation || controller.signal.aborted || data.length > LIMIT || (size !== undefined && size !== data.length)) throw unavailable();
        const id = `artifact-${generation}-${++this.sequence}`;
        this.bytes = { id, key: sessionKey, data, expires: Date.now() + 120_000 };
        this.expiry = setTimeout(() => { if (this.bytes?.id === id) this.bytes = undefined; }, 120_000);
        const mimeType = typeof result.artifact.mimeType === 'string' ? result.artifact.mimeType : 'application/octet-stream';
        const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf', 'image/webp': 'webp' } as Record<string, string>)[mimeType] ?? 'bin';
        const title = result.artifact.title;
        const name = typeof title === 'string' && title.length <= 200 && title.trim() && !/[/\\\x00-\x1f]/.test(title) && !title.startsWith('.') ? title : `attachment.${extension}`;
        return { id, name, mimeType, size: data.length };
      } finally { clearTimeout(timer); if (this.controller === controller) this.controller = undefined; }
    },
    read: async (key, id, offset): Promise<SessionFileChunk> => {
      const entry = this.bytes;
      if (!entry || entry.key !== key || entry.id !== id || entry.expires < Date.now()
        || !Number.isSafeInteger(offset) || offset < 0 || offset > entry.data.length || offset % CHUNK) throw unavailable();
      const chunk = entry.data.subarray(offset, offset + CHUNK);
      let binary = ''; for (const byte of chunk) binary += String.fromCharCode(byte);
      const done = offset + chunk.length === entry.data.length;
      if (done) { this.bytes = undefined; clearTimeout(this.expiry); }
      return { offset, total: entry.data.length, data: btoa(binary), done };
    },
  };
}
