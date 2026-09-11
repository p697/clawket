import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ExpoModulesCore 55.0.26: module initialization can register requesters from
// concurrent AppContexts. Both dictionaries must share one reader/writer lock.
const accesses = [
  `  for (id<EXPermissionsRequester> requester in newRequesters) {
    [_requesters setObject:requester forKey:[[requester class] permissionType]];
    [_requestersByClass setObject:requester forKey:[requester class]];
  }`,
  '  return _requesters[type];',
  '  return [_requestersByClass objectForKey:requesterClass];',
];

export function patchExpoPermissions(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Expo permissions source is empty or malformed.');
  let result = source;
  for (const original of accesses) {
    const protectedAccess = `  @synchronized (self) {\n${original.split('\n').map((line) => `  ${line}`).join('\n')}\n  }`;
    if (result.includes(protectedAccess)) {
      if (result.split(protectedAccess).length !== 2 || result.replace(protectedAccess, '').includes(original)) {
        throw new Error('Expo permissions source contains duplicated protected or unprotected access.');
      }
      continue;
    }
    if (result.split(original).length !== 2) throw new Error('Expo permissions source does not contain exactly one reviewed access block.');
    result = result.replace(original, protectedAccess);
  }
  return result;
}

export function applyExpoPermissionsPatch(mobileRoot) {
  const relative = 'node_modules/expo-modules-core/ios/Legacy/Services/Permissions/EXPermissionsService.m';
  const candidates = [path.join(mobileRoot, relative), path.resolve(mobileRoot, '../..', relative)];
  const files = [...new Set(candidates.filter((file) => fs.existsSync(file)).map((file) => fs.realpathSync(file)))];
  if (!files.length) throw new Error('Expo permissions source is missing. Install mobile dependencies first.');
  // Validate every copy before writing any of them.
  const patches = files.map((file) => ({ file, source: fs.readFileSync(file, 'utf8') }));
  const validated = patches.map(({ file, source }) => ({ file, source, patched: patchExpoPermissions(source) }));
  for (const { file, source, patched } of validated) if (patched !== source) fs.writeFileSync(file, patched);
  return files.length;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const count = applyExpoPermissionsPatch(process.env.CLAWKET_MOBILE_ROOT || path.resolve(path.dirname(scriptPath), '..'));
  console.log(`Verified Expo permissions synchronization: ${count} source file(s), 3 protected access blocks each.`);
}
