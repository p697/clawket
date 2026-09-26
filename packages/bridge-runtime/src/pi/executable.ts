import { existsSync, realpathSync } from 'node:fs';
import { delimiter, dirname, join, isAbsolute } from 'node:path';

/** npm's Windows .cmd shim is not an executable for shell:false. Resolve its installed JS entry without invoking a shell. */
export function resolvePiExecutable(command = 'pi', platform = process.platform, searchPath = process.env.PATH ?? ''): { command: string; prefix: string[] } {
  const candidates = isAbsolute(command) || command.includes('/') || command.includes('\\') ? [command] : searchPath.split(platform === 'win32' ? ';' : delimiter).flatMap(dir => platform === 'win32' ? [join(dir, command + '.exe'), join(dir, command + '.cmd'), join(dir, command)] : [join(dir, command)]);
  const found = candidates.find(path => existsSync(path));
  if (!found) return { command, prefix: [] };
  const resolved = realpathSync(found);
  if (platform === 'win32' && /\.cmd$/i.test(resolved)) {
    for (const packageName of ['@earendil-works/pi-coding-agent', '@mariozechner/pi-coding-agent']) {
      const entry = join(dirname(resolved), 'node_modules', packageName, 'dist', 'bundle', 'cli.js');
      if (existsSync(entry)) return { command: process.execPath, prefix: [entry] };
    }
    throw new Error('Unsupported Pi command shim. Provide --pi-command with the installed Pi executable or cli.js.');
  }
  if (/\.[cm]?js$/.test(resolved)) return { command: process.execPath, prefix: [resolved] };
  return { command: resolved, prefix: [] };
}

/** Explicit readiness diagnostic. Unknown/older RPC protocols are not advertised as supported. */
export async function inspectPiInstallation(command = 'pi'): Promise<{ version: string }> {
  const { execFile } = await import('node:child_process');
  const executable = resolvePiExecutable(command);
  const version = await new Promise<string>((resolve, reject) => {
    execFile(executable.command, [...executable.prefix, '--version'], { timeout: 10000, maxBuffer: 4096, windowsHide: true }, (error, stdout) => {
      if (error) reject(new Error('Pi could not start. Install @earendil-works/pi-coding-agent and use Node 22.19 or newer for its npm installation.'));
      else resolve(stdout.trim());
    });
  });
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match || (Number(match[1]) === 0 && (Number(match[2]) < 87 || Number(match[2]) === 87 && Number(match[3]) < 1))) throw new Error('Clawket requires Pi 0.87.1 or newer. Update Pi before pairing.');
  return { version };
}
