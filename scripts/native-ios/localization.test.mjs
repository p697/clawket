import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { formatArguments, inspectCatalog, inspectPermissionCatalog, validateCatalog } from './localization.mjs';

const inventory = { schema: 1, locales: ['en', 'ar'], strings: [{ key: 'Preview %@' }] };
const unit = (value) => ({ stringUnit: { state: 'translated', value } });
const fixture = () => ({
  sourceLanguage: 'en', version: '1.0', strings: {
    'Preview %@': { extractionState: 'manual', localizations: { en: unit('Preview %@'), ar: unit('معاينة %@') } },
  },
});

test('validates the real UI and permission catalogs in all 19 locales', () => {
  const inventory = JSON.parse(readFileSync(new URL('../../docs/native-ios/localization-inventory.json', import.meta.url), 'utf8'));
  const catalog = JSON.parse(readFileSync(new URL('../../apps/ios/Clawket/Localizable.xcstrings', import.meta.url), 'utf8'));
  const result = validateCatalog(catalog, inventory);
  const permissionCatalog = JSON.parse(readFileSync(new URL('../../apps/ios/Clawket/InfoPlist.xcstrings', import.meta.url), 'utf8'));
  const permissions = inspectPermissionCatalog(permissionCatalog, inventory);
  assert.deepEqual(permissions.issues, []);
  assert.equal(result.keyCount, inventory.strings.length);
  assert.equal(Object.keys(result.coverage).length, 19);
  assert.equal(permissions.keyCount, 4);
  for (const locale of inventory.locales) {
    assert.equal(result.coverage[locale], result.keyCount);
    assert.equal(permissions.coverage[locale], permissions.keyCount);
  }
});

test('permission purposes reject a changed source or missing inventory instead of claiming resource coverage', () => {
  const purposeInventory = { ...inventory, infoPlistStrings: [{ key: 'Preview %@', sourceValue: 'Preview %@' }] };
  const catalog = fixture();
  assert.deepEqual(inspectPermissionCatalog(catalog, purposeInventory).issues, []);
  catalog.strings['Preview %@'].localizations.en = unit('Changed %@');
  assert.match(inspectPermissionCatalog(catalog, purposeInventory).issues.join('\n'), /permission source differs/);
  assert.throws(() => inspectPermissionCatalog(catalog, { ...purposeInventory, infoPlistStrings: [] }), /empty/);
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
      en: { variations: { plural: { one: unit('One message'), other: unit('%lld messages') } } },
      ar: { variations: { plural: {
        zero: unit('لا رسائل'), one: unit('رسالة واحدة'), two: unit('رسالتان'),
        few: unit('%lld رسائل'), many: unit('%lld رسالة'), other: unit('%lld رسالة'),
      } } },
    } },
  } };
  const pluralInventory = { ...inventory, strings: [{ key }] };
  validateCatalog(catalog, pluralInventory);
  delete catalog.strings[key].localizations.ar.variations.plural.two;
  assert.throws(() => validateCatalog(catalog, pluralInventory), /missing plural category two/);
});
