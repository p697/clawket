import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runCompatGate, runWrangler, shouldRunCompatGate } from './run-wrangler.mjs';

const WORKSPACE_ROOT = '/workspace';
const WRANGLER_BIN = '/workspace/node_modules/.bin/wrangler';
const CONFIG_PATH = '/workspace/apps/relay-worker/wrangler.local.toml';
const DEPLOY_WORKSPACE_MANIFESTS = new Map([
  ['apps/relay-worker/package.json', 'relay-worker'],
  ['apps/relay-registry/package.json', 'relay-registry'],
  ['apps/hermes-relay-worker/package.json', 'hermes-relay-worker'],
  ['apps/hermes-relay-registry/package.json', 'hermes-relay-registry'],
]);

function createDependencies(spawn) {
  return {
    workspaceRoot: WORKSPACE_ROOT,
    spawn,
    exists: () => true,
    readFile: () => 'account_id = "account-1"\n',
    platform: 'darwin',
    env: { TEST_ENV: '1' },
    logError: () => {},
  };
}

test('classifies only deploy as requiring the compatibility gate', () => {
  assert.equal(shouldRunCompatGate('deploy'), true);
  assert.equal(shouldRunCompatGate('dev'), false);
  assert.equal(shouldRunCompatGate('tail'), false);
});

test('routes direct workspace deploy scripts through the fail-closed wrapper', () => {
  for (const [manifestPath, appName] of DEPLOY_WORKSPACE_MANIFESTS) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(
      manifest.scripts.deploy,
      `node ../../scripts/relay/run-wrangler.mjs deploy ${appName}`,
      `${manifestPath} must not expose a direct wrangler deploy bypass`,
    );
  }
});

test('runs compatibility replay before account lookup and deploy', () => {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'npm') return { status: 0 };
    if (args[0] === 'whoami') {
      return {
        status: 0,
        stdout: JSON.stringify({ accounts: [{ id: 'account-1', name: 'Clawket' }] }),
        stderr: '',
      };
    }
    return { status: 0 };
  };

  const status = runWrangler(['deploy', 'relay-worker'], createDependencies(spawn));

  assert.equal(status, 0);
  assert.deepEqual(calls.map(({ command, args }) => [command, ...args]), [
    ['npm', 'run', 'test:compat'],
    [WRANGLER_BIN, 'whoami', '--json'],
    [WRANGLER_BIN, 'deploy', '--config', CONFIG_PATH, '--cwd', WORKSPACE_ROOT],
  ]);
});

test('blocks deploy immediately when compatibility replay fails', () => {
  const calls = [];
  const messages = [];
  const status = runWrangler(['deploy', 'relay-worker'], {
    ...createDependencies((command, args) => {
      calls.push([command, ...args]);
      return { status: 1 };
    }),
    logError: (message) => messages.push(message),
  });

  assert.equal(status, 1);
  assert.deepEqual(calls, [['npm', 'run', 'test:compat']]);
  assert.match(messages.join('\n'), /deployment blocked/);
});

test('treats a damaged compatibility runner as a closed gate', () => {
  const messages = [];
  const result = runCompatGate({
    command: 'deploy',
    workspaceRoot: WORKSPACE_ROOT,
    spawn: () => ({ error: new Error('spawn failed'), status: null }),
    platform: 'darwin',
    env: {},
    logError: (message) => messages.push(message),
  });

  assert.equal(result, false);
  assert.match(messages.join('\n'), /could not start: spawn failed/);
});

test('does not run compatibility replay for dev or tail', () => {
  for (const command of ['dev', 'tail']) {
    const calls = [];
    const spawn = (executable, args) => {
      calls.push([executable, ...args]);
      if (args[0] === 'whoami') {
        return {
          status: 0,
          stdout: JSON.stringify({ accounts: [{ id: 'account-1', name: 'Clawket' }] }),
          stderr: '',
        };
      }
      return { status: 0 };
    };

    const status = runWrangler([command, 'relay-worker'], createDependencies(spawn));

    assert.equal(status, 0);
    assert.equal(calls.some(([executable]) => executable === 'npm'), false);
  }
});

test('rejects a malformed config override before running any subprocess', () => {
  let spawned = false;
  const status = runWrangler(['deploy', 'relay-worker', '--config-file'], {
    ...createDependencies(() => {
      spawned = true;
      return { status: 0 };
    }),
  });

  assert.equal(status, 1);
  assert.equal(spawned, false);
});
