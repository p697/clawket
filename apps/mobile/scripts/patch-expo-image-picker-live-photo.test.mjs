import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { patchImagePickerLivePhoto, applyImagePickerLivePhotoPatch } from './patch-expo-image-picker-live-photo.mjs';

const installed = fs.readFileSync(new URL('../node_modules/expo-image-picker/ios/MediaHandler.swift', import.meta.url), 'utf8');
const before = 'itemProvider.canLoadObject(ofClass: PHLivePhoto.self) && options.mediaTypes.contains(.livePhotos)';
const after = 'options.mediaTypes.contains(.livePhotos) && itemProvider.hasItemConformingToTypeIdentifier(UTType.livePhoto.identifier)';
const original = installed.replace(after, before);

test('both install entry points and required gate include the native guard', () => {
  for (const url of ['../package.json', '../../../package.json']) {
    const manifest = JSON.parse(fs.readFileSync(new URL(url, import.meta.url), 'utf8'));
    assert.ok(manifest.scripts.postinstall.includes('patch-expo-image-picker-live-photo.mjs'));
    if (url.startsWith('../../../')) assert.ok(manifest.scripts['test:required:rest'].includes('patch-expo-image-picker-live-photo.test.mjs'));
  }
});

test('backports only the official Live Photo detection and is idempotent', () => {
  const patched = patchImagePickerLivePhoto(original);
  assert.equal(patched, original.replace(before, after));
  assert.equal(patchImagePickerLivePhoto(patched), patched);
});

test('rejects empty, corrupted, duplicated and drifted native sources', () => {
  for (const source of ['', null, original + '\n', original.replace(before, before + ' && true'), original + after]) {
    assert.throws(() => patchImagePickerLivePhoto(source));
  }
});

test('installation rejects missing sources, wrong package and unreviewed versions', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawket-picker-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => applyImagePickerLivePhotoPatch(root), /missing/);
  const dep = path.join(root, 'node_modules/expo-image-picker');
  fs.mkdirSync(path.join(dep, 'ios'), { recursive: true });
  const manifest = (name, version) => fs.writeFileSync(path.join(dep, 'package.json'), JSON.stringify({ name, version }));
  manifest('expo-image-picker', '57.0.18');
  assert.throws(() => applyImagePickerLivePhotoPatch(root), /ENOENT/);
  fs.writeFileSync(path.join(dep, 'ios/MediaHandler.swift'), original);
  for (const [name, version] of [['other', '57.0.18'], ['expo-image-picker', '57.0.19']]) {
    manifest(name, version);
    assert.throws(() => applyImagePickerLivePhotoPatch(root), /before upgrading/);
    assert.equal(fs.readFileSync(path.join(dep, 'ios/MediaHandler.swift'), 'utf8'), original);
  }
  manifest('expo-image-picker', '57.0.18');
  assert.equal(applyImagePickerLivePhotoPatch(root), 1);
  assert.equal(applyImagePickerLivePhotoPatch(root), 1);
});
