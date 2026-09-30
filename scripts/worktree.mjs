#!/usr/bin/env node
// Task worktree lifecycle for the root AGENTS.md Branch and Worktree Rule.
// Commands, machine setup and tool hooks: docs/worktree-workflow.md.

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statfsSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnNpm } from './node-command.mjs';

export const ROOT_CONFIG_KEY = 'clawket.worktreeRoot';
export const ROOT_ENV = 'CLAWKET_WORKTREE_ROOT';
// Test fixtures live in the OS temporary directory; real worktrees never may.
export const ALLOW_TEMPORARY_ROOT_ENV = 'CLAWKET_WORKTREE_ALLOW_TEMPORARY_ROOT';
export const LEASE_RESOURCES = Object.freeze(['android', 'ios', 'simulator', 'heavy']);
export const DERIVED_DATA_DIRECTORY = '.derived-data';
const DEFAULT_LEASE_TTL = '2h';
const MAX_LEASE_MS = 12 * 60 * 60 * 1000;
const MIN_INSTALL_FREE_BYTES = 4 * 1024 ** 3;

/**
 * Ignored primary-checkout files a task worktree needs. They are linked, never
 * copied: credentials keep one copy, and evidence written from a worktree
 * survives the worktree's removal.
 */
export const LOCAL_LINK_RULES = Object.freeze([
  { parent: 'apps/*', name: /^\.env(\.[\w-]+)?\.local$/ },
  { parent: 'apps/*', name: /^\.dev\.vars(\.[\w-]+)?$/ },
  { parent: 'apps/*', name: /^wrangler(\.[\w-]+)*\.local\.(toml|jsonc)$/ },
  { parent: 'docs/*', name: /^evidence$/ },
]);

export class WorktreeError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'WorktreeError';
    this.exitCode = exitCode;
  }
}

function runGit(args, cwd, input) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return { ok: result.status === 0, status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function gitRaw(args, cwd) {
  const result = runGit(args, cwd);
  if (!result.ok) {
    throw new WorktreeError(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

const git = (args, cwd) => gitRaw(args, cwd).trim();
const refExists = (cwd, ref) => runGit(['show-ref', '--verify', '--quiet', ref], cwd).ok;

/** Real path of the nearest existing ancestor, so missing paths compare like created ones. */
export function canonicalPath(target) {
  const resolved = path.resolve(target);
  try {
    return realpathSync(resolved);
  } catch {
    const parent = path.dirname(resolved);
    return parent === resolved ? resolved : path.join(canonicalPath(parent), path.basename(resolved));
  }
}

export function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === ''
    || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function lstatOrNull(target) {
  try {
    return lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function readRepoContext(cwd = process.cwd()) {
  const probe = runGit(['rev-parse', '--path-format=absolute', '--git-common-dir', '--show-toplevel'], cwd);
  if (!probe.ok) throw new WorktreeError(`not inside a git checkout: ${cwd}`);
  const [commonDir, toplevel] = probe.stdout.trim().split('\n');
  if (path.basename(commonDir) !== '.git') {
    throw new WorktreeError(`unsupported repository layout: ${commonDir} is not a checkout's .git directory`);
  }
  const primary = canonicalPath(path.dirname(commonDir));
  const current = canonicalPath(toplevel);
  return { commonDir: canonicalPath(commonDir), primary, toplevel: current, isPrimary: current === primary };
}

export function temporaryPrefixes() {
  return [...new Set(['/tmp', '/private/tmp', '/var/folders', '/private/var/folders', tmpdir()].map(canonicalPath))];
}

export function resolveWorktreeRoot({ primary, env = process.env, configured = '', temporary = temporaryPrefixes() }) {
  const raw = env[ROOT_ENV]?.trim()
    || configured.trim()
    || path.join(path.dirname(primary), `${path.basename(primary)}-worktrees`);
  if (!path.isAbsolute(raw)) throw new WorktreeError(`worktree root must be an absolute path, got ${raw}`);
  const root = canonicalPath(raw);
  if (isInside(root, canonicalPath(primary))) {
    throw new WorktreeError(`worktree root ${root} is inside the primary checkout, whose tools would scan it`);
  }
  if (env[ALLOW_TEMPORARY_ROOT_ENV] !== '1' && temporary.some((prefix) => isInside(root, prefix))) {
    throw new WorktreeError(`worktree root ${root} is temporary storage that a restart clears`);
  }
  return root;
}

function worktreeRoot(context, env) {
  const configured = runGit(['config', '--get', ROOT_CONFIG_KEY], context.primary);
  return resolveWorktreeRoot({ primary: context.primary, env, configured: configured.ok ? configured.stdout : '' });
}

function ensureRootDirectory(root) {
  const parent = path.dirname(root);
  if (!existsSync(parent)) {
    throw new WorktreeError(`${parent} does not exist; mount its volume or change ${ROOT_CONFIG_KEY}`);
  }
  mkdirSync(root, { recursive: true });
}

const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function validateBranchName(branch) {
  if (typeof branch !== 'string' || !BRANCH_PATTERN.test(branch) || /\.\.|\/\/|\/\.|\.lock$|[/.]$/.test(branch)) {
    throw new WorktreeError(`branch must look like <agent>/<topic> (for example claude/pairing-copy), got ${JSON.stringify(branch)}`);
  }
  return branch;
}

export function worktreeDirectoryName(branch) {
  return validateBranchName(branch).replace(/[^A-Za-z0-9._-]+/g, '-');
}

export function branchForClaudeWorktree(name) {
  if (typeof name !== 'string' || !name.trim()) throw new WorktreeError('hook input has no worktree name');
  const topic = name.trim()
    .replace(/^claude\//, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return validateBranchName(`claude/${topic}`);
}

export function parseWorktreeList(porcelain) {
  const entries = [];
  let entry = null;
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      entry = { path: line.slice('worktree '.length), head: null, branch: null, detached: false, prunable: false };
      entries.push(entry);
    } else if (entry && line.startsWith('HEAD ')) {
      entry.head = line.slice('HEAD '.length);
    } else if (entry && line.startsWith('branch ')) {
      entry.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (entry && line === 'detached') {
      entry.detached = true;
    } else if (entry && line.startsWith('prunable')) {
      entry.prunable = true;
    }
  }
  return entries;
}

const listWorktrees = (primary) => parseWorktreeList(gitRaw(['worktree', 'list', '--porcelain'], primary));

/** Parses `git status --porcelain=v1 -z`; renames and copies carry their source in `from`. */
export function parseStatus(raw) {
  const entries = [];
  const fields = raw.split('\0');
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (!field) continue;
    const entry = { code: field.slice(0, 2), path: field.slice(3) };
    if (entry.code[0] === 'R' || entry.code[0] === 'C') {
      entry.from = fields[index + 1];
      index += 1;
    }
    entries.push(entry);
  }
  return entries;
}

const changedPaths = (cwd, paths = []) => parseStatus(gitRaw(
  ['status', '--porcelain=v1', '-z', '--untracked-files=all', ...(paths.length ? ['--', ...paths] : [])],
  cwd,
));

function assertClean(worktree) {
  const changes = changedPaths(worktree);
  if (changes.length) {
    const sample = changes.slice(0, 10).map((change) => `${change.code} ${change.path}`).join('\n  ');
    throw new WorktreeError(`${worktree} has ${changes.length} uncommitted paths:\n  ${sample}`);
  }
}

function fetchOrigin(cwd, log) {
  const result = runGit(['fetch', '--quiet', '--prune', 'origin'], cwd);
  if (!result.ok) log(`warning: git fetch origin failed, using the last fetched refs: ${result.stderr.trim()}`);
}

function expandParent(primary, pattern) {
  let directories = [''];
  for (const segment of pattern.split('/')) {
    const next = [];
    for (const directory of directories) {
      if (segment !== '*') {
        if (existsSync(path.join(primary, directory, segment))) next.push(path.posix.join(directory, segment));
        continue;
      }
      let entries = [];
      try {
        entries = readdirSync(path.join(primary, directory), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) next.push(path.posix.join(directory, entry.name));
      }
    }
    directories = next;
  }
  return directories;
}

export function findLocalLinkCandidates(primary, rules = LOCAL_LINK_RULES) {
  const candidates = new Set();
  for (const rule of rules) {
    for (const directory of expandParent(primary, rule.parent)) {
      for (const name of readdirSync(path.join(primary, directory))) {
        if (rule.name.test(name)) candidates.add(path.posix.join(directory, name));
      }
    }
  }
  return [...candidates].sort();
}

function ignoredPaths(cwd, relativePaths) {
  if (!relativePaths.length) return new Set();
  const result = runGit(['check-ignore', '--stdin'], cwd, `${relativePaths.join('\n')}\n`);
  // Exit status 1 only means that no path is ignored.
  if (!result.ok && result.status !== 1) throw new WorktreeError(`git check-ignore failed: ${result.stderr.trim()}`);
  return new Set(result.stdout.split('\n').filter(Boolean));
}

export function linkLocalFiles({ primary, worktree, log = () => {} }) {
  const candidates = findLocalLinkCandidates(primary);
  const ignored = ignoredPaths(primary, candidates);
  const report = { linked: [], kept: [], skipped: [], refused: [] };
  for (const relative of candidates) {
    if (!ignored.has(relative)) {
      report.skipped.push(relative);
      continue;
    }
    const destination = path.join(worktree, relative);
    if (lstatOrNull(destination)) {
      report.kept.push(relative);
      continue;
    }
    if (!existsSync(path.dirname(destination))) {
      report.skipped.push(relative);
      continue;
    }
    const source = path.join(primary, relative);
    symlinkSync(source, destination, lstatSync(source).isDirectory() ? 'dir' : 'file');
    // A link git would track could be committed by accident; fail closed instead.
    if (!ignoredPaths(worktree, [relative]).has(relative)) {
      unlinkSync(destination);
      report.refused.push(relative);
      continue;
    }
    report.linked.push(relative);
  }
  log(`linked ${report.linked.length} local files (${report.kept.length} already present)`);
  if (report.refused.length) {
    log(`warning: not linked because this branch's .gitignore would track the link: ${report.refused.join(', ')} `
      + '(ignore them without a trailing slash)');
  }
  return report;
}

function freeBytes(target) {
  try {
    const stats = statfsSync(target);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

function installDependencies(worktree, { reinstall, log }) {
  if (!reinstall && existsSync(path.join(worktree, 'node_modules', '.package-lock.json'))) {
    log('dependencies already installed; pass --reinstall to run npm ci again');
    return;
  }
  const free = freeBytes(worktree);
  if (free !== null && free < MIN_INSTALL_FREE_BYTES) {
    throw new WorktreeError(`${(free / 1024 ** 3).toFixed(1)} GiB free on the worktree volume; keep at least 4 GiB for npm ci`);
  }
  log(`running npm ci in ${worktree}`);
  // npm writes progress to our stderr so stdout stays reserved for the worktree path.
  const result = spawnNpm(['ci'], { cwd: worktree, stdio: ['ignore', 2, 2] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new WorktreeError(`npm ci failed with exit code ${result.status}`);
}

export function bootstrapWorktree({ primary, worktree, install = true, reinstall = false, log = () => {} }) {
  if (canonicalPath(worktree) === canonicalPath(primary)) {
    throw new WorktreeError('bootstrap runs in a task worktree; the primary checkout keeps its own files');
  }
  const report = linkLocalFiles({ primary, worktree, log });
  if (install) installDependencies(worktree, { reinstall, log });
  else log('skipped dependency install; run bootstrap before using JS tooling');
  return report;
}

export function createWorktree(context, branch, { install = true, reinstall = false, base = 'origin/main', env = process.env, log = () => {} } = {}) {
  validateBranchName(branch);
  if (!runGit(['check-ref-format', '--branch', branch], context.primary).ok) {
    throw new WorktreeError(`git rejects the branch name ${branch}`);
  }
  const root = worktreeRoot(context, env);
  const directory = path.join(root, worktreeDirectoryName(branch));
  const registered = listWorktrees(context.primary).find((entry) => canonicalPath(entry.path) === canonicalPath(directory));
  if (registered) {
    if (registered.branch !== branch) {
      throw new WorktreeError(`${directory} already holds ${registered.branch ?? 'a detached HEAD'}`);
    }
    log(`reusing ${directory}`);
  } else {
    if (existsSync(directory)) {
      throw new WorktreeError(`${directory} exists but is not a registered worktree; inspect it before reusing the name`);
    }
    ensureRootDirectory(root);
    fetchOrigin(context.primary, log);
    if (refExists(context.primary, `refs/heads/${branch}`)) {
      git(['worktree', 'add', directory, branch], context.primary);
    } else if (refExists(context.primary, `refs/remotes/origin/${branch}`)) {
      git(['worktree', 'add', '--track', '-b', branch, directory, `origin/${branch}`], context.primary);
    } else {
      git(['worktree', 'add', '--no-track', '-b', branch, directory, base], context.primary);
    }
    log(`created ${directory} on ${branch} from ${git(['rev-parse', '--short', 'HEAD'], directory)}`);
  }
  bootstrapWorktree({ primary: context.primary, worktree: directory, install, reinstall, log });
  return directory;
}

export function syncPrimary(primary, log = () => {}) {
  const branch = runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], primary);
  if (!branch.ok || branch.stdout.trim() !== 'main') {
    throw new WorktreeError(`the primary checkout ${primary} is not on main`);
  }
  fetchOrigin(primary, log);
  const before = git(['rev-parse', '--short', 'HEAD'], primary);
  const merge = runGit(['merge', '--ff-only', '--quiet', 'origin/main'], primary);
  if (!merge.ok) {
    throw new WorktreeError(`could not fast-forward the primary checkout: ${(merge.stderr || merge.stdout).trim()}\n`
      + 'Move those local changes into task worktrees with their owners (worktree.mjs adopt); never stash or reset them.');
  }
  const after = git(['rev-parse', '--short', 'HEAD'], primary);
  log(before === after ? `primary checkout already at origin/main (${after})` : `primary checkout fast-forwarded ${before} -> ${after}`);
  const dirty = changedPaths(primary);
  if (dirty.length) log(`warning: the primary checkout still has ${dirty.length} uncommitted paths`);
  return after;
}

function derivedDataPath(root, worktree, isPrimary) {
  return path.join(root, DERIVED_DATA_DIRECTORY, isPrimary ? 'primary' : path.basename(worktree));
}

function removeDerivedData(context, worktree, env, log) {
  try {
    const root = worktreeRoot(context, env);
    rmSync(derivedDataPath(root, worktree, false), { recursive: true, force: true });
  } catch (error) {
    log(`warning: DerivedData cleanup skipped: ${error.message}`);
  }
}

/** Removes a clean worktree whose commits all exist on a remote branch; the branch itself stays. */
export function removeWorktree(context, target, { env = process.env, log = () => {} } = {}) {
  const worktree = canonicalPath(target);
  if (worktree === context.primary) throw new WorktreeError('refusing to remove the primary checkout');
  const entry = listWorktrees(context.primary).find((candidate) => canonicalPath(candidate.path) === worktree);
  if (!entry) {
    if (!existsSync(worktree)) {
      log(`${worktree} is already removed`);
      return null;
    }
    throw new WorktreeError(`${worktree} is not a registered worktree of ${context.primary}`);
  }
  if (entry.prunable || !existsSync(worktree)) {
    git(['worktree', 'prune'], context.primary);
    log(`pruned the missing worktree ${worktree}`);
    return entry.branch;
  }
  assertClean(worktree);
  const unpushed = Number(git(['rev-list', '--count', 'HEAD', '--not', '--remotes'], worktree));
  if (unpushed > 0) {
    throw new WorktreeError(`${entry.branch ?? worktree} has ${unpushed} commits on no remote branch; push them first`);
  }
  git(['worktree', 'remove', worktree], context.primary);
  removeDerivedData(context, worktree, env, log);
  log(`removed ${worktree}${entry.branch ? `; kept branch ${entry.branch}` : ''}`);
  return entry.branch;
}

function readPullRequest(branch, cwd) {
  const result = spawnSync('gh', ['pr', 'view', branch, '--json', 'number,state,headRefOid,url'], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error?.code === 'ENOENT') throw new WorktreeError('finish needs the GitHub CLI (gh) to confirm the merge');
  if (result.error) throw result.error;
  if (result.status !== 0) throw new WorktreeError(`no pull request found for ${branch}: ${result.stderr.trim()}`);
  return JSON.parse(result.stdout);
}

export function assertFinishable({ branch, head, pullRequest }) {
  if (pullRequest?.state !== 'MERGED') {
    throw new WorktreeError(`the pull request for ${branch} is ${pullRequest?.state ?? 'missing'}; `
      + 'finish only merged work (push and use remove to park unfinished work)');
  }
  if (pullRequest.headRefOid !== head) {
    throw new WorktreeError(`local ${branch} (${head.slice(0, 8)}) is not the merged head `
      + `(${String(pullRequest.headRefOid).slice(0, 8)}); inspect the extra commits first`);
  }
}

export function finishWorktree(context, { dryRun = false, env = process.env, log = () => {}, fetchPullRequest = readPullRequest } = {}) {
  if (context.isPrimary) throw new WorktreeError('finish runs inside the merged task worktree');
  const worktree = context.toplevel;
  const branch = runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], worktree).stdout.trim();
  if (!branch || branch === 'main') throw new WorktreeError('finish needs a task branch checked out');
  assertClean(worktree);
  const head = git(['rev-parse', 'HEAD'], worktree);
  const pullRequest = fetchPullRequest(branch, worktree);
  assertFinishable({ branch, head, pullRequest });
  if (dryRun) {
    log(`would sync main, remove ${worktree} and delete ${branch} (PR #${pullRequest.number} merged)`);
    return;
  }
  let syncError = null;
  try {
    syncPrimary(context.primary, log);
  } catch (error) {
    syncError = error;
  }
  git(['worktree', 'remove', worktree], context.primary);
  removeDerivedData(context, worktree, env, log);
  git(['branch', '-D', branch], context.primary);
  log(`removed ${worktree} and ${branch} (PR #${pullRequest.number} ${pullRequest.url}); continue from ${context.primary}`);
  if (syncError) throw syncError;
}

function snapshotPath(file) {
  const stat = lstatOrNull(file);
  if (!stat) return 'missing';
  if (stat.isSymbolicLink()) return `link:${readlinkSync(file)}`;
  if (!stat.isFile()) throw new WorktreeError(`${file} is neither a file nor a symbolic link`);
  return `file:${(stat.mode & 0o111) ? 'x' : '-'}:${createHash('sha256').update(readFileSync(file)).digest('hex')}`;
}

/** Restores adopted paths in the primary checkout, skipping any path edited since its snapshot. */
export function restoreAdoptedPaths(primary, snapshots) {
  const restored = [];
  const changedSince = [];
  for (const { path: relative, snapshot, tracked } of snapshots) {
    const file = path.join(primary, relative);
    if (snapshotPath(file) !== snapshot) {
      changedSince.push(relative);
      continue;
    }
    if (tracked) {
      git(['checkout', 'HEAD', '--', relative], primary);
    } else {
      rmSync(file, { force: true });
      git(['rm', '--cached', '--quiet', '--ignore-unmatch', '--', relative], primary);
    }
    restored.push(relative);
  }
  return { restored, changedSince };
}

export function adoptChanges(context, branch, paths, { install = false, env = process.env, log = () => {} } = {}) {
  validateBranchName(branch);
  if (!paths.length) throw new WorktreeError('adopt needs the paths to move out of the primary checkout');
  const primary = context.primary;
  if (refExists(primary, `refs/heads/${branch}`) || refExists(primary, `refs/remotes/origin/${branch}`)) {
    throw new WorktreeError(`${branch} already exists; adopt starts a new branch from the primary checkout's HEAD`);
  }
  const unpushed = Number(git(['rev-list', '--count', 'HEAD', '--not', '--remotes'], primary));
  if (unpushed > 0) throw new WorktreeError(`the primary checkout has ${unpushed} unpushed commits; resolve them first`);
  const affected = new Set();
  for (const change of changedPaths(primary, paths)) {
    affected.add(change.path);
    if (change.from) affected.add(change.from);
  }
  if (!affected.size) throw new WorktreeError('none of those paths has uncommitted changes in the primary checkout');
  const snapshots = [...affected].sort().map((relative) => ({
    path: relative,
    snapshot: snapshotPath(path.join(primary, relative)),
    tracked: runGit(['cat-file', '-e', `HEAD:${relative}`], primary).ok,
  }));

  const directory = createWorktree(context, branch, { install: false, base: git(['rev-parse', 'HEAD'], primary), env, log });
  for (const { path: relative, snapshot } of snapshots) {
    const source = path.join(primary, relative);
    const destination = path.join(directory, relative);
    rmSync(destination, { force: true });
    if (snapshot !== 'missing') {
      mkdirSync(path.dirname(destination), { recursive: true });
      cpSync(source, destination, { verbatimSymlinks: true });
    }
    if (snapshotPath(destination) !== snapshot) {
      throw new WorktreeError(`copy of ${relative} does not match the primary checkout; nothing was restored there`);
    }
  }
  const { restored, changedSince } = restoreAdoptedPaths(primary, snapshots);
  log(`moved ${restored.length} paths into ${directory}; review, commit and open a PR from there`);
  if (install) installDependencies(directory, { reinstall: false, log });
  if (changedSince.length) {
    throw new WorktreeError(`these paths changed during the move and stay in the primary checkout: ${changedSince.join(', ')}`);
  }
  return directory;
}

export function parseDuration(value) {
  const match = /^(\d+)(s|m|h)$/.exec(String(value ?? '').trim());
  const milliseconds = match ? Number(match[1]) * { s: 1000, m: 60_000, h: 3_600_000 }[match[2]] : Number.NaN;
  if (!(milliseconds > 0 && milliseconds <= MAX_LEASE_MS)) {
    throw new WorktreeError(`lease duration must look like 45m or 2h and last at most 12h, got ${JSON.stringify(value)}`);
  }
  return milliseconds;
}

export function leaseFile(commonDir, resource) {
  if (!LEASE_RESOURCES.includes(resource)) {
    throw new WorktreeError(`unknown lease resource ${JSON.stringify(resource)}; use ${LEASE_RESOURCES.join(', ')}`);
  }
  return path.join(commonDir, 'clawket-leases', `${resource}.json`);
}

export function readLease(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let lease = null;
  try {
    lease = JSON.parse(text);
  } catch {
    // Reported below: an unreadable lease must not silently free its resource.
  }
  if (!lease || typeof lease.worktree !== 'string' || Number.isNaN(Date.parse(lease.expiresAt))) {
    throw new WorktreeError(`lease file ${file} is unreadable; inspect it, then rerun with --force`);
  }
  return lease;
}

export function acquireLease({ commonDir, resource, holder, ttlMs, note = '', force = false, now = Date.now() }) {
  const file = leaseFile(commonDir, resource);
  mkdirSync(path.dirname(file), { recursive: true });
  const lease = {
    resource,
    worktree: holder.worktree,
    branch: holder.branch,
    head: holder.head,
    note,
    acquiredAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  };
  let replaced = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Linking a complete temporary file publishes the lease atomically or fails with EEXIST.
    const pending = `${file}.${randomUUID()}.tmp`;
    writeFileSync(pending, `${JSON.stringify(lease, null, 2)}\n`);
    try {
      linkSync(pending, file);
      return { lease, replaced };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    } finally {
      rmSync(pending, { force: true });
    }
    let current = null;
    try {
      current = readLease(file);
    } catch (error) {
      if (!force) throw error;
    }
    if (current && current.worktree !== holder.worktree && Date.parse(current.expiresAt) > now && !force) {
      throw new WorktreeError(`${resource} is held by ${current.branch ?? 'a detached HEAD'} in ${current.worktree} `
        + `until ${current.expiresAt}${current.note ? ` (${current.note})` : ''}`, 3);
    }
    replaced = current;
    rmSync(file, { force: true });
  }
  throw new WorktreeError(`could not acquire ${resource}: other agents keep taking it`, 3);
}

export function releaseLease({ commonDir, resource, holder, force = false }) {
  const file = leaseFile(commonDir, resource);
  let current;
  try {
    current = readLease(file);
  } catch (error) {
    if (!force) throw error;
    rmSync(file, { force: true });
    return 'released';
  }
  if (!current) return 'free';
  if (current.worktree !== holder.worktree && !force) {
    throw new WorktreeError(`${resource} is held by ${current.worktree}; only its holder or --force may release it`, 3);
  }
  rmSync(file, { force: true });
  return 'released';
}

function describeLeases(commonDir, now = Date.now()) {
  return LEASE_RESOURCES.map((resource) => {
    try {
      const lease = readLease(leaseFile(commonDir, resource));
      if (!lease) return `${resource}: free`;
      const minutes = Math.round((Date.parse(lease.expiresAt) - now) / 60_000);
      const state = minutes > 0 ? `${minutes} min left` : 'expired, can be taken over';
      return `${resource}: ${lease.branch ?? 'detached HEAD'} in ${lease.worktree} (${state})${lease.note ? ` — ${lease.note}` : ''}`;
    } catch (error) {
      return `${resource}: ${error.message}`;
    }
  });
}

function leaseHolder(context) {
  const branch = runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], context.toplevel);
  return {
    worktree: context.toplevel,
    branch: branch.ok ? branch.stdout.trim() : null,
    head: git(['rev-parse', '--short', 'HEAD'], context.toplevel),
  };
}

function listReport(context, env) {
  let root = null;
  let rootError = null;
  try {
    root = worktreeRoot(context, env);
  } catch (error) {
    rootError = error.message;
  }
  const temporary = env[ALLOW_TEMPORARY_ROOT_ENV] === '1' ? [] : temporaryPrefixes();
  const rows = listWorktrees(context.primary).map((entry) => {
    const location = canonicalPath(entry.path);
    const isPrimary = location === context.primary;
    const missing = entry.prunable || !existsSync(location);
    const changes = missing ? null : changedPaths(location).length;
    const issues = [];
    if (missing) issues.push('directory missing (git worktree prune)');
    else if (temporary.some((prefix) => isInside(location, prefix))) issues.push('temporary location');
    else if (!isPrimary && root && !isInside(location, root)) issues.push('outside the worktree root');
    if (isPrimary && entry.branch !== 'main') issues.push('primary checkout is not on main');
    if (isPrimary && changes) issues.push('primary checkout has uncommitted changes');
    return { branch: entry.branch ?? '(detached)', location, isPrimary, changes, issues };
  });
  return { root, rootError, rows };
}

export function parseHookInput(text) {
  let input;
  try {
    input = JSON.parse(text);
  } catch {
    throw new WorktreeError('hook input is not valid JSON');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new WorktreeError('hook input must be a JSON object');
  return input;
}

const VALUE_FLAGS = new Set(['base', 'ttl', 'note', 'path']);
const BOOLEAN_FLAGS = new Set(['no-install', 'install', 'reinstall', 'force', 'dry-run', 'help']);

export function parseArguments(argv) {
  const positionals = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!value.startsWith('--')) {
      positionals.push(value);
      continue;
    }
    const separator = value.indexOf('=');
    const name = value.slice(2, separator === -1 ? undefined : separator);
    const inline = separator === -1 ? undefined : value.slice(separator + 1);
    if (VALUE_FLAGS.has(name)) {
      const next = inline ?? argv[++index];
      if (next === undefined) throw new WorktreeError(`--${name} needs a value`);
      flags[name] = next;
    } else if (BOOLEAN_FLAGS.has(name) && inline === undefined) {
      flags[name] = true;
    } else {
      throw new WorktreeError(`unknown option ${value}`);
    }
  }
  return { positionals, flags };
}

export const USAGE = `Usage: node scripts/worktree.mjs <command>

  create <agent>/<topic> [--no-install] [--base <ref>]   new task worktree under the worktree root; prints its path
  bootstrap [--no-install] [--reinstall]                 link local files and install dependencies in this worktree
  adopt <agent>/<topic> <path>... [--install]            move uncommitted primary-checkout changes into a new worktree
  list                                                   every worktree with its changes and problems
  paths [derived-data]                                   primary, root, this worktree and its DerivedData path
  sync-main                                              fast-forward the primary checkout to origin/main
  finish [--dry-run]                                     after the PR merged: sync main, remove this worktree and branch
  remove [--path <worktree>]                             remove a clean, pushed worktree and keep its branch
  lease acquire <resource> [--ttl 2h] [--note <text>] [--force]
  lease release <resource> [--force]
  lease status                                           resources: ${LEASE_RESOURCES.join(', ')}
  claude-hook create|remove                              Claude Code WorktreeCreate/WorktreeRemove hook (JSON on stdin)

See docs/worktree-workflow.md.`;

export function main(argv = process.argv.slice(2), { cwd = process.cwd(), env = process.env, readInput = () => readFileSync(0, 'utf8') } = {}) {
  const log = (message) => process.stderr.write(`[worktree] ${message}\n`);
  const print = (text) => process.stdout.write(`${text}\n`);
  const { positionals, flags } = parseArguments(argv);
  const [command, ...rest] = positionals;
  if (!command || flags.help) {
    print(USAGE);
    return command || flags.help ? 0 : 1;
  }

  if (command === 'claude-hook') {
    const input = parseHookInput(readInput());
    if (rest[0] === 'create') {
      const context = readRepoContext(typeof input.cwd === 'string' ? input.cwd : cwd);
      print(createWorktree(context, branchForClaudeWorktree(input.name), { install: false, env, log }));
      return 0;
    }
    if (rest[0] === 'remove') {
      const target = input.worktree_path;
      if (typeof target !== 'string' || !path.isAbsolute(target)) throw new WorktreeError('hook input has no absolute worktree_path');
      if (!existsSync(target)) {
        log(`${target} is already removed`);
        return 0;
      }
      removeWorktree(readRepoContext(target), target, { env, log });
      return 0;
    }
    throw new WorktreeError('claude-hook expects create or remove');
  }

  const context = readRepoContext(cwd);
  switch (command) {
    case 'create':
      if (rest.length !== 1) throw new WorktreeError('create expects exactly one <agent>/<topic> branch');
      print(createWorktree(context, rest[0], { install: !flags['no-install'], base: flags.base, env, log }));
      return 0;
    case 'bootstrap':
      bootstrapWorktree({ primary: context.primary, worktree: context.toplevel, install: !flags['no-install'], reinstall: Boolean(flags.reinstall), log });
      return 0;
    case 'adopt':
      if (rest.length < 2) throw new WorktreeError('adopt expects a branch and at least one path');
      print(adoptChanges(context, rest[0], rest.slice(1), { install: Boolean(flags.install), env, log }));
      return 0;
    case 'list': {
      const { root, rootError, rows } = listReport(context, env);
      print(`worktree root: ${root ?? `unavailable (${rootError})`}`);
      for (const row of rows) {
        const changes = row.changes === null ? '-' : `${row.changes} changed`;
        print(`${row.isPrimary ? '*' : ' '} ${row.branch}  ${changes}  ${row.issues.join('; ') || 'ok'}\n    ${row.location}`);
      }
      print(`verified ${rows.length} worktrees; ${rows.filter((row) => row.issues.length).length} need attention`);
      return 0;
    }
    case 'paths': {
      const root = worktreeRoot(context, env);
      const derivedData = derivedDataPath(root, context.toplevel, context.isPrimary);
      if (rest[0] === 'derived-data') print(derivedData);
      else if (rest.length) throw new WorktreeError('paths accepts only derived-data');
      else print(JSON.stringify({ primary: context.primary, root, worktree: context.toplevel, derivedData }, null, 2));
      return 0;
    }
    case 'sync-main':
      syncPrimary(context.primary, log);
      return 0;
    case 'finish':
      finishWorktree(context, { dryRun: Boolean(flags['dry-run']), env, log });
      return 0;
    case 'remove':
      removeWorktree(context, flags.path ?? context.toplevel, { env, log });
      return 0;
    case 'lease': {
      const [action, resource] = rest;
      if (action === 'status') {
        for (const line of describeLeases(context.commonDir)) print(line);
        return 0;
      }
      if (action === 'acquire') {
        const { lease, replaced } = acquireLease({
          commonDir: context.commonDir,
          resource,
          holder: leaseHolder(context),
          ttlMs: parseDuration(flags.ttl ?? DEFAULT_LEASE_TTL),
          note: flags.note ?? '',
          force: Boolean(flags.force),
        });
        if (replaced && replaced.worktree !== lease.worktree) log(`took over ${resource} from ${replaced.worktree}`);
        print(`${resource} leased to ${lease.worktree} until ${lease.expiresAt}`);
        return 0;
      }
      if (action === 'release') {
        print(`${resource}: ${releaseLease({ commonDir: context.commonDir, resource, holder: leaseHolder(context), force: Boolean(flags.force) })}`);
        return 0;
      }
      throw new WorktreeError('lease expects acquire, release or status');
    }
    default:
      throw new WorktreeError(`unknown command ${command}\n\n${USAGE}`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`[worktree] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error instanceof WorktreeError ? error.exitCode : 1;
  }
}
