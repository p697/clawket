import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyAndroidMarkdownWidthPatch, patchAndroidMarkdownWidth, WIDTH_ANCHOR, WIDTH_PATCH } from './patch-enriched-markdown-android-width.mjs';

test('reserves one physical pixel without changing height, and is idempotent', () => {
  const source = `before\n${WIDTH_ANCHOR}\nafter`;
  const patched = patchAndroidMarkdownWidth(source);
  assert.equal(patched, `before\n${WIDTH_PATCH}\nafter`);
  assert.equal(patchAndroidMarkdownWidth(patched), patched);
});

test('rejects empty, missing, duplicate and corrupted measurement anchors', () => {
  for (const source of [null, '', 'unknown upstream', WIDTH_ANCHOR + WIDTH_ANCHOR, WIDTH_ANCHOR + WIDTH_PATCH, WIDTH_PATCH.replace('+ 1f', '+ 2f')]) {
    assert.throws(() => patchAndroidMarkdownWidth(source));
  }
});

test('patches standalone and hoisted installs and rejects missing input', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawket-markdown-width-'));
  const mobile = path.join(root, 'apps/mobile');
  try {
    assert.throws(() => applyAndroidMarkdownWidthPatch(mobile), /missing/);
    const relative = 'node_modules/react-native-enriched-markdown/android/src/main/java/com/swmansion/enriched/markdown/MeasurementStore.kt';
    const files = [path.join(root, relative), path.join(mobile, relative)];
    for (const file of files) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, WIDTH_ANCHOR); }
    assert.equal(applyAndroidMarkdownWidthPatch(mobile), 2);
    for (const file of files) assert.equal(fs.readFileSync(file, 'utf8'), WIDTH_PATCH);
    fs.writeFileSync(files[0], 'corrupted');
    assert.throws(() => applyAndroidMarkdownWidthPatch(mobile), /reviewed/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
