import { spawnSync } from "node:child_process";
import process from "node:process";
import { spawnNpm } from "../../../scripts/node-command.mjs";

const [command, ...args] = process.argv.slice(2);

if (!command) {
  process.stderr.write("Usage: node scripts/run-command.mjs <command> [args...]\n");
  process.exit(1);
}

const build = spawnNpm(["run", "build"], {
  cwd: process.cwd(),
  stdio: "inherit",
});

if ((build.status ?? 1) !== 0) {
  process.exit(build.status ?? 1);
}

const run = spawnSync(process.execPath, ["dist/index.js", command, ...args], {
  cwd: process.cwd(),
  stdio: "inherit",
});

process.exit(run.status ?? 1);
