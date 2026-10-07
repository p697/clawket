#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ANDROID_MEDIA_READ_PERMISSIONS = [
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_AUDIO',
];

export function validateAndroidMediaPermissions(expo) {
  const android = expo?.android;
  if (!android || typeof android !== 'object' || Array.isArray(android)) {
    return ['expo.android must contain the system-picker media permission policy.'];
  }
  if (!Array.isArray(android.permissions) || !Array.isArray(android.blockedPermissions)
    || !android.permissions.every(permission => typeof permission === 'string')
    || !android.blockedPermissions.every(permission => typeof permission === 'string')
    || ANDROID_MEDIA_READ_PERMISSIONS.some(permission => android.permissions.includes(permission)
      || !android.blockedPermissions.includes(permission))) {
    return ['Android media read permissions must be blocked, never explicitly requested; use system pickers.'];
  }
  const mediaPlugins = Array.isArray(expo.plugins)
    ? expo.plugins.filter(plugin => plugin === 'expo-media-library'
      || (Array.isArray(plugin) && plugin[0] === 'expo-media-library')) : [];
  if (mediaPlugins.length !== 1 || !Array.isArray(mediaPlugins[0])
    || !Array.isArray(mediaPlugins[0][1]?.granularPermissions)
    || mediaPlugins[0][1].granularPermissions.length !== 0) {
    return ['expo-media-library must explicitly set granularPermissions to [] to prevent implicit Android media reads.'];
  }
  return [];
}

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

  return validateAndroidMediaPermissions(expo);
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

  console.log('[check-app-config] verified 4 iOS invariants and 2 Android media invariants: blocked reads and an explicit write-only plugin configuration.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
