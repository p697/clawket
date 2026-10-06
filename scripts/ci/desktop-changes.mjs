#!/usr/bin/env node
// Decides whether a pull request can affect the desktop Bridge and Relay, which the
// Windows and macOS compatibility jobs verify. Anything uncertain runs those jobs:
// a selector that fails must never skip verification.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const DESKTOP_PREFIXES = [
  '.github/',
  'apps/bridge-cli/',
  'apps/relay-registry/',
  'apps/relay-worker/',
  'packages/',
  'scripts/',
  'tests/',
];
// Root files that cannot change what the desktop jobs install, build or run.
const NON_DESKTOP_ROOT_FILE = /^(?:[^/]+\.md|LICENSE|\.gitignore|\.gitleaks\.toml|\.gitleaksignore)$/;

/** Paths the root postinstall runs; every desktop job executes them during npm ci. */
export function postinstallScripts(packageJson) {
  const command = packageJson?.scripts?.postinstall;
  if (typeof command !== 'string') return [];
  return [...command.matchAll(/\bnode\s+([^\s&|;]+\.m?js)\b/g)].map((match) => match[1]);
}

export function affectsDesktop(paths, packageJson) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.some((entry) => typeof entry !== 'string' || !entry)) {
    return { desktop: true, matched: [], reason: 'the changed paths could not be listed' };
  }
  const installScripts = new Set(postinstallScripts(packageJson));
  const matched = paths.filter((entry) => DESKTOP_PREFIXES.some((prefix) => entry.startsWith(prefix))
    || installScripts.has(entry)
    || (!entry.includes('/') && !NON_DESKTOP_ROOT_FILE.test(entry)));
  return { desktop: matched.length > 0, matched, reason: matched.length ? 'desktop paths changed' : 'no desktop paths changed' };
}

/** Keep protected OS names even when only lightweight no-desktop jobs are needed. */
export function desktopJobMatrix(decision) {
  const runDesktop = decision?.desktop !== false;
  return { include: ['windows-latest', 'macos-latest'].map((os) => ({
    os, runner: runDesktop ? os : 'ubuntu-latest', runDesktop,
  })) };
}

function changedPaths(base, head) {
  if (!/^[0-9a-f]{40}$/.test(base ?? '') || !/^[0-9a-f]{40}$/.test(head ?? '')) return null;
  try {
    return execFileSync('git', ['diff', '--name-only', `${base}...${head}`], { cwd: REPOSITORY_ROOT, encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let decision;
  if (process.env.EVENT_NAME !== 'pull_request') {
    decision = { desktop: true, matched: [], reason: `${process.env.EVENT_NAME || 'unknown'} events always run every job` };
  } else {
    let packageJson = null;
    try {
      packageJson = JSON.parse(readFileSync(path.join(REPOSITORY_ROOT, 'package.json'), 'utf8'));
    } catch {
      // A missing or unreadable manifest is itself a desktop-affecting change.
    }
    const paths = changedPaths(process.env.BASE_SHA, process.env.HEAD_SHA);
    decision = packageJson ? affectsDesktop(paths, packageJson) : { desktop: true, matched: [], reason: 'package.json is unreadable' };
    if (paths) console.error(`checked ${paths.length} changed paths; ${decision.matched.length} affect the desktop Bridge`);
    for (const entry of decision.matched.slice(0, 20)) console.error(`  ${entry}`);
  }
  console.error(`desktop jobs: ${decision.desktop ? 'run' : 'skip'} (${decision.reason})`);
  process.stdout.write(`desktop=${decision.desktop}\ndesktop_matrix=${JSON.stringify(desktopJobMatrix(decision))}\n`);
}
