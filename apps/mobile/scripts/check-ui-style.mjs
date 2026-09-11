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
const NATIVE_SWITCH_ALLOWED_FILES = new Set([
  'src/components/ui/ThemedSwitch.tsx',
]);
const NATIVE_TEXT_INPUT_ALLOWED_FILES = new Set([
  // This is the sole stock TextInput host. Search, forms, and Composer compose
  // it rather than controlling native text directly.
  'src/components/ui/CompositionSafeTextInput.tsx',
]);
const RAW_SHADOW_ALLOWED_FILES = new Set([
  // This preview intentionally renders the user's selected chat presentation,
  // including its optional shadow, rather than ordinary application chrome.
  'src/components/chat/ChatAppearancePreviewCard.tsx',
]);
const AGENT_PALETTE_ALLOWED_FILES = new Set([
  'src/components/ui/AgentAvatar.tsx',
]);
const SHEET_CHROME_ALLOWED_DIR_PREFIX = 'src/components/ui/';
const SHEET_CHROME_PRIMITIVES = new Set([
  'AdaptiveBottomSheetModal',
  'AdaptiveBottomSheetModalRef',
  'SHEET_TIMING_CONFIG',
  'SheetBackdrop',
  'SheetDragHandle',
  'SheetHeader',
  'SheetHeaderProps',
  'ThemedFullWindowOverlay',
  'useSheetBackgroundStyle',
]);
const SHEET_CHROME_MODULE_STEMS = new Set([
  'AdaptiveBottomSheetModal',
  'SheetBackdrop',
  'SheetHeader',
  'ThemedFullWindowOverlay',
]);
const EMOJI_LITERAL_ALLOWED_FILES = new Set();
const SCREEN_DIR_PREFIX = 'src/screens/';
const SCREEN_FONT_SIZE_LIMIT = 3;
const EMOJI_LITERAL_RE = /\p{Extended_Pictographic}/u;
const CANONICAL_TOKEN_MEMBERS = new Map([
  ['FontSize', new Set(['display', 'title', 'body', 'secondary', 'caption'])],
  ['LineHeight', new Set(['display', 'title', 'body', 'secondary', 'caption'])],
  ['FontWeight', new Set(['regular', 'semibold'])],
  ['Space', new Set(['xs', 'sm', 'md', 'lg', 'xl', 'xxl'])],
  ['Radius', new Set([
    'bubble',
    'card',
    'settingsGroup',
    'avatarRoster',
    'avatarHeader',
    'avatarSettings',
    'avatarSheet',
    'xl',
    'bottomSheet',
    'sheet',
    'full',
  ])],
  ['ControlSize', new Set(['pill', 'floatingButton', 'settingsRow', 'rosterRow'])],
]);
const CANONICAL_THEME_COLORS = new Set([
  'canvas',
  'canvasGrouped',
  'surface',
  'surfaceFloating',
  'ink',
  'inkSecondary',
  'inkTertiary',
  'line',
  'accent',
  'accentSoft',
  'onAccent',
  'scrim',
  'good',
  'goodSoft',
  'warn',
  'warnSoft',
  'bad',
  'badSoft',
]);
const REMOVED_TOKEN_ALIASES = new Set([
  'SpringPreset',
  'TimingPreset',
]);
const LEGACY_THEME_COLORS = new Set([
  'background',
  'surfaceMuted',
  'surfaceElevated',
  'border',
  'borderStrong',
  'text',
  'textMuted',
  'textSubtle',
  'accent50',
  'accent100',
  'accent200',
  'accent500',
  'accent700',
  'primary',
  'primaryText',
  'primarySoft',
  'searchHighlightBg',
  'success',
  'successSoft',
  'warning',
  'warningSoft',
  'error',
  'errorSoft',
  'info',
  'infoSoft',
  'overlay',
  'debugOverlay',
  'debugText',
  'bubbleUser',
  'bubbleAssistant',
  'bubbleSystem',
  'bubbleSystemText',
  'inputBackground',
  'imageAddBorder',
  'imageAddText',
  'chatPreviewMask',
  'sidebarBackdrop',
  'iconOnColor',
  'sessionBadgeSubagent',
  'sessionBadgeCron',
  'sessionBadgeTelegram',
  'sessionBadgeDiscord',
  'sessionBadgeSlack',
  'usageCostOutput',
  'usageCostInput',
  'usageCostCacheWrite',
  'usageCostCacheRead',
  'badgeModel',
  'badgeThinking',
  'badgeTools',
  'badgePrompts',
  'chartGrid',
  'shadow',
]);

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

function walk(dir, files = [], includeTests = false) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, files, includeTests);
    } else if (/\.(ts|tsx)$/.test(entry) && (includeTests || !/\.test\.(ts|tsx)$/.test(entry))) {
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

function exactMemberFailures(rel, label, actual, expected) {
  const failures = [];
  for (const name of actual) {
    if (!expected.has(name)) failures.push(`${rel}: ${label} defines noncanonical member ${name}`);
  }
  for (const name of expected) {
    if (!actual.has(name)) failures.push(`${rel}: ${label} is missing canonical member ${name}`);
  }
  return failures;
}

function isThemeColorReceiver(expression, sourceFile, aliases) {
  const current = unwrap(expression);
  if (ts.isIdentifier(current) && aliases.has(current.text)) return true;
  const text = current.getText(sourceFile);
  return text === 'colors'
    || text === 'theme.colors'
    || text === 'LOADING_THEME.colors'
    || text === 'light.colors'
    || text === 'dark.colors';
}

function collectThemeColorAliases(sourceFile) {
  const aliases = new Set(['colors']);
  const candidates = [];
  const visit = (node) => {
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.type) {
      const type = node.type.getText(sourceFile);
      if (/\b(?:AppThemeColors|CanonicalThemeColors)\b|AppTheme\[['"]colors['"]\]/.test(type)) {
        aliases.add(node.name.text);
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      candidates.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  let changed;
  do {
    changed = false;
    for (const declaration of candidates) {
      if (
        !aliases.has(declaration.name.text)
        && isThemeColorReceiver(declaration.initializer, sourceFile, aliases)
      ) {
        aliases.add(declaration.name.text);
        changed = true;
      }
    }
  } while (changed);
  return aliases;
}

export function validateCanonicalTokenUsage(rel, source) {
  const sourceFile = ts.createSourceFile(
    rel,
    source,
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const failures = (sourceFile.parseDiagnostics ?? []).map((diagnostic) => (
    `${rel}: canonical token validation parse failed: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`
  ));
  const themeColorAliases = collectThemeColorAliases(sourceFile);
  const lineOf = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const add = (node, message) => failures.push(`${rel}:${lineOf(node)} ${message}`);

  const visit = (node) => {
    if (ts.isIdentifier(node) && REMOVED_TOKEN_ALIASES.has(node.text)) {
      add(node, `${node.text} is a removed token alias; use Motion with ease-out`);
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const allowed = CANONICAL_TOKEN_MEMBERS.get(node.expression.text);
      if (allowed && !allowed.has(node.name.text)) {
        add(node, `${node.expression.text}.${node.name.text} is not a canonical 3.0 token`);
      }
    }
    if (
      ts.isPropertyAccessExpression(node)
      && isThemeColorReceiver(node.expression, sourceFile, themeColorAliases)
      && LEGACY_THEME_COLORS.has(node.name.text)
    ) {
      add(node, `${node.name.text} is a removed theme color alias`);
    }
    if (
      ts.isElementAccessExpression(node)
      && node.argumentExpression
      && (ts.isStringLiteral(node.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(node.argumentExpression))
      && isThemeColorReceiver(node.expression, sourceFile, themeColorAliases)
      && LEGACY_THEME_COLORS.has(node.argumentExpression.text)
    ) {
      add(node, `${node.argumentExpression.text} is a removed theme color alias`);
    }
    if (
      ts.isVariableDeclaration(node)
      && ts.isObjectBindingPattern(node.name)
      && node.initializer
      && isThemeColorReceiver(node.initializer, sourceFile, themeColorAliases)
    ) {
      for (const element of node.name.elements) {
        const name = element.propertyName
          ? propertyName({ name: element.propertyName })
          : propertyName(element);
        if (name && LEGACY_THEME_COLORS.has(name)) {
          add(element, `${name} is a removed theme color alias`);
        }
      }
    }
    if (ts.isIdentifier(node) && node.text === 'LegacyThemeColorAliases') {
      add(node, 'LegacyThemeColorAliases is removed');
    }

    if (
      rel === 'src/theme/tokens.ts'
      && ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && CANONICAL_TOKEN_MEMBERS.has(node.name.text)
      && node.initializer
    ) {
      const initializer = unwrap(node.initializer);
      if (!ts.isObjectLiteralExpression(initializer)) {
        add(node, `${node.name.text} must be an object literal so canonical members can be audited`);
      } else {
        const actual = new Set(initializer.properties.map(propertyName).filter(Boolean));
        failures.push(...exactMemberFailures(
          rel,
          node.name.text,
          actual,
          CANONICAL_TOKEN_MEMBERS.get(node.name.text),
        ));
      }
    }

    if (
      rel === 'src/theme/theme.ts'
      && ts.isTypeAliasDeclaration(node)
      && node.name.text === 'CanonicalThemeColors'
    ) {
      if (!ts.isTypeLiteralNode(node.type)) {
        add(node, 'CanonicalThemeColors must be a type literal so semantic members can be audited');
      } else {
        const actual = new Set(node.type.members.map(propertyName).filter(Boolean));
        failures.push(...exactMemberFailures(rel, 'CanonicalThemeColors', actual, CANONICAL_THEME_COLORS));
      }
    }

    if (
      rel === 'src/theme/theme.ts'
      && (ts.isPropertySignature(node) || ts.isPropertyAssignment(node))
      && LEGACY_THEME_COLORS.has(propertyName(node))
    ) {
      add(node, `${propertyName(node)} must not be defined in the 3.0 theme palette`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return failures;
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
  return [`${rel}: useTabBarHeight is not allowed after the single-root-stack migration`];
}

export function validateNativeSwitchUsage(rel, source) {
  if (!/<Switch\b/.test(source)) return [];
  if (NATIVE_SWITCH_ALLOWED_FILES.has(rel)) return [];
  return [`${rel}: native Switch is reserved for ThemedSwitch and documented presentation exceptions`];
}

export function validateNativeTextInputUsage(rel, source) {
  if (NATIVE_TEXT_INPUT_ALLOWED_FILES.has(rel)) return [];
  const sourceFile = ts.createSourceFile(
    rel,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const directImports = new Set();
  const namespaceImports = new Set();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement)
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== 'react-native'
    ) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const specifier of bindings.elements) {
        if ((specifier.propertyName ?? specifier.name).text === 'TextInput') {
          directImports.add(specifier.name.text);
        }
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      namespaceImports.add(bindings.name.text);
    }
  }

  let foundNativeHost = false;
  const visit = (node) => {
    if (foundNativeHost) return;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName.getText(sourceFile);
      const isNativeHost = directImports.has(tagName)
        || [...namespaceImports].some((name) => tagName === `${name}.TextInput`);
      if (isNativeHost) {
        foundNativeHost = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return foundNativeHost
    ? [`${rel}: native TextInput is reserved for CompositionSafeTextInput`]
    : [];
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

export function validateAgentPaletteOwnership(rel, source) {
  if (AGENT_PALETTE_ALLOWED_FILES.has(rel) || !/\bagentPalette\b/u.test(source)) return [];
  return [`${rel}: agentPalette is reserved for AgentAvatar; use a semantic ink color`];
}

export function validateSheetChromeOwnership(rel, source) {
  if (rel.startsWith(SHEET_CHROME_ALLOWED_DIR_PREFIX)) return [];
  const sourceFile = ts.createSourceFile(
    rel,
    source,
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const failures = [];
  const namespaceImports = new Set();
  const lineOf = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const add = (node, name) => failures.push(
    `${rel}:${lineOf(node)} sheet chrome primitive ${name} is reserved for src/components/ui; compose Sheet instead`,
  );

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleName = statement.moduleSpecifier.text;
    const moduleStem = moduleName.split('/').at(-1);
    const importsUiBarrel = /(?:^|\/)ui(?:\/index)?$/.test(moduleName);
    const importsChromeModule = moduleStem && SHEET_CHROME_MODULE_STEMS.has(moduleStem);
    if (importsChromeModule) {
      add(statement.moduleSpecifier, moduleStem);
      continue;
    }
    if (!importsUiBarrel) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const specifier of bindings.elements) {
        const importedName = (specifier.propertyName ?? specifier.name).text;
        if (SHEET_CHROME_PRIMITIVES.has(importedName)) add(specifier, importedName);
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      namespaceImports.add(bindings.name.text);
    }
  }

  if (namespaceImports.size > 0) {
    const visit = (node) => {
      if (
        ts.isPropertyAccessExpression(node)
        && ts.isIdentifier(node.expression)
        && namespaceImports.has(node.expression.text)
        && SHEET_CHROME_PRIMITIVES.has(node.name.text)
      ) {
        add(node, node.name.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return failures;
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
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  const source = readFileSync(file, 'utf8');
  if (!source.trim()) hardFailures.push(`${rel}: UI source file is empty`);
  const result = scanSource(rel, source);
  hardFailures.push(...result.failures);
  hardFailures.push(...validateTabBarHeightUsage(rel, source));
  hardFailures.push(...validateNativeSwitchUsage(rel, source));
  hardFailures.push(...validateNativeTextInputUsage(rel, source));
  hardFailures.push(...validateRawShadowUsage(rel, source));
  hardFailures.push(...validateAgentPaletteOwnership(rel, source));
  hardFailures.push(...validateSheetChromeOwnership(rel, source));
  for (const { ruleId, line } of result.violations) {
    const fileCounts = (counts[rel] ??= {});
    fileCounts[ruleId] = (fileCounts[ruleId] ?? 0) + 1;
    const fileDetails = (details[rel] ??= {});
    (fileDetails[ruleId] ??= []).push(`${rel}:${line} ${RULES[ruleId]}`);
  }
}

let canonicalTokenScanCount = 0;
try {
  const sourceFiles = walk(join(ROOT, 'src'), [], true);
  if (sourceFiles.length === 0) throw new Error('src contains no TypeScript sources');
  canonicalTokenScanCount = sourceFiles.length + 1;
  for (const file of sourceFiles) {
    const rel = relative(ROOT, file).replaceAll('\\', '/');
    const source = readFileSync(file, 'utf8');
    if (!source.trim()) hardFailures.push(`${rel}: token-audited source file is empty`);
    hardFailures.push(...validateCanonicalTokenUsage(rel, source));
  }
} catch (error) {
  hardFailures.push(`cannot validate canonical token usage: ${error instanceof Error ? error.message : String(error)}`);
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
  hardFailures.push(...validateCanonicalTokenUsage('App.tsx', appSource));
  hardFailures.push(...validateBottomTabSafety(appSource, packageJson));
} catch (error) {
  hardFailures.push(`cannot validate bottom-tab safety: ${error instanceof Error ? error.message : String(error)}`);
}

const scopeSummary = SCAN_DIRS.map((dir) => `${dir}=${scopeCounts[dir] ?? 0}`).join(', ');
console.log(`[check-ui-style] scanned ${files.length} UI source files (${scopeSummary})`);
console.log(`[check-ui-style] canonical token coverage: ${canonicalTokenScanCount} production/test TypeScript sources`);
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
