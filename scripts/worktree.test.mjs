import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ALLOW_TEMPORARY_ROOT_ENV,
  ROOT_ENV,
  WorktreeError,
  acquireLease,
  assertFinishable,
  branchForClaudeWorktree,
  finishWorktree,
  leaseFile,
  parseArguments,
  parseDuration,
  parseHookInput,
  parseStatus,
  parseWorktreeList,
  readRepoContext,
  releaseLease,
  resolveWorktreeRoot,
  restoreAdoptedPaths,
  validateBranchName,
  worktreeDirectoryName,
} from './worktree.mjs';

const script = fileURLToPath(new URL('./worktree.mjs', import.meta.url));
const isWorktreeError = (exitCode = 1) => (error) => error instanceof WorktreeError && error.exitCode === exitCode;

function fixtureEnv(root) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Worktree Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Worktree Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: devNull,
    [ROOT_ENV]: root,
    [ALLOW_TEMPORARY_ROOT_ENV]: '1',
  };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[name];
  return env;
}

function write(root, relative, content) {
  mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  writeFileSync(path.join(root, relative), content);
}

function createFixture(t) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'clawket-worktree-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const fixture = {
    base,
    origin: path.join(base, 'origin.git'),
    primary: path.join(base, 'clawket'),
    root: path.join(base, 'worktrees'),
  };
  fixture.env = fixtureEnv(fixture.root);
  fixture.git = (args, cwd = fixture.primary) => execFileSync('git', args, { cwd, env: fixture.env, encoding: 'utf8' }).trim();
  fixture.run = (args, { cwd = fixture.primary, input } = {}) => spawnSync(process.execPath, [script, ...args], {
    cwd,
    env: fixture.env,
    encoding: 'utf8',
    input,
  });

  fixture.git(['init', '--quiet', '--bare', '--initial-branch=main', fixture.origin], base);
  fixture.git(['init', '--quiet', '--initial-branch=main', fixture.primary], base);
  fixture.git(['remote', 'add', 'origin', fixture.origin]);
  write(fixture.primary, '.gitignore', '.env*.local\n/docs/*/evidence\nnode_modules/\n');
  write(fixture.primary, 'apps/demo/package.json', '{}\n');
  write(fixture.primary, 'docs/3.0/README.md', '# docs\n');
  write(fixture.primary, 'tracked.txt', 'one\n');
  write(fixture.primary, 'keep.txt', 'keep\n');
  fixture.git(['add', '-A']);
  fixture.git(['commit', '--quiet', '-m', 'initial']);
  fixture.git(['push', '--quiet', '--set-upstream', 'origin', 'main']);
  // Ignored local files that task worktrees link instead of copying.
  write(fixture.primary, 'apps/demo/.env.local', 'SECRET=1\n');
  write(fixture.primary, 'docs/3.0/evidence/run.log', 'evidence\n');
  return fixture;
}

function pushFromSecondClone(fixture, relative, content) {
  const clone = path.join(fixture.base, `clone-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fixture.git(['clone', '--quiet', fixture.origin, clone], fixture.base);
  write(clone, relative, content);
  fixture.git(['commit', '--quiet', '-am', `update ${relative}`], clone);
  fixture.git(['push', '--quiet', 'origin', 'main'], clone);
}

test('branch names follow <agent>/<topic> and map to flat directory names', () => {
  for (const branch of ['claude/pairing-copy', 'codex/3-1-release', 'feat/3.0-voice', 'claude/fix/login']) {
    assert.equal(validateBranchName(branch), branch);
  }
  for (const branch of ['main', 'claude/', '/topic', 'claude/../x', 'claude/.hidden', 'claude/x.lock', 'claude/has space', 'claude//x', 'claude/x.', 42]) {
    assert.throws(() => validateBranchName(branch), isWorktreeError(), String(branch));
  }
  assert.equal(worktreeDirectoryName('claude/fix/login'), 'claude-fix-login');
  assert.equal(branchForClaudeWorktree('Fix login!'), 'claude/Fix-login');
  assert.equal(branchForClaudeWorktree('claude/already-prefixed'), 'claude/already-prefixed');
  assert.throws(() => branchForClaudeWorktree('..'), isWorktreeError());
  assert.throws(() => branchForClaudeWorktree(''), isWorktreeError());
});

test('the worktree root is absolute, persistent and outside the primary checkout', () => {
  const primary = '/work/clawket';
  const temporary = ['/tmp', '/scratch'];
  assert.equal(resolveWorktreeRoot({ primary, env: {}, temporary }), '/work/clawket-worktrees');
  assert.equal(resolveWorktreeRoot({ primary, env: {}, configured: '/ssd/trees\n', temporary }), '/ssd/trees');
  assert.equal(resolveWorktreeRoot({ primary, env: { [ROOT_ENV]: '/other/trees' }, configured: '/ssd/trees', temporary }), '/other/trees');
  assert.throws(() => resolveWorktreeRoot({ primary, env: {}, configured: 'relative/trees', temporary }), /absolute/);
  assert.throws(() => resolveWorktreeRoot({ primary, env: {}, configured: '/work/clawket/.worktrees', temporary }), /inside the primary checkout/);
  assert.throws(() => resolveWorktreeRoot({ primary, env: {}, configured: '/work/clawket', temporary }), /inside the primary checkout/);
  assert.throws(() => resolveWorktreeRoot({ primary, env: {}, configured: '/scratch/trees', temporary }), /temporary storage/);
  assert.equal(
    resolveWorktreeRoot({ primary, env: { [ALLOW_TEMPORARY_ROOT_ENV]: '1' }, configured: '/scratch/trees', temporary }),
    '/scratch/trees',
  );
});

test('parsers accept current git output and reject malformed input', () => {
  const worktrees = parseWorktreeList([
    'worktree /work/clawket', 'HEAD 1111', 'branch refs/heads/main', '',
    'worktree /tmp/gone', 'HEAD 2222', 'branch refs/heads/claude/gone', 'prunable gitdir file points to non-existent location', '',
    'worktree /ssd/detached', 'HEAD 3333', 'detached', '',
  ].join('\n'));
  assert.deepEqual(worktrees.map((entry) => [entry.path, entry.branch, entry.prunable, entry.detached]), [
    ['/work/clawket', 'main', false, false],
    ['/tmp/gone', 'claude/gone', true, false],
    ['/ssd/detached', null, false, true],
  ]);
  assert.deepEqual(parseStatus(' M tracked.txt\0R  new.txt\0old.txt\0?? apps/x.ts\0'), [
    { code: ' M', path: 'tracked.txt' },
    { code: 'R ', path: 'new.txt', from: 'old.txt' },
    { code: '??', path: 'apps/x.ts' },
  ]);
  assert.equal(parseDuration('45m'), 2_700_000);
  assert.equal(parseDuration('2h'), 7_200_000);
  for (const value of ['0m', '13h', '2d', '', 'soon', undefined]) assert.throws(() => parseDuration(value), isWorktreeError());
  assert.deepEqual(parseArguments(['create', 'claude/x', '--no-install', '--base=origin/release']), {
    positionals: ['create', 'claude/x'],
    flags: { 'no-install': true, base: 'origin/release' },
  });
  assert.throws(() => parseArguments(['lease', 'acquire', 'android', '--ttl']), /needs a value/);
  assert.throws(() => parseArguments(['create', '--stash']), /unknown option/);
  assert.deepEqual(parseHookInput('{"name":"x"}'), { name: 'x' });
  for (const corrupted of ['not json', '[]', 'null', '"text"']) assert.throws(() => parseHookInput(corrupted), isWorktreeError());
});

test('finish accepts only the merged head of its own pull request', () => {
  const head = 'a'.repeat(40);
  assert.throws(() => assertFinishable({ branch: 'claude/x', head, pullRequest: { state: 'OPEN', headRefOid: head } }), /OPEN/);
  assert.throws(() => assertFinishable({ branch: 'claude/x', head, pullRequest: null }), /missing/);
  assert.throws(
    () => assertFinishable({ branch: 'claude/x', head, pullRequest: { state: 'MERGED', headRefOid: 'b'.repeat(40) } }),
    /not the merged head/,
  );
  assert.doesNotThrow(() => assertFinishable({ branch: 'claude/x', head, pullRequest: { state: 'MERGED', headRefOid: head } }));
});

test('leases are exclusive, renewable, expiring and fail closed when corrupted', (t) => {
  const commonDir = realpathSync(mkdtempSync(path.join(tmpdir(), 'clawket-lease-')));
  t.after(() => rmSync(commonDir, { recursive: true, force: true }));
  const first = { worktree: '/ssd/claude-a', branch: 'claude/a', head: 'aaaa' };
  const second = { worktree: '/ssd/codex-b', branch: 'codex/b', head: 'bbbb' };
  const now = Date.parse('2026-09-30T00:00:00Z');

  assert.equal(acquireLease({ commonDir, resource: 'android', holder: first, ttlMs: 60_000, now }).lease.worktree, first.worktree);
  assert.throws(() => acquireLease({ commonDir, resource: 'android', holder: second, ttlMs: 60_000, now: now + 1_000 }), isWorktreeError(3));
  assert.equal(acquireLease({ commonDir, resource: 'android', holder: first, ttlMs: 60_000, now: now + 2_000 }).replaced.worktree, first.worktree);
  assert.throws(() => releaseLease({ commonDir, resource: 'android', holder: second }), isWorktreeError(3));
  const takeover = acquireLease({ commonDir, resource: 'android', holder: second, ttlMs: 60_000, now: now + 62_001 });
  assert.equal(takeover.replaced.worktree, first.worktree);
  assert.equal(releaseLease({ commonDir, resource: 'android', holder: second }), 'released');
  assert.equal(releaseLease({ commonDir, resource: 'android', holder: second }), 'free');

  mkdirSync(path.dirname(leaseFile(commonDir, 'heavy')), { recursive: true });
  writeFileSync(leaseFile(commonDir, 'heavy'), '{"worktree":');
  assert.throws(() => acquireLease({ commonDir, resource: 'heavy', holder: first, ttlMs: 60_000, now }), /unreadable/);
  assert.throws(() => releaseLease({ commonDir, resource: 'heavy', holder: first }), /unreadable/);
  assert.equal(acquireLease({ commonDir, resource: 'heavy', holder: first, ttlMs: 60_000, now, force: true }).lease.resource, 'heavy');
  assert.throws(() => leaseFile(commonDir, 'printer'), /unknown lease resource/);
});

test('create builds a task worktree from origin/main with linked local files', (t) => {
  const fixture = createFixture(t);
  const created = fixture.run(['create', 'claude/pairing-copy', '--no-install']);
  assert.equal(created.status, 0, created.stderr);
  const worktree = path.join(fixture.root, 'claude-pairing-copy');
  assert.equal(created.stdout, `${worktree}\n`);
  assert.equal(fixture.git(['branch', '--show-current'], worktree), 'claude/pairing-copy');
  assert.equal(fixture.git(['rev-parse', 'HEAD'], worktree), fixture.git(['rev-parse', 'origin/main']));
  assert.equal(readlinkSync(path.join(worktree, 'apps/demo/.env.local')), path.join(fixture.primary, 'apps/demo/.env.local'));
  assert.equal(readFileSync(path.join(worktree, 'docs/3.0/evidence/run.log'), 'utf8'), 'evidence\n');
  assert.equal(fixture.git(['status', '--porcelain', '--untracked-files=all'], worktree), '');

  const reused = fixture.run(['create', 'claude/pairing-copy', '--no-install']);
  assert.equal(reused.status, 0, reused.stderr);
  assert.equal(reused.stdout, `${worktree}\n`);

  const nested = spawnSync(process.execPath, [script, 'create', 'claude/nested', '--no-install'], {
    cwd: fixture.primary,
    env: { ...fixture.env, [ROOT_ENV]: path.join(fixture.primary, '.worktrees') },
    encoding: 'utf8',
  });
  assert.equal(nested.status, 1);
  assert.match(nested.stderr, /inside the primary checkout/);
});

test('remove parks only clean, pushed work and never follows linked files', (t) => {
  const fixture = createFixture(t);
  const worktree = fixture.run(['create', 'claude/park-me', '--no-install']).stdout.trim();

  write(worktree, 'draft.md', 'wip\n');
  const dirty = fixture.run(['remove', '--path', worktree]);
  assert.equal(dirty.status, 1);
  assert.match(dirty.stderr, /uncommitted/);

  fixture.git(['add', 'draft.md'], worktree);
  fixture.git(['commit', '--quiet', '-m', 'draft'], worktree);
  const unpushed = fixture.run(['remove', '--path', worktree]);
  assert.equal(unpushed.status, 1);
  assert.match(unpushed.stderr, /push them first/);

  fixture.git(['push', '--quiet', 'origin', 'claude/park-me'], worktree);
  const removed = fixture.run(['remove', '--path', worktree]);
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(existsSync(worktree), false);
  assert.equal(readFileSync(path.join(fixture.primary, 'docs/3.0/evidence/run.log'), 'utf8'), 'evidence\n');
  assert.equal(readFileSync(path.join(fixture.primary, 'apps/demo/.env.local'), 'utf8'), 'SECRET=1\n');
  assert.match(fixture.git(['branch', '--list', 'claude/park-me']), /claude\/park-me/);
});

test('sync-main fast-forwards the primary checkout and never overwrites local edits', (t) => {
  const fixture = createFixture(t);
  pushFromSecondClone(fixture, 'tracked.txt', 'two\n');
  const synced = fixture.run(['sync-main']);
  assert.equal(synced.status, 0, synced.stderr);
  assert.equal(readFileSync(path.join(fixture.primary, 'tracked.txt'), 'utf8'), 'two\n');

  pushFromSecondClone(fixture, 'tracked.txt', 'three\n');
  write(fixture.primary, 'tracked.txt', 'local edit\n');
  const blocked = fixture.run(['sync-main']);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /never stash or reset/);
  assert.equal(readFileSync(path.join(fixture.primary, 'tracked.txt'), 'utf8'), 'local edit\n');
});

test('finish syncs main, then removes the merged worktree and its branch', (t) => {
  const fixture = createFixture(t);
  const worktree = fixture.run(['create', 'claude/merged', '--no-install']).stdout.trim();
  write(worktree, 'feature.txt', 'done\n');
  fixture.git(['add', 'feature.txt'], worktree);
  fixture.git(['commit', '--quiet', '-m', 'feature'], worktree);
  const head = fixture.git(['rev-parse', 'HEAD'], worktree);
  pushFromSecondClone(fixture, 'tracked.txt', 'squashed upstream\n');

  const pullRequest = { number: 7, state: 'MERGED', headRefOid: head, url: 'https://example.invalid/pull/7' };
  finishWorktree(readRepoContext(worktree), { env: fixture.env, fetchPullRequest: () => pullRequest });
  assert.equal(existsSync(worktree), false);
  assert.equal(fixture.git(['branch', '--list', 'claude/merged']), '');
  assert.equal(readFileSync(path.join(fixture.primary, 'tracked.txt'), 'utf8'), 'squashed upstream\n');
});

test('adopt moves only the named primary-checkout changes into a new task worktree', (t) => {
  const fixture = createFixture(t);
  write(fixture.primary, 'tracked.txt', 'moved edit\n');
  write(fixture.primary, 'apps/demo/new.ts', 'export {};\n');
  rmSync(path.join(fixture.primary, 'docs/3.0/README.md'));
  write(fixture.primary, 'keep.txt', 'someone else\n');

  const adopted = fixture.run(['adopt', 'claude/rescue', 'tracked.txt', 'apps/demo/new.ts', 'docs/3.0/README.md']);
  assert.equal(adopted.status, 0, adopted.stderr);
  const worktree = adopted.stdout.trim();
  assert.equal(worktree, path.join(fixture.root, 'claude-rescue'));
  assert.equal(readFileSync(path.join(worktree, 'tracked.txt'), 'utf8'), 'moved edit\n');
  assert.equal(readFileSync(path.join(worktree, 'apps/demo/new.ts'), 'utf8'), 'export {};\n');
  assert.equal(existsSync(path.join(worktree, 'docs/3.0/README.md')), false);
  assert.equal(fixture.git(['status', '--porcelain', '--untracked-files=all'], worktree).split('\n').length, 3);

  assert.equal(readFileSync(path.join(fixture.primary, 'tracked.txt'), 'utf8'), 'one\n');
  assert.equal(existsSync(path.join(fixture.primary, 'apps/demo/new.ts')), false);
  assert.equal(readFileSync(path.join(fixture.primary, 'docs/3.0/README.md'), 'utf8'), '# docs\n');
  assert.equal(fixture.git(['status', '--porcelain', '--untracked-files=all']), 'M keep.txt');

  const existing = fixture.run(['adopt', 'claude/rescue', 'keep.txt']);
  assert.equal(existing.status, 1);
  assert.match(existing.stderr, /already exists/);
});

test('adopt leaves a primary path that changed after its snapshot', (t) => {
  const fixture = createFixture(t);
  write(fixture.primary, 'tracked.txt', 'edited again\n');
  const result = restoreAdoptedPaths(fixture.primary, [{ path: 'tracked.txt', snapshot: 'file:-:stale', tracked: true }]);
  assert.deepEqual(result, { restored: [], changedSince: ['tracked.txt'] });
  assert.equal(readFileSync(path.join(fixture.primary, 'tracked.txt'), 'utf8'), 'edited again\n');
});

test('Claude hooks create on the configured root and refuse to drop unsaved work', (t) => {
  const fixture = createFixture(t);
  const input = JSON.stringify({
    session_id: 'fixture',
    cwd: fixture.primary,
    hook_event_name: 'WorktreeCreate',
    name: 'Fix login!',
    worktree_path: path.join(fixture.primary, '.claude', 'worktrees', 'Fix login!'),
  });
  const created = fixture.run(['claude-hook', 'create'], { input });
  assert.equal(created.status, 0, created.stderr);
  const worktree = path.join(fixture.root, 'claude-Fix-login');
  assert.equal(created.stdout, `${worktree}\n`);

  const removal = JSON.stringify({ hook_event_name: 'WorktreeRemove', name: 'Fix login!', worktree_path: worktree });
  write(worktree, 'draft.md', 'wip\n');
  const refused = fixture.run(['claude-hook', 'remove'], { input: removal });
  assert.equal(refused.status, 1);
  assert.equal(existsSync(worktree), true);

  rmSync(path.join(worktree, 'draft.md'));
  assert.equal(fixture.run(['claude-hook', 'remove'], { input: removal }).status, 0);
  assert.equal(existsSync(worktree), false);
  assert.equal(fixture.run(['claude-hook', 'remove'], { input: removal }).status, 0);

  const corrupted = fixture.run(['claude-hook', 'create'], { input: 'not json' });
  assert.equal(corrupted.status, 1);
  assert.match(corrupted.stderr, /not valid JSON/);
});

test('list reports every worktree and the ones that need attention', (t) => {
  const fixture = createFixture(t);
  fixture.run(['create', 'claude/listed', '--no-install']);
  write(fixture.primary, 'tracked.txt', 'dirty primary\n');
  const listed = fixture.run(['list']);
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /primary checkout has uncommitted changes/);
  assert.match(listed.stdout, /claude\/listed {2}0 changed {2}ok/);
  assert.match(listed.stdout, /verified 2 worktrees; 1 need attention/);
});
