import { ClaudeFault } from './errors.js';
import { ClaudeOwnerLock } from './owner-lock.js';
import { claudeModelId } from './models.js';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export type ClaudeRecord = {
  key: string;
  imported?: true;
  nativeId?: string;
  cwd: string;
  title: string;
  createdAt: number;
  lastActivityAt?: number;
  model?: string;
  /** Observed native model is display metadata, never a launch override. Legacy model pins remain intact. */
  observedModel?: string;
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
    if (!row || typeof row !== 'object' || (row.imported === true ? row.key !== `native:${createHash('sha256').update(typeof row.nativeId === 'string' ? row.nativeId : '').digest('hex').slice(0, 32)}` : !UUID.test(row.key)) || keys.has(row.key)
      || row.imported !== undefined && row.imported !== true
      || row.imported === true && (!row.nativeId || row.materialized !== true)
      || typeof row.cwd !== 'string' || !isAbsolute(row.cwd) || typeof row.title !== 'string' || row.title.length > 300
      || !Number.isFinite(row.createdAt) || row.createdAt < 0
      || row.lastActivityAt !== undefined && (!Number.isFinite(row.lastActivityAt) || row.lastActivityAt < 0)
      || row.model !== undefined && (typeof row.model !== 'string' || row.model.length > 300)
      || row.observedModel !== undefined && claudeModelId(row.observedModel) !== row.observedModel
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
  private readonly lock: ClaudeOwnerLock;
  private closed = false;

  constructor(private readonly directory: string, private readonly scope: { project: string; device: boolean }) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new ClaudeFault('Invalid Claude state directory');
    this.indexPath = join(directory, 'sessions.json');
    this.lock = new ClaudeOwnerLock(directory);
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

  save(): void {
    if (this.closed) throw new ClaudeFault('Claude store is closed');
    validate(this.records);
    const json = JSON.stringify({ version: 1, ...this.scope, sessions: this.records });
    if (Buffer.byteLength(json) > MAX_BYTES) throw new ClaudeFault('Claude metadata storage limit reached');
    const temporary = join(this.directory, `sessions-${randomUUID()}.pending`);
    try {
      // Flush the writable handle itself: Windows rejects fsync on a read-only handle.
      const descriptor = openSync(temporary, 'wx', 0o600);
      try { writeFileSync(descriptor, json); fsyncSync(descriptor); } finally { closeSync(descriptor); }
      renameSync(temporary, this.indexPath);
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.lock.close();
  }
}
