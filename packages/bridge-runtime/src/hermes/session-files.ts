import { join } from 'node:path';
import type { SessionFileStore } from '../session-files.js';

export class HermesFileListing {
  private pending = false;
  constructor(private readonly store: SessionFileStore,
    private readonly history: (key: string) => Promise<{ messages: unknown[] }>,
    private readonly roots: () => Promise<string[]>, private readonly generation: () => number) {}
  async list(key: string) {
    if (!key || key.length > 1024 || this.pending) throw new Error('Session files unavailable.');
    this.pending = true;
    const generation = this.generation();
    try {
      const history = await this.history(key);
      const roots = await this.roots();
      if (generation !== this.generation()) throw new Error('Connection changed.');
      return { files: this.store.list(key, history.messages, roots) };
    } finally { this.pending = false; }
  }
}
/** Read local configuration only; never start a terminal or expose provider credentials. */
export async function hermesFileRoots(run: <T>(script: string) => Promise<T>, home: string): Promise<string[]> {
  const value = await run<unknown>(`
import contextlib, io, json, os
with contextlib.redirect_stdout(io.StringIO()):
    from hermes_cli.config import load_config
    cfg = load_config()
    terminal = cfg.get('terminal') or {}
    backend = terminal.get('backend', 'local')
    cwd = terminal.get('cwd', '')
    roots = []
    if backend == 'local' and isinstance(cwd, str) and cwd and cwd not in ('.', 'auto', 'cwd'):
        expanded = os.path.expanduser(cwd)
        if os.path.isabs(expanded): roots.append(expanded)
print(json.dumps(roots))
`);
  if (!Array.isArray(value) || value.some(root => typeof root !== 'string') || value.length > 1) throw new Error('Session files unavailable.');
  return [...value as string[], join(home, 'outputs')];
}
