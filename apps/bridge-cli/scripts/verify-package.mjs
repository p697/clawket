import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const pack = spawnSync("npm", ["pack", "--json", "--dry-run", "--ignore-scripts"], {
  cwd: process.cwd(),
  encoding: "utf8"
});

if (pack.status !== 0) {
  process.stderr.write(pack.stderr || "npm pack --dry-run failed\n");
  process.exit(pack.status ?? 1);
}

const [result] = JSON.parse(pack.stdout);
const files = result.files.map((file) => file.path).sort();
const allowedPrefixes = ["dist/", "package.json", "LICENSE"];
const disallowed = files.filter((file) => !allowedPrefixes.some((prefix) => file === prefix || file.startsWith(prefix)));

if (disallowed.length > 0) {
  process.stderr.write(`Refusing to publish unexpected files: ${disallowed.join(", ")}\n`);
  process.exit(1);
}

if (!files.includes("dist/index.js")) {
  process.stderr.write("Refusing to publish without dist/index.js\n");
  process.exit(1);
}

const dist = await readFile(new URL("../dist/index.js", import.meta.url), "utf8");
const distWithoutSourcePathComments = dist.replace(/^\s*\/\/\s.*$/gm, "");
const forbiddenMarkers = [
  "@clawket/bridge-core",
  "@clawket/bridge-runtime",
  "src/index.ts",
  "../src/",
  "process.env.CLAWKET_PACKAGE_DEFAULT_REGISTRY_URL",
  "process.env.CLAWKET_PACKAGE_DEFAULT_REGISTRY_FALLBACK_URL"
];

for (const marker of forbiddenMarkers) {
  if (distWithoutSourcePathComments.includes(marker)) {
    process.stderr.write(`Refusing to publish: dist/index.js still contains ${marker}\n`);
    process.exit(1);
  }
}

const entrypoint = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const smoke = spawnSync(process.execPath, [entrypoint, "help"], {
  cwd: process.cwd(),
  encoding: "utf8"
});
if (smoke.status !== 0 || !smoke.stdout.includes("clawket pair")) {
  process.stderr.write(smoke.stderr || "Refusing to publish: bundled CLI startup smoke test failed\n");
  process.exit(smoke.status ?? 1);
}

process.stdout.write(`Package contents verified: ${files.join(", ")}\n`);
