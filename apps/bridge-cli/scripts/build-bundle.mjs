import { spawnSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadBridgeCliEnv } from "./load-env.mjs";

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
  "tsup",
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
  "ws",
  "--external",
  "qrcode-terminal",
  `--define.process.env.CLAWKET_PACKAGE_DEFAULT_REGISTRY_URL=${JSON.stringify(packagedRegistryUrl)}`,
  `--define.process.env.CLAWKET_PACKAGE_DEFAULT_REGISTRY_FALLBACK_URL=${JSON.stringify(packagedRegistryFallbackUrl)}`,
];

const result = spawnSync("npx", args, {
  stdio: "inherit",
  env: process.env,
  cwd: rootDir,
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const bundledEntrypointMjs = path.join(appDir, "dist", "index.mjs");
const bundledEntrypointJs = path.join(appDir, "dist", "index.js");

if (existsSync(bundledEntrypointMjs)) {
  renameSync(bundledEntrypointMjs, bundledEntrypointJs);
}
