import { accessSync, constants, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

type InstallationOptions = { home?: string; env?: NodeJS.ProcessEnv };

export function resolveHermesSourcePath({ home = homedir(), env = process.env }: InstallationOptions = {}): string {
  if (env.HERMES_SOURCE_PATH?.trim()) return env.HERMES_SOURCE_PATH.trim();
  const installed = join(home, '.local', 'share', 'hermes-agent');
  if (existsSync(join(installed, 'hermes_cli'))) return installed;
  return join(home, '.hermes', 'hermes-agent');
}

export function resolveHermesCommand({ home = homedir(), env = process.env }: InstallationOptions = {}): string {
  if (env.HERMES_COMMAND?.trim()) return env.HERMES_COMMAND.trim();
  const paths = (env.PATH ?? '').split(delimiter).filter(Boolean).map((entry) => join(entry, 'hermes'));
  paths.push(join(home, '.local', 'bin', 'hermes'));
  return paths.find((candidate) => {
    try { accessSync(candidate, constants.X_OK); return true; } catch { return false; }
  }) ?? 'hermes';
}
