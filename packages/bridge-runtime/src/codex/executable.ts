import { existsSync, realpathSync } from 'node:fs';
import { delimiter, dirname, join, isAbsolute } from 'node:path';

/** npm's Windows .cmd shim is not an executable for shell:false. Resolve its installed JS entry without invoking a shell. */
export function resolveCodexExecutable(command = 'codex', platform = process.platform, searchPath = process.env.PATH ?? ''): { command: string; prefix: string[] } {
  const candidates = isAbsolute(command) || command.includes('/') || command.includes('\\') ? [command] : searchPath.split(platform === 'win32' ? ';' : delimiter).flatMap(dir => platform === 'win32' ? [join(dir, command + '.exe'), join(dir, command + '.cmd'), join(dir, command)] : [join(dir, command)]);
  const found = candidates.find(path => existsSync(path));
  if (!found) return { command, prefix: [] };
  const resolved = realpathSync(found);
  if (platform === 'win32' && /\.cmd$/i.test(resolved)) {
    for (const packageName of ['@openai/codex']) {
      const entry = join(dirname(resolved), 'node_modules', packageName, 'bin', 'codex.js');
      if (existsSync(entry)) return { command: process.execPath, prefix: [entry] };
    }
    throw new Error('Unsupported Codex command shim. Provide --codex-command with the installed Codex executable or cli.js.');
  }
  if (/\.[cm]?js$/.test(resolved)) return { command: process.execPath, prefix: [resolved] };
  return { command: resolved, prefix: [] };
}

/** Explicit readiness diagnostic. Unknown/older RPC protocols are not advertised as supported. */
export async function inspectCodexInstallation(command = 'codex'): Promise<{ version: string }> {
  const { execFile } = await import('node:child_process');
  const executable = resolveCodexExecutable(command);
  const version = await new Promise<string>((resolve, reject) => {
    execFile(executable.command, [...executable.prefix, '--version'], { timeout: 10000, maxBuffer: 4096, windowsHide: true }, (error, stdout) => {
      if (error) reject(new Error('Codex could not start. Install @openai/codex and run codex login before pairing.'));
      else resolve(stdout.trim());
    });
  });
  const match = /^(?:codex-cli )?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match || (Number(match[1]) === 0 && (Number(match[2]) < 153 || (Number(match[2]) === 153 && Number(match[3]) < 3)))) throw new Error('Clawket requires Codex 0.153.3 or newer. Update Codex before pairing.');
  return { version };
}
