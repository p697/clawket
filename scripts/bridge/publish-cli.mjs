import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadBridgeCliEnv } from "../../apps/bridge-cli/scripts/load-env.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..", "..");
const bridgePkgPath = path.join(rootDir, "apps", "bridge-cli", "package.json");
const REQUIRED_CLI_VERSION = "3.0.0";

function runOrThrow(command, args, cwd = rootDir, spawn = spawnSync) {
  const result = spawn(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "inherit"
  });

  if (result.error) {
    throw new Error(`${command} ${args.join(" ")} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}`);
  }
}

export function runCompatibilityGate({ spawn = spawnSync, cwd = rootDir } = {}) {
  runOrThrow("npm", ["run", "test:compat"], cwd, spawn);
}

function readRequiredEnv(name, env = process.env) {
  const value = env[name]?.trim() ?? "";
  if (!value) {
    throw new Error(
      `Missing ${name}. Set it in apps/bridge-cli/.env.local or your shell before publishing.`,
    );
  }
  return value;
}

export async function preparePublish({
  spawn = spawnSync,
  env = process.env,
  readText = readFile,
  stdout = process.stdout,
  cwd = rootDir,
  packagePath = bridgePkgPath,
} = {}) {
  stdout.write("Running required v1 compatibility replay before Bridge publish preparation...\n");
  runCompatibilityGate({ spawn, cwd });

  const registryUrl = readRequiredEnv("CLAWKET_PACKAGE_DEFAULT_REGISTRY_URL", env);
  const fallbackUrl = readRequiredEnv("CLAWKET_PACKAGE_DEFAULT_REGISTRY_FALLBACK_URL", env);
  const originalText = await readText(packagePath, "utf8");
  const pkg = JSON.parse(originalText);
  if (pkg.version !== REQUIRED_CLI_VERSION) {
    throw new Error(
      `Expected @p697/clawket version ${REQUIRED_CLI_VERSION}, found ${String(pkg.version)}.`,
    );
  }

  stdout.write(`\nPublishing @p697/clawket version: ${pkg.version}\n`);
  stdout.write(`Publishing default registry: ${registryUrl}\n`);
  stdout.write(`Publishing fallback registry: ${fallbackUrl}\n`);
  stdout.write("Running publish safety checks (build + verify + dry-run)...\n\n");

  runOrThrow(
    "npm",
    ["run", "--workspace", "@p697/clawket", "publish:dry-run"],
    cwd,
    spawn,
  );

  stdout.write("\nAll publish checks passed.\n");
  stdout.write(`Final manual step:\n`);
  stdout.write(`npm publish --workspace @p697/clawket --access public\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadBridgeCliEnv();
  preparePublish().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
