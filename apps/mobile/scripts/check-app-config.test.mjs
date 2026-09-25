import homeWidgets from '../plugins/with-home-widgets.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import appConfig from '../app.config.js';
import {
  validateAppConfig,
  validateAppConfigSource,
} from './check-app-config.mjs';

test('source config has no operator account and supports explicitly supplied build identities', () => {
  const source = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  assert.equal(source.expo.ios.appleTeamId, undefined);
  assert.equal(source.expo.owner, undefined);
  assert.equal(source.expo.extra.eas.projectId, undefined);
  const names = ['EXPO_APPLE_TEAM_ID', 'EXPO_EAS_OWNER', 'EXPO_EAS_PROJECT_ID'];
  const previous = names.map(name => process.env[name]);
  try {
    for (const name of names) delete process.env[name];
    const community = appConfig({ config: source.expo });
    assert.equal(community.ios.appleTeamId, undefined);
    assert.equal(community.extra.eas.projectId, undefined);
    process.env.EXPO_APPLE_TEAM_ID = 'TESTTEAM00';
    process.env.EXPO_EAS_OWNER = 'test-owner';
    process.env.EXPO_EAS_PROJECT_ID = 'test-project';
    const own = appConfig({ config: source.expo });
    assert.equal(own.ios.appleTeamId, 'TESTTEAM00');
    assert.equal(own.owner, 'test-owner');
    assert.equal(own.extra.eas.projectId, 'test-project');
    assert.deepEqual(own.extra.eas.build, source.expo.extra.eas.build);
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});

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
