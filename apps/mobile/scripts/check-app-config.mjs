#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function validateAppConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return ['app.json must contain a JSON object.'];
  }

  const expo = config.expo;
  if (!expo || typeof expo !== 'object' || Array.isArray(expo)) {
    return ['app.json must contain an expo object.'];
  }

  const ios = expo.ios;
  if (!ios || typeof ios !== 'object' || Array.isArray(ios)) {
    return ['app.json must contain an expo.ios object.'];
  }

  if (ios.supportsTablet !== true) {
    return [
      'expo.ios.supportsTablet must be true so the canonical iPad sheet presentation is reachable.',
    ];
  }

  const plugins = Array.isArray(expo.plugins) ? expo.plugins : [];
  const buildPropertiesIndex = plugins.findIndex((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties');
  const pasteInputIndex = plugins.indexOf('./plugins/with-paste-input-setup');
  if (buildPropertiesIndex < 0 || plugins[buildPropertiesIndex][1]?.ios?.enableSceneSupport !== true) {
    return ['Expo SDK 57 must enable ios.enableSceneSupport to launch on iOS 27.'];
  }
  // Config mod actions run in reverse registration order: Expo must migrate first.
  if (pasteInputIndex < 0 || buildPropertiesIndex <= pasteInputIndex) {
    return ['expo-build-properties must follow with-paste-input-setup so scene migration runs before paste registration.'];
  }

  const orientations = ios.infoPlist?.['UISupportedInterfaceOrientations~ipad'];
  if (!Array.isArray(orientations) || ![
    'UIInterfaceOrientationPortrait', 'UIInterfaceOrientationPortraitUpsideDown',
    'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight',
  ].every(value => orientations.includes(value)) || ios.requireFullScreen !== false) {
    return ['iPad must support all four orientations and allow resizable windows (requireFullScreen: false).'];
  }

  return [];
}

export function validateAppConfigSource(source) {
  if (typeof source !== 'string' || source.trim().length === 0) {
    return ['app.json must not be empty.'];
  }

  try {
    return validateAppConfig(JSON.parse(source));
  } catch {
    return ['app.json must contain valid JSON.'];
  }
}

function main() {
  const appConfigPath = resolve(import.meta.dirname, '..', 'app.json');
  const errors = validateAppConfigSource(readFileSync(appConfigPath, 'utf8'));

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`[check-app-config] ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('[check-app-config] verified 4 iOS invariants: tablet support, scene lifecycle, native plugin ordering, and iPad window resizing.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
