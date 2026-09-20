import { randomUUID } from 'node:crypto';
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readSync,
  opendirSync, realpathSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

const METHODS = ['skills.get', 'skills.content.update'] as const;
const MAX_BYTES = 1024 * 1024;
type RecordValue = Record<string, unknown>;
type Request = { id: string; method: string; params: RecordValue };

/** One authenticated Gateway socket owns this bounded, ephemeral extension. */
export class OpenClawSkillDocuments {
  private active = true;
  private readonly pending = new Map<string, { request: Request; timer: ReturnType<typeof setTimeout> }>();
  readonly methods: readonly string[];

  constructor(private readonly options: {
    nativeMethods: readonly string[];
    scopes: readonly string[];
    sendGateway: (text: string) => void;
    sendClient: (text: string) => void;
  }) {
    this.methods = METHODS.filter(method => !options.nativeMethods.includes(method)
      && (options.scopes.includes('operator.admin') || (method === METHODS[0] && options.scopes.includes('operator.read'))));
  }

  dispose(): void {
    this.active = false;
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  handleRequest(text: string): boolean {
    const frame = parse(text);
    if (!this.active || frame?.type !== 'req' || typeof frame.id !== 'string'
      || typeof frame.method !== 'string' || !METHODS.some(method => method === frame.method)
      || this.options.nativeMethods.includes(frame.method)) return false;
    const request = { id: frame.id, method: frame.method, params: record(frame.params) ?? {} };
    const { skillKey, agentId, filePath, content } = request.params;
    if (typeof skillKey !== 'string' || !skillKey.trim() || skillKey.length > 512
      || (agentId !== undefined && (typeof agentId !== 'string' || !agentId.trim() || agentId.length > 256))
      || (filePath != null && filePath !== '' && (typeof filePath !== 'string' || !safeRelative(filePath) || request.method !== METHODS[0]))
      || (request.method === METHODS[1] && (typeof content !== 'string' || Buffer.byteLength(content) > MAX_BYTES))) {
      this.fail(request, 'INVALID_REQUEST', 'Invalid skill document request.');
      return true;
    }
    const admin = this.options.scopes.includes('operator.admin');
    if ((!admin && !this.options.scopes.includes('operator.read')) || (request.method === METHODS[1] && !admin)) {
      this.fail(request, 'INVALID_REQUEST', 'Skill document permission required.');
      return true;
    }
    if (this.pending.size >= 4) {
      this.fail(request, 'UNAVAILABLE', 'Too many skill document requests.');
      return true;
    }
    // Resolve from this client's authenticated, Agent-scoped Gateway report.
    // Never accept a client-provided filesystem path or reuse another client's report.
    const id = `bridge-skill-${randomUUID()}`;
    const timer = setTimeout(() => {
      this.pending.delete(id);
      this.fail(request, 'UNAVAILABLE', 'Skill document request timed out.');
    }, 10_000);
    this.pending.set(id, { request, timer });
    this.options.sendGateway(JSON.stringify({ type: 'req', id, method: 'skills.status', params: { agentId: agentId ?? 'main' } }));
    return true;
  }

  handleResponse(text: string): boolean {
    const frame = parse(text);
    if (!this.active || frame?.type !== 'res' || typeof frame.id !== 'string') return false;
    const pending = this.pending.get(frame.id);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pending.delete(frame.id);
    const { request } = pending;
    if (frame.ok !== true) {
      // Retain Gateway permission/not-found errors; they are not method fallbacks.
      this.options.sendClient(JSON.stringify({ ...frame, id: request.id }));
      return true;
    }
    try {
      const report = record(frame.payload);
      const matches = Array.isArray(report?.skills)
        ? report.skills.map(record).filter(skill => skill?.skillKey === request.params.skillKey) : [];
      if (matches.length !== 1 || !matches[0]) throw new Error('not found');
      const skill = matches[0];
      const mainPath = resolveSkillPath(skill);
      const base = dirname(mainPath);
      const filePath = typeof request.params.filePath === 'string' && request.params.filePath ? request.params.filePath : 'SKILL.md';
      const path = resolveDocumentPath(base, filePath);
      const linkedFiles = listDocuments(base);
      if (filePath !== 'SKILL.md' && !linkedFiles?.other.includes(filePath)) throw new Error('unlisted file');
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      let content: string;
      let editable: boolean;
      let stat: ReturnType<typeof fstatSync>;
      try {
        stat = fstatSync(fd);
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES) throw new Error('unsafe file');
        // Read one extra byte so a growing file cannot silently truncate an editable draft.
        const bytes = Buffer.alloc(MAX_BYTES + 1);
        let length = 0;
        while (length < bytes.length) {
          const count = readSync(fd, bytes, length, bytes.length - length, null);
          if (!count) break;
          length += count;
        }
        if (length > MAX_BYTES) throw new Error('oversized file');
        const current = lstatSync(resolveDocumentPath(base, filePath));
        if (current.dev !== stat.dev || current.ino !== stat.ino || current.size !== stat.size
          || current.mtimeMs !== stat.mtimeMs) throw new Error('changed file');
        content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length));
        if (content.includes('\0')) throw new Error('binary file');
        editable = filePath === 'SKILL.md' && this.options.scopes.includes('operator.admin') && skill.bundled === false
          && ['openclaw-workspace', 'openclaw-managed'].includes(String(skill.source));
      } finally { closeSync(fd); }
      if (request.method === METHODS[1]) {
        if (!editable) throw new Error('read only');
        const next = request.params.content as string;
        if (next.includes('\0')) throw new Error('binary content');
        // Atomic replacement keeps the old source intact on a failed write. The read handle is
        // closed first: Windows refuses to rename over a file that still has an open handle.
        const temporary = join(dirname(path), `.clawket-skill-${randomUUID()}.tmp`);
        try {
          writeFileSync(temporary, next, { flag: 'wx', mode: stat.mode & 0o777 });
          const current = lstatSync(path);
          if (resolveSkillPath(skill) !== path || current.dev !== stat.dev || current.ino !== stat.ino
            || current.size !== stat.size || current.mtimeMs !== stat.mtimeMs) throw new Error('file changed');
          renameSync(temporary, path);
        } finally {
          try { unlinkSync(temporary); } catch { /* renamed or never created */ }
        }
      }
      const payload = request.method === METHODS[1]
        ? { ok: true, skillKey: skill.skillKey, path }
        : { skillKey: skill.skillKey, name: skill.name, path, content, filePath, fileType: /\.md$/i.test(filePath) ? 'markdown' : 'text', isBinary: false, linkedFiles, editable };
      this.options.sendClient(JSON.stringify({ type: 'res', id: request.id, ok: true, payload }));
    } catch {
      // Native errors contain private host paths; do not forward them.
      this.fail(request, 'UNAVAILABLE', 'Skill document is missing, protected, changed, or too large.');
    }
    return true;
  }

  private fail(request: Request, code: string, message: string): void {
    if (this.active) this.options.sendClient(JSON.stringify({ type: 'res', id: request.id, ok: false, error: { code, message } }));
  }
}

function resolveSkillPath(skill: RecordValue): string {
  if (typeof skill.filePath !== 'string' || typeof skill.baseDir !== 'string'
    || !isAbsolute(skill.filePath) || !isAbsolute(skill.baseDir) || basename(skill.filePath) !== 'SKILL.md'
    || resolve(skill.filePath) !== join(resolve(skill.baseDir), 'SKILL.md')) throw new Error('invalid path');
  const base = realpathSync(skill.baseDir);
  const path = realpathSync(skill.filePath);
  if (path !== join(base, 'SKILL.md') || lstatSync(skill.filePath).isSymbolicLink()) throw new Error('unsafe path');
  return path;
}

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
}
function parse(text: string): RecordValue | null {
  try { return record(JSON.parse(text)); } catch { return null; }
}

// Relative paths only, with each component checked; auxiliary files are never writable.
function safeRelative(path: string): boolean {
  return path.length <= 1024 && !path.includes('\\') && !path.includes('\0')
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..') && !isAbsolute(path);
}
function resolveDocumentPath(base: string, relative: string): string {
  if (!safeRelative(relative)) throw new Error('invalid path');
  let path = base;
  for (const part of relative.split('/')) {
    path = join(path, part);
    if (lstatSync(path).isSymbolicLink()) throw new Error('unsafe path');
  }
  if (realpathSync(path) !== path) throw new Error('changed path');
  return path;
}
function listDocuments(base: string): Record<string, string[]> | null {
  const files: string[] = [];
  let visited = 0;
  function walk(relative: string, depth: number): void {
    if (depth > 5 || visited >= 512) return;
    const path = relative ? resolveDocumentPath(base, relative) : base;
    const dir = opendirSync(path);
    try {
      let entry;
      while (visited < 512 && (entry = dir.readSync())) {
        visited += 1;
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const child = relative ? `${relative}/${entry.name}` : entry.name;
        try {
          if (entry.isDirectory()) walk(child, depth + 1);
          else if (entry.isFile() && child !== 'SKILL.md') {
            const stat = lstatSync(resolveDocumentPath(base, child));
            if (stat.nlink === 1 && stat.size <= MAX_BYTES) files.push(child);
          }
        } catch { /* A removed or protected child must not hide SKILL.md. */ }
      }
    } finally { dir.closeSync(); }
  }
  walk('', 0);
  return files.length ? { other: files.sort() } : null;
}
