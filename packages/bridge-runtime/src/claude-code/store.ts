import { ClaudeFault } from './errors.js';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export type ClaudeRecord = {
  key: string;
  nativeId?: string;
  cwd: string;
  title: string;
  createdAt: number;
  lastActivityAt?: number;
  model?: string;
  materialized?: boolean;
  fingerprints: Record<string, { hash: string; runId: string; clientKey: string }>;
};
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const MAX_BYTES = 4 * 1024 * 1024;

function validate(records: unknown): asserts records is ClaudeRecord[] {
  if (!Array.isArray(records) || records.length > 500) throw new ClaudeFault('Invalid Claude index');
  const keys = new Set<string>();
  const nativeIds = new Set<string>();
  for (const row of records) {
    if (!row || typeof row !== 'object' || !UUID.test(row.key) || keys.has(row.key)
      || typeof row.cwd !== 'string' || !isAbsolute(row.cwd) || typeof row.title !== 'string' || row.title.length > 300
      || !Number.isFinite(row.createdAt) || row.createdAt < 0
      || row.lastActivityAt !== undefined && (!Number.isFinite(row.lastActivityAt) || row.lastActivityAt < 0)
      || row.model !== undefined && (typeof row.model !== 'string' || row.model.length > 300)
      || row.materialized !== undefined && typeof row.materialized !== 'boolean'
      || row.nativeId !== undefined && (!UUID.test(row.nativeId) || nativeIds.has(row.nativeId))
      || row.materialized && !row.nativeId
      || !row.fingerprints || typeof row.fingerprints !== 'object' || Array.isArray(row.fingerprints)
      || Object.keys(row.fingerprints).length > 1_000) throw new ClaudeFault('Invalid Claude index entry');
    for (const [id, value] of Object.entries(row.fingerprints)) {
      const fingerprint = value as { hash?: unknown; runId?: unknown; clientKey?: unknown } | null;
      if (!/^[a-f0-9]{64}$/.test(id) || !fingerprint || typeof fingerprint.hash !== 'string'
        || !/^[a-f0-9]{64}$/.test(fingerprint.hash) || typeof fingerprint.runId !== 'string' || !UUID.test(fingerprint.runId)
        || typeof fingerprint.clientKey !== 'string' || !fingerprint.clientKey || fingerprint.clientKey.length > 200) {
        throw new ClaudeFault('Invalid Claude acceptance fingerprint');
      }
    }
    keys.add(row.key);
    if (row.nativeId) nativeIds.add(row.nativeId);
  }
}

/** Private metadata only. Never stores credentials, image bodies or native transcripts. */
export class ClaudeStore {
  records: ClaudeRecord[] = [];
  private readonly indexPath: string;
  private readonly lockPath: string;
  private readonly owner = JSON.stringify({ pid: process.pid, nonce: randomUUID() });
  private closed = false;

  constructor(private readonly directory: string, private readonly scope: { project: string; device: boolean }) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new ClaudeFault('Invalid Claude state directory');
    this.indexPath = join(directory, 'sessions.json');
    this.lockPath = join(directory, 'owner.lock');
    this.acquire();
    try {
      if (!existsSync(this.indexPath)) return;
      const stat = lstatSync(this.indexPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_BYTES) throw new ClaudeFault('Invalid Claude index file');
      const saved = JSON.parse(readFileSync(this.indexPath, 'utf8'));
      if (saved.version !== 1 || saved.project !== scope.project || saved.device !== scope.device) throw new ClaudeFault('Claude pairing scope mismatch');
      validate(saved.sessions);
      if (!scope.device && saved.sessions.some((row: ClaudeRecord) => row.cwd !== scope.project)) throw new ClaudeFault('Claude project scope mismatch');
      this.records = saved.sessions;
    } catch (error) { this.close(); throw error; }
  }

  private acquire(): void {
    try { writeFileSync(this.lockPath, this.owner, { flag: 'wx', mode: 0o600 }); return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new ClaudeFault('Cannot create Claude owner lock'); }
    // Two contenders must not both decide the same old lock is stale and unlink a replacement.
    const recoveryPath = join(this.directory, 'owner-recovery.lock');
    try { writeFileSync(recoveryPath, this.owner, { flag: 'wx', mode: 0o600 }); }
    catch { throw new ClaudeFault('Claude owner recovery is already in progress'); }
    try { this.recoverDeadOwner(); }
    finally {
      try { if (readFileSync(recoveryPath, 'utf8') === this.owner) unlinkSync(recoveryPath); } catch { /* Fail closed. */ }
    }
  }

  private recoverDeadOwner(): void {
    const stat = lstatSync(this.lockPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 || stat.nlink !== 1) throw new ClaudeFault('Invalid Claude owner lock');
    let prior: { pid: number };
    try { prior = JSON.parse(readFileSync(this.lockPath, 'utf8')); }
    catch { throw new ClaudeFault('Invalid Claude owner lock'); }
    if (!Number.isSafeInteger(prior?.pid) || prior.pid <= 0) throw new ClaudeFault('Invalid Claude owner process');
    try { process.kill(prior.pid, 0); throw new ClaudeFault('This Claude pairing already has a Bridge owner'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    // Compare the inode again before removing a confirmed dead owner's lock.
    const current = lstatSync(this.lockPath);
    if (current.ino !== stat.ino || current.dev !== stat.dev) throw new ClaudeFault('Claude owner changed during recovery');
    unlinkSync(this.lockPath);
    writeFileSync(this.lockPath, this.owner, { flag: 'wx', mode: 0o600 });
  }

  save(): void {
    if (this.closed) throw new ClaudeFault('Claude store is closed');
    validate(this.records);
    const json = JSON.stringify({ version: 1, ...this.scope, sessions: this.records });
    if (Buffer.byteLength(json) > MAX_BYTES) throw new ClaudeFault('Claude metadata storage limit reached');
    const temporary = join(this.directory, `sessions-${randomUUID()}.pending`);
    try {
      writeFileSync(temporary, json, { flag: 'wx', mode: 0o600 });
      const descriptor = openSync(temporary, 'r');
      try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
      renameSync(temporary, this.indexPath);
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      if (readFileSync(this.lockPath, 'utf8') === this.owner) unlinkSync(this.lockPath);
    } catch { /* A removed/replaced lock is never recreated or taken from its new owner. */ }
  }
}
