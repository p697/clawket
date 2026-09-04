import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadBridgeCliEnv } from "./load-env.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const rootDir = path.resolve(appDir, "..", "..");

export const BUILD_PROVENANCE_PREFIX = "// clawket-build-provenance-sha256:";

export const REQUIRED_RUNTIME_MODULE_MARKERS = Object.freeze([
  "hermes/index",
  "hermes/relay",
  "openclaw/runtime",
  "relay-session",
]);

export const OBSOLETE_RUNTIME_MODULE_MARKERS = Object.freeze([
  "hermes",
  "hermes-relay",
  "runtime",
]);

const BUILD_INPUT_DIRECTORIES = Object.freeze([
  "apps/bridge-cli/src",
  "packages/bridge-core/src",
  "packages/bridge-runtime/src",
]);

const BUILD_INPUT_FILES = Object.freeze([
  "package-lock.json",
  "tsconfig.bridge-base.json",
  "apps/bridge-cli/package.json",
  "apps/bridge-cli/tsconfig.json",
  "apps/bridge-cli/scripts/build-bundle.mjs",
  "apps/bridge-cli/scripts/load-env.mjs",
  "apps/bridge-cli/scripts/verify-package.mjs",
  "packages/bridge-core/package.json",
  "packages/bridge-core/tsconfig.json",
  "packages/bridge-runtime/package.json",
  "packages/bridge-runtime/tsconfig.json",
]);

export function computeBuildProvenanceDigest(entries, definitions = {}) {
  const hash = createHash("sha256");
  hash.update("clawket-cli-build-provenance-v1\0");

  for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
    const normalizedPath = entry.path.replaceAll(path.sep, "/");
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content);
    hash.update(normalizedPath);
    hash.update("\0");
    hash.update(String(content.byteLength));
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }

  for (const [name, value] of Object.entries(definitions).sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(`define:${name}\0${String(value)}\0`);
  }

  return hash.digest("hex");
}

export async function computeCliBuildProvenance({
  repositoryRoot = rootDir,
  env = process.env,
} = {}) {
  const relativePaths = [...BUILD_INPUT_FILES];
  for (const directory of BUILD_INPUT_DIRECTORIES) {
    relativePaths.push(...await listBuildSourceFiles(repositoryRoot, directory));
  }

  const uniquePaths = [...new Set(relativePaths)].sort();
  const entries = await Promise.all(uniquePaths.map(async (relativePath) => ({
    path: relativePath,
    content: await readFile(path.join(repositoryRoot, relativePath)),
  })));
  const definitions = {
    CLAWKET_PACKAGE_DEFAULT_REGISTRY_URL: env.CLAWKET_PACKAGE_DEFAULT_REGISTRY_URL?.trim() ?? "",
    CLAWKET_PACKAGE_DEFAULT_REGISTRY_FALLBACK_URL:
      env.CLAWKET_PACKAGE_DEFAULT_REGISTRY_FALLBACK_URL?.trim() ?? "",
  };

  return {
    digest: computeBuildProvenanceDigest(entries, definitions),
    inputCount: entries.length,
  };
}

export function stampBundleBuildProvenance(bundle, digest) {
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error("Build provenance digest must be a lowercase SHA-256 value");
  }
  const markerPattern = new RegExp(`^${escapeRegExp(BUILD_PROVENANCE_PREFIX)}[a-f0-9]{64}\\r?\\n?`, "gm");
  const cleanBundle = bundle.replace(markerPattern, "");
  const marker = `${BUILD_PROVENANCE_PREFIX}${digest}\n`;
  if (!cleanBundle.startsWith("#!")) return `${marker}${cleanBundle}`;
  const firstNewline = cleanBundle.indexOf("\n");
  if (firstNewline < 0) return `${cleanBundle}\n${marker}`;
  return `${cleanBundle.slice(0, firstNewline + 1)}${marker}${cleanBundle.slice(firstNewline + 1)}`;
}

export function assertBundleBuildProvenance(bundle, expectedDigest) {
  const markerPattern = new RegExp(`^${escapeRegExp(BUILD_PROVENANCE_PREFIX)}([a-f0-9]{64})$`, "gm");
  const matches = [...bundle.matchAll(markerPattern)];
  if (matches.length !== 1) {
    throw new Error(
      `Refusing to publish stale bundle: expected exactly one build provenance marker, found ${matches.length}`,
    );
  }
  if (matches[0][1] !== expectedDigest) {
    throw new Error("Refusing to publish stale bundle: build inputs changed after dist/index.js was built");
  }
}

export function extractRuntimeModuleMarkers(bundle) {
  const markers = new Set();
  const markerPattern = /^\/\/ packages\/bridge-runtime\/(?:src|dist)\/([^\s]+?)\.(?:ts|js)$/gm;
  for (const match of bundle.matchAll(markerPattern)) markers.add(match[1]);
  return markers;
}

export function assertRuntimeModuleBoundaries(bundle) {
  const markers = extractRuntimeModuleMarkers(bundle);
  const missing = REQUIRED_RUNTIME_MODULE_MARKERS.filter((marker) => !markers.has(marker));
  const obsolete = OBSOLETE_RUNTIME_MODULE_MARKERS.filter((marker) => markers.has(marker));
  if (missing.length > 0) {
    throw new Error(`Refusing to publish bundle missing runtime modules: ${missing.join(", ")}`);
  }
  if (obsolete.length > 0) {
    throw new Error(`Refusing to publish bundle containing obsolete runtime modules: ${obsolete.join(", ")}`);
  }
  return markers;
}

export function validatePackManifest(result) {
  if (!result || !Array.isArray(result.files) || result.files.length === 0) {
    throw new Error("Refusing to publish an empty or malformed package manifest");
  }
  const files = result.files.map((file) => file?.path).filter((file) => typeof file === "string").sort();
  if (files.length !== result.files.length) {
    throw new Error("Refusing to publish a package manifest with malformed file entries");
  }
  const allowedPrefixes = ["dist/"];
  const allowedFiles = new Set(["package.json", "LICENSE"]);
  const disallowed = files.filter(
    (file) => !allowedFiles.has(file) && !allowedPrefixes.some((prefix) => file.startsWith(prefix)),
  );
  if (disallowed.length > 0) {
    throw new Error(`Refusing to publish unexpected files: ${disallowed.join(", ")}`);
  }
  if (!files.includes("dist/index.js")) {
    throw new Error("Refusing to publish without dist/index.js");
  }
  return files;
}

export async function verifyPackage({
  packageDirectory = appDir,
  repositoryRoot = rootDir,
  env = process.env,
  spawn = spawnSync,
} = {}) {
  const pack = spawn("npm", ["pack", "--json", "--dry-run", "--ignore-scripts"], {
    cwd: packageDirectory,
    encoding: "utf8",
  });
  if (pack.error) throw pack.error;
  if (pack.status !== 0) {
    throw new Error(pack.stderr || "npm pack --dry-run failed");
  }

  let result;
  try {
    [result] = JSON.parse(pack.stdout);
  } catch (error) {
    throw new Error("npm pack --dry-run returned malformed JSON", { cause: error });
  }
  const files = validatePackManifest(result);
  const bundlePath = path.join(packageDirectory, "dist", "index.js");
  const bundle = await readFile(bundlePath, "utf8");
  const bundleWithoutSourcePathComments = bundle.replace(/^\s*\/\/\s.*$/gm, "");
  const forbiddenMarkers = [
    "@clawket/bridge-core",
    "@clawket/bridge-runtime",
    "src/index.ts",
    "../src/",
    "process.env.CLAWKET_PACKAGE_DEFAULT_REGISTRY_URL",
    "process.env.CLAWKET_PACKAGE_DEFAULT_REGISTRY_FALLBACK_URL",
  ];
  for (const marker of forbiddenMarkers) {
    if (bundleWithoutSourcePathComments.includes(marker)) {
      throw new Error(`Refusing to publish: dist/index.js still contains ${marker}`);
    }
  }

  const runtimeMarkers = assertRuntimeModuleBoundaries(bundle);
  const provenance = await computeCliBuildProvenance({ repositoryRoot, env });
  assertBundleBuildProvenance(bundle, provenance.digest);

  const entrypoint = path.join(packageDirectory, "dist", "index.js");
  const smoke = spawn(process.execPath, [entrypoint, "help"], {
    cwd: packageDirectory,
    encoding: "utf8",
  });
  if (smoke.error) throw smoke.error;
  if (smoke.status !== 0 || !smoke.stdout.includes("clawket pair")) {
    throw new Error(smoke.stderr || "Refusing to publish: bundled CLI startup smoke test failed");
  }

  return {
    files,
    provenance,
    runtimeMarkerCount: runtimeMarkers.size,
  };
}

async function listBuildSourceFiles(repositoryRoot, relativeDirectory) {
  const directory = path.join(repositoryRoot, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...await listBuildSourceFiles(repositoryRoot, relativePath));
      continue;
    }
    if (!entry.isFile() || !isBuildSourceFile(entry.name)) continue;
    paths.push(relativePath);
  }
  return paths;
}

function isBuildSourceFile(fileName) {
  return /\.(?:[cm]?[jt]s|json)$/.test(fileName)
    && !/\.(?:test|spec)\.[cm]?[jt]s$/.test(fileName);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadBridgeCliEnv();
  verifyPackage().then(({ files, provenance, runtimeMarkerCount }) => {
    process.stdout.write(
      `Package contents verified: ${files.length} files; `
      + `${REQUIRED_RUNTIME_MODULE_MARKERS.length} required runtime boundaries; `
      + `${runtimeMarkerCount} runtime modules; ${provenance.inputCount} provenance inputs\n`,
    );
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
