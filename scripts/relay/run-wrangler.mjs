import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [, , command, appName, ...restArgs] = process.argv;

if (!command || !appName) {
  console.error('Usage: node scripts/run-wrangler.mjs <command> <app-name> [wrangler args...]');
  process.exit(1);
}

const workspaceRoot = process.cwd();
const appDir = path.join(workspaceRoot, 'apps', appName);
const localConfig = path.join(appDir, 'wrangler.local.toml');
const defaultConfig = path.join(appDir, 'wrangler.toml');
const selectedConfig = existsSync(localConfig) ? localConfig : defaultConfig;
const wranglerBin = path.join(
  workspaceRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler',
);

console.error(`[run-wrangler] using ${path.relative(workspaceRoot, selectedConfig)}`);

const selectedAccountId = readTopLevelTomlString(selectedConfig, 'account_id');
const shouldEnforceAccount = command === 'deploy' || command === 'tail';

if (shouldEnforceAccount) {
  ensureAccountSelection({
    wranglerBin,
    workspaceRoot,
    selectedConfig,
    selectedAccountId,
  });
}

const result = spawnSync(
  wranglerBin,
  [command, '--config', selectedConfig, '--cwd', workspaceRoot, ...restArgs],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...(selectedAccountId ? { CLOUDFLARE_ACCOUNT_ID: selectedAccountId } : {}),
    },
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);

function readTopLevelTomlString(configPath, key) {
  const source = readFileSync(configPath, 'utf8');
  const match = source.match(new RegExp(`^${key}\\s*=\\s*"([^"\\n]+)"\\s*$`, 'm'));
  return match?.[1] ?? null;
}

function ensureAccountSelection({ wranglerBin, workspaceRoot, selectedConfig, selectedAccountId }) {
  const whoami = spawnSync(
    wranglerBin,
    ['whoami', '--json'],
    {
      cwd: workspaceRoot,
      env: process.env,
      encoding: 'utf8',
    },
  );

  if (whoami.error || whoami.status !== 0) {
    console.error('[run-wrangler] failed to read Cloudflare login/account state via `wrangler whoami --json`.');
    if (whoami.stderr) console.error(whoami.stderr.trim());
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(whoami.stdout);
  } catch {
    console.error('[run-wrangler] could not parse `wrangler whoami --json` output.');
    process.exit(1);
  }

  const accounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
  const hasMultipleAccounts = accounts.length > 1;

  if (!selectedAccountId) {
    if (hasMultipleAccounts) {
      console.error(
        `[run-wrangler] multiple Cloudflare accounts are available, but ${path.relative(workspaceRoot, selectedConfig)} does not set account_id.`,
      );
      console.error('[run-wrangler] add account_id to your untracked wrangler.local.toml before deploy/tail.');
      process.exit(1);
    }
    return;
  }

  const matchedAccount = accounts.find((account) => account?.id === selectedAccountId);
  if (!matchedAccount) {
    console.error(
      `[run-wrangler] configured account_id ${selectedAccountId} was not found in your current Wrangler login session.`,
    );
    console.error('[run-wrangler] run `pnpm cf:whoami` and update your local config or login context.');
    process.exit(1);
  }

  console.error(`[run-wrangler] account locked to ${matchedAccount.name} (${matchedAccount.id})`);
}
