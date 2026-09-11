import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { npmInvocation } from '../../scripts/node-command.mjs';

const execFileAsync = promisify(execFile);
const CACHE_SCHEMA_VERSION = 2;

const OPENCLAW_BUILD_INPUTS = [
  'tsconfig.bridge-base.json',
  'packages/bridge-core/package.json',
  'packages/bridge-core/tsconfig.json',
  'packages/bridge-core/src',
  'packages/bridge-runtime/package.json',
  'packages/bridge-runtime/tsconfig.json',
  'packages/bridge-runtime/src/openclaw.ts',
  'packages/bridge-runtime/src/protocol.ts',
  'packages/bridge-runtime/src/runtime.ts',
] as const;

export const LEGACY_BRIDGE_PINS = [
  {
    key: 'a3ed',
    release: 'published npm 0.6.4 Bridge gitHead',
    commit: 'a3edb44d89dcd7562f55c83fa5804e9fb1bba81e',
    fixturePrefix: 'connect.c2',
  },
  {
    key: 'bd69',
    release: 'published npm 0.7.0 Bridge gitHead',
    commit: 'bd69e3e09da028839d92321a55e97811fc44cd36',
    fixturePrefix: 'connect.c2',
    openClawEquivalentTo: 'a3ed',
  },
  {
    key: 'c2',
    release: 'Bridge snapshot accompanying the 2.1.0 production App',
    commit: 'c2bfe068da15837d94dce70c3247fb39759e9c59',
    fixturePrefix: 'connect.c2',
    openClawEquivalentTo: 'a3ed',
  },
  {
    key: '31a',
    release: '2.1.1 inferred Bridge snapshot',
    commit: '31a857abe4aaa362ec335213c8e381135d3ef0a0',
    fixturePrefix: 'connect.31a',
  },
  {
    key: '3e37',
    release: '2.1.2 version-anchor Bridge with the d9c 2.1.2 client wire',
    commit: '3e37a72e95615ace91c387571f0ef62acadd92e5',
    fixturePrefix: 'connect.d9c',
    openClawEquivalentTo: '31a',
  },
  {
    key: '9cf',
    release: 'latest pre-3.0 Bridge',
    commit: '9cf26e59dc6269292e8b6769ba1db47023157597',
    fixturePrefix: 'connect.d9c',
  },
] as const;

export const LEGACY_BRIDGE_REPLAY_PINS = LEGACY_BRIDGE_PINS.filter(
  (pin) => !('openClawEquivalentTo' in pin),
);

export type LegacyBridgePin = (typeof LEGACY_BRIDGE_PINS)[number];

export type LegacyBridgeRuntime = {
  start(): void;
  stop(): Promise<void>;
  getSnapshot(): { relayConnected: boolean };
};

export type LegacyBridgeRuntimeConstructor = new (options: {
  config: {
    serverUrl: string;
    gatewayId: string;
    relaySecret: string;
    relayUrl: string;
    instanceId: string;
    displayName: string;
    createdAt: string;
    updatedAt: string;
  };
  gatewayUrl: string;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  onLog?: (line: string) => void;
}) => LegacyBridgeRuntime;

export type PreparedLegacyBridge = {
  pin: LegacyBridgePin;
  openClawFingerprint: string;
  builtFromCommit: string;
  cacheHit: boolean;
  loadRuntime(): Promise<LegacyBridgeRuntimeConstructor>;
};

type JsonObject = Record<string, unknown>;

export type LegacyBridgeCacheManifest = {
  schemaVersion: number;
  cacheKey: string;
  openClawFingerprint: string;
  builtFromCommit: string;
  originalLockSha256: string;
  dependencyVersions: Record<string, string>;
  files: Record<string, string>;
};

type CacheManifest = LegacyBridgeCacheManifest;

type HistoricalInstall = {
  packageJson: JsonObject;
  packageLock: JsonObject;
  originalLockSha256: string;
  dependencyVersions: Record<string, string>;
  fingerprintMaterial: string;
};

export async function prepareLegacyBridgeMatrix(repositoryRoot: string): Promise<PreparedLegacyBridge[]> {
  const commonGitDirectory = await resolveCommonGitDirectory(repositoryRoot);
  const cacheRoot = join(commonGitDirectory, 'clawket-compat-cache', 'legacy-bridge-v2');
  await mkdir(cacheRoot, { recursive: true });

  const prepared: PreparedLegacyBridge[] = [];
  for (const pin of LEGACY_BRIDGE_PINS) {
    prepared.push(await withDetachedWorktree(repositoryRoot, pin, async (worktree) => {
      const canonicalCommit = resolveCanonicalPinCommit(pin);
      const historicalInstall = await createHistoricalInstall(worktree);
      const openClawFingerprint = await computeOpenClawFingerprint(
        worktree,
        historicalInstall.fingerprintMaterial,
      );
      const cacheKey = createHash('sha256')
        .update([
          `schema=${CACHE_SCHEMA_VERSION}`,
          `openclaw=${openClawFingerprint}`,
          `node=${process.versions.node}`,
          `platform=${process.platform}`,
          `arch=${process.arch}`,
        ].join('\n'))
        .digest('hex');
      const cacheDirectory = join(cacheRoot, cacheKey);

      const cached = await readValidCache(
        cacheDirectory,
        cacheKey,
        openClawFingerprint,
        canonicalCommit,
      );
      if (!cached && canonicalCommit !== pin.commit) {
        throw new Error(
          `Equivalent Bridge pin ${pin.commit} cannot rebuild missing canonical artifact ${canonicalCommit}.`,
        );
      }
      const manifest = cached ?? await buildAndCache({
        worktree,
        cacheRoot,
        cacheDirectory,
        cacheKey,
        openClawFingerprint,
        commit: pin.commit,
        historicalInstall,
      });

      return {
        pin,
        openClawFingerprint,
        builtFromCommit: manifest.builtFromCommit,
        cacheHit: Boolean(cached),
        async loadRuntime(): Promise<LegacyBridgeRuntimeConstructor> {
          const runtimeUrl = pathToFileURL(join(cacheDirectory, 'runtime', 'dist', 'runtime.js'));
          runtimeUrl.searchParams.set('compatPin', pin.commit);
          const imported = await import(runtimeUrl.href) as Record<string, unknown>;
          if (typeof imported.BridgeRuntime !== 'function') {
            throw new Error(`Historical BridgeRuntime export is missing for ${pin.commit}.`);
          }
          return imported.BridgeRuntime as LegacyBridgeRuntimeConstructor;
        },
      };
    }));
  }

  assertDeclaredEquivalence(prepared);
  return prepared;
}

export function validateLegacyBridgeCacheManifest(
  value: unknown,
  expected: { cacheKey: string; openClawFingerprint: string; builtFromCommit: string },
): LegacyBridgeCacheManifest {
  const manifest = requireObject(value, 'historical Bridge cache manifest');
  if (manifest.schemaVersion !== CACHE_SCHEMA_VERSION) {
    throw new Error(`Unsupported historical Bridge cache schema: ${String(manifest.schemaVersion)}.`);
  }
  if (manifest.cacheKey !== expected.cacheKey || !/^[0-9a-f]{64}$/.test(expected.cacheKey)) {
    throw new Error('Historical Bridge cache key does not match the requested build.');
  }
  if (
    manifest.openClawFingerprint !== expected.openClawFingerprint
    || !/^[0-9a-f]{64}$/.test(expected.openClawFingerprint)
  ) {
    throw new Error('Historical Bridge OpenClaw fingerprint does not match the requested build.');
  }
  if (
    typeof manifest.builtFromCommit !== 'string'
    || !/^[0-9a-f]{40}$/.test(manifest.builtFromCommit)
    || !/^[0-9a-f]{40}$/.test(expected.builtFromCommit)
    || manifest.builtFromCommit !== expected.builtFromCommit
  ) {
    throw new Error('Historical Bridge cache build commit does not match the canonical pin.');
  }
  if (typeof manifest.originalLockSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.originalLockSha256)) {
    throw new Error('Historical Bridge cache lock digest is invalid.');
  }

  const dependencyVersions = requireObject(
    manifest.dependencyVersions,
    'historical Bridge cache dependency versions',
  );
  if (Object.keys(dependencyVersions).length === 0) {
    throw new Error('Historical Bridge cache dependency inventory is empty.');
  }
  for (const [path, version] of Object.entries(dependencyVersions)) {
    requireSafeRelativePath(path, 'historical Bridge dependency path');
    requireNonEmptyString(version, `historical Bridge dependency version ${path}`);
  }

  const files = requireObject(manifest.files, 'historical Bridge cache file hashes');
  if (Object.keys(files).length === 0) throw new Error('Historical Bridge cache file inventory is empty.');
  for (const [path, digest] of Object.entries(files)) {
    requireSafeRelativePath(path, 'historical Bridge cache file path');
    if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
      throw new Error(`Historical Bridge cache file digest is invalid: ${path}.`);
    }
  }

  return manifest as unknown as LegacyBridgeCacheManifest;
}

async function withDetachedWorktree<T>(
  repositoryRoot: string,
  pin: LegacyBridgePin,
  action: (worktree: string) => Promise<T>,
): Promise<T> {
  if (!/^[0-9a-f]{40}$/.test(pin.commit)) {
    throw new Error(`Legacy Bridge pin must be a full commit SHA: ${pin.commit}`);
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), `clawket-legacy-bridge-${pin.key}-`));
  const worktree = join(temporaryRoot, 'worktree');
  let actionError: unknown;
  try {
    await run(repositoryRoot, 'git', ['worktree', 'add', '--detach', worktree, pin.commit], 60_000);
    const checkedOutCommit = (await run(worktree, 'git', ['rev-parse', 'HEAD'], 10_000)).trim();
    if (checkedOutCommit !== pin.commit) {
      throw new Error(`Detached worktree resolved ${checkedOutCommit}; expected ${pin.commit}.`);
    }
    return await action(worktree);
  } catch (error) {
    actionError = error;
    throw error;
  } finally {
    const cleanupErrors: unknown[] = [];
    try {
      await run(repositoryRoot, 'git', ['worktree', 'remove', '--force', worktree], 60_000);
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await rm(temporaryRoot, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        actionError ? [actionError, ...cleanupErrors] : cleanupErrors,
        `Failed to clean detached worktree for ${pin.commit}.`,
      );
    }
  }
}

async function computeOpenClawFingerprint(worktree: string, installMaterial: string): Promise<string> {
  const inputObjectIds: string[] = [];
  for (const input of OPENCLAW_BUILD_INPUTS) {
    const objectId = (await run(worktree, 'git', ['rev-parse', `HEAD:${input}`], 10_000)).trim();
    if (!/^[0-9a-f]{40,64}$/.test(objectId)) {
      throw new Error(`Could not resolve historical Bridge input ${input}: ${objectId}`);
    }
    inputObjectIds.push(`${input}\0${objectId}`);
  }
  return createHash('sha256')
    .update(inputObjectIds.join('\n'))
    .update('\nlock\0')
    .update(installMaterial)
    .digest('hex');
}

async function createHistoricalInstall(worktree: string): Promise<HistoricalInstall> {
  const originalLockText = await readFile(join(worktree, 'package-lock.json'), 'utf8');
  const originalLock = parseJsonObject(originalLockText, 'historical package-lock.json');
  const originalPackages = requireObject(originalLock.packages, 'historical package-lock packages');
  const corePackage = parseJsonObject(
    await readFile(join(worktree, 'packages', 'bridge-core', 'package.json'), 'utf8'),
    'historical bridge-core package.json',
  );
  const runtimePackage = parseJsonObject(
    await readFile(join(worktree, 'packages', 'bridge-runtime', 'package.json'), 'utf8'),
    'historical bridge-runtime package.json',
  );

  const selectedKeys = [
    'node_modules/typescript',
    'node_modules/@types/node',
    'node_modules/@types/node/node_modules/undici-types',
    'packages/bridge-runtime/node_modules/@types/ws',
    'packages/bridge-runtime/node_modules/ws',
  ];
  const coreDependencies = optionalObject(corePackage.dependencies, 'bridge-core dependencies');
  const runtimeDependencies = optionalObject(runtimePackage.dependencies, 'bridge-runtime dependencies');
  if ('tweetnacl' in coreDependencies || 'tweetnacl' in runtimeDependencies) {
    selectedKeys.push('node_modules/tweetnacl');
  }

  const selectedEntries: Record<string, JsonObject> = {};
  for (const key of selectedKeys) {
    selectedEntries[key] = resolveHistoricalLockEntry(key, originalPackages);
    requireNonEmptyString(selectedEntries[key].version, `${key}.version`);
    requireNonEmptyString(selectedEntries[key].resolved, `${key}.resolved`);
    requireNonEmptyString(selectedEntries[key].integrity, `${key}.integrity`);
  }

  const dependencyVersions = Object.fromEntries(selectedKeys.map((key) => [
    key,
    requireNonEmptyString(selectedEntries[key].version, `${key}.version`),
  ]));
  // The historical monorepo locks contain a stale Expo closure. Preserve the
  // exact Bridge build entries and integrities in a reduced lock that npm ci
  // can validate, instead of silently re-resolving any historical dependency.
  const packageJson: JsonObject = {
    name: 'clawket-legacy-bridge-build',
    version: '0.0.0',
    private: true,
    workspaces: ['packages/bridge-core', 'packages/bridge-runtime'],
    devDependencies: {
      '@types/node': dependencyVersions['node_modules/@types/node'],
      typescript: dependencyVersions['node_modules/typescript'],
    },
  };
  const packages: Record<string, unknown> = {
    '': {
      name: packageJson.name,
      version: packageJson.version,
      workspaces: packageJson.workspaces,
      devDependencies: packageJson.devDependencies,
    },
    'packages/bridge-core': requireObject(originalPackages['packages/bridge-core'], 'bridge-core workspace lock'),
    'packages/bridge-runtime': requireObject(originalPackages['packages/bridge-runtime'], 'bridge-runtime workspace lock'),
    'node_modules/@clawket/bridge-core': { resolved: 'packages/bridge-core', link: true },
    'node_modules/@clawket/bridge-runtime': { resolved: 'packages/bridge-runtime', link: true },
    ...selectedEntries,
  };
  const packageLock: JsonObject = {
    name: packageJson.name,
    version: packageJson.version,
    lockfileVersion: 3,
    requires: true,
    packages,
  };
  const fingerprintMaterial = stableStringify({
    corePackage,
    runtimePackage,
    selectedEntries,
  });

  return {
    packageJson,
    packageLock,
    originalLockSha256: sha256(originalLockText),
    dependencyVersions,
    fingerprintMaterial,
  };
}

function resolveHistoricalLockEntry(key: string, packages: JsonObject): JsonObject {
  const original = requireObject(packages[key], `historical lock entry ${key}`);
  if (typeof original.resolved === 'string' && typeof original.integrity === 'string') return { ...original };

  const packageName = lockPackageName(key);
  const version = requireNonEmptyString(original.version, `${key}.version`);
  const candidate = Object.entries(packages).find(([candidateKey, candidateValue]) => {
    if (lockPackageName(candidateKey) !== packageName) return false;
    if (!candidateValue || typeof candidateValue !== 'object' || Array.isArray(candidateValue)) return false;
    const entry = candidateValue as JsonObject;
    return entry.version === version
      && typeof entry.resolved === 'string'
      && entry.resolved.length > 0
      && typeof entry.integrity === 'string'
      && entry.integrity.length > 0;
  });
  if (!candidate) {
    throw new Error(`Historical lock has no resolvable ${packageName}@${version} entry for ${key}.`);
  }
  const source = candidate[1] as JsonObject;
  return {
    ...original,
    resolved: source.resolved,
    integrity: source.integrity,
  };
}

function lockPackageName(lockPath: string): string {
  const marker = 'node_modules/';
  const index = lockPath.lastIndexOf(marker);
  if (index < 0) return '';
  const remainder = lockPath.slice(index + marker.length);
  if (!remainder.startsWith('@')) return remainder.split('/')[0];
  return remainder.split('/').slice(0, 2).join('/');
}

async function buildAndCache(params: {
  worktree: string;
  cacheRoot: string;
  cacheDirectory: string;
  cacheKey: string;
  openClawFingerprint: string;
  commit: string;
  historicalInstall: HistoricalInstall;
}): Promise<CacheManifest> {
  await writeFile(
    join(params.worktree, 'package.json'),
    `${JSON.stringify(params.historicalInstall.packageJson, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    join(params.worktree, 'package-lock.json'),
    `${JSON.stringify(params.historicalInstall.packageLock, null, 2)}\n`,
    'utf8',
  );

  await run(params.worktree, 'npm', [
    'ci',
    '--ignore-scripts',
    '--omit=optional',
    '--no-audit',
    '--no-fund',
    '--loglevel=error',
  ], 180_000);
  await verifyInstalledVersions(params.worktree, params.historicalInstall.dependencyVersions);
  for (const name of ['bridge-core', 'bridge-runtime']) {
    if (process.platform === 'win32') {
      // Execute the pinned compiler against untouched historical sources. Its
      // package script's `rm -rf dist` is Unix-only; this worktree is fresh.
      const directory = join(params.worktree, 'packages', name);
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (manifest.scripts?.build !== 'rm -rf dist && tsc -p tsconfig.json') throw new Error('Unreviewed historical build command');
      await run(directory, process.execPath, [join(params.worktree, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], 120_000);
    } else {
      await run(params.worktree, 'npm', ['run', '--workspace', `@clawket/${name}`, 'build'], 120_000);
    }
  }

  const stagingDirectory = await mkdtemp(join(params.cacheRoot, '.staging-'));
  try {
    const runtimeDirectory = join(stagingDirectory, 'runtime');
    const runtimeNodeModules = join(runtimeDirectory, 'node_modules');
    await mkdir(join(runtimeNodeModules, '@clawket', 'bridge-core'), { recursive: true });
    await cp(
      join(params.worktree, 'packages', 'bridge-runtime', 'dist'),
      join(runtimeDirectory, 'dist'),
      { recursive: true },
    );
    await cp(
      join(params.worktree, 'packages', 'bridge-runtime', 'package.json'),
      join(runtimeDirectory, 'package.json'),
    );
    await cp(
      join(params.worktree, 'packages', 'bridge-core', 'dist'),
      join(runtimeNodeModules, '@clawket', 'bridge-core', 'dist'),
      { recursive: true },
    );
    await cp(
      join(params.worktree, 'packages', 'bridge-core', 'package.json'),
      join(runtimeNodeModules, '@clawket', 'bridge-core', 'package.json'),
    );
    await cp(
      join(params.worktree, 'packages', 'bridge-runtime', 'node_modules', 'ws'),
      join(runtimeNodeModules, 'ws'),
      { recursive: true, dereference: true },
    );
    if ('node_modules/tweetnacl' in params.historicalInstall.dependencyVersions) {
      await cp(
        join(params.worktree, 'node_modules', 'tweetnacl'),
        join(runtimeNodeModules, 'tweetnacl'),
        { recursive: true, dereference: true },
      );
    }

    const manifest: CacheManifest = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      cacheKey: params.cacheKey,
      openClawFingerprint: params.openClawFingerprint,
      builtFromCommit: params.commit,
      originalLockSha256: params.historicalInstall.originalLockSha256,
      dependencyVersions: params.historicalInstall.dependencyVersions,
      files: await hashDirectoryFiles(stagingDirectory),
    };
    await writeFile(join(stagingDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    try {
      await rename(stagingDirectory, params.cacheDirectory);
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      await rm(stagingDirectory, { recursive: true, force: true });
      const racedCache = await readValidCache(
        params.cacheDirectory,
        params.cacheKey,
        params.openClawFingerprint,
        params.commit,
      );
      if (!racedCache) throw new Error(`A concurrent historical Bridge cache write was invalid: ${params.cacheKey}`);
      return racedCache;
    }
    return manifest;
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function readValidCache(
  cacheDirectory: string,
  cacheKey: string,
  openClawFingerprint: string,
  builtFromCommit: string,
): Promise<CacheManifest | null> {
  let manifest: CacheManifest;
  try {
    manifest = validateLegacyBridgeCacheManifest(
      JSON.parse(await readFile(join(cacheDirectory, 'manifest.json'), 'utf8')) as unknown,
      { cacheKey, openClawFingerprint, builtFromCommit },
    );
  } catch {
    await rm(cacheDirectory, { recursive: true, force: true });
    return null;
  }
  const actualFiles = await hashDirectoryFiles(cacheDirectory, new Set(['manifest.json']));
  if (stableStringify(actualFiles) !== stableStringify(manifest.files)) {
    await rm(cacheDirectory, { recursive: true, force: true });
    return null;
  }
  return manifest;
}

async function verifyInstalledVersions(
  worktree: string,
  dependencyVersions: Record<string, string>,
): Promise<void> {
  for (const [lockPath, expectedVersion] of Object.entries(dependencyVersions)) {
    const packageDirectory = join(worktree, lockPath);
    const installedPackage = parseJsonObject(
      await readFile(join(packageDirectory, 'package.json'), 'utf8'),
      `installed ${lockPath} package.json`,
    );
    const actualVersion = requireNonEmptyString(installedPackage.version, `${lockPath} installed version`);
    if (actualVersion !== expectedVersion) {
      throw new Error(`Historical lock mismatch for ${lockPath}: installed ${actualVersion}, expected ${expectedVersion}.`);
    }
  }
}

async function hashDirectoryFiles(
  root: string,
  ignoredRelativePaths = new Set<string>(),
): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const relativePath = relative(root, path).split(sep).join('/');
      if (ignoredRelativePaths.has(relativePath)) continue;
      if (entry.isSymbolicLink()) throw new Error(`Historical Bridge cache must not contain symlinks: ${relativePath}`);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        hashes[relativePath] = sha256(await readFile(path));
      } else {
        throw new Error(`Unsupported historical Bridge cache entry: ${relativePath}`);
      }
    }
  };
  await visit(root);
  return hashes;
}

async function resolveCommonGitDirectory(repositoryRoot: string): Promise<string> {
  const raw = (await run(repositoryRoot, 'git', ['rev-parse', '--git-common-dir'], 10_000)).trim();
  const commonDirectory = resolve(repositoryRoot, raw);
  const info = await stat(commonDirectory);
  if (!info.isDirectory()) throw new Error(`Git common directory is not a directory: ${commonDirectory}`);
  return commonDirectory;
}

function resolveCanonicalPinCommit(pin: LegacyBridgePin): string {
  const byKey = new Map<string, LegacyBridgePin>(
    LEGACY_BRIDGE_PINS.map((candidate) => [candidate.key, candidate]),
  );
  const visited = new Set<string>();
  let current = pin;
  while ('openClawEquivalentTo' in current) {
    if (visited.has(current.key)) throw new Error(`Historical Bridge equivalence cycle at ${current.key}.`);
    visited.add(current.key);
    const canonical = byKey.get(current.openClawEquivalentTo);
    if (!canonical) throw new Error(`Missing canonical historical Bridge pin ${current.openClawEquivalentTo}.`);
    current = canonical;
  }
  if (!/^[0-9a-f]{40}$/.test(current.commit)) {
    throw new Error(`Canonical historical Bridge pin is invalid: ${current.commit}.`);
  }
  return current.commit;
}

function assertDeclaredEquivalence(prepared: PreparedLegacyBridge[]): void {
  const byKey = new Map(prepared.map((item) => [item.pin.key, item]));
  for (const item of prepared) {
    if (!('openClawEquivalentTo' in item.pin)) continue;
    const canonical = byKey.get(item.pin.openClawEquivalentTo);
    if (!canonical) throw new Error(`Missing declared equivalent Bridge pin ${item.pin.openClawEquivalentTo}.`);
    if (item.openClawFingerprint !== canonical.openClawFingerprint) {
      throw new Error(
        `${item.pin.commit} no longer matches ${canonical.pin.commit} for the OpenClaw Bridge build inputs.`,
      );
    }
    if (item.builtFromCommit !== canonical.builtFromCommit) {
      throw new Error(
        `Equivalent Bridge pins did not resolve the same cached artifact: ${item.pin.commit} vs ${canonical.pin.commit}.`,
      );
    }
  }
}

async function run(cwd: string, executable: string, args: string[], timeout: number): Promise<string> {
  try {
    if (executable === 'npm') [executable, args] = npmInvocation(args);
    const { stdout, stderr } = await execFileAsync(executable, args, {
      windowsHide: true,
      cwd,
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      timeout,
    });
    return `${stdout}${stderr}`;
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const stdout = readErrorOutput(error, 'stdout');
    const stderr = readErrorOutput(error, 'stderr');
    throw new Error(
      `Command failed in ${basename(cwd)}: ${executable} ${args.join(' ')}\n${details}\n${stdout}${stderr}`.trim(),
    );
  }
}

function readErrorOutput(error: unknown, key: 'stdout' | 'stderr'): string {
  if (!error || typeof error !== 'object' || !(key in error)) return '';
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : Buffer.isBuffer(value) ? value.toString('utf8') : '';
}

function parseJsonObject(text: string, label: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return requireObject(parsed, label);
}

function requireObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as JsonObject;
}

function optionalObject(value: unknown, label: string): JsonObject {
  if (value === undefined) return {};
  return requireObject(value, label);
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function requireSafeRelativePath(value: string, label: string): void {
  if (
    value.length === 0
    || value.startsWith('/')
    || value.startsWith('\\')
    || value.split(/[\\/]/).some((part) => part === '..' || part.length === 0)
  ) {
    throw new Error(`${label} must be a safe relative path: ${value}.`);
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function isAlreadyExistsError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error.code === 'EEXIST' || error.code === 'ENOTEMPTY'),
  );
}
