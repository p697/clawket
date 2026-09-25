import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function piPath(value: string, project: string): string {
  return resolve(project, value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value);
}

/** Match stable Pi's CLI > environment > project/global settings precedence without opening a native session. */
export function nativePiDirectory(project: string, agentDirectory: string, override?: string, env = process.env): string {
  const configured = [join(project, '.pi/settings.json'), join(agentDirectory, 'settings.json')];
  let value = override ?? env.PI_CODING_AGENT_SESSION_DIR;
  if (!value) for (const file of configured) {
    try {
      if (!existsSync(file) || statSync(file).size > 1024 * 1024) continue;
      const settings = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      if (typeof settings.sessionDir === 'string' && settings.sessionDir) { value = settings.sessionDir; break; }
    } catch { /* Pi owns settings diagnostics; history discovery must not rewrite settings. */ }
  }
  return value ? piPath(value, project) : join(agentDirectory, 'sessions', `--${project.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`);
}
