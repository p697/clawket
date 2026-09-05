import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDesignSystemDocs } from './check-design-system-docs.mjs';

const components = ['ActionButton', 'Button', 'Card', 'CompositionSafeBottomSheetTextInput', 'CompositionSafeTextInput', 'FormTextInput', 'PasteCapableTextInput', 'SearchInput', 'SettingsGroup', 'SettingsIcon', 'ThemedSwitch'];
const tokens = ['BorderWidth', 'ControlSize', 'FontSize', 'LineHeight', 'PresentationColor', 'Radius', 'Shadow', 'Space', 'StatusSize', 'createSurfaceStyle'];
const themeColors = ['canvas', 'canvasGrouped', 'surface', 'surfaceFloating', 'ink', 'inkSecondary', 'inkTertiary', 'line', 'accent', 'accentSoft', 'onAccent', 'scrim', 'good', 'goodSoft', 'warn', 'warnSoft', 'bad', 'badSoft'];
const exceptions = ['ChatAppearancePreviewCard', 'ChatComposer', 'ChatSharePosterModal', 'FileEditorView', 'SkillContentScreen', 'StatsPosterModal'];
const codeList = (values) => values.map((value) => `\`${value}\``).join('\n');
const validInput = {
  tokensSource: tokens.join('\n'),
  themeSource: `export type CanonicalThemeColors = {\n${themeColors.map((color) => `  ${color}: string;`).join('\n')}\n};`,
  indexSource: components.join('\n'),
  designDoc: codeList([...components, ...tokens, ...themeColors, ...exceptions]),
  agentsDoc: codeList([...components, ...tokens]),
};

test('accepts complete design-system sources', () => {
  assert.deepEqual(validateDesignSystemDocs(validInput), []);
});

test('fails loudly when a shared component disappears from durable docs', () => {
  const failures = validateDesignSystemDocs({
    ...validInput,
    designDoc: validInput.designDoc.replace('`SettingsIcon`', ''),
  });
  assert.ok(failures.some((failure) => failure.includes('SettingsIcon')));
});

test('fails loudly on empty input', () => {
  const failures = validateDesignSystemDocs({ ...validInput, tokensSource: '' });
  assert.ok(failures.some((failure) => failure.includes('tokensSource')));
});

test('rejects a noncanonical theme color alias', () => {
  const failures = validateDesignSystemDocs({
    ...validInput,
    themeSource: validInput.themeSource.replace('  badSoft: string;', '  badSoft: string;\n  surfaceMuted: string;'),
  });
  assert.ok(failures.some((failure) => failure.includes('surfaceMuted')));
});

test('fails closed when the theme source is corrupted', () => {
  const failures = validateDesignSystemDocs({
    ...validInput,
    themeSource: 'export type CanonicalThemeColors = { canvas:',
  });
  assert.ok(failures.some((failure) => failure.includes('cannot be parsed')));
});
