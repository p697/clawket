import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.CLAWKET_MOBILE_ROOT || fileURLToPath(new URL('..', import.meta.url));
const targets = [
  ['@react-native-menu/menu/android/build.gradle', `      // MenuViewManager
      if (getReactNativeMinorVersion() <= 75) {
        java.srcDirs += "src/reactNativeVersionPatch/MenuViewManager/75"
      } else {
        java.srcDirs += "src/reactNativeVersionPatch/MenuViewManager/latest"
      }
`],
  ['react-native-keyboard-controller/android/build.gradle', `      if (project.ext.shouldUseBaseReactPackage()) {
        java.srcDirs += ['src/base']
      } else {
        java.srcDirs += ['src/turbo']
      }
`],
];
const suffix = '\n      // Mirror Kotlin sources for recent AGP/KGP.\n      kotlin.srcDirs += java.srcDirs\n';
// Validate every anchor before writing, including on repeat installs.
const patches = targets.map(([relativePath, needle]) => {
  const candidates = [path.join(root, 'node_modules', relativePath), path.resolve(root, '../..', 'node_modules', relativePath)];
  const file = candidates.find(existsSync);
  if (!file) throw new Error(`Missing dependency Gradle file; searched: ${candidates.join(', ')}`);
  const text = readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
  if (!text.includes(needle)) throw new Error(`Unable to patch expected block in ${file}`);
  return { file, text: text.includes('kotlin.srcDirs += java.srcDirs') ? text : text.replace(needle, needle + suffix) };
});
for (const { file, text } of patches) writeFileSync(file, text, 'utf8');
console.log(`Verified ${patches.length} Android native dependency patches`);
