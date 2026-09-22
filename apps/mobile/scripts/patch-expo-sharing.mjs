import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Reviewed against expo-sharing 57.0.20. A text MIME does not mean EXTRA_TEXT:
// file-manager shares carry EXTRA_STREAM and must retain a file payload.
const replacements = [
  ['return if (type == "text/plain") {', 'return if (type == "text/plain" && !intent.hasExtra(Intent.EXTRA_STREAM)) {'],
  ['shareType = ShareType.fromMimeType(specificType)', 'shareType = ShareType.fromMimeType(specificType).let { if (it == ShareType.Text) ShareType.File else it }'],
];

export function patchExpoSharing(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Expo sharing source is missing or malformed.');
  let result = source;
  for (const [before, after] of replacements) {
    if (result.includes(after)) {
      if (result.split(after).length !== 2 || result.replace(after, '').includes(before)) throw new Error('Expo sharing patch is duplicated.');
      continue;
    }
    if (result.split(before).length !== 2) throw new Error('Expo sharing parser drifted from the reviewed text-file branches.');
    result = result.replace(before, after);
  }
  return result;
}

export function applyExpoSharingPatch(mobileRoot) {
  const relative = 'node_modules/expo-sharing/android/src/main/java/expo/modules/sharing/dataParsers/SimpleShareIntentDataParser.kt';
  const candidates = [path.join(mobileRoot, relative), path.resolve(mobileRoot, '../..', relative)];
  const files = [...new Set(candidates.filter(file => fs.existsSync(file)).map(file => fs.realpathSync(file)))];
  if (!files.length) throw new Error('Expo sharing parser is missing. Install mobile dependencies first.');
  const patches = files.map(file => { const source = fs.readFileSync(file, 'utf8'); return { file, source, patched: patchExpoSharing(source) }; });
  for (const { file, source, patched } of patches) if (patched !== source) fs.writeFileSync(file, patched);
  return files.length;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const count = applyExpoSharingPatch(process.env.CLAWKET_MOBILE_ROOT || path.resolve(path.dirname(scriptPath), '..'));
  console.log(`Verified Expo incoming text-file sharing: ${count} parser file(s), 2 reviewed branches each.`);
}
