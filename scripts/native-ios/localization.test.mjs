import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { formatArguments, inspectCatalog, validateCatalog } from './localization.mjs';

const inventory = { schema: 1, locales: ['en', 'ar'], strings: [{ key: 'Preview %@' }] };
const unit = (value) => ({ stringUnit: { state: 'translated', value } });
const fixture = () => ({
  sourceLanguage: 'en', version: '1.0', strings: {
    'Preview %@': { extractionState: 'manual', localizations: { en: unit('Preview %@'), ar: unit('معاينة %@') } },
  },
});

test('validates the real catalog under the explicit initial-QA scope and reports all 19 locales', () => {
  const inventory = JSON.parse(readFileSync(new URL('../../docs/native-ios/localization-inventory.json', import.meta.url), 'utf8'));
  const catalog = JSON.parse(readFileSync(new URL('../../apps/ios/Clawket/Localizable.xcstrings', import.meta.url), 'utf8'));
  const result = validateCatalog(catalog, inventory, { requiredLocales: inventory.requiredForInitialQA });
  assert.equal(result.keyCount, inventory.strings.length);
  assert.equal(Object.keys(result.coverage).length, 19);
  for (const locale of inventory.requiredForInitialQA) assert.equal(result.coverage[locale], result.keyCount);
});

test('missing required translations fail and never become English-filled completeness', () => {
  const catalog = fixture();
  delete catalog.strings['Preview %@'].localizations.ar;
  assert.throws(() => validateCatalog(catalog, inventory), /ar: 1\/1 translations pending/);
  const report = inspectCatalog(catalog, inventory, { requiredLocales: ['en'] });
  assert.equal(report.coverage.ar, 0);
  assert.deepEqual(report.missing.ar, ['Preview %@']);
  assert.equal(catalog.strings['Preview %@'].localizations.ar, undefined);
});

test('corrupted placeholder types, missing text, duplicate keys and empty inputs fail closed', () => {
  const catalog = fixture();
  catalog.strings['Preview %@'].localizations.ar = unit('معاينة %lld');
  assert.throws(() => validateCatalog(catalog, inventory), /format arguments differ/);
  catalog.strings['Preview %@'].localizations.ar = unit('');
  assert.throws(() => validateCatalog(catalog, inventory), /missing actual translated text/);
  assert.throws(() => validateCatalog(fixture(), { ...inventory, strings: [inventory.strings[0], inventory.strings[0]] }), /duplicate/);
  assert.throws(() => validateCatalog(fixture(), { ...inventory, strings: [] }), /empty/);
  assert.throws(() => validateCatalog({ ...fixture(), strings: {} }, inventory), /empty/);
});

test('positional interpolation supports reordered names without permitting mixed or unsafe formats', () => {
  assert.deepEqual(formatArguments('%@ — %@'), formatArguments('%2$@ — %1$@'));
  assert.deepEqual(formatArguments('100%%'), []);
  assert.throws(() => formatArguments('%1$@ %@'), /Mixed/);
  assert.throws(() => formatArguments('%n'), /Unsafe/);
});

test('Arabic plural variants must cover zero, one, two, few, many and other with matching argument types', () => {
  const key = '%lld messages';
  const catalog = { sourceLanguage: 'en', version: '1.0', strings: {
    [key]: { extractionState: 'manual', localizations: {
      en: { variations: { plural: { one: unit('%lld message'), other: unit('%lld messages') } } },
      ar: { variations: { plural: Object.fromEntries(['zero', 'one', 'two', 'few', 'many', 'other'].map((category) => [category, unit('%lld رسالة')])) } },
    } },
  } };
  const pluralInventory = { ...inventory, strings: [{ key }] };
  validateCatalog(catalog, pluralInventory);
  delete catalog.strings[key].localizations.ar.variations.plural.two;
  assert.throws(() => validateCatalog(catalog, pluralInventory), /missing plural category two/);
});
