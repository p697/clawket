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

function run({
  baseline = {},
  source = 'export const styles = {};\n',
  screenSource = 'export const screen = {};\n',
  componentFile = 'SelfTest.tsx',
  appSource = 'export default function App() { return null; }\n',
  dependencies = {},
  args = [],
  omitBaseline = false,
  omitScreensDirectory = false,
  omitComponentsDirectory = false,
  omitComponentFile = false,
}) {
  const sandbox = mkdtempSync(path.join(appRoot, '.check-ui-style-selftest-'));
  try {
    mkdirSync(path.join(sandbox, 'scripts'), { recursive: true });
    if (!omitComponentsDirectory) {
      mkdirSync(path.join(sandbox, 'src', 'components'), { recursive: true });
    }
    if (!omitScreensDirectory) {
      mkdirSync(path.join(sandbox, 'src', 'screens'), { recursive: true });
    }
    writeFileSync(path.join(sandbox, 'scripts', 'check-ui-style.mjs'), checker);
    if (!omitBaseline) {
      writeFileSync(
        path.join(sandbox, 'scripts', 'ui-style-baseline.json'),
        typeof baseline === 'string' ? baseline : `${JSON.stringify(baseline)}\n`,
      );
    }
    if (!omitComponentsDirectory && !omitComponentFile) {
      const componentPath = path.join(sandbox, 'src', 'components', componentFile);
      mkdirSync(path.dirname(componentPath), { recursive: true });
      writeFileSync(componentPath, source);
    }
    if (!omitScreensDirectory) {
      writeFileSync(path.join(sandbox, 'src', 'screens', 'SelfTestScreen.tsx'), screenSource);
    }
    writeFileSync(path.join(sandbox, 'App.tsx'), appSource);
    writeFileSync(path.join(sandbox, 'package.json'), JSON.stringify({ dependencies }));
    return spawnSync(
      process.execPath,
      [path.join(sandbox, 'scripts', 'check-ui-style.mjs'), ...args],
      { encoding: 'utf8' },
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

function expectPass(label, input, marker = 'ui-style check passed') {
  checked += 1;
  const result = run(input);
  if (
    result.status !== 0
    || !result.stdout.includes(marker)
    || !result.stdout.includes('[check-ui-style] scanned 2 UI source files')
    || !result.stdout.includes('[check-ui-style] M5 tracked debt:')
  ) {
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

expectFailure('baseline update cannot trade one improvement for another regression', {
  baseline: { 'src/components/SelfTest.tsx': { 'font-size-literal': 1 } },
  source: "export const styles = { label: { color: '#fff' } };\n",
  args: ['--update'],
}, 'baseline update refused');

expectPass('baseline update accepts a strict decrease', {
  baseline: { 'src/components/SelfTest.tsx': { 'font-size-literal': 1 } },
  args: ['--update'],
}, 'ui-style baseline updated');

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

expectPass('canonical Composer may own its composition-safe native input', {
  componentFile: 'ui/Composer.tsx',
  source: "import { TextInput } from 'react-native'; export const x = <TextInput />;\n",
});

expectFailure('raw shadows cannot bypass dark-mode surface semantics', {
  source: "import { Shadow } from '../theme/tokens'; export const x = <View style={Shadow.md} />;\n",
}, 'raw Shadow tokens must go through');

expectFailure('list rows cannot use a hairline borderWidth', {
  componentFile: 'ui/RosterRow.tsx',
  source: [
    "import { StyleSheet } from 'react-native';",
    'export const styles = StyleSheet.create({',
    '  container: { borderWidth: StyleSheet.hairlineWidth },',
    '});',
    '',
  ].join('\n'),
}, 'list-row-border-width');

expectPass('non-row semantic surfaces may still use a hairline borderWidth', {
  source: [
    "import { StyleSheet } from 'react-native';",
    'export const styles = StyleSheet.create({',
    '  statusRing: { borderWidth: StyleSheet.hairlineWidth },',
    '});',
    '',
  ].join('\n'),
});

expectFailure('emoji literals cannot stand in for interface icons', {
  source: "const SEARCH_ICON = '🔎'; export const icon = SEARCH_ICON;\n",
}, 'emoji-icon-literal');

expectPass('avatar emoji choices remain identity content', {
  componentFile: 'agents/EmojiPicker.tsx',
  source: "const EMOJI_OPTIONS = ['🦊', '🐼']; export const values = EMOJI_OPTIONS;\n",
});

expectPass('emoji-bearing protocol text is not mistaken for an icon', {
  source: "export const imagePlaceholder = '📷 Image';\n",
});

expectPass('screens may use three distinct FontSize tokens', {
  screenSource: [
    "import { FontSize } from '../theme/tokens';",
    'export const styles = {',
    '  title: { fontSize: FontSize.title },',
    '  body: { fontSize: FontSize.body },',
    '  caption: { fontSize: FontSize.caption },',
    '};',
    '',
  ].join('\n'),
});

expectFailure('screens cannot use four distinct FontSize tokens', {
  screenSource: [
    "import { FontSize } from '../theme/tokens';",
    'export const styles = {',
    '  display: { fontSize: FontSize.display },',
    '  title: { fontSize: FontSize.title },',
    '  body: { fontSize: FontSize.body },',
    '  caption: { fontSize: FontSize.caption },',
    '};',
    '',
  ].join('\n'),
}, 'screen-font-size-budget');

expectFailure('malformed baseline fails loudly', {
  baseline: '{ broken json',
}, 'Missing or invalid baseline');

expectFailure('missing baseline fails loudly', {
  omitBaseline: true,
}, 'Missing or invalid baseline');

expectFailure('empty baseline file fails loudly', {
  baseline: '',
}, 'baseline file is empty');

expectFailure('empty per-file baseline counts fail loudly', {
  baseline: { 'src/components/SelfTest.tsx': {} },
}, 'empty counts');

expectFailure('missing scan root fails loudly', {
  omitScreensDirectory: true,
}, 'src/screens');

expectFailure('empty scan root fails loudly', {
  omitComponentFile: true,
}, 'contains no TypeScript UI sources');

expectFailure('empty UI source fails loudly', {
  source: '',
}, 'UI source file is empty');

expectFailure('malformed UI source fails loudly', {
  source: 'export const broken = <View>;\n',
}, 'parse failed');

if (failures.length) {
  console.error('[check-ui-style-selftest] failed');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`[check-ui-style-selftest] ok (${checked} checker outcomes verified)`);
