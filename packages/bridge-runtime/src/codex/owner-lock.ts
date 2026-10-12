import { lstatSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

/** Preserve the legacy PID file while serializing recovery of a dead writer. */
export function acquireCodexOwnerLock(path: string): () => void {
  const owner = String(process.pid);
  const create = () => writeFileSync(path, owner, { flag: 'wx', mode: 0o600 });
  try { create(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const recoveryPath = path + '.recovery', recovery = randomUUID();
    try { writeFileSync(recoveryPath, recovery, { flag: 'wx', mode: 0o600 }); }
    catch { throw new Error('Codex owner recovery is already in progress'); }
    try {
      const prior = lstatSync(path);
      if (!prior.isFile() || prior.nlink !== 1 || prior.size > 32) throw new Error('Invalid Codex owner lock');
      const text = readFileSync(path, 'utf8');
      if (!/^[1-9]\d{0,9}$/.test(text)) throw new Error('Invalid Codex owner lock');
      try { process.kill(Number(text), 0); throw new Error('This Codex project is already managed by another Bridge'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      const current = lstatSync(path);
      if (current.ino !== prior.ino || current.dev !== prior.dev || readFileSync(path, 'utf8') !== text) {
        throw new Error('Codex owner changed during recovery');
      }
      unlinkSync(path); create();
    } finally {
      try { if (readFileSync(recoveryPath, 'utf8') === recovery) unlinkSync(recoveryPath); } catch { /* Fail closed. */ }
    }
  }
  const acquired = lstatSync(path);
  return () => {
    try {
      const current = lstatSync(path);
      if (current.ino === acquired.ino && current.dev === acquired.dev && readFileSync(path, 'utf8') === owner) unlinkSync(path);
    } catch { /* Never remove a replacement owner's lock. */ }
  };
}
