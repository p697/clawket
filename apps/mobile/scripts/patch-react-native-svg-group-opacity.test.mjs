import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GROUP_DRAW_AFTER,
  GROUP_DRAW_BEFORE,
  applySvgGroupOpacityPatch,
  patchSvgGroupOpacity,
} from './patch-react-native-svg-group-opacity.mjs';

const relative = 'node_modules/react-native-svg/android/src/main/java/com/horcrux/svg/GroupView.java';
const source = `class GroupView extends RenderableView {
  void drawGroup(final Canvas canvas, final Paint paint, final float opacity) {
    pushGlyphContext();
${GROUP_DRAW_BEFORE}
    popGlyphContext();
  }
}
`;

test('both install entry points apply the patch', () => {
  for (const [url, script] of [['../package.json', './scripts/'], ['../../../package.json', 'apps/mobile/scripts/']]) {
    const manifest = JSON.parse(fs.readFileSync(fileURLToPath(new URL(url, import.meta.url)), 'utf8'));
    assert.ok(manifest.scripts.postinstall.includes(`node ${script}patch-react-native-svg-group-opacity.mjs`), url);
  }
});

test('a group draws into a local canvas and resets only its own layer, idempotently', () => {
  const patched = patchSvgGroupOpacity(source);
  const body = patched.slice(patched.indexOf('void drawGroup('), patched.indexOf('popGlyphContext();'));
  assert.ok(!body.includes('mLayerCanvas = canvas;'));
  assert.equal(body.split('mLayerCanvas').length - 1, 3, 'new Canvas, setBitmap and the hand-off to the local');
  assert.match(body, /final boolean offscreen = mOpacity != 1;\n {4}final Canvas layerCanvas;\n {4}if \(offscreen\) \{/);
  assert.match(body, /int count = node\.saveAndSetupCanvas\(layerCanvas, mCTM\);\n {8}node\.render\(layerCanvas, paint, opacity\);/);
  assert.match(body, /node\.restoreCanvas\(layerCanvas, count\);/);
  assert.match(body, /if \(offscreen\) \{\n.*\n {6}layerCanvas\.restore\(\);/);
  assert.equal(patchSvgGroupOpacity(patched), patched);
  assert.equal(patchSvgGroupOpacity(source.replaceAll('\n', '\r\n')), patched);
});

test('rejects missing, drifted, duplicated and mixed input', () => {
  for (const value of [null, '', ' ', 'class GroupView {}',
    source.replace('mLayerCanvas = canvas;', 'mLayerCanvas = null;'),
    source.replace('node.restoreCanvas(mLayerCanvas, count);', 'node.restoreCanvas(canvas, count);'),
    source + source, patchSvgGroupOpacity(source) + source,
    patchSvgGroupOpacity(source).replace('layerCanvas.restore();', 'mLayerCanvas.restore();'),
    source.replace(GROUP_DRAW_BEFORE, GROUP_DRAW_AFTER + '\n' + GROUP_DRAW_BEFORE)]) {
    assert.throws(() => patchSvgGroupOpacity(value));
  }
});

test('fails when dependency source is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawket-svg-group-patch-'));
  try { assert.throws(() => applySvgGroupOpacityPatch(path.join(root, 'apps/mobile')), /GroupView source is missing/); }
  finally { fs.rmSync(root, { recursive: true }); }
});

test('validates all installed copies before changing any and deduplicates workspace links', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawket-svg-group-patch-'));
  const mobileRoot = path.join(root, 'apps/mobile');
  const hoisted = path.join(root, relative);
  const local = path.join(mobileRoot, relative);
  try {
    for (const file of [hoisted, local]) fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(hoisted, source);
    fs.writeFileSync(local, 'drifted');
    assert.throws(() => applySvgGroupOpacityPatch(mobileRoot), /drifted/);
    assert.equal(fs.readFileSync(hoisted, 'utf8'), source);
    fs.writeFileSync(local, source);
    assert.equal(applySvgGroupOpacityPatch(mobileRoot), 2);
    for (const file of [hoisted, local]) assert.equal(fs.readFileSync(file, 'utf8'), patchSvgGroupOpacity(source));
    fs.unlinkSync(local);
    fs.symlinkSync(hoisted, local);
    assert.equal(applySvgGroupOpacityPatch(mobileRoot), 1);
  } finally { fs.rmSync(root, { recursive: true }); }
});
