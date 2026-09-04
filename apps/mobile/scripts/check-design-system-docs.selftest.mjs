import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDesignSystemDocs } from './check-design-system-docs.mjs';

const components = ['ActionButton', 'Button', 'Card', 'FormTextInput', 'SearchInput', 'SettingsGroup', 'SettingsIcon', 'ThemedSwitch'];
const tokens = ['BorderWidth', 'ControlSize', 'FontSize', 'LineHeight', 'PresentationColor', 'Radius', 'Shadow', 'Space', 'StatusSize', 'createSurfaceStyle'];
const exceptions = ['ChatAppearancePreviewCard', 'ChatComposer', 'ChatSharePosterModal', 'FileEditorView', 'SkillContentScreen', 'StatsPosterModal'];
const codeList = (values) => values.map((value) => `\`${value}\``).join('\n');
const validInput = {
  tokensSource: tokens.join('\n'),
  indexSource: components.join('\n'),
  designDoc: codeList([...components, ...tokens, ...exceptions]),
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
