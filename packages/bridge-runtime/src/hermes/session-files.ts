import { join } from 'node:path';
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
