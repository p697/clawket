import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countLines,
  formatMarkdown,
  isTestFile,
  parseArgs,
  selectMarkdownFiles,
  validateInventory,
} from './loc.mjs';

test('classifies colocated and directory-based tests', () => {
  assert.equal(isTestFile('apps/mobile/src/example.test.ts'), true);
  assert.equal(isTestFile('packages/example/tests/protocol.ts'), true);
  assert.equal(isTestFile('apps/mobile/src/example.ts'), false);
});

test('counts files with and without a trailing newline', () => {
  assert.equal(countLines(''), 0);
  assert.equal(countLines('one\n'), 1);
  assert.equal(countLines('one\ntwo'), 2);
});

test('rejects malformed arguments instead of silently changing scope', () => {
  assert.throws(() => parseArgs(['--ref']), /Usage:/);
  assert.throws(() => parseArgs(['--unknown', 'main']), /Usage:/);
});

test('uses the working-tree inventory for Markdown additions and deletions', () => {
  assert.deepEqual(
    selectMarkdownFiles(['README.md', 'docs/new.md', 'docs/removed.txt', 'apps/mobile/src/index.ts']),
    ['README.md', 'docs/new.md'],
  );
});

test('rejects a missing or corrupted file inventory', () => {
  assert.throws(
    () => validateInventory({ sourceFiles: [], markdownFiles: ['README.md'] }),
    /no TypeScript source files/,
  );
  assert.throws(
    () => validateInventory({ sourceFiles: ['apps/mobile/src/index.ts'], markdownFiles: [] }),
    /no tracked Markdown files/,
  );
});

test('renders an auditable Markdown summary', () => {
  const output = formatMarkdown({
    ref: 'abc123',
    scopes: [['apps/example', { nonTestLines: 10, testLines: 5, testFiles: 1 }]],
    totals: { nonTestLines: 10, testLines: 5, testFiles: 1 },
    markdownFiles: 2,
  });

  assert.match(output, /Clawket LOC metrics \(abc123\)/);
  assert.match(output, /\*\*10\*\*/);
  assert.match(output, /Markdown documents.*\*\*2\*\*/);
});
