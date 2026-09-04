#!/usr/bin/env node

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
const BASELINE_PATH = join(ROOT, 'scripts', 'ui-style-baseline.json');
const SCAN_DIRS = ['src/screens', 'src/components'];
const UPDATE = process.argv.includes('--update');
const TAB_BAR_HEIGHT_ALLOWED_FILES = new Set([
  'src/screens/ChatScreen/hooks/useChatKeyboardLayout.ts',
]);
const NATIVE_SWITCH_ALLOWED_FILES = new Set([
  'src/components/ui/ThemedSwitch.tsx',
  // Share-poster controls deliberately mirror the exported artifact instead of
  // inheriting the application settings chrome.
  'src/screens/ChatScreen/components/ChatSharePosterModal.tsx',
]);
const NATIVE_TEXT_INPUT_ALLOWED_FILES = new Set([
  // Canonical 3.0 composer owns multiline sizing, paste, microphone, and
  // streaming controls; ordinary form fields still go through shared chrome.
  'src/components/ui/Composer.tsx',
  'src/components/ui/FormTextInput.tsx',
  'src/components/ui/SearchInput.tsx',
  // These are editors/composers with selection, accessory, or streaming
  // behavior that is intentionally outside ordinary form-field chrome.
  'src/components/chat/ChatComposer.tsx',
  'src/components/console/FileEditorView.tsx',
  'src/screens/ConsoleScreen/SkillContentScreen.tsx',
]);
const RAW_SHADOW_ALLOWED_FILES = new Set([
  // This preview intentionally renders the user's selected chat presentation,
  // including its optional shadow, rather than ordinary application chrome.
  'src/components/chat/ChatAppearancePreviewCard.tsx',
]);
const EMOJI_LITERAL_ALLOWED_FILES = new Set([
  // These literals are user-selectable Agent avatar content, not interface
  // icons. AgentAvatar renders the chosen value as identity data.
  'src/components/agents/EmojiPicker.tsx',
]);
const SCREEN_DIR_PREFIX = 'src/screens/';
const SCREEN_FONT_SIZE_LIMIT = 3;
const EMOJI_LITERAL_RE = /\p{Extended_Pictographic}/u;

const RULES = {
  'border-radius-literal': 'borderRadius numeric literal — use Radius tokens',
  'hardcoded-color': 'hardcoded color — use semantic theme.colors tokens',
  'font-size-literal': 'fontSize numeric literal — use FontSize tokens',
  'font-token-arithmetic': 'FontSize arithmetic — use a FontSize/LineHeight step',
  'border-width-literal': 'borderWidth numeric literal — use StyleSheet.hairlineWidth',
  'native-keyboard-avoider': "KeyboardAvoidingView from react-native — use react-native-keyboard-controller",
  'list-row-border-width': 'list-row borderWidth — rows must use spacing and pressed-state color, not an outline',
  'emoji-icon-literal': 'emoji literal used as an icon — use a Lucide icon or dynamic Agent avatar content',
  'screen-font-size-budget': `screen uses more than ${SCREEN_FONT_SIZE_LIMIT} FontSize tokens — keep the default hierarchy to two tiers (three including a title)`,
};
const RULE_IDS = Object.keys(RULES);
const M5_RULE_IDS = [
  'list-row-border-width',
  'emoji-icon-literal',
  'screen-font-size-budget',
];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, files);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

function propertyName(node) {
  const name = node?.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function declarationName(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  if (
    (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node))
    && node.name
  ) {
    return ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)
      ? node.name.text
      : null;
  }
  return null;
}

function isIconSemanticName(name) {
  if (!name) return false;
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  return words.some((word) => word === 'icon' || word === 'icons' || word === 'emoji' || word === 'emojis');
}

function isListRowSemanticName(name) {
  if (!name) return false;
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  return words.includes('row') || words.includes('item');
}

function jsxTagName(node, sourceFile) {
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText(sourceFile);
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText(sourceFile);
  return null;
}

function sourceStem(rel) {
  const fileName = rel.split('/').at(-1) ?? rel;
  return fileName.replace(/\.(?:ts|tsx)$/, '');
}

function jsxAttributeOwnerName(node, sourceFile) {
  if (!ts.isJsxAttribute(node) || !ts.isJsxAttributes(node.parent)) return null;
  return jsxTagName(node.parent.parent, sourceFile);
}

function owningStyleName(node, sourceFile) {
  let current = node.parent;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isObjectLiteralExpression(current)) {
      const owner = current.parent;
      if (ts.isPropertyAssignment(owner)) return propertyName(owner);
      const name = declarationName(owner);
      if (name) return name;
    }
    if (ts.isJsxExpression(current) && ts.isJsxAttribute(current.parent)) {
      const attribute = current.parent;
      if (attribute.name.getText(sourceFile) !== 'style') return null;
      const element = attribute.parent;
      return ts.isJsxAttributes(element) ? jsxTagName(element.parent, sourceFile) : null;
    }
    current = current.parent;
  }
  return null;
}

function isEmojiLiteral(node) {
  if (
    ts.isStringLiteral(node)
    || ts.isNoSubstitutionTemplateLiteral(node)
    || ts.isJsxText(node)
    || ts.isTemplateHead(node)
    || ts.isTemplateMiddle(node)
    || ts.isTemplateTail(node)
  ) {
    return EMOJI_LITERAL_RE.test(node.text);
  }
  return false;
}

function isEmojiIconLiteral(node, sourceFile) {
  if (!isEmojiLiteral(node)) return false;
  let current = node.parent;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isJsxAttribute(current) && isIconSemanticName(current.name.getText(sourceFile))) {
      return true;
    }
    if (ts.isPropertyAssignment(current) && isIconSemanticName(propertyName(current))) {
      return true;
    }
    const name = declarationName(current);
    if (name && isIconSemanticName(name)) return true;
    if (ts.isJsxElement(current) && jsxTagName(current, sourceFile) === 'Text') {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function isScope(node) {
  return ts.isSourceFile(node)
    || ts.isBlock(node)
    || ts.isModuleBlock(node)
    || ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node);
}

function enclosingScope(node) {
  let current = node.parent;
  while (current && !isScope(current)) current = current.parent;
  return current;
}

function collectInitializers(sourceFile) {
  const byScope = new Map();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const scope = enclosingScope(node);
      const values = byScope.get(scope) ?? new Map();
      values.set(node.name.text, values.has(node.name.text) ? null : node.initializer);
      byScope.set(scope, values);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return byScope;
}

function unwrap(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function resolveIdentifier(identifier, initializers) {
  let current = identifier.parent;
  while (current) {
    if (isScope(current)) {
      const value = initializers.get(current)?.get(identifier.text);
      if (value !== undefined) return value;
    }
    current = current.parent;
  }
  return null;
}

function resolveExpression(expression, initializers, seen = new Set()) {
  const current = unwrap(expression);
  if (!ts.isIdentifier(current)) return current;
  const value = resolveIdentifier(current, initializers);
  if (!value || seen.has(value)) return current;
  const nextSeen = new Set(seen);
  nextSeen.add(value);
  return resolveExpression(value, initializers, nextSeen);
}

function numericLiteral(expression, initializers, nonZero = false) {
  const current = resolveExpression(expression, initializers);
  if (ts.isNumericLiteral(current)) {
    return !nonZero || Number(current.text) !== 0;
  }
  if (ts.isPrefixUnaryExpression(current)) {
    const operand = unwrap(current.operand);
    return ts.isNumericLiteral(operand) && (!nonZero || Number(operand.text) !== 0);
  }
  return false;
}

function hardcodedColor(expression, initializers) {
  const current = resolveExpression(expression, initializers);
  return (
    (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current))
    && /^(?:#|rgba?\()/i.test(current.text)
  );
}

function containsFontSize(expression, initializers, seen = new Set()) {
  const current = unwrap(expression);
  if (ts.isPropertyAccessExpression(current) && current.expression.getText() === 'FontSize') {
    return true;
  }
  if (ts.isIdentifier(current)) {
    const value = resolveIdentifier(current, initializers);
    if (!value || seen.has(value)) return false;
    const nextSeen = new Set(seen);
    nextSeen.add(value);
    return containsFontSize(value, initializers, nextSeen);
  }
  let found = false;
  ts.forEachChild(current, (child) => {
    if (!found && containsFontSize(child, initializers, seen)) found = true;
  });
  return found;
}

function containsFontArithmetic(expression, initializers, seen = new Set()) {
  const current = unwrap(expression);
  if (ts.isIdentifier(current)) {
    const value = resolveIdentifier(current, initializers);
    if (!value || seen.has(value)) return false;
    const nextSeen = new Set(seen);
    nextSeen.add(value);
    return containsFontArithmetic(value, initializers, nextSeen);
  }
  if (
    ts.isBinaryExpression(current)
    && (current.operatorToken.kind === ts.SyntaxKind.PlusToken
      || current.operatorToken.kind === ts.SyntaxKind.MinusToken)
    && containsFontSize(current, initializers)
  ) {
    return true;
  }
  let found = false;
  ts.forEachChild(current, (child) => {
    if (!found && containsFontArithmetic(child, initializers, seen)) found = true;
  });
  return found;
}

export function scanSource(rel, source) {
  const sourceFile = ts.createSourceFile(
    rel,
    source,
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const failures = (sourceFile.parseDiagnostics ?? []).map((diagnostic) => (
    `${rel}: parse failed: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`
  ));
  const initializers = collectInitializers(sourceFile);
  const violations = [];
  const screenFontSizes = new Map();
  const lineOf = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const add = (ruleId, node) => violations.push({ ruleId, line: lineOf(node) });

  const checkProperty = (name, expression, node) => {
    if (name === 'borderRadius' && numericLiteral(expression, initializers)) {
      add('border-radius-literal', node);
    }
    if (name && /color$/i.test(name) && hardcodedColor(expression, initializers)) {
      add('hardcoded-color', node);
    }
    if (name === 'fontSize' && numericLiteral(expression, initializers)) {
      add('font-size-literal', node);
    }
    if ((name === 'fontSize' || name === 'lineHeight') && containsFontArithmetic(expression, initializers)) {
      add('font-token-arithmetic', node);
    }
    if (name === 'borderWidth' && numericLiteral(expression, initializers, true)) {
      add('border-width-literal', node);
    }
    if (
      name === 'borderWidth'
      && (
        isListRowSemanticName(sourceStem(rel))
        || isListRowSemanticName(owningStyleName(node, sourceFile))
        || isListRowSemanticName(jsxAttributeOwnerName(node, sourceFile))
      )
    ) {
      add('list-row-border-width', node);
    }
  };

  const visit = (node) => {
    if (ts.isPropertyAssignment(node)) {
      checkProperty(propertyName(node), node.initializer, node);
    } else if (ts.isJsxAttribute(node) && node.initializer) {
      const expression = ts.isJsxExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer;
      if (expression) checkProperty(node.name.getText(sourceFile), expression, node);
    }
    if (!EMOJI_LITERAL_ALLOWED_FILES.has(rel) && isEmojiIconLiteral(node, sourceFile)) {
      add('emoji-icon-literal', node);
    }
    if (
      rel.startsWith(SCREEN_DIR_PREFIX)
      && ts.isPropertyAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'FontSize'
      && !screenFontSizes.has(node.name.text)
    ) {
      screenFontSizes.set(node.name.text, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  for (const node of [...screenFontSizes.values()].slice(SCREEN_FONT_SIZE_LIMIT)) {
    add('screen-font-size-budget', node);
  }

  const nativeImport = /import\s*\{([^}]*)\}\s*from\s*['"]react-native['"]/gs;
  for (const match of source.matchAll(nativeImport)) {
    if (/\bKeyboardAvoidingView\b/.test(match[1])) {
      violations.push({ ruleId: 'native-keyboard-avoider', line: 1 });
    }
  }
  return { failures, violations };
}

export function validateBottomTabSafety(appSource, packageJson) {
  const failures = [];
  if (/['"]@bottom-tabs\/react-navigation['"]/.test(appSource)) {
    failures.push('App.tsx imports @bottom-tabs/react-navigation');
  }
  if (/['"]react-native-bottom-tabs['"]/.test(appSource)) {
    failures.push('App.tsx imports react-native-bottom-tabs');
  }
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  for (const name of ['@bottom-tabs/react-navigation', 'react-native-bottom-tabs']) {
    if (dependencies[name]) failures.push(`package.json depends on ${name}`);
  }
  return failures;
}

export function validateTabBarHeightUsage(rel, source) {
  if (!/\buseTabBarHeight\b/.test(source)) return [];
  if (TAB_BAR_HEIGHT_ALLOWED_FILES.has(rel)) return [];
  return [`${rel}: useTabBarHeight is reserved for physical overlays and keyboard policies; JS tab scenes already exclude the bar`];
}

export function validateNativeSwitchUsage(rel, source) {
  if (!/<Switch\b/.test(source)) return [];
  if (NATIVE_SWITCH_ALLOWED_FILES.has(rel)) return [];
  return [`${rel}: native Switch is reserved for ThemedSwitch and documented presentation exceptions`];
}

export function validateNativeTextInputUsage(rel, source) {
  if (!/<TextInput\b/.test(source)) return [];
  if (NATIVE_TEXT_INPUT_ALLOWED_FILES.has(rel)) return [];
  return [`${rel}: native TextInput is reserved for FormTextInput, SearchInput, and documented editor/composer exceptions`];
}

export function validateRawShadowUsage(rel, source) {
  if (RAW_SHADOW_ALLOWED_FILES.has(rel)) return [];
  const hasRawShadow = source.split('\n').some((line) => (
    /\bShadow\.(?:xs|sm|md|lg)\b/.test(line)
    && !line.includes('createThemedShadowStyle')
  ));
  return hasRawShadow
    ? [`${rel}: raw Shadow tokens must go through createThemedShadowStyle/createSurfaceStyle for dark-mode safety`]
    : [];
}

export function validateBaseline(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'root must be an object';
  for (const [rel, counts] of Object.entries(value)) {
    if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return `${rel} must map to counts`;
    if (!SCAN_DIRS.some((dir) => rel.startsWith(`${dir}/`))) return `${rel} is outside the UI scan roots`;
    if (!/\.(ts|tsx)$/.test(rel)) return `${rel} is not a TypeScript UI source`;
    if (Object.keys(counts).length === 0) return `${rel} has empty counts`;
    for (const [ruleId, count] of Object.entries(counts)) {
      if (!RULE_IDS.includes(ruleId)) return `${rel} has unknown rule ${ruleId}`;
      if (!Number.isInteger(count) || count <= 0) return `${rel}/${ruleId} has an invalid count`;
    }
  }
  return null;
}

export function compareBaseline(counts, baseline) {
  const regressions = [];
  let improvements = 0;
  for (const rel of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
    for (const ruleId of RULE_IDS) {
      const actual = counts[rel]?.[ruleId] ?? 0;
      const allowed = baseline[rel]?.[ruleId] ?? 0;
      if (actual > allowed) {
        regressions.push({ rel, ruleId, actual, allowed });
      } else if (actual < allowed) {
        improvements += 1;
      }
    }
  }
  return { regressions, improvements };
}

function sortedCounts(counts) {
  return Object.fromEntries(
    Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([rel, values]) => [
        rel,
        Object.fromEntries(RULE_IDS.filter((ruleId) => values[ruleId]).map((ruleId) => [ruleId, values[ruleId]])),
      ]),
  );
}

function loadBaseline() {
  const raw = readFileSync(BASELINE_PATH, 'utf8');
  if (!raw.trim()) throw new Error('baseline file is empty');
  const value = JSON.parse(raw);
  const error = validateBaseline(value);
  if (error) throw new Error(error);
  return value;
}

const files = [];
const scopeCounts = {};
const sourceCollectionFailures = [];
for (const dir of SCAN_DIRS) {
  try {
    const full = join(ROOT, dir);
    if (!statSync(full).isDirectory()) throw new Error('not a directory');
    const scopedFiles = walk(full);
    if (scopedFiles.length === 0) throw new Error('contains no TypeScript UI sources');
    scopeCounts[dir] = scopedFiles.length;
    files.push(...scopedFiles);
  } catch (error) {
    sourceCollectionFailures.push(`${dir}: ${error instanceof Error ? error.message : String(error)}`);
    scopeCounts[dir] = 0;
  }
}
const counts = {};
const details = {};
const hardFailures = [...sourceCollectionFailures];

for (const file of files) {
  const rel = relative(ROOT, file);
  const source = readFileSync(file, 'utf8');
  if (!source.trim()) hardFailures.push(`${rel}: UI source file is empty`);
  const result = scanSource(rel, source);
  hardFailures.push(...result.failures);
  hardFailures.push(...validateTabBarHeightUsage(rel, source));
  hardFailures.push(...validateNativeSwitchUsage(rel, source));
  hardFailures.push(...validateNativeTextInputUsage(rel, source));
  hardFailures.push(...validateRawShadowUsage(rel, source));
  for (const { ruleId, line } of result.violations) {
    const fileCounts = (counts[rel] ??= {});
    fileCounts[ruleId] = (fileCounts[ruleId] ?? 0) + 1;
    const fileDetails = (details[rel] ??= {});
    (fileDetails[ruleId] ??= []).push(`${rel}:${line} ${RULES[ruleId]}`);
  }
}

try {
  const appSource = readFileSync(join(ROOT, 'App.tsx'), 'utf8');
  if (!appSource.trim()) throw new Error('App.tsx is empty');
  const packageSource = readFileSync(join(ROOT, 'package.json'), 'utf8');
  if (!packageSource.trim()) throw new Error('package.json is empty');
  const packageJson = JSON.parse(packageSource);
  if (!packageJson || typeof packageJson !== 'object' || Array.isArray(packageJson)) {
    throw new Error('package.json root must be an object');
  }
  hardFailures.push(...validateBottomTabSafety(appSource, packageJson));
} catch (error) {
  hardFailures.push(`cannot validate bottom-tab safety: ${error instanceof Error ? error.message : String(error)}`);
}

const scopeSummary = SCAN_DIRS.map((dir) => `${dir}=${scopeCounts[dir] ?? 0}`).join(', ');
console.log(`[check-ui-style] scanned ${files.length} UI source files (${scopeSummary})`);
console.log(`[check-ui-style] M5 rule coverage: list-row and emoji=${files.length} files; screen FontSize=${scopeCounts['src/screens'] ?? 0} files`);
console.log(`[check-ui-style] M5 tracked debt: ${M5_RULE_IDS.map((ruleId) => {
  let violations = 0;
  let affectedFiles = 0;
  for (const fileCounts of Object.values(counts)) {
    const count = fileCounts[ruleId] ?? 0;
    violations += count;
    if (count > 0) affectedFiles += 1;
  }
  return `${ruleId}=${violations}/${affectedFiles} files`;
}).join(', ')}`);

let baseline;
try {
  baseline = loadBaseline();
} catch (error) {
  console.error('[check-ui-style] failed');
  console.error(`- Missing or invalid baseline: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const comparison = compareBaseline(counts, baseline);

if (UPDATE) {
  if (hardFailures.length || comparison.regressions.length) {
    console.error('[check-ui-style] failed');
    for (const failure of hardFailures) console.error(`- ${failure}`);
    for (const { rel, ruleId, actual, allowed } of comparison.regressions) {
      console.error(`- baseline update refused: ${rel}/${ruleId}: ${actual}, existing baseline ${allowed}`);
    }
    process.exit(1);
  }
  const sorted = sortedCounts(counts);
  const tracked = Object.values(sorted).reduce(
    (sum, values) => sum + Object.values(values).reduce((inner, count) => inner + count, 0),
    0,
  );
  writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`ui-style baseline updated: ${Object.keys(sorted).length} files, ${tracked} tracked violations.`);
  process.exit(0);
}

const regressions = comparison.regressions.map(({ rel, ruleId, actual, allowed }) => {
  for (const detail of details[rel]?.[ruleId] ?? []) console.error(`  ${detail}`);
  return `${rel}/${ruleId}: ${actual}, baseline ${allowed}`;
});
const { improvements } = comparison;

if (hardFailures.length || regressions.length) {
  console.error('[check-ui-style] failed');
  for (const failure of hardFailures) console.error(`- ${failure}`);
  for (const regression of regressions) console.error(`- ${regression}`);
  process.exit(1);
}

if (improvements) {
  console.log(`ui-style check passed; verified ${files.length} UI source files; ${improvements} file/rule pair(s) beat the baseline.`);
} else {
  console.log(`ui-style check passed; verified ${files.length} UI source files and bottom-tab dependencies.`);
}
