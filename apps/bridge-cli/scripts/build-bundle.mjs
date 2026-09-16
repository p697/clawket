import { spawnSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadBridgeCliEnv } from "./load-env.mjs";
import {
  computeCliBuildProvenance,
  stampBundleBuildProvenance,
} from "./verify-package.mjs";

loadBridgeCliEnv();

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const rootDir = path.resolve(appDir, "..", "..");

function readOptionalEnv(name) {
  return process.env[name]?.trim() ?? "";
}

const packagedRegistryUrl = readOptionalEnv("CLAWKET_PACKAGE_DEFAULT_REGISTRY_URL");
const packagedRegistryFallbackUrl = readOptionalEnv("CLAWKET_PACKAGE_DEFAULT_REGISTRY_FALLBACK_URL");

const args = [
  "apps/bridge-cli/src/index.ts",
  "--format",
  "esm",
  "--platform",
  "node",
  "--target",
  "node20",
  "--clean",
  "--out-dir",
  "apps/bridge-cli/dist",
  "--no-external",
  "@clawket/bridge-core",
  "--no-external",
  "@clawket/bridge-runtime",
  "--external",
  "qrcode",
  "--external",
  "https-proxy-agent",
  "--external",
  "ws",
  "--external",
  "qrcode-terminal",
  "--external",
  "tweetnacl",
  `--define.process.env.CLAWKET_PACKAGE_DEFAULT_REGISTRY_URL=${JSON.stringify(packagedRegistryUrl)}`,
  `--define.process.env.CLAWKET_PACKAGE_DEFAULT_REGISTRY_FALLBACK_URL=${JSON.stringify(packagedRegistryFallbackUrl)}`,
];

const require = createRequire(import.meta.url);
const tsupEntry = path.join(path.dirname(require.resolve('tsup/package.json')), 'dist', 'cli-default.js');
const result = spawnSync(process.execPath, [tsupEntry, ...args], {
  stdio: "inherit",
  env: process.env,
  cwd: rootDir,
  windowsHide: true,
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const bundledEntrypointMjs = path.join(appDir, "dist", "index.mjs");
const bundledEntrypointJs = path.join(appDir, "dist", "index.js");

if (existsSync(bundledEntrypointMjs)) {
  renameSync(bundledEntrypointMjs, bundledEntrypointJs);
}

const provenance = await computeCliBuildProvenance({ repositoryRoot: rootDir });
const bundle = await readFile(bundledEntrypointJs, "utf8");
await writeFile(
  bundledEntrypointJs,
  stampBundleBuildProvenance(bundle, provenance.digest),
  "utf8",
);
