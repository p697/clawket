import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runCompatGate, runWrangler, shouldRunCompatGate } from './run-wrangler.mjs';

const WORKSPACE_ROOT = '/workspace';
const WRANGLER_BIN = '/workspace/node_modules/.bin/wrangler';
const CONFIG_PATH = '/workspace/apps/relay-worker/wrangler.local.toml';
const HERMES_CONFIG_PATH = '/workspace/apps/relay-worker/wrangler.hermes.local.toml';
const DEPLOY_WORKSPACE_MANIFESTS = new Map([
  ['apps/relay-worker/package.json', 'relay-worker'],
  ['apps/relay-registry/package.json', 'relay-registry'],
]);
const HERMES_DEPLOY_WORKSPACE_MANIFESTS = new Map([
  ['apps/relay-worker/package.json', 'relay-worker'],
  ['apps/relay-registry/package.json', 'relay-registry'],
]);
const ROOT_WRANGLER_SCRIPTS = {
  'relay:dev:worker': 'node scripts/relay/run-wrangler.mjs dev relay-worker',
  'relay:dev:registry': 'node scripts/relay/run-wrangler.mjs dev relay-registry',
  'relay:dev:hermes-worker': 'node scripts/relay/run-wrangler.mjs dev relay-worker --config-file wrangler.hermes.local.toml',
  'relay:dev:hermes-registry': 'node scripts/relay/run-wrangler.mjs dev relay-registry --config-file wrangler.hermes.local.toml',
  'relay:dev:hermes-preview-worker': 'node scripts/relay/run-wrangler.mjs dev relay-worker --config-file wrangler.hermes.preview.local.toml',
  'relay:dev:hermes-preview-registry': 'node scripts/relay/run-wrangler.mjs dev relay-registry --config-file wrangler.hermes.preview.local.toml',
  'relay:deploy:worker': 'node scripts/relay/run-wrangler.mjs deploy relay-worker',
  'relay:deploy:registry': 'node scripts/relay/run-wrangler.mjs deploy relay-registry',
  'relay:deploy:preview-worker': 'node scripts/relay/run-wrangler.mjs deploy relay-worker --config-file wrangler.preview.local.toml',
  'relay:deploy:preview-registry': 'node scripts/relay/run-wrangler.mjs deploy relay-registry --config-file wrangler.preview.local.toml',
  'relay:deploy:hermes-worker': 'node scripts/relay/run-wrangler.mjs deploy relay-worker --config-file wrangler.hermes.local.toml',
  'relay:deploy:hermes-registry': 'node scripts/relay/run-wrangler.mjs deploy relay-registry --config-file wrangler.hermes.local.toml',
  'relay:deploy:hermes-preview-worker': 'node scripts/relay/run-wrangler.mjs deploy relay-worker --config-file wrangler.hermes.preview.local.toml',
  'relay:deploy:hermes-preview-registry': 'node scripts/relay/run-wrangler.mjs deploy relay-registry --config-file wrangler.hermes.preview.local.toml',
  'relay:tail:worker': 'node scripts/relay/run-wrangler.mjs tail relay-worker',
  'relay:tail:registry': 'node scripts/relay/run-wrangler.mjs tail relay-registry',
  'relay:tail:preview-worker': 'node scripts/relay/run-wrangler.mjs tail relay-worker --config-file wrangler.preview.local.toml',
  'relay:tail:preview-registry': 'node scripts/relay/run-wrangler.mjs tail relay-registry --config-file wrangler.preview.local.toml',
  'relay:tail:hermes-worker': 'node scripts/relay/run-wrangler.mjs tail relay-worker --config-file wrangler.hermes.local.toml',
  'relay:tail:hermes-registry': 'node scripts/relay/run-wrangler.mjs tail relay-registry --config-file wrangler.hermes.local.toml',
  'relay:tail:hermes-preview-worker': 'node scripts/relay/run-wrangler.mjs tail relay-worker --config-file wrangler.hermes.preview.local.toml',
  'relay:tail:hermes-preview-registry': 'node scripts/relay/run-wrangler.mjs tail relay-registry --config-file wrangler.hermes.preview.local.toml',
};
const TRACKED_CONFIGS = [
  {
    path: 'apps/relay-worker/wrangler.toml',
    name: 'clawket-relay',
    backend: 'openclaw',
    binding: 'ROOM',
    className: 'RelayRoom',
    kvBinding: 'ROUTES_KV',
  },
  {
    path: 'apps/relay-worker/wrangler.local.example.toml',
    name: 'clawket-relay',
    backend: 'openclaw',
    binding: 'ROOM',
    className: 'RelayRoom',
    kvBinding: 'ROUTES_KV',
  },
  {
    path: 'apps/relay-worker/wrangler.preview.example.toml',
    name: 'clawket-relay-preview',
    backend: 'openclaw',
    binding: 'ROOM',
    className: 'RelayRoom',
    kvBinding: 'ROUTES_KV',
  },
  {
    path: 'apps/relay-worker/wrangler.hermes.toml',
    name: 'clawket-hermes-relay',
    backend: 'hermes',
    binding: 'HERMES_ROOM',
    className: 'HermesRelayRoom',
    kvBinding: 'HERMES_ROUTES_KV',
    heartbeatMs: '5000',
  },
  {
    path: 'apps/relay-worker/wrangler.hermes.local.example.toml',
    name: 'clawket-hermes-relay',
    backend: 'hermes',
    binding: 'HERMES_ROOM',
    className: 'HermesRelayRoom',
    kvBinding: 'HERMES_ROUTES_KV',
    heartbeatMs: '5000',
  },
  {
    path: 'apps/relay-worker/wrangler.hermes.preview.example.toml',
    name: 'clawket-hermes-relay-preview',
    backend: 'hermes',
    binding: 'HERMES_ROOM',
    className: 'HermesRelayRoom',
    kvBinding: 'HERMES_ROUTES_KV',
    heartbeatMs: '5000',
  },
  {
    path: 'apps/relay-registry/wrangler.toml',
    name: 'clawket-registry',
    backend: 'openclaw',
    kvBinding: 'ROUTES_KV',
  },
  {
    path: 'apps/relay-registry/wrangler.local.example.toml',
    name: 'clawket-registry',
    backend: 'openclaw',
    kvBinding: 'ROUTES_KV',
  },
  {
    path: 'apps/relay-registry/wrangler.preview.example.toml',
    name: 'clawket-registry-preview',
    backend: 'openclaw',
    kvBinding: 'ROUTES_KV',
    serviceBinding: 'RELAY_SYNC_SERVICE',
    serviceName: 'clawket-relay-preview',
  },
  {
    path: 'apps/relay-registry/wrangler.hermes.toml',
    name: 'clawket-hermes-registry',
    backend: 'hermes',
    kvBinding: 'HERMES_ROUTES_KV',
  },
  {
    path: 'apps/relay-registry/wrangler.hermes.local.example.toml',
    name: 'clawket-hermes-registry',
    backend: 'hermes',
    kvBinding: 'HERMES_ROUTES_KV',
  },
  {
    path: 'apps/relay-registry/wrangler.hermes.preview.example.toml',
    name: 'clawket-hermes-registry-preview',
    backend: 'hermes',
    kvBinding: 'HERMES_ROUTES_KV',
  },
];
const CONFIG_PAIRS = [
  {
    label: 'OpenClaw production template',
    workerPath: 'apps/relay-worker/wrangler.toml',
    registryPath: 'apps/relay-registry/wrangler.toml',
    registryUrl: 'https://registry.example.com',
    relayUrl: 'wss://relay.example.com/ws',
    publicBaseUrl: 'https://registry.example.com',
  },
  {
    label: 'OpenClaw local template',
    workerPath: 'apps/relay-worker/wrangler.local.example.toml',
    registryPath: 'apps/relay-registry/wrangler.local.example.toml',
    registryUrl: 'https://registry.example.com',
    relayUrl: 'wss://relay.example.com/ws',
    publicBaseUrl: 'https://registry.example.com',
  },
  {
    label: 'OpenClaw Preview template',
    workerPath: 'apps/relay-worker/wrangler.preview.example.toml',
    registryPath: 'apps/relay-registry/wrangler.preview.example.toml',
    registryUrl: 'https://clawket-registry-preview.example.workers.dev',
    relayUrl: 'wss://clawket-relay-preview.example.workers.dev/ws',
    publicBaseUrl: 'https://clawket-registry-preview.example.workers.dev',
    serviceBinding: 'RELAY_SYNC_SERVICE',
    serviceName: 'clawket-relay-preview',
  },
  {
    label: 'Hermes production template',
    workerPath: 'apps/relay-worker/wrangler.hermes.toml',
    registryPath: 'apps/relay-registry/wrangler.hermes.toml',
    registryUrl: 'https://hermes-registry.example.com',
    relayUrl: 'wss://hermes-relay.example.com/ws',
  },
  {
    label: 'Hermes local template',
    workerPath: 'apps/relay-worker/wrangler.hermes.local.example.toml',
    registryPath: 'apps/relay-registry/wrangler.hermes.local.example.toml',
    registryUrl: 'https://hermes-registry.example.com',
    relayUrl: 'wss://hermes-relay.example.com/ws',
  },
  {
    label: 'Hermes Preview template',
    workerPath: 'apps/relay-worker/wrangler.hermes.preview.example.toml',
    registryPath: 'apps/relay-registry/wrangler.hermes.preview.example.toml',
    registryUrl: 'https://clawket-hermes-registry-preview.example.workers.dev',
    relayUrl: 'wss://clawket-hermes-relay-preview.example.workers.dev/ws',
  },
];
const LOCAL_CONFIG_TEMPLATES = [
  ['wrangler.local.toml', 'wrangler.local.example.toml'],
  ['wrangler.preview.local.toml', 'wrangler.preview.example.toml'],
  ['wrangler.hermes.local.toml', 'wrangler.hermes.local.example.toml'],
  ['wrangler.hermes.preview.local.toml', 'wrangler.hermes.preview.example.toml'],
];

function readTomlString(source, key) {
  return source.match(new RegExp(`^${key}\\s*=\\s*"([^"\\n]+)"\\s*$`, 'm'))?.[1] ?? null;
}

function readTomlJsonMap(source, key) {
  const literal = source.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm'))?.[1];
  assert.ok(literal, `${key} must be present`);
  return JSON.parse(JSON.parse(literal));
}

function readArrayTables(source, name) {
  const tables = [];
  let current = null;
  for (const line of source.split('\n')) {
    const header = line.match(/^\[\[([^\]]+)\]\]$/);
    if (header) {
      current = header[1] === name ? {} : null;
      if (current) tables.push(current);
      continue;
    }
    if (line.startsWith('[')) {
      current = null;
      continue;
    }
    const property = current && line.match(/^([a-zA-Z0-9_]+)\s*=\s*"([^"\n]*)"\s*$/);
    if (property) current[property[1]] = property[2];
  }
  return tables;
}

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

  for (const [manifestPath, appName] of HERMES_DEPLOY_WORKSPACE_MANIFESTS) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(
      manifest.scripts['deploy:hermes'],
      `node ../../scripts/relay/run-wrangler.mjs deploy ${appName} --config-file wrangler.hermes.local.toml`,
      `${manifestPath} must route its Hermes deploy through the merged workspace wrapper`,
    );
  }
});

test('routes every root Relay dev, deploy, and tail command through the merged workspaces', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const [scriptName, expected] of Object.entries(ROOT_WRANGLER_SCRIPTS)) {
    assert.equal(manifest.scripts[scriptName], expected, `${scriptName} Wrangler route changed`);
    assert.doesNotMatch(manifest.scripts[scriptName], /\.example\.toml\b/, scriptName);
  }
});

test('keeps ignored local config names paired with tracked example templates', () => {
  for (const appName of ['relay-worker', 'relay-registry']) {
    for (const [localName, exampleName] of LOCAL_CONFIG_TEMPLATES) {
      const source = readFileSync(`apps/${appName}/${exampleName}`, 'utf8');
      assert.match(source, /^name = "clawket-/m, `${appName}/${exampleName}`);

      if (localName !== 'wrangler.local.toml') {
        assert.equal(
          Object.values(ROOT_WRANGLER_SCRIPTS).some((command) => (
            command.includes(` ${appName} `) && command.includes(`--config-file ${localName}`)
          )),
          true,
          `${appName}/${localName} must be selected by a root Wrangler command`,
        );
      }
    }
  }
});

test('pins the merged deployment matrix names, backends, and Durable Object identities', () => {
  for (const expected of TRACKED_CONFIGS) {
    const source = readFileSync(expected.path, 'utf8');
    assert.match(source, new RegExp(`^name = "${expected.name}"$`, 'm'), expected.path);
    assert.match(source, /^compatibility_date = "2026-03-03"$/m, expected.path);
    assert.match(source, new RegExp(`^RELAY_BACKEND = "${expected.backend}"$`, 'm'), expected.path);
    assert.deepEqual(
      readArrayTables(source, 'kv_namespaces').map(({ binding }) => binding),
      [expected.kvBinding],
      `${expected.path} must use only its backend-specific KV binding`,
    );
    if (expected.binding) {
      assert.match(source, new RegExp(`^name = "${expected.binding}"$`, 'm'), expected.path);
      assert.match(source, new RegExp(`^class_name = "${expected.className}"$`, 'm'), expected.path);
      assert.match(source, /^tag = "v1"$/m, expected.path);
      assert.match(
        source,
        new RegExp(`^new_sqlite_classes = \\["${expected.className}"\\]$`, 'm'),
        expected.path,
      );
    }
    if (expected.heartbeatMs) {
      assert.match(
        source,
        new RegExp(`^HEARTBEAT_INTERVAL_MS = "${expected.heartbeatMs}"$`, 'm'),
        expected.path,
      );
    }
    if (expected.serviceBinding) {
      assert.match(source, new RegExp(`^binding = "${expected.serviceBinding}"$`, 'm'), expected.path);
      assert.match(source, new RegExp(`^service = "${expected.serviceName}"$`, 'm'), expected.path);
    }
  }
});

test('pairs every tracked Registry endpoint with its Relay endpoint and service binding', () => {
  for (const expected of CONFIG_PAIRS) {
    const worker = readFileSync(expected.workerPath, 'utf8');
    const registry = readFileSync(expected.registryPath, 'utf8');

    assert.equal(
      readTomlString(worker, 'REGISTRY_VERIFY_URL'),
      expected.registryUrl,
      `${expected.label} Worker must verify against its matching Registry`,
    );
    const regionMap = readTomlJsonMap(registry, 'RELAY_REGION_MAP');
    assert.deepEqual(Object.keys(regionMap).sort(), ['cn', 'eu', 'sg', 'us'], expected.label);
    assert.deepEqual(
      [...new Set(Object.values(regionMap))],
      [expected.relayUrl],
      `${expected.label} Registry must issue its matching Relay URL`,
    );
    if (expected.publicBaseUrl) {
      assert.equal(
        readTomlString(registry, 'PAIR_PUBLIC_BASE_URL'),
        expected.publicBaseUrl,
        `${expected.label} invitation URL must use its matching Registry`,
      );
    }

    const services = readArrayTables(registry, 'services');
    assert.deepEqual(
      services,
      expected.serviceBinding
        ? [{ binding: expected.serviceBinding, service: expected.serviceName }]
        : [],
      `${expected.label} service binding changed`,
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

test('selects an explicit merged Hermes config and removes the wrapper-only flag', () => {
  const calls = [];
  const spawn = (command, args) => {
    calls.push([command, ...args]);
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

  const status = runWrangler(
    ['deploy', 'relay-worker', '--config-file', 'wrangler.hermes.local.toml', '--minify'],
    createDependencies(spawn),
  );

  assert.equal(status, 0);
  assert.deepEqual(calls, [
    ['npm', 'run', 'test:compat'],
    [WRANGLER_BIN, 'whoami', '--json'],
    [WRANGLER_BIN, 'deploy', '--config', HERMES_CONFIG_PATH, '--cwd', WORKSPACE_ROOT, '--minify'],
  ]);
});

test('points account-selection failures at the repository Wrangler identity command', () => {
  const messages = [];
  const status = runWrangler(['tail', 'relay-worker'], {
    ...createDependencies((_command, args) => {
      if (args[0] === 'whoami') {
        return {
          status: 0,
          stdout: JSON.stringify({ accounts: [{ id: 'account-2', name: 'Other' }] }),
          stderr: '',
        };
      }
      return { status: 0 };
    }),
    logError: (message) => messages.push(message),
  });

  assert.equal(status, 1);
  assert.match(messages.join('\n'), /npm run relay:cf:whoami/);
  assert.doesNotMatch(messages.join('\n'), /npm run cf:whoami/);
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

test('rejects a missing explicit merged config before running compatibility replay', () => {
  let spawned = false;
  const status = runWrangler(
    ['deploy', 'relay-worker', '--config-file', 'wrangler.hermes.preview.local.toml'],
    {
      ...createDependencies(() => {
        spawned = true;
        return { status: 0 };
      }),
      exists: (selectedPath) => !selectedPath.endsWith('wrangler.hermes.preview.local.toml'),
    },
  );

  assert.equal(status, 1);
  assert.equal(spawned, false);
});
