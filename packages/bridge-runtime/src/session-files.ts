import { createHash, randomUUID } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync, type Stats } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

export const SESSION_FILE_METHODS = ['clawket.files.list', 'clawket.files.read'] as const;
export const SESSION_FILE_LIMIT = 10 * 1024 * 1024;
export const SESSION_FILE_CHUNK = 128 * 1024;
const MAX_ENTRIES = 128;
const TTL = 15 * 60 * 1000;
const TYPES: Record<string, string> = {
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.zip': 'application/zip',
  '.svg': 'image/svg+xml', '.html': 'text/html', '.log': 'text/plain',
  '.py': 'text/plain', '.js': 'text/plain', '.ts': 'text/plain',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const PRIVATE_NAMES = /^(?:agents|claude|memory|user|identity|soul|tools|heartbeat|bootstrap)\.md$|^(?:credentials|auth|config|secrets|tokens?)(?:[.-]|$)/i;
type Entry = { sessionKey: string; root: string; path: string; stat: Stats; expires: number };
export type SessionFile = { id: string; name: string; size: number; mimeType: string };
const record = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** Keep fenced examples intact, including tilde/long fences. Callers decide whether a reference was delivered. */
export function mapSessionFileReferences(text: string, visit: (reference: string, markup: string) => string | undefined): string {
  let fence: string | undefined;
  return text.split('\n').map(line => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      return line;
    }
    if (fence) return line;
    return line.replace(/!?\[[^\]\n]{0,256}\]\((?:<([^>\n]+)>|([^\s)]+))\)|^\s*MEDIA:\s*([^\r\n]+)|`([^`\n]+)`/g,
      (markup, a, b, c, d) => {
        const candidate = String(a ?? b ?? c ?? d ?? '').trim();
        if (candidate.length > 2048 || /[\x00-\x1f]/.test(candidate) || !TYPES[extname(candidate).toLowerCase()]) return markup;
        return visit(candidate, markup) ?? markup;
      });
  }).join('\n');
}

/** Only explicit assistant-delivered links/media/code paths, never user prompts or tool arguments. */
export function sessionFileReferences(messages: readonly unknown[]): string[] {
  const found = new Set<string>();
  for (const value of messages.slice(-200)) {
    const message = record(value);
    if (message?.role !== 'assistant') continue;
    const body = typeof message.content === 'string' ? message.content : Array.isArray(message.content)
      ? message.content.flatMap(value => { const block = record(value); return block?.type === 'text' && typeof block.text === 'string' ? [block.text] : []; }).join('\n') : '';
    // Bounded parsing; fenced examples are not delivery declarations.
    mapSessionFileReferences(body.slice(0, 256_000), candidate => { if (found.size < 64) found.add(candidate); return undefined; });
    if (found.size >= 64) return [...found];
  }
  return [...found];
}

function sameFile(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
function contained(root: string, path: string): boolean {
  const part = relative(root, path);
  return !!part && !isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`);
}
function inspect(root: string, path: string): Stats {
  if (realpathSync(root) !== root || !contained(root, path)) throw new Error('unavailable');
  let current = root;
  const parts = relative(root, path).split(sep);
  for (const [index, part] of parts.entries()) {
    if (!part || part.startsWith('.') || PRIVATE_NAMES.test(part)) throw new Error('unavailable');
    current = join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory())) throw new Error('unavailable');
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > SESSION_FILE_LIMIT || !TYPES[extname(path).toLowerCase()]) throw new Error('unavailable');
  return stat;
}

/** In-memory metadata only. Source bytes remain on the user's computer; no spool or cloud copy. */
export class SessionFileStore {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly stableIds = false) {}
  open(sessionKey: string, id: string): SessionFile {
    const entry = this.entries.get(id);
    if (!entry || entry.sessionKey !== sessionKey || entry.expires < Date.now()) throw new Error('Attachment unavailable. Refresh and retry.');
    try { if (!sameFile(entry.stat, inspect(entry.root, entry.path))) throw new Error('changed'); }
    catch { throw new Error('Attachment unavailable or changed. Refresh and retry.'); }
    return { id, name: basename(entry.path), size: entry.stat.size, mimeType: TYPES[extname(entry.path).toLowerCase()] };
  }
  clear(): void { this.entries.clear(); }
  forget(sessionKey: string): void { for (const [id, entry] of this.entries) if (entry.sessionKey === sessionKey) this.entries.delete(id); }
  list(sessionKey: string, messages: readonly unknown[], roots: readonly string[]): SessionFile[] {
    if (!sessionKey || sessionKey.length > 1024) throw new Error('Invalid session.');
    const now = Date.now();
    for (const [id, entry] of this.entries) if (entry.expires < now) this.entries.delete(id);
    const result: SessionFile[] = [];
    const paths = new Set<string>();
    for (const reference of sessionFileReferences(messages)) {
      for (const sourceRoot of roots.slice(0, 4)) {
        try {
          if (!isAbsolute(sourceRoot)) continue;
          const root = realpathSync(sourceRoot);
          let candidate = reference;
          if (candidate.startsWith('file://')) { const url = new URL(candidate); if (url.host) continue; candidate = decodeURIComponent(url.pathname); }
          else if (/^[a-z][a-z0-9+.-]*:/i.test(candidate) && !/^[a-z]:[\\/]/i.test(candidate)) continue;
          else { try { candidate = decodeURIComponent(candidate); } catch { continue; } }
          if (candidate.startsWith('~/')) candidate = join(homedir(), candidate.slice(2));
          const unresolved = resolve(sourceRoot, candidate);
          const path = contained(resolve(sourceRoot), unresolved) ? resolve(root, relative(resolve(sourceRoot), unresolved)) : resolve(root, candidate);
          if (paths.has(path)) break;
          const stat = inspect(root, path);
          const existing = [...this.entries].find(([, entry]) => entry.sessionKey === sessionKey && entry.path === path && sameFile(entry.stat, stat));
          // Preserve handles used by an in-progress transfer.
          if (!existing && this.entries.size >= MAX_ENTRIES) continue;
          const id = existing?.[0] ?? (this.stableIds ? 'file_' + createHash('sha256').update(JSON.stringify([sessionKey, path, stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs])).digest('hex') : randomUUID());
          this.entries.set(id, { sessionKey, root, path, stat, expires: now + TTL });
          paths.add(path);
          result.push({ id, name: basename(path), size: stat.size, mimeType: TYPES[extname(path).toLowerCase()] });
          break;
        } catch { /* Missing, private, external and nonregular paths are not offered. */ }
      }
    }
    return result;
  }
  read(sessionKey: string, id: string, offset: number): { offset: number; total: number; data: string; done: boolean } {
    const entry = this.entries.get(id);
    if (!entry || entry.sessionKey !== sessionKey || entry.expires < Date.now()
      || !Number.isSafeInteger(offset) || offset < 0 || offset > entry.stat.size || offset % SESSION_FILE_CHUNK !== 0) throw new Error('File unavailable. Refresh and retry.');
    let fd: number | undefined;
    try {
      const current = inspect(entry.root, entry.path);
      if (!sameFile(entry.stat, current)) throw new Error('changed');
      fd = openSync(entry.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      if (!sameFile(entry.stat, fstatSync(fd))) throw new Error('changed');
      const length = Math.min(SESSION_FILE_CHUNK, entry.stat.size - offset);
      const buffer = Buffer.alloc(length);
      const count = length === 0 ? 0 : readSync(fd, buffer, 0, length, offset);
      if (count !== length || !sameFile(entry.stat, fstatSync(fd)) || !sameFile(entry.stat, inspect(entry.root, entry.path))) throw new Error('changed');
      return { offset, total: entry.stat.size, data: buffer.toString('base64'), done: offset + count === entry.stat.size };
    } catch { throw new Error('File unavailable or changed. Refresh and retry.'); }
    finally { if (fd !== undefined) closeSync(fd); }
  }
}
