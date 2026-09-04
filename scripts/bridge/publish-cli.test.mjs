import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { preparePublish, runCompatibilityGate } from './publish-cli.mjs';

test('guards direct workspace publishes without invoking the publish workflow recursively', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../../apps/bridge-cli/package.json', import.meta.url), 'utf8'),
  );

  assert.equal(manifest.scripts.prepublishOnly, 'npm --prefix ../.. run test:compat');
  assert.doesNotMatch(manifest.scripts.prepublishOnly, /publish/);
});

test('runs the v1 compatibility replay from the repository root', () => {
  const calls = [];

  runCompatibilityGate({
    cwd: '/workspace',
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'npm');
  assert.deepEqual(calls[0].args, ['run', 'test:compat']);
  assert.equal(calls[0].options.cwd, '/workspace');
  assert.equal(calls[0].options.stdio, 'inherit');
});

test('fails closed when the compatibility replay cannot start', () => {
  assert.throws(
    () => runCompatibilityGate({ spawn: () => ({ error: new Error('spawn failed') }) }),
    /could not start: spawn failed/,
  );
});

test('blocks before reading or changing the package when compatibility fails', async () => {
  let read = false;
  let wrote = false;

  await assert.rejects(
    preparePublish({
      spawn: () => ({ status: 1 }),
      readText: async () => {
        read = true;
        return '{}';
      },
      stdout: { write() {} },
    }),
    /npm run test:compat failed with exit code 1/,
  );

  assert.equal(read, false);
  assert.equal(wrote, false);
});

test('publishes the decision-locked 3.0.0 version without mutating the manifest', async () => {
  const calls = [];
  const output = [];

  await preparePublish({
    env: {
      CLAWKET_PACKAGE_DEFAULT_REGISTRY_URL: 'https://registry.example.com',
      CLAWKET_PACKAGE_DEFAULT_REGISTRY_FALLBACK_URL: 'https://fallback.example.com',
    },
    readText: async () => JSON.stringify({ name: '@p697/clawket', version: '3.0.0' }),
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
    stdout: { write(value) { output.push(value); } },
    cwd: '/workspace',
  });

  assert.deepEqual(calls.map(({ command, args }) => [command, args]), [
    ['npm', ['run', 'test:compat']],
    ['npm', ['run', '--workspace', '@p697/clawket', 'publish:dry-run']],
  ]);
  assert.match(output.join(''), /Publishing @p697\/clawket version: 3\.0\.0/);
});

test('fails closed when the package version would violate the 3.0 decision', async () => {
  await assert.rejects(
    preparePublish({
      env: {
        CLAWKET_PACKAGE_DEFAULT_REGISTRY_URL: 'https://registry.example.com',
        CLAWKET_PACKAGE_DEFAULT_REGISTRY_FALLBACK_URL: 'https://fallback.example.com',
      },
      readText: async () => JSON.stringify({ name: '@p697/clawket', version: '3.0.1' }),
      spawn: () => ({ status: 0 }),
      stdout: { write() {} },
    }),
    /Expected @p697\/clawket version 3\.0\.0, found 3\.0\.1/,
  );
});
