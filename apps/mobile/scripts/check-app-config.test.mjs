import homeWidgets from '../plugins/with-home-widgets.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  validateAppConfig,
  validateAppConfigSource,
} from './check-app-config.mjs';

test('accepts an iOS app config with tablet support enabled', () => {
  assert.deepEqual(validateAppConfig(JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'))), []);
});

test('rejects missing scene support and ordering that would restore the launch crash', () => {
  const expo = { ios: { supportsTablet: true }, plugins: [] };
  assert.match(validateAppConfig({ expo })[0], /enableSceneSupport/);
  expo.plugins = [['expo-build-properties', { ios: { enableSceneSupport: true } }], './plugins/with-paste-input-setup'];
  assert.match(validateAppConfig({ expo })[0], /must follow/);
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


test('rejects portrait-only or fullscreen-only iPad config', () => {
  const source = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  source.expo.ios.requireFullScreen = true;
  assert.match(validateAppConfig(source)[0], /resizable windows/);
  source.expo.ios.requireFullScreen = false;
  source.expo.ios.infoPlist['UISupportedInterfaceOrientations~ipad'] = ['UIInterfaceOrientationPortrait'];
  assert.match(validateAppConfig(source)[0], /all four orientations/);
});


test('widget resources recover the invalid Xcode group path without changing a real resource directory', () => {
  for (const path of [undefined, 'undefined']) {
    const group = { path, name: 'Resources', children: [{ value: 'widget-mark' }] };
    const project = { pbxGroupByName: () => group };
    homeWidgets.normalizeWidgetResources(project);
    homeWidgets.normalizeWidgetResources(project);
    assert.equal(Object.hasOwn(group, 'path'), false);
    assert.deepEqual(group.children, [{ value: 'widget-mark' }]);
  }
  const existing = { path: 'Assets', children: [] };
  homeWidgets.normalizeWidgetResources({ pbxGroupByName: () => existing });
  assert.equal(existing.path, 'Assets');
});
