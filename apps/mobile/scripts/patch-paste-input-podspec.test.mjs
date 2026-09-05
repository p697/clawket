import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  applyPasteInputPodspecPatch,
  patchPasteInputPodspec,
} from './patch-paste-input-podspec.mjs';

const ORIGINAL = `Pod::Spec.new do |s|
  if ENV['RCT_NEW_ARCH_ENABLED'] != '1'
    raise Pod::Informative, "react-native-paste-input #{package["version"]} requires the React Native New Architecture (Fabric/TurboModules)."
  end
end
`;

test('accepts RN 0.82+ when the new-architecture environment value is unset', () => {
  const patched = patchPasteInputPodspec(ORIGINAL);
  assert.match(patched, /RCT_NEW_ARCH_ENABLED'\] == '0'/);
  assert.equal(patchPasteInputPodspec(patched), patched);
});

for (const hoisted of [true, false]) {
  test(`patches a ${hoisted ? 'workspace-hoisted' : 'standalone mobile'} install`, async () => {
    const fixture = await createFixture({ hoisted, contents: ORIGINAL });
    try {
      const patchedPath = applyPasteInputPodspecPatch(fixture.mobileRoot);
      assert.equal(patchedPath, fixture.podspecPath);
      assert.match(await readFile(patchedPath, 'utf8'), /RCT_NEW_ARCH_ENABLED'\] == '0'/);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
}

test('fails closed when upstream changes the reviewed podspec guard', async () => {
  const fixture = await createFixture({ hoisted: true, contents: '# unexpected upstream shape\n' });
  try {
    assert.throws(
      () => applyPasteInputPodspecPatch(fixture.mobileRoot),
      /missing the reviewed architecture guard/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function createFixture({ hoisted, contents }) {
  const root = await mkdtemp(path.join(tmpdir(), 'clawket-paste-podspec-'));
  const mobileRoot = path.join(root, 'apps', 'mobile');
  const dependencyRoot = hoisted
    ? path.join(root, 'node_modules')
    : path.join(mobileRoot, 'node_modules');
  const podspecPath = path.join(
    dependencyRoot,
    '@mattermost',
    'react-native-paste-input',
    'react-native-paste-input.podspec',
  );
  await mkdir(path.dirname(podspecPath), { recursive: true });
  await writeFile(podspecPath, contents, 'utf8');
  return { root, mobileRoot, podspecPath };
}
