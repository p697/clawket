#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourcePattern = /\.(?:ts|tsx)$/;
const testFilePattern = /(?:^|\/)(?:__tests__|tests?)(?:\/|$)|\.(?:test|spec)\.(?:ts|tsx)$/;

function git(args) {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function normalizeLines(output) {
  return output.split('\n').map((line) => line.trim()).filter(Boolean);
}

export function parseArgs(argv) {
  if (argv.length === 0) return { ref: null };
  if (argv.length === 2 && argv[0] === '--ref' && argv[1].trim()) {
    return { ref: argv[1].trim() };
  }
  throw new Error('Usage: npm run metrics:loc -- [--ref <git-ref>]');
}

export function isTestFile(file) {
  return testFilePattern.test(file);
}

export function countLines(content) {
  if (content.length === 0) return 0;
  const newlineCount = (content.match(/\n/g) ?? []).length;
  return content.endsWith('\n') ? newlineCount : newlineCount + 1;
}

function listFiles(ref) {
  if (ref) {
    git(['rev-parse', '--verify', `${ref}^{commit}`]);
    return normalizeLines(git(['ls-tree', '-r', '--name-only', ref]));
  }

  return normalizeLines(git(['ls-files', '--cached', '--others', '--exclude-standard']))
    .filter((file) => existsSync(path.join(repositoryRoot, file)));
}

function readFileAt(file, ref) {
  if (ref) return git(['show', `${ref}:${file}`]);
  return readFileSync(path.join(repositoryRoot, file), 'utf8');
}

export function collectMetrics({ ref = null } = {}) {
  const files = listFiles(ref);
  const sourceFiles = files.filter(
    (file) => (file.startsWith('apps/') || file.startsWith('packages/')) && sourcePattern.test(file),
  );
  const scopes = new Map();

  for (const file of sourceFiles) {
    const [kind, workspace] = file.split('/');
    if (!workspace) continue;
    const scope = `${kind}/${workspace}`;
    const current = scopes.get(scope) ?? { nonTestLines: 0, testLines: 0, testFiles: 0 };
    const lines = countLines(readFileAt(file, ref));
    if (isTestFile(file)) {
      current.testLines += lines;
      current.testFiles += 1;
    } else {
      current.nonTestLines += lines;
    }
    scopes.set(scope, current);
  }

  const markdownFiles = selectMarkdownFiles(files);
  validateInventory({ sourceFiles, markdownFiles });
  const totals = [...scopes.values()].reduce(
    (result, item) => ({
      nonTestLines: result.nonTestLines + item.nonTestLines,
      testLines: result.testLines + item.testLines,
      testFiles: result.testFiles + item.testFiles,
    }),
    { nonTestLines: 0, testLines: 0, testFiles: 0 },
  );

  return {
    ref,
    scopes: [...scopes.entries()].sort(([left], [right]) => left.localeCompare(right)),
    totals,
    markdownFiles: markdownFiles.length,
  };
}

export function selectMarkdownFiles(files) {
  return files.filter((file) => file.endsWith('.md'));
}

export function validateInventory({ sourceFiles, markdownFiles }) {
  if (!Array.isArray(sourceFiles) || sourceFiles.length === 0) {
    throw new Error('LOC metrics found no TypeScript source files under apps/ or packages/.');
  }
  if (!Array.isArray(markdownFiles) || markdownFiles.length === 0) {
    throw new Error("LOC metrics found no tracked Markdown files from git ls-files '*.md'.");
  }
}

export function formatMarkdown(metrics) {
  const lines = [
    `# Clawket LOC metrics${metrics.ref ? ` (${metrics.ref})` : ''}`,
    '',
    '| Scope | Non-test TS/TSX lines | Test TS/TSX lines | Test files |',
    '|---|---:|---:|---:|',
  ];

  for (const [scope, values] of metrics.scopes) {
    lines.push(`| \`${scope}\` | ${values.nonTestLines} | ${values.testLines} | ${values.testFiles} |`);
  }
  lines.push(
    `| **Total** | **${metrics.totals.nonTestLines}** | **${metrics.totals.testLines}** | **${metrics.totals.testFiles}** |`,
    '',
    `Markdown documents (\`git ls-files '*.md'\` equivalent): **${metrics.markdownFiles}**`,
  );
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  process.stdout.write(formatMarkdown(collectMetrics(args)));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
