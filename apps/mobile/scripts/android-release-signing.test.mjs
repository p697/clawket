import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const releaseSigningPlugin = require('../plugins/with-android-release-signing.js');
const { applyReleaseSigningToGradle, isReleaseTaskName } = releaseSigningPlugin;

const DEBUG_SIGNING_LINE = '            signingConfig signingConfigs.debug';
const RELEASE_SIGNING_BRANCH = `            if (hasReleaseSigningConfig) {
                signingConfig signingConfigs.release
            } else {
                signingConfig signingConfigs.debug
            }`;

function createExpoGradleFixture({ releaseSigningLine = DEBUG_SIGNING_LINE } = {}) {
  return `apply plugin: "com.android.application"

def projectRoot = rootDir.getAbsoluteFile().getParentFile().getAbsolutePath()

android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
${DEBUG_SIGNING_LINE}
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
${releaseSigningLine}
            minifyEnabled false
        }
    }
}
`;
}

test('release task detection ignores debug bundle tasks and catches release variants', () => {
  for (const taskName of [
    'bundleDebug',
    'createBundleDebugJsAndAssets',
    'copyDebugBundledJs',
    'assembleDebug',
    'packageDebug',
  ]) {
    assert.equal(isReleaseTaskName(taskName), false, taskName);
  }

  for (const taskName of [
    'bundleRelease',
    'createBundleReleaseJsAndAssets',
    'assembleRelease',
    'packageRelease',
    'signReleaseBundle',
  ]) {
    assert.equal(isReleaseTaskName(taskName), true, taskName);
  }
});

test('plugin scopes release signing to the release build type and is idempotent', () => {
  const output = applyReleaseSigningToGradle(createExpoGradleFixture());

  assert.match(output, /task\.name\?\.toLowerCase\(\)\?\.contains\("release"\)/);
  assert.doesNotMatch(output, /contains\("bundle"\)/);
  assert.match(
    output,
    /buildTypes \{\n        debug \{\n            signingConfig signingConfigs\.debug\n        \}\n        release \{[\s\S]*?if \(hasReleaseSigningConfig\) \{\n                signingConfig signingConfigs\.release/,
  );
  assert.equal(applyReleaseSigningToGradle(output), output);
});

test('plugin repairs the previously misapplied debug signing branch', () => {
  const broken = createExpoGradleFixture({ releaseSigningLine: DEBUG_SIGNING_LINE }).replace(
    `        debug {
${DEBUG_SIGNING_LINE}
        }
        release {`,
    `        debug {
${RELEASE_SIGNING_BRANCH}
        }
        release {`,
  );

  const output = applyReleaseSigningToGradle(broken);
  assert.match(
    output,
    /buildTypes \{\n        debug \{\n            signingConfig signingConfigs\.debug\n        \}\n        release \{/,
  );
  assert.match(output, /release \{[\s\S]*?signingConfig signingConfigs\.release/);
});

test('plugin fails closed when the release signing anchor is missing', () => {
  const corrupt = createExpoGradleFixture({ releaseSigningLine: '            minifyEnabled false' });

  assert.throws(
    () => applyReleaseSigningToGradle(corrupt),
    /release build type is missing its signing config anchor/,
  );
});
