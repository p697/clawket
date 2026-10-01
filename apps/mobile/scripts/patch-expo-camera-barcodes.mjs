import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Reviewed against expo-camera 57.0.5. Frame selection needs every detected QR,
// preserving Expo's raw data and rotated coordinates for each individual result.
const resultBody = `          val raw = barcode.rawValue ?: barcode.rawBytes?.let { String(it) }

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
          )`;
const prefix = `        .addOnSuccessListener { barcodes ->
          if (barcodes.isEmpty()) {
            return@addOnSuccessListener
          }
`;
const suffix = '\n        }\n        .addOnFailureListener {';
const before = prefix + '          val barcode = barcodes.first()\n' + resultBody + suffix;
const after = prefix + '          for (barcode in barcodes) {\n'
  + resultBody.split('\n').map(line => line ? '  ' + line : line).join('\n')
  + '\n          }' + suffix;

export function patchExpoCameraBarcodes(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Expo camera analyzer source is missing or malformed.');
  const originalCount = source.split(before).length - 1;
  const patchedCount = source.split(after).length - 1;
  const listenerCount = source.split('.addOnSuccessListener { barcodes ->').length - 1;
  if (listenerCount !== 1 || originalCount + patchedCount !== 1) {
    throw new Error('Expo camera analyzer drifted from the reviewed barcode result block.');
  }
  return originalCount === 1 ? source.replace(before, after) : source;
}

export function applyExpoCameraBarcodesPatch(mobileRoot) {
  const relative = 'node_modules/expo-camera/android/src/main/java/expo/modules/camera/analyzers/BarcodeAnalyzer.kt';
  const candidates = [path.join(mobileRoot, relative), path.resolve(mobileRoot, '../..', relative)];
  const files = [...new Set(candidates.filter(file => fs.existsSync(file)).map(file => fs.realpathSync(file)))];
  if (!files.length) throw new Error('Expo camera analyzer is missing. Install mobile dependencies first.');
  const patches = files.map(file => {
    const source = fs.readFileSync(file, 'utf8');
    return { file, source, patched: patchExpoCameraBarcodes(source) };
  });
  for (const { file, source, patched } of patches) if (source !== patched) fs.writeFileSync(file, patched);
  return files.length;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const count = applyExpoCameraBarcodesPatch(process.env.CLAWKET_MOBILE_ROOT || path.resolve(path.dirname(scriptPath), '..'));
  console.log(`Verified Expo camera multi-barcode delivery: ${count} analyzer file(s), 1 reviewed result block each.`);
}
