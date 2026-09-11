import assert from 'node:assert/strict';
import test from 'node:test';

import { buildHermesDeviceConfig } from './hermes-device-dev.mjs';

const BASE_INPUT = {
  workspaceRoot: '/workspace',
  publicHost: '192.168.1.24',
  registryPort: 8787,
  workerPort: 8788,
};

test('builds the Hermes device Registry config from the merged workspace', () => {
  const source = buildHermesDeviceConfig({
    ...BASE_INPUT,
    appName: 'relay-registry',
  });

  assert.match(source, /^name = "clawket-hermes-registry"$/m);
  assert.match(source, /^main = "\/workspace\/apps\/relay-registry\/src\/index\.ts"$/m);
  assert.match(source, /^RELAY_BACKEND = "hermes"$/m);
  assert.match(source, /^binding = "HERMES_ROUTES_KV"$/m);
  assert.match(source, /ws:\/\/192\.168\.1\.24:8788\/ws/);
  assert.doesNotMatch(source, /apps\/hermes-relay-registry/);
});

test('builds the Hermes device Relay config from the merged workspace', () => {
  const source = buildHermesDeviceConfig({
    ...BASE_INPUT,
    appName: 'relay-worker',
  });

  assert.match(source, /^name = "clawket-hermes-relay"$/m);
  assert.match(source, /^main = "\/workspace\/apps\/relay-worker\/src\/index\.ts"$/m);
  assert.match(source, /^RELAY_BACKEND = "hermes"$/m);
  assert.match(source, /^REGISTRY_VERIFY_URL = "http:\/\/192\.168\.1\.24:8787"$/m);
  assert.match(source, /^CLIENT_PONG_TIMEOUT_MS = "30000"$/m);
  assert.match(source, /^GATEWAY_PING_TIMEOUT_MS = "12000"$/m);
  assert.match(source, /^name = "HERMES_ROOM"$/m);
  assert.match(source, /^class_name = "HermesRelayRoom"$/m);
  assert.match(source, /^tag = "v1"$/m);
  assert.match(source, /^new_sqlite_classes = \["HermesRelayRoom"\]$/m);
  assert.doesNotMatch(source, /^CLIENT_IDLE_TIMEOUT_MS\s*=/m);
  assert.doesNotMatch(source, /apps\/hermes-relay-worker/);
});
