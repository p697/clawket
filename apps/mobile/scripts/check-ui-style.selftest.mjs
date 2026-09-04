import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checker = readFileSync(path.join(appRoot, 'scripts', 'check-ui-style.mjs'), 'utf8');
const failures = [];
let checked = 0;

function run({ baseline = {}, source = 'export const styles = {};\n', appSource = '', dependencies = {} }) {
  const sandbox = mkdtempSync(path.join(appRoot, '.check-ui-style-selftest-'));
  try {
    mkdirSync(path.join(sandbox, 'scripts'), { recursive: true });
    mkdirSync(path.join(sandbox, 'src', 'components'), { recursive: true });
    mkdirSync(path.join(sandbox, 'src', 'screens'), { recursive: true });
    writeFileSync(path.join(sandbox, 'scripts', 'check-ui-style.mjs'), checker);
    writeFileSync(
      path.join(sandbox, 'scripts', 'ui-style-baseline.json'),
      typeof baseline === 'string' ? baseline : `${JSON.stringify(baseline)}\n`,
    );
    writeFileSync(path.join(sandbox, 'src', 'components', 'SelfTest.tsx'), source);
    writeFileSync(path.join(sandbox, 'App.tsx'), appSource);
    writeFileSync(path.join(sandbox, 'package.json'), JSON.stringify({ dependencies }));
    return spawnSync(process.execPath, [path.join(sandbox, 'scripts', 'check-ui-style.mjs')], { encoding: 'utf8' });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

function expectPass(label, input) {
  checked += 1;
  const result = run(input);
  if (result.status !== 0 || !result.stdout.includes('ui-style check passed')) {
    failures.push(`${label}: expected pass, got ${result.status}: ${(result.stdout + result.stderr).trim()}`);
  }
}

function expectFailure(label, input, marker) {
  checked += 1;
  const result = run(input);
  const output = result.stdout + result.stderr;
  if (result.status === 0 || !output.includes('[check-ui-style] failed') || !output.includes(marker)) {
    failures.push(`${label}: expected ${marker} failure, got ${result.status}: ${output.trim()}`);
  }
}

expectPass('matching per-file baseline', {
  baseline: { 'src/components/SelfTest.tsx': { 'font-size-literal': 1 } },
  source: 'export const styles = { label: { fontSize: 12 } };\n',
});

expectFailure('one fixed rule cannot offset a different regression', {
  baseline: { 'src/components/SelfTest.tsx': { 'font-size-literal': 1 } },
  source: "export const styles = { label: { color: '#fff' } };\n",
}, 'hardcoded-color');

expectFailure('local numeric aliases remain visible', {
  source: 'const LABEL = 14; export const styles = { label: { fontSize: LABEL } };\n',
}, 'font-size-literal');

expectFailure('native keyboard avoider is ratcheted', {
  source: "import { KeyboardAvoidingView } from 'react-native'; export const x = KeyboardAvoidingView;\n",
}, 'native-keyboard-avoider');

expectFailure('native bottom-tab dependency is forbidden', {
  dependencies: { 'react-native-bottom-tabs': '^1.1.0' },
}, 'react-native-bottom-tabs');

expectFailure('native bottom-tab adapter import is forbidden', {
  appSource: "import { createNativeBottomTabNavigator } from '@bottom-tabs/react-navigation';\n",
}, '@bottom-tabs/react-navigation');

expectFailure('screen content cannot reserve JS tab height again', {
  source: "import { useTabBarHeight } from '../hooks/useTabBarHeight'; export const x = useTabBarHeight;\n",
}, 'useTabBarHeight is reserved');

expectFailure('native switches cannot bypass the themed control', {
  source: "import { Switch } from 'react-native'; export const x = <Switch value />;\n",
}, 'native Switch is reserved');

expectFailure('native text inputs cannot bypass shared field chrome', {
  source: "import { TextInput } from 'react-native'; export const x = <TextInput />;\n",
}, 'native TextInput is reserved');

expectFailure('raw shadows cannot bypass dark-mode surface semantics', {
  source: "import { Shadow } from '../theme/tokens'; export const x = <View style={Shadow.md} />;\n",
}, 'raw Shadow tokens must go through');

expectFailure('malformed baseline fails loudly', {
  baseline: '{ broken json',
}, 'Missing or invalid baseline');

if (failures.length) {
  console.error('[check-ui-style-selftest] failed');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`[check-ui-style-selftest] ok (${checked} checker outcomes verified)`);
