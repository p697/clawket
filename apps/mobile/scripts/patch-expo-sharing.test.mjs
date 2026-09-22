import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchExpoSharing, applyExpoSharingPatch } from './patch-expo-sharing.mjs';

const source = `return if (type == "text/plain") {
  val text = intent.getStringExtra(Intent.EXTRA_TEXT)
}
shareType = ShareType.fromMimeType(specificType)`;

test('Android compiles the patched sharing source instead of a prebuilt binary', () => {
  const manifest = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  assert.ok(manifest.expo.autolinking.android.buildFromSource.includes('expo-sharing'));
});

test('preserves the text-body path but treats stream text MIME as files, idempotently', () => {
  const result = patchExpoSharing(source);
  assert.match(result, /!intent.hasExtra\(Intent.EXTRA_STREAM\)/);
  assert.match(result, /if \(it == ShareType.Text\) ShareType.File else it/);
  assert.equal(patchExpoSharing(result), result);
});

test('rejects empty, drifted and duplicated input instead of silently skipping', () => {
  for (const value of ['', null, source.replace('specificType', 'changedType'), source + source, patchExpoSharing(source) + source]) {
    assert.throws(() => patchExpoSharing(value));
  }
});

test('fails when dependency sources are absent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawket-sharing-patch-'));
  try { assert.throws(() => applyExpoSharingPatch(root), /parser is missing/); }
  finally { fs.rmSync(root, { recursive: true }); }
});
