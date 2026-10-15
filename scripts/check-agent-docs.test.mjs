import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isGitSymlinkPlaceholder, readAgentDocRecords, shouldScanAgentDirectory, validateAgentDocRecords } from './check-agent-docs.mjs';

test('discovers authored native app instructions while excluding generated projects and Swift dependencies', () => {
  for (const path of ['apps/ios', 'apps/android', 'apps/mobile/modules/capture/ios', 'packages/apple/Sources']) {
    assert.equal(shouldScanAgentDirectory(path), true, path);
  }
  for (const path of ['apps/mobile/ios', 'apps/mobile/android', 'packages/apple/.build', 'node_modules', '.git']) {
    assert.equal(shouldScanAgentDirectory(path), false, path);
  }
});

test('a copied instruction file in apps/ios cannot disappear behind the generated-project exclusion', () => {
  const directory = mkdtempSync(join(tmpdir(), 'clawket-native-agent-docs-'));
  try {
    for (const path of ['apps/ios', 'apps/mobile/ios', 'packages/apple/.build']) {
      const target = join(directory, path);
      mkdirSync(target, { recursive: true });
      writeFileSync(join(target, 'AGENTS.md'), '# Native instructions');
      writeFileSync(join(target, 'CLAUDE.md'), '# Unreviewed copied instructions');
    }
    const records = readAgentDocRecords(directory);
    assert.deepEqual(records.map(record => record.agentPath), ['apps/ios/AGENTS.md']);
    assert.match(validateAgentDocRecords(records).join('\n'), /apps\/ios\/AGENTS.md: CLAUDE.md must be a symlink/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Windows placeholders require both the tracked symlink mode and exact target bytes', () => {
  const entry = `120000 ${'a'.repeat(40)} 0\tapps/mobile/CLAUDE.md`;
  assert.equal(isGitSymlinkPlaceholder(entry, 'AGENTS.md'), true);
  assert.equal(isGitSymlinkPlaceholder(entry.replace('120000', '100644'), 'AGENTS.md'), false);
  assert.equal(isGitSymlinkPlaceholder(entry, '# copied instructions'), false);
  assert.equal(isGitSymlinkPlaceholder(entry, '../AGENTS.md'), false);
  assert.equal(isGitSymlinkPlaceholder('', 'AGENTS.md'), false);
});

const rootContent = [
  '# Overview',
  '`AGENTS.md` is the only authored instruction source in each directory.',
  '## CLI Lifecycle Rule',
].join('\n');

const mobileContent = [
  '# Overview',
  '`backendKind` is the product backend: `openclaw` or `hermes`.',
  'src/features/app-updates/releases.ts',
  'docs/design-system.md',
  'docs/engineering-baseline.md',
  '@react-navigation/bottom-tabs',
].join('\n');

function validRecords() {
  return [
    {
      agentPath: 'AGENTS.md',
      claudeKind: 'symlink',
      claudeTarget: 'AGENTS.md',
      content: rootContent,
    },
    {
      agentPath: 'apps/mobile/AGENTS.md',
      claudeKind: 'symlink',
      claudeTarget: 'AGENTS.md',
      content: mobileContent,
    },
  ];
}

test('accepts canonical relative AGENTS symlinks and current references', () => {
  assert.deepEqual(validateAgentDocRecords(validRecords()), []);
});

test('rejects a copied CLAUDE document', () => {
  const records = validRecords();
  records[1] = { ...records[1], claudeKind: 'file', claudeTarget: null };
  assert.match(validateAgentDocRecords(records).join('\n'), /must be a symlink/);
});

test('rejects obsolete release documentation', () => {
  const records = validRecords();
  records[1] = {
    ...records[1],
    content: `${records[1].content}\nsrc/features/app-updates/currentAnnouncement.ts`,
  };
  assert.match(validateAgentDocRecords(records).join('\n'), /removed currentAnnouncement/);
});

test('rejects duplicated lifecycle instructions', () => {
  const records = validRecords();
  records[0] = {
    ...records[0],
    content: `${records[0].content}\n## CLI Lifecycle Rule`,
  };
  assert.match(validateAgentDocRecords(records).join('\n'), /2 CLI Lifecycle Rule headings/);
});
