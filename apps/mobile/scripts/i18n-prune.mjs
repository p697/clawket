#!/usr/bin/env node

import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

export const SUPPORTED_LOCALES = Object.freeze([
  'en',
  'zh-Hans',
  'ja',
  'ko',
  'de',
  'es',
]);

export const SUPPORTED_NAMESPACE_LAYOUTS = Object.freeze([
  Object.freeze(['chat', 'common', 'config', 'settings']),
]);

export const DEFAULT_RETAIN_RULES = Object.freeze({
  exact: Object.freeze({}),
  prefixes: Object.freeze({}),
});

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const TEST_FILE_PATTERN = /(?:^|\.)((?:test)|(?:spec))\.[^.]+$/u;

function stable(values) {
  const sortKey = (value) => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return String(value[0]);
    if (value && typeof value.name === 'string') return value.name;
    return String(value);
  };
  return [...values].sort((a, b) => sortKey(a).localeCompare(sortKey(b), 'en'));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

export function parseLocaleCatalog(source, label = 'locale catalog') {
  if (typeof source !== 'string' || source.trim().length === 0) {
    throw new Error(`${label} is missing or empty`);
  }

  const parsedSource = ts.parseJsonText(label, source);
  if (parsedSource.parseDiagnostics.length > 0) {
    const diagnostic = parsedSource.parseDiagnostics[0];
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    throw new Error(`${label} is malformed JSON: ${message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(
      `${label} is malformed JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isPlainObject(parsed)) throw new Error(`${label} must be a JSON object`);

  const entries = Object.entries(parsed);
  if (entries.length === 0) throw new Error(`${label} is empty`);
  for (const [key, value] of entries) {
    if (key.trim().length === 0) throw new Error(`${label} contains an empty key`);
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${label} key ${JSON.stringify(key)} has an empty or non-string value`);
    }
  }

  const statement = parsedSource.statements[0];
  const expression = statement && ts.isExpressionStatement(statement)
    ? statement.expression
    : null;
  if (expression && ts.isObjectLiteralExpression(expression)) {
    const seen = new Set();
    const duplicates = new Set();
    for (const property of expression.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = propertyNameText(property.name);
      if (key === null) continue;
      if (seen.has(key)) duplicates.add(key);
      seen.add(key);
    }
    if (duplicates.size > 0) {
      throw new Error(
        `${label} contains duplicate keys: ${stable(duplicates).map((key) => JSON.stringify(key)).join(', ')}`,
      );
    }
  }

  return parsed;
}

function isSupportedNamespaceLayout(namespaces) {
  const signature = stable(namespaces).join('\0');
  return SUPPORTED_NAMESPACE_LAYOUTS.some((layout) => layout.join('\0') === signature);
}

export function validateCatalogs(catalogs) {
  const errors = [];
  if (!isPlainObject(catalogs)) {
    return { errors: ['catalogs are missing or malformed'], namespaces: [], catalogKeyCount: 0 };
  }

  const actualLocales = stable(Object.keys(catalogs));
  const expectedLocales = stable(SUPPORTED_LOCALES);
  const missingLocales = expectedLocales.filter((locale) => !actualLocales.includes(locale));
  const extraLocales = actualLocales.filter((locale) => !expectedLocales.includes(locale));
  if (missingLocales.length > 0) errors.push(`missing locales: ${missingLocales.join(', ')}`);
  if (extraLocales.length > 0) errors.push(`unexpected locales: ${extraLocales.join(', ')}`);

  const referenceLocale = SUPPORTED_LOCALES.find((locale) => isPlainObject(catalogs[locale]));
  const namespaces = referenceLocale ? stable(Object.keys(catalogs[referenceLocale])) : [];
  if (!isSupportedNamespaceLayout(namespaces)) {
    errors.push(
      `expected exactly one supported four-namespace layout, found: ${namespaces.join(', ') || '(none)'}`,
    );
  }

  for (const locale of SUPPORTED_LOCALES) {
    const localeCatalogs = catalogs[locale];
    if (!isPlainObject(localeCatalogs)) {
      errors.push(`${locale}: locale directory is missing or malformed`);
      continue;
    }
    const localeNamespaces = stable(Object.keys(localeCatalogs));
    if (localeNamespaces.join('\0') !== namespaces.join('\0')) {
      errors.push(
        `${locale}: namespace set differs (${localeNamespaces.join(', ') || '(none)'})`,
      );
    }
    for (const namespace of namespaces) {
      const catalog = localeCatalogs[namespace];
      if (!isPlainObject(catalog) || Object.keys(catalog).length === 0) {
        errors.push(`${locale}/${namespace}: catalog is missing, empty, or malformed`);
        continue;
      }
      for (const [key, value] of Object.entries(catalog)) {
        if (key.trim().length === 0 || typeof value !== 'string' || value.trim().length === 0) {
          errors.push(`${locale}/${namespace}: invalid value for ${JSON.stringify(key)}`);
        }
      }
    }
  }

  if (referenceLocale) {
    for (const namespace of namespaces) {
      const reference = catalogs[referenceLocale][namespace];
      if (!isPlainObject(reference)) continue;
      const referenceKeys = stable(Object.keys(reference));
      for (const locale of SUPPORTED_LOCALES) {
        const catalog = catalogs[locale]?.[namespace];
        if (!isPlainObject(catalog)) continue;
        const keys = stable(Object.keys(catalog));
        const missing = referenceKeys.filter((key) => !keys.includes(key));
        const extra = keys.filter((key) => !referenceKeys.includes(key));
        if (missing.length > 0) {
          errors.push(`${locale}/${namespace}: missing keys: ${missing.join(' | ')}`);
        }
        if (extra.length > 0) {
          errors.push(`${locale}/${namespace}: extra keys: ${extra.join(' | ')}`);
        }
      }
    }
  }

  const catalogKeyCount = referenceLocale
    ? namespaces.reduce((total, namespace) => {
      const catalog = catalogs[referenceLocale][namespace];
      return total + (isPlainObject(catalog) ? Object.keys(catalog).length : 0);
    }, 0)
    : 0;

  return { errors: stable(new Set(errors)), namespaces, catalogKeyCount };
}

export function loadLocaleCatalogs(root) {
  const localeRoot = join(root, 'src', 'i18n', 'locales');
  let localeEntries;
  try {
    localeEntries = readdirSync(localeRoot, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `cannot read locale root ${localeRoot}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const directoryNames = stable(
    localeEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
  );
  const missingLocales = SUPPORTED_LOCALES.filter((locale) => !directoryNames.includes(locale));
  const extraLocales = directoryNames.filter((locale) => !SUPPORTED_LOCALES.includes(locale));
  if (missingLocales.length > 0 || extraLocales.length > 0) {
    const details = [
      missingLocales.length > 0 ? `missing: ${missingLocales.join(', ')}` : '',
      extraLocales.length > 0 ? `unexpected: ${extraLocales.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    throw new Error(`locale directory set is invalid (${details})`);
  }

  const catalogs = {};
  const paths = {};
  const parsingErrors = [];
  for (const locale of SUPPORTED_LOCALES) {
    const directory = join(localeRoot, locale);
    const files = stable(
      readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => entry.name),
    );
    catalogs[locale] = {};
    paths[locale] = {};
    for (const file of files) {
      const namespace = file.slice(0, -'.json'.length);
      const path = join(directory, file);
      try {
        catalogs[locale][namespace] = parseLocaleCatalog(readFileSync(path, 'utf8'), path);
      } catch (error) {
        parsingErrors.push(error instanceof Error ? error.message : String(error));
      }
      paths[locale][namespace] = path;
    }
  }

  if (parsingErrors.length > 0) {
    throw new Error(`locale parsing failed:\n${stable(parsingErrors).map((error) => `- ${error}`).join('\n')}`);
  }

  const validation = validateCatalogs(catalogs);
  if (validation.errors.length > 0) {
    throw new Error(`locale validation failed:\n${validation.errors.map((error) => `- ${error}`).join('\n')}`);
  }
  return { catalogs, paths, ...validation };
}

function sourceExtension(path) {
  return path.endsWith('.tsx') ? '.tsx' : path.endsWith('.ts') ? '.ts' : '';
}

function shouldScanSourceFile(path) {
  const extension = sourceExtension(path);
  if (!SOURCE_EXTENSIONS.has(extension)) return false;
  const base = path.slice(path.lastIndexOf(sep) + 1);
  if (base.endsWith('.d.ts')) return false;
  return !TEST_FILE_PATTERN.test(base);
}

export function listSourceFiles(root) {
  const sourceRoot = join(root, 'src');
  const files = [];
  const visit = (directory) => {
    for (const entry of stable(readdirSync(directory, { withFileTypes: true }))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') visit(path);
      } else if (entry.isFile() && shouldScanSourceFile(path)) {
        files.push(path);
      }
    }
  };
  visit(sourceRoot);
  const appEntry = join(root, 'App.tsx');
  if (existsSync(appEntry) && shouldScanSourceFile(appEntry)) files.push(appEntry);
  if (files.length === 0) throw new Error(`no TypeScript source files found under ${sourceRoot}`);
  return stable(files);
}

function unwrapExpression(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function extractStaticStrings(node) {
  if (!node) return { values: [], complete: false };
  const expression = unwrapExpression(node);
  if (ts.isStringLiteralLike(expression)) {
    return { values: [expression.text], complete: true };
  }
  if (ts.isConditionalExpression(expression)) {
    const whenTrue = extractStaticStrings(expression.whenTrue);
    const whenFalse = extractStaticStrings(expression.whenFalse);
    return {
      values: stable(new Set([...whenTrue.values, ...whenFalse.values])),
      complete: whenTrue.complete && whenFalse.complete,
    };
  }
  if (ts.isArrayLiteralExpression(expression)) {
    const parts = expression.elements.map(extractStaticStrings);
    const values = [];
    for (const part of parts) {
      for (const value of part.values) {
        if (!values.includes(value)) values.push(value);
      }
    }
    return {
      values,
      complete: parts.every((part) => part.complete),
    };
  }
  return { values: [], complete: false };
}

function dynamicTemplatePrefix(node) {
  if (!node) return null;
  const expression = unwrapExpression(node);
  if (!ts.isTemplateExpression(expression)) return null;
  return expression.head.text.length > 0 ? expression.head.text : null;
}

function callName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

function objectProperty(object, name) {
  if (!object || !ts.isObjectLiteralExpression(unwrapExpression(object))) return null;
  for (const property of unwrapExpression(object).properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.name) === name) return property.initializer;
  }
  return null;
}

function jsxAttribute(opening, name) {
  return opening.attributes.properties.find(
    (property) => ts.isJsxAttribute(property) && property.name.text === name,
  ) ?? null;
}

function jsxAttributeExpression(attribute) {
  if (!attribute?.initializer) return null;
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer;
  if (ts.isJsxExpression(attribute.initializer)) return attribute.initializer.expression ?? null;
  return null;
}

function nodeLocation(sourceFile, node, root) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${relative(root, sourceFile.fileName).split(sep).join('/')}:${position.line + 1}:${position.character + 1}`;
}

function createNamespaceSets(namespaces) {
  return Object.fromEntries(namespaces.map((namespace) => [namespace, new Set()]));
}

function collectDefaultNamespaces(sourceFile, namespaces) {
  const found = [];
  const addFirst = (argument) => {
    const extracted = extractStaticStrings(argument);
    const first = extracted.values.find((namespace) => namespaces.includes(namespace));
    if (first && !found.includes(first)) found.push(first);
  };
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = callName(node.expression);
      if (name === 'useTranslation' || name === 'withTranslation') addFirst(node.arguments[0]);
      if (name === 'getFixedT') addFirst(node.arguments[1]);
    }
    if (ts.isJsxOpeningLikeElement(node) && node.tagName.getText(sourceFile) === 'Translation') {
      addFirst(jsxAttributeExpression(jsxAttribute(node, 'ns')));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found.length > 0 ? found : namespaces.includes('common') ? ['common'] : [namespaces[0]];
}

function collectTranslationBindings(sourceFile, namespaces) {
  const bindings = new Map();
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isObjectBindingPattern(node.name)
      && node.initializer
      && ts.isCallExpression(unwrapExpression(node.initializer))
      && callName(unwrapExpression(node.initializer).expression) === 'useTranslation'
    ) {
      const call = unwrapExpression(node.initializer);
      const extracted = extractStaticStrings(call.arguments[0]);
      const namespace = extracted.values.find((value) => namespaces.includes(value))
        ?? (namespaces.includes('common') ? 'common' : namespaces[0]);
      for (const element of node.name.elements) {
        const importedName = element.propertyName
          ? propertyNameText(element.propertyName)
          : propertyNameText(element.name);
        if (importedName !== 't' || !ts.isIdentifier(element.name)) continue;
        const values = bindings.get(element.name.text) ?? new Set();
        values.add(namespace);
        bindings.set(element.name.text, values);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return bindings;
}

function translationCallNamespaces(expression, bindings, defaults) {
  if (ts.isIdentifier(expression)) {
    if (bindings.has(expression.text)) return stable(bindings.get(expression.text));
    return expression.text === 't' ? defaults : null;
  }
  if (ts.isPropertyAccessExpression(expression) && expression.name.text === 't') {
    return defaults;
  }
  return null;
}

function resolveNamespaces(explicitNode, defaults, namespaces) {
  if (!explicitNode) return { namespaces: defaults, complete: true };
  const extracted = extractStaticStrings(explicitNode);
  const known = extracted.values.filter((namespace) => namespaces.includes(namespace));
  if (extracted.complete && known.length === extracted.values.length && known.length > 0) {
    return { namespaces: known, complete: true };
  }
  return { namespaces, complete: false };
}

function normalizeKeyNamespace(key, targetNamespaces, namespaces) {
  const separator = key.indexOf(':');
  if (separator > 0) {
    const prefix = key.slice(0, separator);
    if (namespaces.includes(prefix)) {
      return { key: key.slice(separator + 1), namespaces: [prefix] };
    }
  }
  return { key, namespaces: targetNamespaces };
}

function normalizeRetainRules(namespaces, rules = DEFAULT_RETAIN_RULES) {
  const exact = createNamespaceSets(namespaces);
  const prefixes = createNamespaceSets(namespaces);
  for (const namespace of namespaces) {
    for (const key of rules.exact?.[namespace] ?? []) exact[namespace].add(key);
    for (const prefix of rules.prefixes?.[namespace] ?? []) prefixes[namespace].add(prefix);
  }
  return { exact, prefixes };
}

export function analyzeSourceFiles({ files, root, catalogs, namespaces, retainRules }) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('source file list is missing or empty');
  }
  const referenceLocale = catalogs.en ? 'en' : SUPPORTED_LOCALES[0];
  const catalogKeys = Object.fromEntries(
    namespaces.map((namespace) => [
      namespace,
      new Set(Object.keys(catalogs[referenceLocale][namespace])),
    ]),
  );
  const keyNamespaces = new Map();
  for (const namespace of namespaces) {
    for (const key of catalogKeys[namespace]) {
      const values = keyNamespaces.get(key) ?? new Set();
      values.add(namespace);
      keyNamespaces.set(key, values);
    }
  }

  const referenced = createNamespaceSets(namespaces);
  const dynamicPrefixes = createNamespaceSets(namespaces);
  const protectedNamespaces = new Set();
  const dynamicCalls = [];
  const missingReferences = [];
  const parseErrors = [];

  const recordKey = (rawKey, targetNamespaces, location) => {
    const normalized = normalizeKeyNamespace(rawKey, targetNamespaces, namespaces);
    for (const namespace of normalized.namespaces) {
      if (catalogKeys[namespace]?.has(normalized.key)) referenced[namespace].add(normalized.key);
      else missingReferences.push(`${namespace}:${normalized.key} @ ${location}`);
    }
  };

  for (const path of stable(files)) {
    const source = readFileSync(path, 'utf8');
    const sourceFile = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    if (sourceFile.parseDiagnostics.length > 0) {
      for (const diagnostic of sourceFile.parseDiagnostics) {
        parseErrors.push(
          `${relative(root, path)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
        );
      }
      continue;
    }
    const defaults = collectDefaultNamespaces(sourceFile, namespaces);
    const translationBindings = collectTranslationBindings(sourceFile, namespaces);

    const visit = (node) => {
      if (ts.isStringLiteralLike(node)) {
        const matchingNamespaces = keyNamespaces.get(node.text);
        if (matchingNamespaces) {
          for (const namespace of matchingNamespaces) referenced[namespace].add(node.text);
        }
      }

      const callNamespaces = ts.isCallExpression(node)
        ? translationCallNamespaces(node.expression, translationBindings, defaults)
        : null;
      if (ts.isCallExpression(node) && callNamespaces) {
        const argument = node.arguments[0];
        const explicitNs = objectProperty(node.arguments[1], 'ns');
        const resolved = resolveNamespaces(explicitNs, callNamespaces, namespaces);
        const extracted = extractStaticStrings(argument);
        const location = nodeLocation(sourceFile, node, root);
        for (const key of extracted.values) recordKey(key, resolved.namespaces, location);
        if (!extracted.complete) {
          const prefix = dynamicTemplatePrefix(argument);
          if (prefix) {
            for (const namespace of resolved.namespaces) dynamicPrefixes[namespace].add(prefix);
            dynamicCalls.push(`${location} [${resolved.namespaces.join(',')}] prefix=${prefix}`);
          } else {
            for (const namespace of resolved.namespaces) protectedNamespaces.add(namespace);
            dynamicCalls.push(`${location} [${resolved.namespaces.join(',')}] unresolved`);
          }
        }
        if (!resolved.complete) {
          for (const namespace of namespaces) protectedNamespaces.add(namespace);
          dynamicCalls.push(`${location} [namespace unresolved]`);
        }
      }

      if (ts.isJsxOpeningLikeElement(node) && node.tagName.getText(sourceFile) === 'Trans') {
        const keyAttribute = jsxAttribute(node, 'i18nKey');
        const nsAttribute = jsxAttribute(node, 'ns');
        const keyNode = jsxAttributeExpression(keyAttribute);
        const resolved = resolveNamespaces(
          jsxAttributeExpression(nsAttribute),
          defaults,
          namespaces,
        );
        const extracted = extractStaticStrings(keyNode);
        const location = nodeLocation(sourceFile, node, root);
        for (const key of extracted.values) recordKey(key, resolved.namespaces, location);
        if (!keyNode || !extracted.complete) {
          for (const namespace of resolved.namespaces) protectedNamespaces.add(namespace);
          dynamicCalls.push(`${location} [${resolved.namespaces.join(',')}] Trans key unresolved`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  if (parseErrors.length > 0) {
    throw new Error(`source parsing failed:\n${stable(parseErrors).map((error) => `- ${error}`).join('\n')}`);
  }

  const normalizedRetain = normalizeRetainRules(namespaces, retainRules);
  const unused = [];
  const removable = [];
  const retained = [];
  const dynamicProtected = [];
  for (const namespace of namespaces) {
    for (const prefix of dynamicPrefixes[namespace]) {
      normalizedRetain.prefixes[namespace].add(prefix);
    }
    for (const key of stable(catalogKeys[namespace])) {
      if (referenced[namespace].has(key)) continue;
      const qualified = `${namespace}:${key}`;
      unused.push(qualified);
      const explicitlyRetained = normalizedRetain.exact[namespace].has(key)
        || [...normalizedRetain.prefixes[namespace]].some((prefix) => key.startsWith(prefix));
      if (explicitlyRetained) retained.push(qualified);
      else if (protectedNamespaces.has(namespace)) dynamicProtected.push(qualified);
      else removable.push(qualified);
    }
  }

  return {
    referenced,
    referencedCount: namespaces.reduce((total, namespace) => total + referenced[namespace].size, 0),
    unused: stable(unused),
    removable: stable(removable),
    retained: stable(retained),
    dynamicProtected: stable(dynamicProtected),
    dynamicCalls: stable(new Set(dynamicCalls)),
    protectedNamespaces: stable(protectedNamespaces),
    missingReferences: stable(new Set(missingReferences)),
  };
}

function parseQualifiedRule(value, label) {
  const separator = value.indexOf(':');
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`${label} must use namespace:value`);
  }
  return { namespace: value.slice(0, separator), value: value.slice(separator + 1) };
}

export function parseArguments(argv) {
  let mode = 'report';
  let root = SCRIPT_ROOT;
  let help = false;
  const exact = {};
  const prefixes = {};
  const setMode = (next) => {
    if (mode !== 'report') {
      throw new Error('choose only one of --strict, --write, or --catalog-only');
    }
    mode = next;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--strict') setMode('strict');
    else if (argument === '--write') setMode('write');
    else if (argument === '--catalog-only') setMode('catalog');
    else if (argument === '--help' || argument === '-h') help = true;
    else if (argument === '--root') {
      const value = argv[index + 1];
      if (!value) throw new Error('--root requires a path');
      root = resolve(value);
      index += 1;
    } else if (argument.startsWith('--root=')) {
      root = resolve(argument.slice('--root='.length));
    } else if (argument.startsWith('--retain=')) {
      const rule = parseQualifiedRule(argument.slice('--retain='.length), '--retain');
      (exact[rule.namespace] ??= []).push(rule.value);
    } else if (argument.startsWith('--retain-prefix=')) {
      const rule = parseQualifiedRule(
        argument.slice('--retain-prefix='.length),
        '--retain-prefix',
      );
      (prefixes[rule.namespace] ??= []).push(rule.value);
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return { mode, root, help, retainRules: { exact, prefixes } };
}

function validateRetainNamespaces(retainRules, namespaces) {
  const used = new Set([
    ...Object.keys(retainRules.exact ?? {}),
    ...Object.keys(retainRules.prefixes ?? {}),
  ]);
  const unknown = stable([...used].filter((namespace) => !namespaces.includes(namespace)));
  if (unknown.length > 0) throw new Error(`retain rules use unknown namespaces: ${unknown.join(', ')}`);
}

function mergeRetainRules(base, extra, namespaces) {
  const merged = { exact: {}, prefixes: {} };
  for (const namespace of namespaces) {
    merged.exact[namespace] = stable(new Set([
      ...(base.exact?.[namespace] ?? []),
      ...(extra.exact?.[namespace] ?? []),
    ]));
    merged.prefixes[namespace] = stable(new Set([
      ...(base.prefixes?.[namespace] ?? []),
      ...(extra.prefixes?.[namespace] ?? []),
    ]));
  }
  return merged;
}

export function writePrunedCatalogs({ catalogs, paths, removable }) {
  const removals = new Map();
  for (const qualified of removable) {
    const separator = qualified.indexOf(':');
    const namespace = qualified.slice(0, separator);
    const key = qualified.slice(separator + 1);
    const values = removals.get(namespace) ?? new Set();
    values.add(key);
    removals.set(namespace, values);
  }
  if (removals.size === 0) return { filesWritten: 0, keysRemoved: 0 };

  const pending = [];
  try {
    for (const locale of SUPPORTED_LOCALES) {
      for (const [namespace, keys] of stable(removals.entries())) {
        const sourceCatalog = catalogs[locale]?.[namespace];
        const destination = paths[locale]?.[namespace];
        if (!isPlainObject(sourceCatalog) || !destination) {
          throw new Error(`cannot write missing catalog ${locale}/${namespace}`);
        }
        const next = {};
        for (const [key, value] of Object.entries(sourceCatalog)) {
          if (!keys.has(key)) next[key] = value;
        }
        if (Object.keys(next).length === 0) {
          throw new Error(`refusing to empty catalog ${locale}/${namespace}`);
        }
        const temporary = `${destination}.i18n-prune-${process.pid}-${pending.length}.tmp`;
        writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
        parseLocaleCatalog(readFileSync(temporary, 'utf8'), temporary);
        pending.push({ temporary, destination });
      }
    }
    for (const { temporary, destination } of pending) renameSync(temporary, destination);
  } finally {
    for (const { temporary } of pending) rmSync(temporary, { force: true });
  }
  return {
    filesWritten: pending.length,
    keysRemoved: removable.length,
  };
}

function printReport(report, log) {
  log(
    `[i18n-prune] mode=${report.mode} files=${report.fileCount} locales=${SUPPORTED_LOCALES.length} namespaces=${report.namespaces.length} catalog_keys=${report.catalogKeyCount} translations=${report.catalogKeyCount * SUPPORTED_LOCALES.length} referenced=${report.analysis.referencedCount} unused=${report.analysis.unused.length} removable=${report.analysis.removable.length} retained=${report.analysis.retained.length} dynamic_protected=${report.analysis.dynamicProtected.length} missing=${report.analysis.missingReferences.length} dynamic_calls=${report.analysis.dynamicCalls.length}`,
  );
  for (const key of report.analysis.removable) log(`UNUSED remove ${key}`);
  for (const key of report.analysis.retained) log(`UNUSED retain ${key}`);
  for (const key of report.analysis.dynamicProtected) log(`UNUSED dynamic-protected ${key}`);
  for (const reference of report.analysis.missingReferences) log(`MISSING ${reference}`);
  for (const call of report.analysis.dynamicCalls) log(`DYNAMIC ${call}`);
  if (report.analysis.protectedNamespaces.length > 0) {
    log(`PROTECTED namespaces=${report.analysis.protectedNamespaces.join(',')}`);
  }
}

export function runI18nPrune({
  root = SCRIPT_ROOT,
  mode = 'report',
  retainRules = DEFAULT_RETAIN_RULES,
  log = console.log,
  error = console.error,
} = {}) {
  try {
    const loaded = loadLocaleCatalogs(root);
    validateRetainNamespaces(retainRules, loaded.namespaces);
    if (mode === 'catalog') {
      log(
        `[i18n-prune] catalog check passed locales=${SUPPORTED_LOCALES.length} namespaces=${loaded.namespaces.length} catalog_keys=${loaded.catalogKeyCount} translations=${loaded.catalogKeyCount * SUPPORTED_LOCALES.length}`,
      );
      return {
        exitCode: 0,
        report: {
          mode,
          namespaces: loaded.namespaces,
          catalogKeyCount: loaded.catalogKeyCount,
        },
      };
    }
    const files = listSourceFiles(root);
    const mergedRetainRules = mergeRetainRules(
      DEFAULT_RETAIN_RULES,
      retainRules,
      loaded.namespaces,
    );
    const analysis = analyzeSourceFiles({
      files,
      root,
      catalogs: loaded.catalogs,
      namespaces: loaded.namespaces,
      retainRules: mergedRetainRules,
    });
    const report = {
      mode,
      fileCount: files.length,
      namespaces: loaded.namespaces,
      catalogKeyCount: loaded.catalogKeyCount,
      analysis,
    };
    printReport(report, log);

    if (mode === 'write') {
      if (analysis.missingReferences.length > 0) {
        error('[i18n-prune] refusing --write because source references missing catalog keys');
        return { exitCode: 1, report };
      }
      const result = writePrunedCatalogs({
        catalogs: loaded.catalogs,
        paths: loaded.paths,
        removable: analysis.removable,
      });
      log(
        `[i18n-prune] write complete files=${result.filesWritten} keys_removed=${result.keysRemoved}`,
      );
      return { exitCode: 0, report, writeResult: result };
    }

    if (mode === 'strict') {
      const failed = analysis.removable.length > 0
        || analysis.missingReferences.length > 0
        || analysis.protectedNamespaces.length > 0;
      if (failed) {
        error('[i18n-prune] strict check failed');
        return { exitCode: 1, report };
      }
      log('[i18n-prune] strict check passed');
    }
    return { exitCode: 0, report };
  } catch (caught) {
    error(`[i18n-prune] failed: ${caught instanceof Error ? caught.message : String(caught)}`);
    return { exitCode: 1, report: null };
  }
}

function printHelp() {
  console.log(`Usage: node scripts/i18n-prune.mjs [options]

Default mode reports unused keys without changing files.

Options:
  --strict                       Fail on removable, missing, or unresolved dynamic keys
  --write                        Delete only proven-unused, unprotected keys
  --catalog-only                 Validate locale, namespace, and key parity only
  --root <path>                  Override the mobile workspace root
  --retain=<namespace>:<key>     Preserve an exact dynamically used key
  --retain-prefix=<ns>:<prefix>  Preserve a dynamic key family
  --help                         Show this help`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) printHelp();
    else process.exitCode = runI18nPrune(options).exitCode;
  } catch (error) {
    console.error(`[i18n-prune] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
