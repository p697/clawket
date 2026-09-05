#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');

const COMPONENTS = [
  'ActionButton',
  'Button',
  'Card',
  'CompositionSafeBottomSheetTextInput',
  'CompositionSafeTextInput',
  'FormTextInput',
  'PasteCapableTextInput',
  'SearchInput',
  'SettingsGroup',
  'SettingsIcon',
  'ThemedSwitch',
];
const TOKEN_FAMILIES = [
  'BorderWidth',
  'ControlSize',
  'FontSize',
  'LineHeight',
  'PresentationColor',
  'Radius',
  'Shadow',
  'Space',
  'StatusSize',
  'createSurfaceStyle',
];
const THEME_COLORS = [
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
];
const DOCUMENTED_EXCEPTIONS = [
  'ChatAppearancePreviewCard',
  'ChatComposer',
  'ChatSharePosterModal',
  'FileEditorView',
  'SkillContentScreen',
  'StatsPosterModal',
];

function requireText(label, source, needle, failures) {
  if (!source.includes(needle)) failures.push(`${label} is missing ${needle}`);
}

function propertyName(node) {
  const name = node?.name;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;
}

function validateCanonicalThemeSource(themeSource, failures) {
  const sourceFile = ts.createSourceFile(
    'src/theme/theme.ts',
    themeSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  for (const diagnostic of sourceFile.parseDiagnostics ?? []) {
    failures.push(`theme.ts cannot be parsed: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
  }
  const declaration = sourceFile.statements.find((statement) => (
    ts.isTypeAliasDeclaration(statement) && statement.name.text === 'CanonicalThemeColors'
  ));
  if (!declaration || !ts.isTypeLiteralNode(declaration.type)) {
    failures.push('theme.ts is missing the CanonicalThemeColors type literal');
    return;
  }
  const actual = new Set(declaration.type.members.map(propertyName).filter(Boolean));
  for (const color of actual) {
    if (!THEME_COLORS.includes(color)) failures.push(`theme.ts defines noncanonical color ${color}`);
  }
  for (const color of THEME_COLORS) {
    if (!actual.has(color)) failures.push(`theme.ts is missing canonical color ${color}`);
  }
  if (themeSource.includes('LegacyThemeColorAliases')) {
    failures.push('theme.ts still defines LegacyThemeColorAliases');
  }
}

export function validateDesignSystemDocs({ tokensSource, themeSource, indexSource, designDoc, agentsDoc }) {
  const failures = [];
  for (const [label, source] of Object.entries({ tokensSource, themeSource, indexSource, designDoc, agentsDoc })) {
    if (typeof source !== 'string' || source.trim().length === 0) failures.push(`${label} is missing or empty`);
  }
  if (failures.length) return failures;

  validateCanonicalThemeSource(themeSource, failures);
  for (const component of COMPONENTS) {
    requireText('UI index', indexSource, component, failures);
    requireText('design-system.md', designDoc, `\`${component}\``, failures);
    requireText('AGENTS.md', agentsDoc, `\`${component}\``, failures);
  }
  for (const token of TOKEN_FAMILIES) {
    requireText('tokens.ts', tokensSource, token, failures);
    requireText('design-system.md', designDoc, `\`${token}`, failures);
    requireText('AGENTS.md', agentsDoc, `\`${token}`, failures);
  }
  for (const color of THEME_COLORS) {
    requireText('design-system.md', designDoc, `\`${color}\``, failures);
  }
  for (const exception of DOCUMENTED_EXCEPTIONS) {
    requireText('design-system.md', designDoc, `\`${exception}\``, failures);
  }
  return failures;
}

function readRequired(path) {
  return readFileSync(join(ROOT, path), 'utf8');
}

function run() {
  let failures;
  try {
    failures = validateDesignSystemDocs({
      tokensSource: readRequired('src/theme/tokens.ts'),
      themeSource: readRequired('src/theme/theme.ts'),
      indexSource: readRequired('src/components/ui/index.ts'),
      designDoc: readRequired('docs/design-system.md'),
      agentsDoc: readRequired('AGENTS.md'),
    });
  } catch (error) {
    failures = [`cannot read design-system sources: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (failures.length) {
    console.error('[check-design-system-docs] failed');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`design-system docs check passed; verified ${COMPONENTS.length} components, ${TOKEN_FAMILIES.length} token families, ${THEME_COLORS.length} canonical theme colors, and ${DOCUMENTED_EXCEPTIONS.length} exceptions.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) run();
