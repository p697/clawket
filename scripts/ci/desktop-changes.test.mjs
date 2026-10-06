import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { affectsDesktop, postinstallScripts, desktopJobMatrix } from './desktop-changes.mjs';

const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

test('mobile, documentation and speech-only changes skip the desktop suites', () => {
  for (const paths of [
    ['apps/mobile/src/components/ui/Button.tsx', 'apps/mobile/AGENTS.md'],
    ['docs/3.0/PROGRESS.md', 'README.md', 'README.zh-CN.md', 'AGENTS.md'],
    ['apps/mobile/scripts/check-ui-style.mjs', '.gitignore'],
    ['apps/speech-worker/src/index.ts'],
  ]) {
    assert.equal(affectsDesktop(paths, manifest).desktop, false, paths.join(', '));
  }
});

test('Bridge, Relay, shared package, install, test and workflow changes run them', () => {
  for (const entry of [
    'apps/bridge-cli/src/index.ts',
    'apps/relay-worker/src/index.ts',
    'packages/agent-protocol/src/index.ts',
    'scripts/bridge/local-model-supervisor.mjs',
    'tests/compat/PINNED.md',
    '.github/workflows/required-checks.yml',
    'package-lock.json',
    'tsconfig.bridge-base.json',
    'a-new-root-config.json',
  ]) {
    const decision = affectsDesktop(['apps/mobile/App.tsx', entry], manifest);
    assert.equal(decision.desktop, true, entry);
    assert.deepEqual(decision.matched, [entry]);
  }
});

test('scripts the root postinstall runs count as desktop changes', () => {
  const scripts = postinstallScripts(manifest);
  assert.ok(scripts.includes('apps/mobile/scripts/patch-expo-sharing.mjs'), scripts.join(', '));
  assert.equal(affectsDesktop(['apps/mobile/scripts/patch-expo-sharing.mjs'], manifest).desktop, true);
  assert.deepEqual(postinstallScripts({ scripts: { postinstall: 'node a.mjs && node dir/b.js' } }), ['a.mjs', 'dir/b.js']);
  assert.deepEqual(postinstallScripts({}), []);
});

test('an unknown or corrupted change list runs the desktop jobs', () => {
  for (const paths of [undefined, null, [], [''], 'apps/mobile/App.tsx', [42]]) {
    assert.equal(affectsDesktop(paths, manifest).desktop, true, JSON.stringify(paths));
  }
});


test('mobile-only jobs still generate both protected OS check names on lightweight runners', () => {
  const decision = affectsDesktop(['apps/mobile/src/connection/index.ts'], manifest);
  assert.deepEqual(desktopJobMatrix(decision), { include: [
    { os: 'windows-latest', runner: 'ubuntu-latest', runDesktop: false },
    { os: 'macos-latest', runner: 'ubuntu-latest', runDesktop: false },
  ] });
});

test('desktop changes run the unchanged real platform suites', () => {
  const matrix = desktopJobMatrix(affectsDesktop(['.github/workflows/required-checks.yml'], manifest));
  assert.deepEqual(matrix.include.map(({ os, runner, runDesktop }) => [os, runner, runDesktop]), [
    ['windows-latest', 'windows-latest', true], ['macos-latest', 'macos-latest', true],
  ]);
});

test('missing or corrupted selector decisions fail closed on both desktop platforms', () => {
  for (const input of [undefined, null, {}, { desktop: 'false' }, { desktop: 0 }, { desktop: null }]) {
    const matrix = desktopJobMatrix(input);
    assert.equal(matrix.include.length, 2);
    for (const job of matrix.include) {
      assert.equal(job.runner, job.os);
      assert.equal(job.runDesktop, true);
    }
  }
});
