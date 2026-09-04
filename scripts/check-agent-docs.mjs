#!/usr/bin/env node

import { lstatSync, readFileSync, readlinkSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'ios', 'android', 'build', 'dist']);

function discoverAgentPaths(root, directory = root, paths = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        discoverAgentPaths(root, join(directory, entry.name), paths);
      }
      continue;
    }
    if (entry.name === 'AGENTS.md') paths.push(relative(root, join(directory, entry.name)));
  }
  return paths.sort();
}

export function validateAgentDocRecords(records) {
  const failures = [];

  for (const record of records) {
    if (record.claudeKind !== 'symlink') {
      failures.push(`${record.agentPath}: CLAUDE.md must be a symlink, got ${record.claudeKind}`);
    } else if (record.claudeTarget !== 'AGENTS.md') {
      failures.push(`${record.agentPath}: CLAUDE.md must target AGENTS.md, got ${record.claudeTarget}`);
    }
  }

  const root = records.find((record) => record.agentPath === 'AGENTS.md');
  const mobile = records.find((record) => record.agentPath === 'apps/mobile/AGENTS.md');
  if (!root) failures.push('root AGENTS.md was not discovered');
  if (!mobile) failures.push('apps/mobile/AGENTS.md was not discovered');

  if (root) {
    if (!root.content.includes('AGENTS.md` is the only authored instruction source')) {
      failures.push('root AGENTS.md does not define the canonical AGENTS/CLAUDE source rule');
    }
    const lifecycleHeadings = root.content.match(/^## CLI Lifecycle Rule$/gm) ?? [];
    if (lifecycleHeadings.length !== 1) {
      failures.push(`root AGENTS.md has ${lifecycleHeadings.length} CLI Lifecycle Rule headings; expected 1`);
    }
  }

  if (mobile) {
    const requiredReferences = [
      'src/features/app-updates/releases.ts',
      'docs/design-system.md',
      'docs/engineering-baseline.md',
      '@react-navigation/bottom-tabs',
      '`openclaw` or `hermes`',
    ];
    for (const reference of requiredReferences) {
      if (!mobile.content.includes(reference)) {
        failures.push(`apps/mobile/AGENTS.md is missing current reference: ${reference}`);
      }
    }
    if (mobile.content.includes('src/features/app-updates/currentAnnouncement.ts')) {
      failures.push('apps/mobile/AGENTS.md still references removed currentAnnouncement.ts');
    }
  }

  return failures;
}

export function readAgentDocRecords(root = REPOSITORY_ROOT) {
  return discoverAgentPaths(root).map((agentPath) => {
    const directory = dirname(join(root, agentPath));
    const claudePath = join(directory, 'CLAUDE.md');
    let claudeKind = 'missing';
    let claudeTarget = null;
    try {
      const stat = lstatSync(claudePath);
      claudeKind = stat.isSymbolicLink() ? 'symlink' : 'file';
      if (stat.isSymbolicLink()) claudeTarget = readlinkSync(claudePath);
    } catch {
      // A missing compatibility document is reported by the validator.
    }
    return {
      agentPath,
      claudeKind,
      claudeTarget,
      content: readFileSync(join(root, agentPath), 'utf8'),
    };
  });
}

export function runAgentDocCheck(root = REPOSITORY_ROOT) {
  const records = readAgentDocRecords(root);
  const failures = validateAgentDocRecords(records);
  return { records, failures };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const { records, failures } = runAgentDocCheck();
    if (failures.length) {
      console.error('[check-agent-docs] failed');
      for (const failure of failures) console.error(`- ${failure}`);
      process.exit(1);
    }
    console.log(`agent-doc check passed; verified ${records.length} AGENTS/CLAUDE pairs.`);
  } catch (error) {
    console.error('[check-agent-docs] failed');
    console.error(`- ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
