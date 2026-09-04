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

const RULES = {
  'border-radius-literal': 'borderRadius numeric literal — use Radius tokens',
  'hardcoded-color': 'hardcoded color — use semantic theme.colors tokens',
  'font-size-literal': 'fontSize numeric literal — use FontSize tokens',
  'font-token-arithmetic': 'FontSize arithmetic — use a FontSize/LineHeight step',
  'border-width-literal': 'borderWidth numeric literal — use StyleSheet.hairlineWidth',
  'native-keyboard-avoider': "KeyboardAvoidingView from react-native — use react-native-keyboard-controller",
};
const RULE_IDS = Object.keys(RULES);

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
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

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

function validateBaseline(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'root must be an object';
  for (const [rel, counts] of Object.entries(value)) {
    if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return `${rel} must map to counts`;
    for (const [ruleId, count] of Object.entries(counts)) {
      if (!RULE_IDS.includes(ruleId)) return `${rel} has unknown rule ${ruleId}`;
      if (!Number.isInteger(count) || count < 0) return `${rel}/${ruleId} has an invalid count`;
    }
  }
  return null;
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

const files = SCAN_DIRS.flatMap((dir) => walk(join(ROOT, dir)));
const counts = {};
const details = {};
const hardFailures = [];

for (const file of files) {
  const rel = relative(ROOT, file);
  const source = readFileSync(file, 'utf8');
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
  const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  hardFailures.push(...validateBottomTabSafety(appSource, packageJson));
} catch (error) {
  hardFailures.push(`cannot validate bottom-tab safety: ${error instanceof Error ? error.message : String(error)}`);
}

if (UPDATE) {
  if (hardFailures.length) {
    console.error('[check-ui-style] failed');
    for (const failure of hardFailures) console.error(`- ${failure}`);
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

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const error = validateBaseline(baseline);
  if (error) throw new Error(error);
} catch (error) {
  console.error('[check-ui-style] failed');
  console.error(`- Missing or invalid baseline: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const regressions = [];
let improvements = 0;
for (const rel of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
  for (const ruleId of RULE_IDS) {
    const actual = counts[rel]?.[ruleId] ?? 0;
    const allowed = baseline[rel]?.[ruleId] ?? 0;
    if (actual > allowed) {
      regressions.push(`${rel}/${ruleId}: ${actual}, baseline ${allowed}`);
      for (const detail of details[rel]?.[ruleId] ?? []) console.error(`  ${detail}`);
    } else if (actual < allowed) {
      improvements += 1;
    }
  }
}

if (hardFailures.length || regressions.length) {
  console.error('[check-ui-style] failed');
  for (const failure of hardFailures) console.error(`- ${failure}`);
  for (const regression of regressions) console.error(`- ${regression}`);
  process.exit(1);
}

if (improvements) {
  console.log(`ui-style check passed; ${improvements} file/rule pair(s) beat the baseline.`);
} else {
  console.log(`ui-style check passed; verified ${files.length} UI source files and bottom-tab dependencies.`);
}
