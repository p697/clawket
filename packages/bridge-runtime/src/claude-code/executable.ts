import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { ClaudeFault } from './errors.js';

/** Resolve native and npm installations without a shell or changes to the user's installation. */
export function resolveClaudeExecutable(command = 'claude'): string {
  const candidates = isAbsolute(command) || command.includes('/') || command.includes('\\') ? [command]
    : (process.env.PATH ?? '').split(delimiter).flatMap(dir => process.platform === 'win32'
      ? [join(dir, `${command}.exe`), join(dir, `${command}.cmd`), join(dir, command)] : [join(dir, command)]);
  if (command === 'claude') candidates.push(join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'));
  const path = candidates.find(candidate => existsSync(candidate));
  if (!path) throw new ClaudeFault('Install Claude Code and run claude auth login before pairing.');
  const resolved = realpathSync(path);
  if (/\.cmd$/i.test(resolved)) {
    const entry = join(dirname(resolved), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
    if (existsSync(entry)) return realpathSync(entry);
    throw new ClaudeFault('Use --claude-command with the installed Claude executable or cli.js.');
  }
  return resolved;
}
export function claudeCommand(executable: string, args: string[]): { command: string; args: string[] } {
  return /\.[cm]?js$/i.test(executable) ? { command: process.execPath, args: [executable, ...args] } : { command: executable, args };
}
export async function inspectClaudeInstallation(command = 'claude'): Promise<{ version: string; executable: string }> {
  const executable = resolveClaudeExecutable(command);
  const invocation = claudeCommand(executable, ['--version']);
  const version = await new Promise<string>((resolve, reject) => execFile(invocation.command, invocation.args,
    { timeout: 10000, maxBuffer: 4096, encoding: 'utf8', windowsHide: true }, (error, stdout) => error
      ? reject(new ClaudeFault('Claude Code could not start. Check the installed CLI.')) : resolve(stdout.trim())));
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\s|$)/.exec(version);
  if (!match || Number(match[1]) < 2 || Number(match[1]) === 2 && (Number(match[2]) < 1 || Number(match[2]) === 1 && Number(match[3]) < 280)) {
    throw new ClaudeFault('Clawket requires Claude Code 2.1.280 or newer. Update Claude Code before pairing.');
  }
  return { version, executable };
}
