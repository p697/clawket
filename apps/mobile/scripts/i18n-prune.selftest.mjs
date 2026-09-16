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
  validateAppConfig,
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
  settings: {
    'Used settings': 'Used settings',
    'Dead settings': 'Dead settings',
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function localizedCatalogs(locale) {
  if (locale === 'en') return clone(fixtureCatalogs);
  return Object.fromEntries(Object.entries(fixtureCatalogs).map(([namespace, catalog]) => [
    namespace,
    Object.fromEntries(Object.entries(catalog).map(([key, value]) => [key, `${locale} ${value}`])),
  ]));
}

function makeCatalogMatrix(overrides = {}) {
  return Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [
    locale,
    clone(overrides[locale] ?? localizedCatalogs(locale)),
  ]));
}

function makeAppConfig(overrides = {}) {
  const locales = overrides.locales ?? SUPPORTED_LOCALES;
  return JSON.stringify({
    expo: {
      ios: { infoPlist: { CFBundleLocalizations: overrides.bundle ?? locales } },
      plugins: [
        'expo-font',
        ['expo-localization', { supportsRTL: overrides.supportsRTL ?? true, supportedLocales: locales }],
      ],
    },
  });
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'clawket-i18n-prune-selftest-'));
  const localeRoot = join(root, 'src', 'i18n', 'locales');
  for (const locale of SUPPORTED_LOCALES) {
    const directory = join(localeRoot, locale);
    mkdirSync(directory, { recursive: true });
    for (const [namespace, catalog] of Object.entries(localizedCatalogs(locale))) {
      writeFileSync(
        join(directory, `${namespace}.json`),
        `${JSON.stringify(catalog, null, 2)}\n`,
        'utf8',
      );
    }
  }
  writeFileSync(join(root, 'app.json'), makeAppConfig(), 'utf8');
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
  i18n.t('Used settings', { ns: 'settings' });
  return <Trans ns="config" i18nKey="Used config" />;
}
`,
    'utf8',
  );
  writeFileSync(
    join(root, 'src', 'Scoped.tsx'),
    `import { useTranslation } from 'react-i18next';

export function First() {
  const { t } = useTranslation(['chat', 'config']);
  return t('Used config');
}

export function Second() {
  const { t } = useTranslation('settings');
  return t('Used settings') + t('Used chat');
}
`,
    'utf8',
  );
  writeFileSync(
    join(root, 'src', 'Origin.ts'),
    `export const RUNTIME_KEYS = ['Dynamic common'] as const;
`,
    'utf8',
  );
  writeFileSync(
    join(root, 'App.tsx'),
    `import i18n from './src/i18n';

export function App() {
  return i18n.t('Dead config', { ns: 'config' });
}
`,
    'utf8',
  );
  return root;
}

const fixtureOrigins = [
  { file: 'src/Example.tsx', argument: 'runtimeKey', origin: 'src/Origin.ts' },
];

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

test('validates the supported-locale, four-namespace catalog matrix', () => {
  const result = validateCatalogs(makeCatalogMatrix());
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.namespaces, ['chat', 'common', 'config', 'settings']);
  assert.equal(result.catalogKeyCount, 11);
  assert.equal(SUPPORTED_LOCALES.length, 19);
  assert.equal(SUPPORTED_LOCALES[0], 'en');

  const legacyConsoleLayout = makeCatalogMatrix();
  for (const locale of SUPPORTED_LOCALES) {
    legacyConsoleLayout[locale].console = legacyConsoleLayout[locale].settings;
    delete legacyConsoleLayout[locale].settings;
  }
  assert.ok(
    validateCatalogs(legacyConsoleLayout).errors.some(
      (error) => error.includes('expected exactly one supported four-namespace layout'),
    ),
  );
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

  const untranslated = makeCatalogMatrix({ ar: clone(fixtureCatalogs) });
  assert.ok(
    validateCatalogs(untranslated).errors.some(
      (error) => error.includes('ar/chat: 100% of values equal English; catalog looks untranslated'),
    ),
  );

  const tokens = makeCatalogMatrix();
  tokens.en.common['Hello {{name}}'] = 'Hello {{name}}';
  for (const locale of SUPPORTED_LOCALES) {
    if (locale !== 'en') tokens[locale].common['Hello {{name}}'] = `${locale} {{ name }}`;
  }
  tokens.de.common['Hello {{name}}'] = 'Hallo {{nom}}';
  const tokenErrors = validateCatalogs(tokens).errors;
  assert.deepEqual(tokenErrors, [
    'de/common: interpolation tokens differ for "Hello {{name}}" (expected name, found nom)',
  ]);

  assert.deepEqual(validateAppConfig(makeAppConfig()), []);
  assert.match(validateAppConfig('{oops')[0], /malformed JSON/u);
  assert.deepEqual(validateAppConfig(makeAppConfig({ bundle: ['en'] })), [
    `app.json: expo.ios.infoPlist.CFBundleLocalizations must list exactly ${SUPPORTED_LOCALES.join(', ')}`,
  ]);
  assert.deepEqual(validateAppConfig(makeAppConfig({ supportsRTL: false })), [
    'app.json: expo-localization plugin must set supportsRTL: true',
  ]);
  assert.deepEqual(validateAppConfig(makeAppConfig({ locales: ['en'] })).length, 2);
});

test('fails closed when app.json is missing or registers a different locale set', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const output = [];
  writeFileSync(join(root, 'app.json'), makeAppConfig({ locales: SUPPORTED_LOCALES.slice(1) }), 'utf8');
  assert.equal(runI18nPrune({ root, mode: 'catalog', log: () => {}, error: (line) => output.push(line) }).exitCode, 1);
  assert.match(output.join('\n'), /CFBundleLocalizations must list exactly/u);
  rmSync(join(root, 'app.json'));
  assert.equal(runI18nPrune({ root, mode: 'catalog', log: () => {}, error: (line) => output.push(line) }).exitCode, 1);
  assert.match(output.join('\n'), /cannot read .*app\.json/u);
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
    dynamicOrigins: [],
    log: (line) => output.push(line),
    error: (line) => output.push(line),
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(snapshotLocales(root), before);
  assert.deepEqual(result.report.analysis.removable, [
    'chat:Dead chat',
    'settings:Dead settings',
  ]);
  // Bindings resolve lexically: the second component's `t` only sees `settings`.
  assert.deepEqual(result.report.analysis.missingReferences, [
    'settings:Used chat @ src/Scoped.tsx:10:31',
  ]);
  assert.deepEqual(result.report.analysis.retained, [
    'chat:thinking_high',
    'config:Retain config',
  ]);
  assert.deepEqual(result.report.analysis.dynamicProtected, ['common:Dead common']);
  assert.deepEqual(result.report.analysis.protectedNamespaces, ['common']);
  assert.match(output[0], /files=4 locales=19 namespaces=4 catalog_keys=11/u);
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
    dynamicOrigins: [],
    log: () => {},
    error: () => {},
  });
  assert.equal(strict.exitCode, 1);

  const blocked = runI18nPrune({
    root,
    mode: 'write',
    retainRules,
    dynamicOrigins: [],
    log: () => {},
    error: () => {},
  });
  assert.equal(blocked.exitCode, 1, 'a missing reference must block writing');

  rmSync(join(root, 'src', 'Scoped.tsx'));
  const write = runI18nPrune({
    root,
    mode: 'write',
    retainRules,
    dynamicOrigins: [],
    log: () => {},
    error: () => {},
  });
  assert.equal(write.exitCode, 0);
  assert.deepEqual(write.writeResult, { filesWritten: SUPPORTED_LOCALES.length * 2, keysRemoved: 2 });

  const loaded = loadLocaleCatalogs(root);
  assert.deepEqual(loaded.errors, []);
  for (const locale of SUPPORTED_LOCALES) {
    assert.ok('Dead common' in loaded.catalogs[locale].common);
    assert.ok('Dynamic common' in loaded.catalogs[locale].common);
    assert.ok('thinking_high' in loaded.catalogs[locale].chat);
    assert.ok('Retain config' in loaded.catalogs[locale].config);
    assert.ok(!('Dead chat' in loaded.catalogs[locale].chat));
    assert.ok('Dead config' in loaded.catalogs[locale].config);
    assert.ok(!('Dead settings' in loaded.catalogs[locale].settings));
  }
});

test('registered dynamic origins unprotect their namespace and stale entries fail closed', (context) => {
  const root = createFixture();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  rmSync(join(root, 'src', 'Scoped.tsx'));
  const retainRules = { exact: { config: ['Retain config'] }, prefixes: {} };

  const registered = runI18nPrune({
    root,
    mode: 'report',
    retainRules,
    dynamicOrigins: fixtureOrigins,
    log: () => {},
    error: () => {},
  });
  assert.equal(registered.exitCode, 0);
  assert.deepEqual(registered.report.analysis.registryErrors, []);
  assert.deepEqual(registered.report.analysis.protectedNamespaces, []);
  assert.deepEqual(registered.report.analysis.dynamicProtected, []);
  assert.deepEqual(registered.report.analysis.removable, [
    'chat:Dead chat',
    'common:Dead common',
    'settings:Dead settings',
  ]);
  assert.ok(registered.report.analysis.dynamicCalls.some((call) => call.endsWith('origin=src/Origin.ts')));

  const stale = runI18nPrune({
    root,
    mode: 'write',
    retainRules,
    dynamicOrigins: [
      { file: 'src/Example.tsx', argument: 'movedKey', origin: 'src/Origin.ts' },
      { file: 'src/Example.tsx', argument: 'runtimeKey', origin: 'src/Missing.ts' },
    ],
    log: () => {},
    error: () => {},
  });
  assert.equal(stale.exitCode, 1);
  assert.deepEqual(stale.report.analysis.registryErrors, [
    'src/Example.tsx t(movedKey): no matching dynamic call was found',
    'src/Example.tsx t(runtimeKey): origin src/Missing.ts was not scanned',
  ]);
  assert.equal(stale.writeResult, undefined);
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
