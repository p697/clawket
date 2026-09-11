import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGINAL = `  if ENV['RCT_NEW_ARCH_ENABLED'] != '1'
    raise Pod::Informative, "react-native-paste-input #{package["version"]} requires the React Native New Architecture (Fabric/TurboModules)."
  end`;

const PATCHED = `  # React Native 0.82+ is new-arch only and can leave this unset while
  # CocoaPods evaluates podspecs. Only an explicit opt-out is unsupported.
  if ENV['RCT_NEW_ARCH_ENABLED'] == '0'
    raise Pod::Informative, "react-native-paste-input #{package["version"]} requires the React Native New Architecture (Fabric/TurboModules)."
  end`;

export function patchPasteInputPodspec(contents) {
  if (contents.includes(PATCHED)) return contents;
  if (!contents.includes(ORIGINAL)) {
    throw new Error('react-native-paste-input podspec is missing the reviewed architecture guard.');
  }
  return contents.replace(ORIGINAL, PATCHED);
}

export function findPasteInputPodspec(mobileRoot) {
  const repositoryRoot = path.resolve(mobileRoot, '..', '..');
  const candidates = [
    path.join(mobileRoot, 'node_modules', '@mattermost', 'react-native-paste-input', 'react-native-paste-input.podspec'),
    path.join(repositoryRoot, 'node_modules', '@mattermost', 'react-native-paste-input', 'react-native-paste-input.podspec'),
  ];
  const match = candidates.find((candidate) => fs.existsSync(candidate));
  if (!match) throw new Error(`react-native-paste-input podspec not found; searched: ${candidates.join(', ')}`);
  return match;
}

export function applyPasteInputPodspecPatch(mobileRoot) {
  const podspecPath = findPasteInputPodspec(mobileRoot);
  const contents = fs.readFileSync(podspecPath, 'utf8');
  const patched = patchPasteInputPodspec(contents);
  if (patched !== contents) fs.writeFileSync(podspecPath, patched);
  return podspecPath;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const defaultMobileRoot = path.resolve(path.dirname(scriptPath), '..');
  const mobileRoot = process.env.CLAWKET_MOBILE_ROOT || defaultMobileRoot;
  const patchedPath = applyPasteInputPodspecPatch(mobileRoot);
  console.log(`Verified paste-input podspec patch: ${patchedPath}`);
}
