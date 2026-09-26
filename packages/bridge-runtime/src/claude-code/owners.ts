import { claudeCommand } from './executable.js';
import { execFile } from 'node:child_process';

export type ClaudeOwner = {
  sessionId: string;
  cwd: string;
  pid?: number;
  status: 'busy' | 'idle' | 'waiting' | 'unknown';
};
export type ClaudeOwnerSnapshot = { known: true; owners: ClaudeOwner[] } | { known: false; owners: [] };

/** Malformed or incomplete native evidence never means that a session is free. */
export function parseClaudeOwners(value: unknown): ClaudeOwnerSnapshot {
  if (!Array.isArray(value) || value.length > 1_000) return { known: false, owners: [] };
  const owners: ClaudeOwner[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || typeof row.sessionId !== 'string' || !row.sessionId
      || typeof row.cwd !== 'string' || !row.cwd) return { known: false, owners: [] };
    owners.push({ sessionId: row.sessionId, cwd: row.cwd,
      ...(Number.isSafeInteger(row.pid) && row.pid > 0 ? { pid: row.pid } : {}),
      status: ['busy', 'idle', 'waiting'].includes(row.status) ? row.status : 'unknown' });
  }
  return { known: true, owners };
}

/** Official read-only CLI roster; does not inspect credentials or terminate any process. */
export class ClaudeOwners {
  private pending?: Promise<ClaudeOwnerSnapshot>;
  constructor(private readonly executable: string) {}

  snapshot(): Promise<ClaudeOwnerSnapshot> {
    if (this.pending) return this.pending;
    const request = new Promise<ClaudeOwnerSnapshot>(resolve => {
      const invocation = claudeCommand(this.executable, ['agents', '--json', '--all']);
      execFile(invocation.command, invocation.args, {
        timeout: 8_000, maxBuffer: 1024 * 1024, encoding: 'utf8', windowsHide: true,
      }, (error, stdout) => {
        if (error) { resolve({ known: false, owners: [] }); return; }
        try { resolve(parseClaudeOwners(JSON.parse(stdout))); }
        catch { resolve({ known: false, owners: [] }); }
      });
    });
    const attempt = request.finally(() => { if (this.pending === attempt) this.pending = undefined; });
    this.pending = attempt;
    return attempt;
  }
}
