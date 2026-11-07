import { lstatSync, readFileSync } from 'node:fs';

/** Called only after ECONNREFUSED. The runtime rechecks/acquires the lock itself. */
export function ownerLockBlocksStart(path: string): boolean {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 1024) return true;
    const pid = ownerLockPid(readFileSync(path, 'utf8'));
    if (!pid) return true;
    try { process.kill(pid, 0); }
    catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
    return true;
  } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ENOENT'; }
}

/** Codex and Pi record a bare PID; Claude Code records `{ pid, nonce }`. Anything else is malformed. */
function ownerLockPid(text: string): number | null {
  if (/^[1-9]\d{0,9}$/.test(text)) return Number(text);
  if (!text.startsWith('{')) return null;
  try {
    const pid = JSON.parse(text)?.pid;
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  } catch { return null; }
}
