import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { SUPPORTED_LOCALES } = require('../../apps/mobile/src/i18n/supported-locales.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function formatArguments(value) {
  const result = [];
  let implicit = 0;
  let positional = false;
  let unnumbered = false;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '%') continue;
    if (value[index + 1] === '%') { index += 1; continue; }
    const match = /^%(?:([1-9]\d*)\$)?[-+ #0]*(?:\d+)?(?:\.\d+)?(hh|h|ll|l|q|L|z|t|j)?([@dDuUxXoOfFeEgGaAcCsSp])/.exec(value.slice(index));
    if (!match) {
      if (/^%(?:\d+\$)?n/.test(value.slice(index))) throw new Error('Unsafe format directive');
      continue;
    }
    if (match[1]) positional = true;
    else unnumbered = true;
    const position = match[1] ? Number(match[1]) : ++implicit;
    result.push(`${position}:${match[2] ?? ''}${match[3]}`);
    index += match[0].length - 1;
  }
  if (positional && unnumbered) throw new Error('Mixed positional and unnumbered format arguments');
  return result.sort();
}

function units(localization, locale, where, issues) {
  if (!object(localization)) { issues.push(`${where}: localization must be an object`); return []; }
  if (own(localization, 'stringUnit')) {
    if (own(localization, 'variations') || own(localization, 'substitutions')) {
      issues.push(`${where}: ambiguous string unit and variants`);
    }
    return [{ unit: localization.stringUnit, plural: false }];
  }
  const plural = localization.variations?.plural;
  if (!object(plural) || Object.keys(localization.variations).length !== 1 || own(localization, 'substitutions')) {
    issues.push(`${where}: unsupported or missing translation structure`);
    return [];
  }
  const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  for (const category of categories) {
    if (!own(plural, category)) issues.push(`${where}: missing plural category ${category}`);
  }
  const known = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
  return Object.entries(plural).flatMap(([category, variant]) => {
    if (!known.has(category)) issues.push(`${where}: unknown plural category ${category}`);
    if (!object(variant) || !own(variant, 'stringUnit')) {
      issues.push(`${where}/${category}: missing string unit`);
      return [];
    }
    return [{ unit: variant.stringUnit, plural: true }];
  });
}

/** Validates real translations; absent locales are counted, never filled with English. */
export function inspectCatalog(catalog, inventory, { requiredLocales } = {}) {
  if (!object(inventory) || inventory.schema !== 1 || !Array.isArray(inventory.strings) || inventory.strings.length === 0
      || !Array.isArray(inventory.locales) || inventory.locales.length === 0) {
    throw new Error('Missing, malformed or empty native localization inventory');
  }
  if (!object(catalog) || catalog.sourceLanguage !== 'en' || catalog.version !== '1.0'
      || !object(catalog.strings) || Object.keys(catalog.strings).length === 0) {
    throw new Error('Missing, malformed or empty native string catalog');
  }
  const locales = inventory.locales;
  if (new Set(locales).size !== locales.length || locales.some((locale) => typeof locale !== 'string' || !locale)) {
    throw new Error('Invalid or duplicate inventory locales');
  }
  const required = requiredLocales ?? locales;
  if (required.length === 0 || required.some((locale) => !locales.includes(locale))) throw new Error('Invalid required locale scope');
  const keys = inventory.strings.map((entry) => entry?.key);
  if (keys.some((key) => typeof key !== 'string' || !key) || new Set(keys).size !== keys.length) {
    throw new Error('Invalid or duplicate native localization keys');
  }
  const issues = [];
  const expected = new Set(keys);
  for (const key of Object.keys(catalog.strings)) {
    if (!expected.has(key)) issues.push(`Uninventoried catalog key: ${key}`);
  }
  const coverage = Object.fromEntries(locales.map((locale) => [locale, 0]));
  const missing = Object.fromEntries(locales.map((locale) => [locale, []]));
  for (const key of keys) {
    const entry = catalog.strings[key];
    if (!object(entry) || !object(entry.localizations)) { issues.push(`Missing catalog key: ${key}`); continue; }
    if (entry.extractionState !== 'manual') issues.push(`${key}: package/host catalog entries must remain manual`);
    for (const locale of Object.keys(entry.localizations)) {
      if (!locales.includes(locale)) issues.push(`${key}: unexpected locale ${locale}`);
    }
    let sourceArguments;
    try { sourceArguments = formatArguments(key); }
    catch (error) { issues.push(`${key}: ${error.message}`); continue; }
    for (const locale of locales) {
      const localization = entry.localizations[locale];
      if (!localization) { missing[locale].push(key); continue; }
      const before = issues.length;
      const values = units(localization, locale, `${key}/${locale}`, issues);
      if (values.length === 0) missing[locale].push(key);
      for (const { unit, plural } of values) {
        if (!object(unit) || unit.state !== 'translated' || typeof unit.value !== 'string' || !unit.value.trim()) {
          issues.push(`${key}/${locale}: missing actual translated text`);
          continue;
        }
        if (/\{\{[^}]+\}\}/.test(unit.value)) issues.push(`${key}/${locale}: unconverted Mobile interpolation`);
        try {
          const actualArguments = formatArguments(unit.value);
          const numericArguments = sourceArguments.filter((argument) => /[dDuUxXoO]$/.test(argument));
          // A plural rule consumes the count even when a language writes "one message"
          // or "no messages" without displaying the numeric argument.
          const withoutCount = plural && numericArguments.length === 1
            ? sourceArguments.filter((argument) => argument !== numericArguments[0]) : undefined;
          if (plural && numericArguments.length !== 1) {
            issues.push(`${key}/${locale}: plural requires one unambiguous integer argument`);
          }
          if (JSON.stringify(actualArguments) !== JSON.stringify(sourceArguments)
              && JSON.stringify(actualArguments) !== JSON.stringify(withoutCount)) {
            issues.push(`${key}/${locale}: format arguments differ from source`);
          }
        } catch (error) { issues.push(`${key}/${locale}: ${error.message}`); }
      }
      if (values.length > 0 && before === issues.length) coverage[locale] += 1;
    }
  }
  for (const locale of required) {
    if (missing[locale].length) issues.push(`${locale}: ${missing[locale].length}/${keys.length} translations pending (${missing[locale].slice(0, 3).join('; ')})`);
  }
  return { keyCount: keys.length, requiredLocales: required, coverage, missing, issues };
}

export function validateCatalog(catalog, inventory, options) {
  const report = inspectCatalog(catalog, inventory, options);
  if (report.issues.length) throw new Error(report.issues.join('\n'));
  return report;
}

export function inspectPermissionCatalog(catalog, inventory, options) {
  const report = inspectCatalog(catalog, { ...inventory, strings: inventory.infoPlistStrings }, options);
  for (const entry of inventory.infoPlistStrings) {
    if (typeof entry.sourceValue !== 'string' || !entry.sourceValue.trim()
        || catalog.strings[entry.key]?.localizations?.en?.stringUnit?.value !== entry.sourceValue) {
      report.issues.push(`${entry.key}: permission source differs from the inventoried purpose`);
    }
  }
  return report;
}

function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--initial-qa') || args.length > 1) throw new Error('Usage: node scripts/native-ios/localization.mjs [--initial-qa]');
  const inventory = JSON.parse(readFileSync(path.join(root, 'docs/native-ios/localization-inventory.json'), 'utf8'));
  if (JSON.stringify(inventory.locales) !== JSON.stringify(SUPPORTED_LOCALES.map((locale) => locale.code))) {
    throw new Error('Native locale inventory differs from the shared 19-locale product contract');
  }
  const catalog = JSON.parse(readFileSync(path.join(root, 'apps/ios/Clawket/Localizable.xcstrings'), 'utf8'));
  const permissionCatalog = JSON.parse(readFileSync(path.join(root, 'apps/ios/Clawket/InfoPlist.xcstrings'), 'utf8'));
  const options = args.includes('--initial-qa') ? { requiredLocales: inventory.requiredForInitialQA } : {};
  const report = inspectCatalog(catalog, inventory, options);
  const permissions = inspectPermissionCatalog(permissionCatalog, inventory, options);
  console.log(`Native catalogs: ${report.keyCount} UI keys; ${permissions.keyCount} permission purposes; required locale scope: ${report.requiredLocales.join(', ')}`);
  for (const [locale, count] of Object.entries(report.coverage)) {
    console.log(`${locale}: UI ${count}/${report.keyCount}, permissions ${permissions.coverage[locale]}/${permissions.keyCount}`);
  }
  const issues = [...report.issues.map((issue) => `UI: ${issue}`), ...permissions.issues.map((issue) => `InfoPlist: ${issue}`)];
  if (issues.length) throw new Error(issues.join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
