import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultWorkspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function shouldRunCompatGate(command) {
  return command === 'deploy';
}

export function runCompatGate({
  command,
  workspaceRoot,
  spawn = spawnSync,
  platform = process.platform,
  env = process.env,
  logError = console.error,
}) {
  if (!shouldRunCompatGate(command)) return true;

  const npmBin = platform === 'win32' ? 'npm.cmd' : 'npm';
  logError('[run-wrangler] running required v1 compatibility replay before deploy');
  const result = spawn(
    npmBin,
    ['run', 'test:compat'],
    {
      cwd: workspaceRoot,
      stdio: 'inherit',
      env,
    },
  );

  if (result.error) {
    logError(`[run-wrangler] compatibility replay could not start: ${result.error.message}`);
    return false;
  }
  if (result.status !== 0) {
    logError('[run-wrangler] compatibility replay failed; deployment blocked');
    return false;
  }

  return true;
}

export function runWrangler(rawArgs, dependencies = {}) {
  const {
    workspaceRoot = defaultWorkspaceRoot,
    spawn = spawnSync,
    exists = existsSync,
    readFile = readFileSync,
    platform = process.platform,
    env = process.env,
    logError = console.error,
  } = dependencies;
  const [command, appName, ...rawRestArgs] = rawArgs;

  if (!command || !appName) {
    logError('Usage: node scripts/run-wrangler.mjs <command> <app-name> [wrangler args...]');
    return 1;
  }

  const appDir = path.join(workspaceRoot, 'apps', appName);
  const localConfig = path.join(appDir, 'wrangler.local.toml');
  const defaultConfig = path.join(appDir, 'wrangler.toml');
  const configFileIndex = rawRestArgs.indexOf('--config-file');
  const explicitConfigFile = configFileIndex >= 0 ? rawRestArgs[configFileIndex + 1] : null;
  if (configFileIndex >= 0 && !explicitConfigFile) {
    logError('--config-file requires a filename relative to the selected app directory.');
    return 1;
  }
  const restArgs = configFileIndex >= 0
    ? rawRestArgs.filter((_, index) => index !== configFileIndex && index !== configFileIndex + 1)
    : rawRestArgs;
  const selectedConfig = explicitConfigFile
    ? path.join(appDir, explicitConfigFile)
    : exists(localConfig)
      ? localConfig
      : defaultConfig;
  if (!exists(selectedConfig)) {
    logError(`[run-wrangler] config not found: ${path.relative(workspaceRoot, selectedConfig)}`);
    return 1;
  }
  const wranglerBin = path.join(
    workspaceRoot,
    'node_modules',
    '.bin',
    platform === 'win32' ? 'wrangler.cmd' : 'wrangler',
  );

  logError(`[run-wrangler] using ${path.relative(workspaceRoot, selectedConfig)}`);

  if (!runCompatGate({ command, workspaceRoot, spawn, platform, env, logError })) {
    return 1;
  }

  const selectedAccountId = readTopLevelTomlString(selectedConfig, 'account_id', readFile);
  const shouldEnforceAccount = command === 'deploy' || command === 'tail';

  if (shouldEnforceAccount && !ensureAccountSelection({
    wranglerBin,
    workspaceRoot,
    selectedConfig,
    selectedAccountId,
    spawn,
    env,
    logError,
  })) {
    return 1;
  }

  const result = spawn(
    wranglerBin,
    [command, '--config', selectedConfig, '--cwd', workspaceRoot, ...restArgs],
    {
      stdio: 'inherit',
      env: {
        ...env,
        ...(selectedAccountId ? { CLOUDFLARE_ACCOUNT_ID: selectedAccountId } : {}),
      },
    },
  );

  if (result.error) {
    logError(result.error.message);
    return 1;
  }

  return result.status ?? 1;
}

export function readTopLevelTomlString(configPath, key, readFile = readFileSync) {
  const source = readFile(configPath, 'utf8');
  const match = source.match(new RegExp(`^${key}\\s*=\\s*"([^"\\n]+)"\\s*$`, 'm'));
  return match?.[1] ?? null;
}

export function ensureAccountSelection({
  wranglerBin,
  workspaceRoot,
  selectedConfig,
  selectedAccountId,
  spawn = spawnSync,
  env = process.env,
  logError = console.error,
}) {
  const whoami = spawn(
    wranglerBin,
    ['whoami', '--json'],
    {
      cwd: workspaceRoot,
      env,
      encoding: 'utf8',
    },
  );

  if (whoami.error || whoami.status !== 0) {
    logError('[run-wrangler] failed to read Cloudflare login/account state via `wrangler whoami --json`.');
    if (whoami.stderr) logError(whoami.stderr.trim());
    return false;
  }

  let parsed;
  try {
    parsed = JSON.parse(whoami.stdout);
  } catch {
    logError('[run-wrangler] could not parse `wrangler whoami --json` output.');
    return false;
  }

  const accounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
  const hasMultipleAccounts = accounts.length > 1;

  if (!selectedAccountId) {
    if (hasMultipleAccounts) {
      logError(
        `[run-wrangler] multiple Cloudflare accounts are available, but ${path.relative(workspaceRoot, selectedConfig)} does not set account_id.`,
      );
      logError('[run-wrangler] add account_id to your untracked wrangler.local.toml before deploy/tail.');
      return false;
    }
    return true;
  }

  const matchedAccount = accounts.find((account) => account?.id === selectedAccountId);
  if (!matchedAccount) {
    logError(
      `[run-wrangler] configured account_id ${selectedAccountId} was not found in your current Wrangler login session.`,
    );
    logError('[run-wrangler] run `npm run relay:cf:whoami` and update your local config or login context.');
    return false;
  }

  logError(`[run-wrangler] account locked to ${matchedAccount.name} (${matchedAccount.id})`);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runWrangler(process.argv.slice(2));
}
