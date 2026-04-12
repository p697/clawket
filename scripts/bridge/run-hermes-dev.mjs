import { spawn } from "node:child_process";
import { watch } from "node:fs";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const watchTargets = [
  { path: "apps/bridge-cli/src", recursive: true },
  { path: "apps/bridge-cli/scripts/build-bundle.mjs", recursive: false },
  { path: "apps/bridge-cli/tsconfig.json", recursive: false },
  { path: "packages/bridge-core/src", recursive: true },
  { path: "packages/bridge-core/tsconfig.json", recursive: false },
  { path: "packages/bridge-runtime/src", recursive: true },
  { path: "packages/bridge-runtime/tsconfig.json", recursive: false },
];
const WATCHABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
]);
const STARTUP_IGNORE_MS = 1_500;

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const forwardedArgs = process.argv.slice(2);
const watchers = [];
const startedAt = Date.now();

let buildRunning = false;
let rebuildQueued = false;
let shuttingDown = false;
let child = null;
let debounceTimer = null;

async function main() {
  const initialBuildOk = await rebuildAndRestart("initial startup");
  if (!initialBuildOk) {
    process.exit(1);
  }

  for (const target of watchTargets) {
    const absoluteTarget = path.resolve(rootDir, target.path);
    const watcher = watch(
      absoluteTarget,
      { recursive: target.recursive },
      (_eventType, filename) => {
        const changePath = resolveChangedPath(target.path, filename);
        if (!changePath) {
          return;
        }
        scheduleRebuild(changePath);
      },
    );
    watcher.on("error", (error) => {
      console.error(`[bridge:hermes:dev] Watch error for ${target.path}: ${formatError(error)}`);
    });
    watchers.push(watcher);
  }

  console.log("[bridge:hermes:dev] Watching bridge sources for changes.");
}

function scheduleRebuild(changedPath) {
  if (shuttingDown) {
    return;
  }
  if (Date.now() - startedAt < STARTUP_IGNORE_MS) {
    return;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void rebuildAndRestart(changedPath);
  }, 150);
}

async function rebuildAndRestart(reason) {
  if (buildRunning) {
    rebuildQueued = true;
    return false;
  }

  buildRunning = true;
  console.log(`[bridge:hermes:dev] Rebuilding because ${reason}.`);
  const buildOk = await runBridgeBuild();
  if (buildOk) {
    await restartHermesDevProcess();
  } else {
    console.error("[bridge:hermes:dev] Build failed. Keeping the current Hermes dev process unchanged.");
  }
  buildRunning = false;

  if (rebuildQueued) {
    rebuildQueued = false;
    return rebuildAndRestart("queued change");
  }
  return buildOk;
}

function resolveChangedPath(basePath, filename) {
  const normalizedFilename = typeof filename === "string" ? filename.trim() : "";
  const relativePath = normalizedFilename
    ? path.posix.join(basePath.replace(/\\/g, "/"), normalizedFilename.replace(/\\/g, "/"))
    : basePath.replace(/\\/g, "/");
  const basename = path.posix.basename(relativePath);
  const extension = path.posix.extname(relativePath);

  if (!basename) {
    return null;
  }
  if (basename.startsWith(".")) {
    return null;
  }
  if (basename.endsWith("~") || basename.endsWith(".tmp") || basename.endsWith(".swp") || basename.endsWith(".swx")) {
    return null;
  }
  if (!WATCHABLE_EXTENSIONS.has(extension)) {
    return null;
  }
  return relativePath;
}

function runBridgeBuild() {
  return new Promise((resolve) => {
    const build = spawn(npmCommand, ["run", "bridge:build"], {
      cwd: rootDir,
      stdio: "inherit",
    });
    build.on("exit", (code) => {
      resolve((code ?? 1) === 0);
    });
    build.on("error", (error) => {
      console.error(`[bridge:hermes:dev] Failed to start build: ${formatError(error)}`);
      resolve(false);
    });
  });
}

async function restartHermesDevProcess() {
  await stopHermesDevProcess();
  if (shuttingDown) {
    return;
  }
  child = spawn(
    process.execPath,
    ["apps/bridge-cli/dist/index.js", "hermes", "dev", ...forwardedArgs],
    {
      cwd: rootDir,
      stdio: "inherit",
    },
  );
  child.on("exit", (code, signal) => {
    if (child && !shuttingDown) {
      console.log(`[bridge:hermes:dev] Hermes dev process exited (code=${code ?? "null"}, signal=${signal ?? "null"}).`);
    }
    child = null;
  });
  child.on("error", (error) => {
    console.error(`[bridge:hermes:dev] Failed to start Hermes dev process: ${formatError(error)}`);
  });
}

function stopHermesDevProcess() {
  return new Promise((resolve) => {
    if (!child) {
      resolve();
      return;
    }

    const runningChild = child;
    let resolved = false;
    const finish = () => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolve();
    };

    runningChild.once("exit", finish);
    runningChild.kill("SIGTERM");
    setTimeout(() => {
      if (resolved) {
        return;
      }
      runningChild.kill("SIGKILL");
    }, 3_000).unref();
  });
}

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  for (const watcher of watchers) {
    watcher.close();
  }
  console.log(`[bridge:hermes:dev] Shutting down (${signal}).`);
  await stopHermesDevProcess();
  process.exit(0);
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

await main();
