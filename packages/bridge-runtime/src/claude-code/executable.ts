import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { ClaudeFault } from './errors.js';

type ExecutableSearch = Readonly<{
  platform?: NodeJS.Platform;
  home?: string;
  searchPath?: string;
  desktopDirectories?: readonly string[];
}>;

function desktopDirectories(platform: NodeJS.Platform, home: string): string[] {
  if (platform === 'darwin') return [join(home, 'Library', 'Application Support', 'Claude', 'claude-code')];
  if (platform === 'win32') return [join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Claude', 'claude-code')];
  return [];
}

function desktopExecutable(directory: string, platform: NodeJS.Platform): string | undefined {
  let versions: string[];
  try {
    versions = readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && /^\d{1,9}\.\d{1,9}\.\d{1,9}$/.test(entry.name))
      .map(entry => entry.name).sort((a, b) => {
        const left = a.split('.').map(Number), right = b.split('.').map(Number);
        return right[0] - left[0] || right[1] - left[1] || right[2] - left[2];
      });
  } catch { return undefined; }
  for (const version of versions) {
    // Desktop downloads its host runtime into user data. Never select the GUI,
    // SDK's packaged CLI or claude-code-vm's Linux guest executable.
    const candidates = platform === 'darwin'
      ? [join(directory, version, 'claude.app', 'Contents', 'MacOS', 'claude'), join(directory, version, 'claude')]
      : [join(directory, version, 'claude.exe')];
    for (const path of candidates) {
      try { accessSync(path, constants.X_OK); if (statSync(path).isFile()) return path; }
      catch { /* Missing or incomplete downloads are not installed runtimes. */ }
    }
  }
  return undefined;
}

/** Default discovery prefers Desktop; explicit commands preserve the user's selection. */
export function resolveClaudeExecutable(command = 'claude', search: ExecutableSearch = {}): string {
  const platform = search.platform ?? process.platform;
  const home = search.home ?? homedir();
  const candidates = isAbsolute(command) || command.includes('/') || command.includes('\\') ? [command]
    : (search.searchPath ?? process.env.PATH ?? '').split(platform === 'win32' ? ';' : delimiter).filter(Boolean).flatMap(dir => platform === 'win32'
      ? [join(dir, `${command}.exe`), join(dir, `${command}.cmd`), join(dir, command)] : [join(dir, command)]);
  let path: string | undefined;
  if (command === 'claude') {
    if (platform === 'darwin' || platform === 'win32') {
      for (const directory of search.desktopDirectories ?? desktopDirectories(platform, home)) {
        path = desktopExecutable(directory, platform);
        if (path) break;
      }
    }
    candidates.push(join(home, '.local', 'bin', platform === 'win32' ? 'claude.exe' : 'claude'));
  }
  path ??= candidates.find(candidate => existsSync(candidate));
  if (!path) throw new ClaudeFault('Open the Code tab in Claude Desktop to install its runtime, or install Claude Code CLI. Use --claude-command to select an executable.');
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
export async function inspectClaudeInstallation(command = 'claude', search: ExecutableSearch = {}): Promise<{ version: string; executable: string }> {
  const executable = resolveClaudeExecutable(command, search);
  const invocation = claudeCommand(executable, ['--version']);
  const version = await new Promise<string>((resolve, reject) => execFile(invocation.command, invocation.args,
    { timeout: 10000, maxBuffer: 4096, encoding: 'utf8', windowsHide: true }, (error, stdout) => error
      ? reject(new ClaudeFault('Claude Code could not start. Check Claude Desktop or the selected CLI.')) : resolve(stdout.trim())));
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\s|$)/.exec(version);
  if (!match || Number(match[1]) < 2 || Number(match[1]) === 2 && (Number(match[2]) < 1 || Number(match[2]) === 1 && Number(match[3]) < 280)) {
    throw new ClaudeFault('Clawket requires Claude Code 2.1.280 or newer. Update Claude Desktop or the selected CLI before pairing.');
  }
  return { version, executable };
}
