import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Backport https://github.com/expo/expo/pull/50435 to expo-image-picker 57.0.18.
// Check opt-in first and use the type identifier, avoiding PHLivePhoto introspection.
const before = 'itemProvider.canLoadObject(ofClass: PHLivePhoto.self) && options.mediaTypes.contains(.livePhotos)';
const after = 'options.mediaTypes.contains(.livePhotos) && itemProvider.hasItemConformingToTypeIdentifier(UTType.livePhoto.identifier)';
const reviewedHash = '876dbd333aec2ab115b9fee68f57d4152f660707268b4ffe595d646cea30e2ba';

export function patchImagePickerLivePhoto(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Image picker source is missing or malformed.');
  const original = source.replace(after, before);
  if (createHash('sha256').update(original).digest('hex') !== reviewedHash) {
    throw new Error('Image picker 57.0.18 MediaHandler source drifted; review the Live Photo guard.');
  }
  return original.replace(before, after);
}

export function applyImagePickerLivePhotoPatch(mobileRoot) {
  const relative = 'node_modules/expo-image-picker';
  const roots = [...new Set([path.join(mobileRoot, relative), path.resolve(mobileRoot, '../..', relative)]
    .filter(root => fs.existsSync(root)).map(root => fs.realpathSync(root)))];
  if (!roots.length) throw new Error('Image picker dependency is missing. Install mobile dependencies first.');
  const patches = roots.map(root => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (manifest.name !== 'expo-image-picker' || manifest.version !== '57.0.18') {
      throw new Error('Review the image picker Live Photo guard before upgrading.');
    }
    const file = path.join(root, 'ios/MediaHandler.swift');
    const source = fs.readFileSync(file, 'utf8');
    return { file, source, patched: patchImagePickerLivePhoto(source) };
  });
  for (const { file, source, patched } of patches) if (source !== patched) fs.writeFileSync(file, patched);
  return patches.length;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const count = applyImagePickerLivePhotoPatch(process.env.CLAWKET_MOBILE_ROOT || path.resolve(path.dirname(scriptPath), '..'));
  console.log(`Verified image picker Live Photo opt-in guard: ${count} native source file(s).`);
}
