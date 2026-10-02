import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { readCliVersion } from './metadata.js';

export function isRuntimeCommand(argv: string[]): boolean {
  const commands = ['run', 'start', 'install', 'restart'];
  return commands.includes(argv[0]) || (['codex', 'claude-code', 'pi', 'hermes', 'local-model'].includes(argv[0]) && commands.includes(argv[1])) || (argv[0] === 'hermes' && argv[1] === 'relay' && argv[2] === 'run');
}

/** Future starts use the verified snapshot, including stopped configurations. */
export async function delegateManagedRuntime(argv: string[]): Promise<boolean> {
  if (process.env.CLAWKET_UPDATE_ACTIVATION === '1' || (argv[0] === 'local-model' && process.send)) return false;
  if (!isRuntimeCommand(argv) || argv.includes('--help') || argv.includes('-h')) return false;
  const root = join(homedir(), '.clawket', 'runtime'), path = join(root, 'active.json');
  if (!existsSync(path)) return false;
  let manifest: { version: string; entry: string; node: string };
  try { manifest = JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new Error('Invalid managed Bridge release. Inspect local update state.'); }
  if (!manifest || typeof manifest.entry !== 'string' || typeof manifest.node !== 'string' || typeof manifest.version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version)) throw new Error('Invalid managed Bridge release.');
  const entry = realpathSync(manifest.entry), inside = relative(realpathSync(join(root, 'releases')), entry);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('Invalid managed Bridge release location.');
  const metadata = JSON.parse(readFileSync(join(dirname(entry), '../package.json'), 'utf8'));
  if (metadata.name !== '@p697/clawket' || metadata.version !== manifest.version || metadata.clawket?.updateProtocol !== 1) throw new Error('Invalid managed Bridge release metadata.');
  if (entry === realpathSync(process.argv[1])) return false;
  // An update never lowers a running version; don't redirect a newer CLI to an old snapshot.
  const current = readCliVersion().split('.').map(Number), next = manifest.version.split('.').map(Number);
  const changed = current.findIndex((v, i) => v !== next[i]);
  if (changed >= 0 && next[changed] < current[changed]) return false;
  await new Promise<void>((resolve, reject) => {
    const ipc = typeof process.send === 'function';
    const child = spawn(manifest.node, [entry, ...argv], { stdio: ipc ? ['inherit', 'inherit', 'inherit', 'ipc'] : 'inherit', windowsHide: true });
    if (ipc) child.on('message', message => { if (process.connected) process.send?.(message, () => {}); });
    const disconnect = () => { if (child.connected) child.disconnect(); };
    if (ipc) process.once('disconnect', disconnect);
    const stop = () => child.kill('SIGTERM');
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    const cleanup = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); process.off('disconnect', disconnect); };
    child.once('error', () => { cleanup(); reject(new Error('Could not start the managed Bridge release.')); });
    child.once('exit', code => { cleanup(); process.exitCode = code ?? 1; resolve(); });
  });
  return true;
}
