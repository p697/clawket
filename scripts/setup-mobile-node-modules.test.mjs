import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const sourceScript = fileURLToPath(new URL('./setup-mobile-node-modules.mjs', import.meta.url));

test('links Expo Modules Core for a clean hoisted install when it is only transitive', async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'clawket-mobile-node-modules-'));
  const fixtureScript = path.join(fixtureRoot, 'scripts', 'setup-mobile-node-modules.mjs');
  const mobileRoot = path.join(fixtureRoot, 'apps', 'mobile');
  const sourcePackage = path.join(fixtureRoot, 'node_modules', 'expo-modules-core');
  const targetPackage = path.join(mobileRoot, 'node_modules', 'expo-modules-core');

  try {
    await Promise.all([
      mkdir(path.dirname(fixtureScript), { recursive: true }),
      mkdir(mobileRoot, { recursive: true }),
      mkdir(sourcePackage, { recursive: true }),
    ]);
    await Promise.all([
      copyFile(sourceScript, fixtureScript),
      writeFile(
        path.join(mobileRoot, 'package.json'),
        JSON.stringify({ dependencies: { expo: 'fixture' } }),
        'utf8',
      ),
      writeFile(path.join(sourcePackage, 'fixture.txt'), 'linked', 'utf8'),
    ]);

    await execFileAsync(process.execPath, [fixtureScript]);

    assert.equal(await realpath(targetPackage), await realpath(sourcePackage));
    assert.equal(await readFile(path.join(targetPackage, 'fixture.txt'), 'utf8'), 'linked');
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
