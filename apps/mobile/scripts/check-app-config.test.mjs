import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateAppConfig,
  validateAppConfigSource,
} from './check-app-config.mjs';

test('accepts an iOS app config with tablet support enabled', () => {
  assert.deepEqual(validateAppConfig({
    expo: {
      ios: { supportsTablet: true },
    },
  }), []);
});

test('rejects a config that makes the adaptive iPad UI unreachable', () => {
  assert.deepEqual(validateAppConfig({
    expo: {
      ios: { supportsTablet: false },
    },
  }), [
    'expo.ios.supportsTablet must be true so the canonical iPad sheet presentation is reachable.',
  ]);
});

test('fails closed on missing and corrupted config input', () => {
  assert.deepEqual(validateAppConfig({}), [
    'app.json must contain an expo object.',
  ]);
  assert.deepEqual(validateAppConfigSource(''), [
    'app.json must not be empty.',
  ]);
  assert.deepEqual(validateAppConfigSource('{"expo":'), [
    'app.json must contain valid JSON.',
  ]);
});
