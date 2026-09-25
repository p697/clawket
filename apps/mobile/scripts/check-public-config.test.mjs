import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { buildConfig, parseBoolean, validateConfig } from './check-public-config.mjs';

const { mergeGeneratedBlock } = createRequire(import.meta.url)('../plugins/with-xcode-env.js');

test('Xcode Release validates after loading local Node with a GUI-style PATH', () => {
  const app = realpathSync(mkdtempSync(join(tmpdir(), 'clawket-xcode-')));
  try {
    const ios = join(app, 'ios');
    mkdirSync(join(ios, 'Pods'), { recursive: true });
    mkdirSync(join(app, 'scripts'));
    copyFileSync(new URL('./check-public-config.mjs', import.meta.url), join(app, 'scripts/check-public-config.mjs'));
    const generated = mergeGeneratedBlock('export NODE_BINARY=$(command -v node)\n');
    assert.equal(mergeGeneratedBlock(generated), generated);
    writeFileSync(join(ios, '.xcode.env'), generated);
    writeFileSync(join(ios, '.xcode.env.local'), `export NODE_BINARY='${process.execPath.replaceAll("'", "'\\''")}'\n`);
    writeFileSync(join(app, '.env.local'), [
      'EXPO_PUBLIC_POSTHOG_API_KEY=phc_test',
      'EXPO_PUBLIC_POSTHOG_HOST=https://example.test',
      'EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY=appl_test',
      'EXPO_PUBLIC_REVENUECAT_PRO_ENTITLEMENT_ID=pro',
      'EXPO_PUBLIC_SPEECH_URL=wss://speech.clawket.ai/v1/speech',
    ].join('\n'));
    // No inherited terminal environment or node on PATH, as in Xcode GUI phases.
    const env = { PATH: '/usr/bin:/bin', PODS_ROOT: join(ios, 'Pods'), CONFIGURATION: 'Release', CLAWKET_OFFICIAL_BUILD: '1' };
    const run = (overrides = {}) => spawnSync('/bin/bash', ['-c', '. "$PODS_ROOT/../.xcode.env"'], {
      cwd: app, env: { ...env, ...overrides }, encoding: 'utf8',
    });
    const valid = run();
    assert.equal(valid.status, 0, valid.stdout + valid.stderr);
    assert.match(valid.stdout, /Public config check \(ios\)/);
    const preview = run({ EXPO_PUBLIC_SPEECH_URL: 'wss://clawket-speech-preview.clawket.workers.dev/v1/speech' });
    assert.equal(preview.status, 1);
    assert.match(preview.stdout, /Store builds require EXPO_PUBLIC_SPEECH_URL/);
    writeFileSync(join(app, '.env.local'), '');
    const community = run({ CLAWKET_OFFICIAL_BUILD: '0' });
    assert.equal(community.status, 0, community.stdout + community.stderr);
    assert.match(community.stdout, /Speech: disabled/);
    assert.equal(run().status, 1, 'Official builds still require integrations');
    writeFileSync(join(ios, '.xcode.env.local'), 'export NODE_BINARY=/missing/node\n');
    const missing = run();
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Set NODE_BINARY to an executable Node path/);
    assert.equal(run({ CONFIGURATION: 'Debug' }).status, 0);
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});

test('parseBoolean rejects malformed values instead of enabling a release flag', () => {
  assert.equal(parseBoolean('tru'), null);
  assert.equal(parseBoolean({}), null);
});

test('store builds reject malformed boolean flags instead of silently falling back', () => {
  const config = buildConfig({});
  const errors = validateConfig(config, 'android', {
    CLAWKET_REQUIRE_REVENUECAT: 'tru',
  });

  assert.deepEqual(errors, [
    'CLAWKET_REQUIRE_REVENUECAT must be a boolean value (true/false or 1/0).',
  ]);
});

test('Android store builds fail closed when required RevenueCat config is absent', () => {
  const config = buildConfig({});
  const errors = validateConfig(config, 'android', {
    CLAWKET_REQUIRE_REVENUECAT: '1',
  });

  assert.deepEqual(errors, [
    'RevenueCat must be enabled for android store builds, but no EXPO_PUBLIC_REVENUECAT_* configuration was found.',
  ]);
});

test('Android store builds fail closed when required PostHog config is absent', () => {
  const config = buildConfig({});
  const errors = validateConfig(config, 'android', {
    CLAWKET_REQUIRE_POSTHOG: '1',
  });

  assert.deepEqual(errors, [
    'PostHog must be enabled for this build, but no EXPO_PUBLIC_POSTHOG_* configuration was found.',
  ]);
});

test('Android store builds require both the entitlement and Google API key', () => {
  const config = buildConfig({
    EXPO_PUBLIC_REVENUECAT_ENABLED: 'true',
    EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY: 'appl_test',
  });
  const errors = validateConfig(config, 'android', {
    CLAWKET_REQUIRE_REVENUECAT: '1',
  });

  assert.deepEqual(errors, [
    'RevenueCat is enabled but EXPO_PUBLIC_REVENUECAT_PRO_ENTITLEMENT_ID is missing.',
    'RevenueCat is enabled for Android but EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY is missing.',
  ]);
});

test('Android store config passes with the Google API key and entitlement', () => {
  const config = buildConfig({
    EXPO_PUBLIC_POSTHOG_API_KEY: 'phc_test',
    EXPO_PUBLIC_POSTHOG_HOST: 'https://example.test',
    EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY: 'goog_test',
    EXPO_PUBLIC_REVENUECAT_PRO_ENTITLEMENT_ID: 'pro',
  });
  const errors = validateConfig(config, 'android', {
    CLAWKET_REQUIRE_POSTHOG: '1',
    CLAWKET_REQUIRE_REVENUECAT: '1',
  });

  assert.deepEqual(errors, []);
});

test('store speech rejects missing and Preview endpoints and accepts the production domain', () => {
  const release = { CLAWKET_REQUIRE_SPEECH: '1' };
  const missing = buildConfig({});
  const preview = buildConfig({ EXPO_PUBLIC_SPEECH_URL: 'wss://clawket-speech-preview.clawket.workers.dev/v1/speech' });
  const production = buildConfig({ EXPO_PUBLIC_SPEECH_URL: 'wss://speech.clawket.ai/v1/speech' });
  const expected = ['Store builds require EXPO_PUBLIC_SPEECH_URL=wss://speech.clawket.ai/v1/speech.'];

  assert.deepEqual(validateConfig(missing, 'android', release), expected);
  assert.deepEqual(validateConfig(preview, 'ios', release), expected);
  assert.deepEqual(validateConfig(production, 'android', release), []);
});

test('EAS store profiles provide the production speech endpoint', () => {
  const eas = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf8'));
  const production = eas.build.production;

  assert.equal(production.environment, 'production');
  assert.equal(production.env.CLAWKET_OFFICIAL_BUILD, '1');
  assert.equal(production.env.CLAWKET_REQUIRE_SPEECH, '1');
  assert.equal(production.env.EXPO_PUBLIC_SPEECH_URL, 'wss://speech.clawket.ai/v1/speech');
  assert.equal(eas.build.testflight.extends, 'production');
  assert.match(validateConfig(buildConfig(production.env), 'android', production.env).join('\n'), /RevenueCat must be enabled/);
  assert.equal(eas.build.community.env.CLAWKET_OFFICIAL_BUILD, '0');
  assert.deepEqual(validateConfig(buildConfig({}), 'android', eas.build.community.env), []);
});
