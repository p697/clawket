import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  SUPPORTED_LOCALES,
  loadLocaleCatalogs,
  parseArguments,
  parseLocaleCatalog,
  runI18nPrune,
  validateCatalogs,
} from './i18n-prune.mjs';

const fixtureCatalogs = {
  common: {
    'Used common': 'Used common',
    'Dynamic common': 'Dynamic common',
    'Dead common': 'Dead common',
  },
  chat: {
    'Used chat': 'Used chat',
    thinking_high: 'High',
    'Dead chat': 'Dead chat',
  },
  config: {
    'Used config': 'Used config',
    'Retain config': 'Retain config',
    'Dead config': 'Dead config',
  },
  console: {
    'Used console': 'Used console',
    'Dead console': 'Dead console',
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeCatalogMatrix(overrides = {}) {
  return Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [
    locale,
    clone(overrides[locale] ?? fixtureCatalogs),
  ]));
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'clawket-i18n-prune-selftest-'));
  const localeRoot = join(root, 'src', 'i18n', 'locales');
  for (const locale of SUPPORTED_LOCALES) {
    const directory = join(localeRoot, locale);
    mkdirSync(directory, { recursive: true });
    for (const [namespace, catalog] of Object.entries(fixtureCatalogs)) {
      writeFileSync(
        join(directory, `${namespace}.json`),
        `${JSON.stringify(catalog, null, 2)}\n`,
        'utf8',
      );
    }
  }
  writeFileSync(
    join(root, 'src', 'Example.tsx'),
    `import { Trans, useTranslation } from 'react-i18next';
import i18n from './i18n';

export function Example({ runtimeKey, level }) {
  const { t } = useTranslation('common');
  t('Used common');
  t(runtimeKey);
  t(\`thinking_\${level}\`, { ns: 'chat' });
  i18n.t('Used chat', { ns: 'chat' });
  i18n.t('Used console', { ns: 'console' });
  return <Trans ns="config" i18nKey="Used config" />;
}
`,
    'utf8',
  );
  return root;
}

function snapshotLocales(root) {
  const values = {};
  for (const locale of SUPPORTED_LOCALES) {
    for (const namespace of Object.keys(fixtureCatalogs)) {
      const path = join(root, 'src', 'i18n', 'locales', locale, `${namespace}.json`);
      values[`${locale}/${namespace}`] = readFileSync(path, 'utf8');
    }
  }
  return values;
}

test('validates the six-locale, four-namespace catalog matrix', () => {
  const result = validateCatalogs(makeCatalogMatrix());
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.namespaces, ['chat', 'common', 'config', 'console']);
  assert.equal(result.catalogKeyCount, 11);

  const settingsLayout = makeCatalogMatrix();
  for (const locale of SUPPORTED_LOCALES) {
    settingsLayout[locale].settings = settingsLayout[locale].console;
    delete settingsLayout[locale].console;
  }
  const renamed = validateCatalogs(settingsLayout);
  assert.deepEqual(renamed.errors, []);
  assert.deepEqual(renamed.namespaces, ['chat', 'common', 'config', 'settings']);
});

test('fails closed for corrupted, empty, duplicate, missing, and inconsistent inputs', () => {
  assert.throws(() => parseLocaleCatalog('', 'empty.json'), /missing or empty/u);
  assert.throws(() => parseLocaleCatalog('{bad', 'bad.json'), /malformed JSON/u);
  assert.throws(
    () => parseLocaleCatalog('{"Same":"one","Same":"two"}', 'duplicate.json'),
    /duplicate key/u,
  );

  const missingLocale = makeCatalogMatrix();
  delete missingLocale.es;
  assert.ok(validateCatalogs(missingLocale).errors.some((error) => error.includes('missing locales')));

  const inconsistent = makeCatalogMatrix();
  delete inconsistent.ja.chat['Dead chat'];
  assert.ok(
    validateCatalogs(inconsistent).errors.some(
      (error) => error.includes('ja/chat: missing keys: Dead chat'),
    ),
  );

  const empty = makeCatalogMatrix();
  empty.ko.config = {};
  assert.ok(
    validateCatalogs(empty).errors.some(
      (error) => error.includes('ko/config: catalog is missing, empty, or malformed'),
    ),
  );
});

test('reports deterministically without writing and protects dynamic and retained keys', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const before = snapshotLocales(root);
  const output = [];
  const result = runI18nPrune({
    root,
    mode: 'report',
    retainRules: { exact: { config: ['Retain config'] }, prefixes: {} },
    log: (line) => output.push(line),
    error: (line) => output.push(line),
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(snapshotLocales(root), before);
  assert.deepEqual(result.report.analysis.removable, [
    'chat:Dead chat',
    'config:Dead config',
    'console:Dead console',
  ]);
  assert.deepEqual(result.report.analysis.retained, [
    'chat:thinking_high',
    'config:Retain config',
  ]);
  assert.deepEqual(result.report.analysis.dynamicProtected, [
    'common:Dead common',
    'common:Dynamic common',
  ]);
  assert.deepEqual(result.report.analysis.protectedNamespaces, ['common']);
  assert.match(output[0], /files=1 locales=6 namespaces=4 catalog_keys=11/u);
  assert.ok(output.some((line) => line === 'UNUSED remove chat:Dead chat'));
});

test('strict fails on actionable debt and explicit write removes only proven-unused keys', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const retainRules = { exact: { config: ['Retain config'] }, prefixes: {} };
  const strict = runI18nPrune({
    root,
    mode: 'strict',
    retainRules,
    log: () => {},
    error: () => {},
  });
  assert.equal(strict.exitCode, 1);

  const write = runI18nPrune({
    root,
    mode: 'write',
    retainRules,
    log: () => {},
    error: () => {},
  });
  assert.equal(write.exitCode, 0);
  assert.deepEqual(write.writeResult, { filesWritten: 18, keysRemoved: 3 });

  const loaded = loadLocaleCatalogs(root);
  assert.deepEqual(loaded.errors, []);
  for (const locale of SUPPORTED_LOCALES) {
    assert.ok('Dead common' in loaded.catalogs[locale].common);
    assert.ok('Dynamic common' in loaded.catalogs[locale].common);
    assert.ok('thinking_high' in loaded.catalogs[locale].chat);
    assert.ok('Retain config' in loaded.catalogs[locale].config);
    assert.ok(!('Dead chat' in loaded.catalogs[locale].chat));
    assert.ok(!('Dead config' in loaded.catalogs[locale].config));
    assert.ok(!('Dead console' in loaded.catalogs[locale].console));
  }
});

test('rejects unsafe CLI combinations and parses explicit retention rules', () => {
  assert.throws(() => parseArguments(['--strict', '--write']), /choose only one/u);
  assert.throws(() => parseArguments(['--catalog-only', '--write']), /choose only one/u);
  assert.throws(() => parseArguments(['--unknown']), /unknown argument/u);
  assert.throws(() => parseArguments(['--retain=missing-separator']), /namespace:value/u);
  const parsed = parseArguments([
    '--strict',
    '--retain=config:Runtime label',
    '--retain-prefix=chat:thinking_',
  ]);
  assert.equal(parsed.mode, 'strict');
  assert.deepEqual(parsed.retainRules, {
    exact: { config: ['Runtime label'] },
    prefixes: { chat: ['thinking_'] },
  });

  assert.equal(parseArguments(['--catalog-only']).mode, 'catalog');
});
