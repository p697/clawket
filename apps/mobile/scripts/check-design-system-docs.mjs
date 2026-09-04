#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const COMPONENTS = [
  'ActionButton',
  'Button',
  'Card',
  'FormTextInput',
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
  'createSurfaceStyle',
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

export function validateDesignSystemDocs({ tokensSource, indexSource, designDoc, agentsDoc }) {
  const failures = [];
  for (const [label, source] of Object.entries({ tokensSource, indexSource, designDoc, agentsDoc })) {
    if (typeof source !== 'string' || source.trim().length === 0) failures.push(`${label} is missing or empty`);
  }
  if (failures.length) return failures;

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
  console.log(`design-system docs check passed; verified ${COMPONENTS.length} components, ${TOKEN_FAMILIES.length} token families, and ${DOCUMENTED_EXCEPTIONS.length} exceptions.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) run();
