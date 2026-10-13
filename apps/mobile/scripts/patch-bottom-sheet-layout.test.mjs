import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { applyBottomSheetLayoutPatch, patchBottomSheetLayout } from './patch-bottom-sheet-layout.mjs';

const mobileRoot = fileURLToPath(new URL('..', import.meta.url));
const entry = 'src/hooks/useAnimatedLayout.ts';
// MIT-licensed upstream hook, retained verbatim to exercise the original defect.
const original = fs.readFileSync(new URL('./fixtures/bottom-sheet-useAnimatedLayout-5.2.14.txt', import.meta.url), 'utf8');
const patched = patchBottomSheetLayout(original, entry);
const sentinel = -999;

/** Execute the actual hook; keep reaction previous values across React renders. */
function mountHook(source, { provider = true, modal = true } = {}) {
  let state;
  let cursor = 0;
  const reactions = [];
  const shared = value => ({ value, get() { return this.value; }, modify(fn) { this.value = fn(this.value); } });
  const container = provider ? shared({ height: 669, offset: { top: 0, bottom: 0, left: 0, right: 0 } }) : undefined;
  const deps = {
    react: {
      useMemo: fn => fn(),
      useState: fn => [state ??= fn()],
      useEffect: () => {},
    },
    'react-native': { Dimensions: { get: () => ({ width: 951, height: 669 }), addEventListener: () => {} } },
    'react-native-reanimated': {
      makeMutable: shared,
      useAnimatedReaction(prepare, react) {
        const index = cursor++;
        reactions[index] = { previous: reactions[index]?.previous ?? null, prepare, react };
      },
    },
    '../constants': { INITIAL_LAYOUT_VALUE: sentinel, INITIAL_CONTAINER_LAYOUT: { offset: { top: 0, bottom: 0, left: 0, right: 0 } } },
  };
  const exports = {};
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { exports, require: name => {
    assert.ok(Object.hasOwn(deps, name), `unexpected hook dependency ${name}`);
    return deps[name];
  } });
  const flush = () => {
    for (const reaction of reactions) {
      const value = reaction.prepare();
      const previous = reaction.previous;
      reaction.previous = value;
      reaction.react(value, previous);
    }
    return state.value.containerHeight;
  };
  return {
    render(top, bottom) { cursor = 0; exports.useAnimatedLayout(container, top, bottom, modal); return flush(); },
    resize(height) {
      if (container) container.value = { ...container.value, height };
      else state.value.rawContainerHeight = height;
      return flush();
    },
    get state() { return state; },
  };
}

test('both installation paths and the required gate include the reviewed patch', () => {
  for (const url of ['../package.json', '../../../package.json']) {
    const manifest = JSON.parse(fs.readFileSync(new URL(url, import.meta.url), 'utf8'));
    assert.ok(manifest.scripts.postinstall.includes('patch-bottom-sheet-layout.mjs'));
    if (url.startsWith('../../../')) assert.ok(manifest.scripts['test:required:rest'].includes('patch-bottom-sheet-layout.test.mjs'));
  }
});

test('reproduces upstream stale geometry after height arrives before centered insets', () => {
  const hook = mountHook(original);
  hook.render(24, 24);
  hook.resize(951);
  assert.equal(hook.render(140, 91), 903);
  assert.notEqual(hook.state.value.containerHeight, 720);
});

for (const provider of [true, false]) {
  test(`resizes the same shared state with either event order and inset-only changes (provider=${provider})`, () => {
    const hook = mountHook(patched, { provider });
    hook.render(24, 24);
    hook.resize(669);
    const stableState = hook.state;
    // Native size first, safe-area/centering props second.
    assert.equal(hook.resize(951), 903);
    assert.equal(hook.render(140, 91), 720);
    // Insets first, native size second.
    hook.render(24, 24);
    assert.equal(hook.resize(669), 621);
    assert.equal(hook.render(64, 32), 573);
    assert.equal(hook.render(32, 64), 573);
    assert.equal(hook.render(0, 0), 669);
    assert.equal(hook.state, stableState);
  });
}

test('non-modal geometry and unmeasured sentinels keep their existing meaning', () => {
  const hook = mountHook(patched, { provider: false });
  assert.equal(hook.render(24, 24), sentinel);
  assert.equal(hook.render(140, 91), sentinel);
  assert.equal(hook.resize(951), 720);
  const nonmodal = mountHook(patched, { modal: false });
  assert.equal(nonmodal.render(24, 24), 669);
  assert.equal(nonmodal.render(140, 91), 669);
  assert.equal(nonmodal.resize(951), 951);
});

test('provider rejects raw zero/undefined but accepts a measured effective height of zero', () => {
  const hook = mountHook(patched);
  assert.equal(hook.render(24, 24), 621);
  assert.equal(hook.resize(0), 621);
  assert.equal(hook.resize(undefined), 621);
  assert.equal(hook.resize(sentinel), 621);
  assert.equal(hook.resize(48), 0);
  assert.equal(hook.render(0, 0), 48);
});

test('the actual resize position setter accepts the fully expanded zero detent', () => {
  const positionEntry = 'src/components/bottomSheet/BottomSheet.tsx';
  const source = patchBottomSheetLayout(fs.readFileSync(path.join(mobileRoot, 'node_modules/@gorhom/bottom-sheet', positionEntry), 'utf8'), positionEntry);
  const parsed = ts.createSourceFile(positionEntry, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = [];
  const visit = node => {
    if (ts.isFunctionExpression(node) && node.name?.text === 'setToPosition') functions.push(node.getText(parsed));
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.equal(functions.length, 1);
  const run = (body, target) => {
    const position = { value: 231, get() { return this.value; } };
    const animation = { value: { status: 0 }, get() { return this.value; }, set(fn) { this.value = fn(this.value); } };
    const resized = { value: true };
    let stops = 0;
    const js = ts.transpileModule(`const resize = ${body}; resize(target);`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(js, { target, __DEV__: false, animatedPosition: position,
      animatedAnimationState: animation, animatedContainerHeightDidChange: resized,
      animatedDetentsState: { get: () => ({ detents: [0] }) },
      ANIMATION_STATUS: { RUNNING: 1 }, stopAnimation: () => { stops += 1; } });
    return { position: position.value, index: animation.value.nextIndex, resized: resized.value, stops };
  };
  const upstream = functions[0].replace('if (!targetPosition && targetPosition !== 0)', 'if (!targetPosition)');
  assert.equal(run(upstream, 0).position, 231);
  assert.deepEqual(run(functions[0], 0), { position: 0, index: 0, resized: false, stops: 1 });
  for (const invalid of [undefined, null, Number.NaN]) assert.equal(run(functions[0], invalid).position, 231);
});

test('rejects empty, drifted, duplicated, partial or unknown sources and applies idempotently', () => {
  assert.equal(patchBottomSheetLayout(patched, entry), patched);
  for (const source of [null, '', ' ', original + original, original.replace('topInset + bottomInset', 'topInset'),
    patched.replace('_state.containerHeight = result;', '_state.containerHeight = modal ? result - verticalInset : result;')]) {
    assert.throws(() => patchBottomSheetLayout(source, entry));
  }
  assert.throws(() => patchBottomSheetLayout(original, 'unknown'));
});

test('validates all runtime entries and versions before writing; fails on missing dependencies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawket-sheet-patch-'));
  const local = path.join(root, 'apps/mobile');
  const relative = 'node_modules/@gorhom/bottom-sheet';
  const installed = path.join(mobileRoot, relative);
  const target = path.join(local, relative);
  const entries = [entry, 'lib/module/hooks/useAnimatedLayout.js', 'lib/commonjs/hooks/useAnimatedLayout.js',
    'src/components/bottomSheet/BottomSheet.tsx', 'lib/module/components/bottomSheet/BottomSheet.js', 'lib/commonjs/components/bottomSheet/BottomSheet.js'];
  try {
    assert.throws(() => applyBottomSheetLayoutPatch(local), /missing/);
    for (const name of [...entries, 'package.json']) {
      const file = path.join(target, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.copyFileSync(path.join(installed, name), file);
    }
    fs.writeFileSync(path.join(target, entry), original);
    const last = path.join(target, entries[2]);
    const lastSource = fs.readFileSync(last, 'utf8');
    fs.writeFileSync(last, 'drifted');
    assert.throws(() => applyBottomSheetLayoutPatch(local), /drifted/);
    assert.equal(fs.readFileSync(path.join(target, entry), 'utf8'), original);
    fs.writeFileSync(last, lastSource);
    assert.equal(applyBottomSheetLayoutPatch(local), 6);
    assert.equal(applyBottomSheetLayoutPatch(local), 6);
    for (const name of entries) {
      const source = fs.readFileSync(path.join(target, name), 'utf8');
      assert.equal(patchBottomSheetLayout(source, name), source);
    }
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ version: '5.2.15' }));
    assert.throws(() => applyBottomSheetLayoutPatch(local), /before upgrading/);
  } finally { fs.rmSync(root, { recursive: true }); }
});
