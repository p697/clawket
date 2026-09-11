import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL('./patch-android-native-deps.sh', import.meta.url));
const menuNeedle = `      // MenuViewManager
      if (getReactNativeMinorVersion() <= 75) {
        java.srcDirs += "src/reactNativeVersionPatch/MenuViewManager/75"
      } else {
        java.srcDirs += "src/reactNativeVersionPatch/MenuViewManager/latest"
      }
`;
const keyboardNeedle = `      if (project.ext.shouldUseBaseReactPackage()) {
        java.srcDirs += ['src/base']
      } else {
        java.srcDirs += ['src/turbo']
      }
`;

test('patches dependencies hoisted to the workspace root before the root postinstall', async () => {
  const fixture = await createFixture({ hoisted: true });
  try {
    await runPatch(fixture.mobileRoot);
    for (const file of fixture.files) {
      assert.match(await readFile(file, 'utf8'), /kotlin\.srcDirs \+= java\.srcDirs/);
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('patches standalone mobile dependencies', async () => {
  const fixture = await createFixture({ hoisted: false });
  try {
    await runPatch(fixture.mobileRoot);
    for (const file of fixture.files) {
      assert.match(await readFile(file, 'utf8'), /kotlin\.srcDirs \+= java\.srcDirs/);
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('fails closed when an installed dependency no longer has the reviewed block', async () => {
  const fixture = await createFixture({ hoisted: true, corruptMenu: true });
  try {
    await assert.rejects(runPatch(fixture.mobileRoot), /Unable to patch expected block/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function createFixture({ hoisted, corruptMenu = false }) {
  const root = await mkdtemp(path.join(tmpdir(), 'clawket-android-patch-'));
  const mobileRoot = path.join(root, 'apps', 'mobile');
  const dependencyRoot = hoisted ? path.join(root, 'node_modules') : path.join(mobileRoot, 'node_modules');
  const menuFile = path.join(dependencyRoot, '@react-native-menu', 'menu', 'android', 'build.gradle');
  const keyboardFile = path.join(dependencyRoot, 'react-native-keyboard-controller', 'android', 'build.gradle');
  await Promise.all([
    mkdir(path.dirname(menuFile), { recursive: true }),
    mkdir(path.dirname(keyboardFile), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(menuFile, corruptMenu ? '// unexpected upstream shape\n' : menuNeedle, 'utf8'),
    writeFile(keyboardFile, keyboardNeedle, 'utf8'),
  ]);
  return { root, mobileRoot, files: [menuFile, keyboardFile] };
}

async function runPatch(mobileRoot) {
  return execFileAsync('bash', [scriptPath], {
    env: { ...process.env, CLAWKET_MOBILE_ROOT: mobileRoot },
    encoding: 'utf8',
  });
}
