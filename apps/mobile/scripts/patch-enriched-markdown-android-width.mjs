import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 1.0.2's CommonMark intrinsic width can round back below TextView's line
// width at fractional screen densities. Its final glyph then wraps into a
// second line outside the measured one-line height. Reserve one physical
// pixel; Yoga still enforces the parent's maximum width.
export const WIDTH_ANCHOR = 'PixelUtil.toDIPFromPixel(ceil(maxLineWidth)),\n        PixelUtil.toDIPFromPixel(layout.height.toFloat()),';
export const WIDTH_PATCH = WIDTH_ANCHOR.replace('ceil(maxLineWidth)', 'ceil(maxLineWidth) + 1f');

export function patchAndroidMarkdownWidth(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Android Markdown measurement source is empty or malformed.');
  const originalCount = source.split(WIDTH_ANCHOR).length - 1;
  const patchedCount = source.split(WIDTH_PATCH).length - 1;
  if (originalCount === 0 && patchedCount === 1) return source;
  if (originalCount !== 1 || patchedCount !== 0) throw new Error('Android Markdown measurement does not match reviewed 1.0.2 source.');
  return source.replace(WIDTH_ANCHOR, WIDTH_PATCH);
}

export function applyAndroidMarkdownWidthPatch(mobileRoot) {
  const relative = 'node_modules/react-native-enriched-markdown/android/src/main/java/com/swmansion/enriched/markdown/MeasurementStore.kt';
  const candidates = [path.join(mobileRoot, relative), path.resolve(mobileRoot, '../..', relative)];
  const files = [...new Set(candidates.filter(fs.existsSync).map(file => fs.realpathSync(file)))];
  if (!files.length) throw new Error('Android Markdown measurement source is missing. Install mobile dependencies first.');
  const validated = files.map(file => ({ file, patched: patchAndroidMarkdownWidth(fs.readFileSync(file, 'utf8')) }));
  for (const { file, patched } of validated) fs.writeFileSync(file, patched);
  return files.length;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const count = applyAndroidMarkdownWidthPatch(process.env.CLAWKET_MOBILE_ROOT || path.resolve(path.dirname(scriptPath), '..'));
  console.log(`Verified enriched-markdown Android intrinsic width patch: ${count} source file(s).`);
}
