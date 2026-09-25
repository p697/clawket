import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildConfig, parseBoolean, validateConfig } from './check-public-config.mjs';

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
  assert.equal(production.env.CLAWKET_REQUIRE_SPEECH, '1');
  assert.equal(production.env.EXPO_PUBLIC_SPEECH_URL, 'wss://speech.clawket.ai/v1/speech');
  assert.equal(eas.build.testflight.extends, 'production');
  assert.deepEqual(validateConfig(buildConfig(production.env), 'android', production.env), []);
});
