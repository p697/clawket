#!/usr/bin/env node

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const appRoot = resolve(import.meta.dirname, '..');
const envLocalPath = resolve(appRoot, '.env.local');

if (!existsSync(envLocalPath)) {
  console.error(`Missing ${envLocalPath}`);
  process.exit(1);
}

const raw = readFileSync(envLocalPath, 'utf8');
const parsed = new Map();

for (const rawLine of raw.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  const index = line.indexOf('=');
  if (index <= 0) continue;
  const key = line.slice(0, index).trim();
  const value = line.slice(index + 1).trim();
  parsed.set(key, value);
}

const storeUnsafeKeys = new Set([
  'EXPO_PUBLIC_REVENUECAT_TEST_API_KEY',
  'EXPO_PUBLIC_UNLOCK_PRO',
  // The local speech endpoint is Preview infrastructure, never a store-build default.
  'EXPO_PUBLIC_SPEECH_URL',
]);

function syncVar({ name, value, environments, visibility = 'sensitive' }) {
  if (!value) return;
  const args = [
    'eas-cli',
    'env:create',
    '--non-interactive',
    '--force',
    '--scope',
    'project',
    '--visibility',
    visibility,
    '--name',
    name,
    '--value',
    value,
  ];

  for (const env of environments) {
    args.push('--environment', env);
  }

  console.log(`Syncing ${name} -> ${environments.join(', ')}`);
  const result = spawnSync('npx', args, {
    cwd: appRoot,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

for (const [name, value] of parsed.entries()) {
  if (!value) continue;
  const environments = storeUnsafeKeys.has(name)
    ? ['development']
    : ['production', 'preview', 'development'];
  syncVar({ name, value, environments });
}

syncVar({
  name: 'CLAWKET_REQUIRE_REVENUECAT',
  value: '1',
  environments: ['production', 'preview'],
  visibility: 'plaintext',
});

console.log('EAS environment sync complete.');
