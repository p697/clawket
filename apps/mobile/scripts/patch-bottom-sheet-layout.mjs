import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Reviewed against @gorhom/bottom-sheet 5.2.14. Insets must participate in
// the observed value, even when the native container height has not changed.
const entries = {
  'src/components/bottomSheet/BottomSheet.tsx': '672f6cf7cffbe780852f5528a940d3d2789582bc428e7e114c893d5a6bbea211',
  'lib/module/components/bottomSheet/BottomSheet.js': '86d4cd0591fe125b4fcdc55996892ec25ddeaaf37910a727c2854935b24fac3d',
  'lib/commonjs/components/bottomSheet/BottomSheet.js': 'f8cbb06abeb84bebdb880a3e0283cf3bde4b5a1d9d4cc06ef58e9bd8264c91d5',
  'src/hooks/useAnimatedLayout.ts': '1324368fb7e77bbf817b10cb73a864cce336813c247fefb5d29bceaf3b7fc611',
  'lib/module/hooks/useAnimatedLayout.js': '3785d0a2a9f3c1fd9ea1bf944e09c196cbe8ccc0d70f1ccd658a45ff0cb43337',
  'lib/commonjs/hooks/useAnimatedLayout.js': '04aa6f1902a3ac48001407ad32006bec33deaa8434b2a0cdce2feb5e955cc656',
};
const hash = source => createHash('sha256').update(source).digest('hex');

function replacements(entry) {
  if (entry.includes('/components/')) {
    return [['if (!targetPosition)', 'if (!targetPosition && targetPosition !== 0)']];
  }
  const sentinel = entry.startsWith('lib/commonjs/') ? '_constants.INITIAL_LAYOUT_VALUE' : 'INITIAL_LAYOUT_VALUE';
  const indent = entry.startsWith('src/') ? '    ' : '  ';
  return [
    ...['state.value.rawContainerHeight', 'containerLayoutState?.get().height'].map(read => [
      `() => ${read},`,
      `() => {\n${indent}  const height = ${read};\n${read.startsWith('container') ? `${indent}  if (!height) return undefined;\n` : ''}${indent}  return height === undefined || height === ${sentinel}\n${indent}    ? height\n${indent}    : modal ? height - verticalInset : height;\n${indent}},`,
    ]),
    ['if (!result || result === previous)', 'if (result === undefined || result === previous)'],
    ['_state.containerHeight = modal ? result - verticalInset : result;', '_state.containerHeight = result;'],
  ];
}

export function patchBottomSheetLayout(source, entry) {
  if (typeof source !== 'string' || !source.trim() || !Object.hasOwn(entries, entry)) {
    throw new Error('Bottom sheet layout source or entry is missing or malformed.');
  }
  const changes = replacements(entry);
  const original = changes.reduce((value, [before, after]) => value.replaceAll(after, before), source);
  if (hash(original) !== entries[entry]) {
    throw new Error(`Bottom sheet 5.2.14 layout source drifted: ${entry}`);
  }
  const patched = changes.reduce((value, [before, after]) => value.replaceAll(before, after), original);
  if (source !== original && source !== patched) {
    throw new Error(`Bottom sheet layout patch is partial: ${entry}`);
  }
  return patched;
}

export function applyBottomSheetLayoutPatch(mobileRoot) {
  const relative = 'node_modules/@gorhom/bottom-sheet';
  const candidates = [path.join(mobileRoot, relative), path.resolve(mobileRoot, '../..', relative)];
  const roots = [...new Set(candidates.filter(root => fs.existsSync(root)).map(root => fs.realpathSync(root)))];
  if (!roots.length) throw new Error('Bottom sheet dependency is missing. Install mobile dependencies first.');
  // Validate every installed entry before changing any of them.
  const patches = roots.flatMap(root => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (manifest.name !== '@gorhom/bottom-sheet' || manifest.version !== '5.2.14') throw new Error('Review the bottom sheet layout patch before upgrading.');
    return Object.keys(entries).map(entry => {
      const file = path.join(root, entry);
      const source = fs.readFileSync(file, 'utf8');
      return { file, source, patched: patchBottomSheetLayout(source, entry) };
    });
  });
  for (const { file, source, patched } of patches) if (source !== patched) fs.writeFileSync(file, patched);
  return patches.length;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const count = applyBottomSheetLayoutPatch(process.env.CLAWKET_MOBILE_ROOT || path.resolve(path.dirname(scriptPath), '..'));
  console.log(`Verified bottom sheet resize layout: ${count} source/runtime entries, inset-aware reactions and zero-position resize.`);
}
