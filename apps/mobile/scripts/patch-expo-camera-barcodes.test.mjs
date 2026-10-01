import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchExpoCameraBarcodes, applyExpoCameraBarcodesPatch } from './patch-expo-camera-barcodes.mjs';

const source = `      barcodeScanner.process(image)
        .addOnSuccessListener { barcodes ->
          if (barcodes.isEmpty()) {
            return@addOnSuccessListener
          }
          val barcode = barcodes.first()
          val raw = barcode.rawValue ?: barcode.rawBytes?.let { String(it) }

          val cornerPoints = barcode.cornerPoints?.let { points ->
            // Pre-allocate array
            IntArray(points.size * 2).apply {
              points.forEachIndexed { index, point ->
                this[index * 2] = point.x
                this[index * 2 + 1] = point.y
              }
            }.toMutableList()
          } ?: mutableListOf()

          val extra = BarCodeScannerResultSerializer.parseExtraDate(barcode)
          onComplete(
            BarCodeScannerResult(
              barcode.format,
              barcode.displayValue,
              raw,
              extra,
              cornerPoints,
              effectiveHeight,
              effectiveWidth
            )
          )
        }
        .addOnFailureListener {
          handleFailure()
        }
        .addOnCompleteListener {
          imageProxy.close()
        }`;
const relative = 'node_modules/expo-camera/android/src/main/java/expo/modules/camera/analyzers/BarcodeAnalyzer.kt';

test('Android compiles patched camera source instead of the prebuilt module', () => {
  const manifest = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  assert.ok(manifest.expo.autolinking.android.buildFromSource.includes('expo-camera'));
  for (const url of ['../package.json', '../../../package.json']) {
    const config = JSON.parse(fs.readFileSync(fileURLToPath(new URL(url, import.meta.url)), 'utf8'));
    assert.ok(config.scripts.postinstall.includes('patch-expo-camera-barcodes.mjs'));
  }
});

test('delivers every barcode with unchanged per-code data, coordinates and cleanup, idempotently', () => {
  const patched = patchExpoCameraBarcodes(source);
  assert.ok(!patched.includes('barcodes.first()'));
  // Strip only the new loop and its indentation: the reviewed result stays exact.
  const restored = patched.replace(/          for \(barcode in barcodes\) \{\n([\s\S]*?)\n          }\n        }/, (_loop, body) =>
    '          val barcode = barcodes.first()\n' + body.split('\n').map(line => line ? line.slice(2) : line).join('\n') + '\n        }');
  assert.equal(restored, source);
  assert.equal(patchExpoCameraBarcodes(patched), patched);
});

test('rejects missing, drifted, duplicated and mixed input', () => {
  for (const value of [null, '', ' ', source.replace('effectiveHeight', 'imageProxy.height'),
    source + source, patchExpoCameraBarcodes(source) + source, patchExpoCameraBarcodes(source).replace('raw,', 'changedRaw,')]) {
    assert.throws(() => patchExpoCameraBarcodes(value));
  }
});

test('fails when dependency source is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawket-camera-patch-'));
  try { assert.throws(() => applyExpoCameraBarcodesPatch(path.join(root, 'apps/mobile')), /analyzer is missing/); }
  finally { fs.rmSync(root, { recursive: true }); }
});

test('validates all installed copies before changing any and deduplicates workspace links', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawket-camera-patch-'));
  const mobileRoot = path.join(root, 'apps/mobile');
  const hoisted = path.join(root, relative);
  const local = path.join(mobileRoot, relative);
  try {
    for (const file of [hoisted, local]) fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(hoisted, source);
    fs.writeFileSync(local, 'drifted');
    assert.throws(() => applyExpoCameraBarcodesPatch(mobileRoot));
    assert.equal(fs.readFileSync(hoisted, 'utf8'), source);
    fs.writeFileSync(local, source);
    assert.equal(applyExpoCameraBarcodesPatch(mobileRoot), 2);
    assert.equal(fs.readFileSync(local, 'utf8'), patchExpoCameraBarcodes(source));
    fs.unlinkSync(local);
    fs.symlinkSync(hoisted, local);
    assert.equal(applyExpoCameraBarcodesPatch(mobileRoot), 1);
  } finally { fs.rmSync(root, { recursive: true }); }
});
