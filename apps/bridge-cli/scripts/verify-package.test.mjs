import { describe, expect, it } from "vitest";
import {
  BUILD_PROVENANCE_PREFIX,
  OBSOLETE_RUNTIME_MODULE_MARKERS,
  REQUIRED_RUNTIME_MODULE_MARKERS,
  assertBundleBuildProvenance,
  assertRuntimeModuleBoundaries,
  computeBuildProvenanceDigest,
  extractRuntimeModuleMarkers,
  stampBundleBuildProvenance,
  validatePackManifest,
} from "./verify-package.mjs";

function runtimeBoundaryLines(markers = REQUIRED_RUNTIME_MODULE_MARKERS) {
  return markers.map((marker) => `// packages/bridge-runtime/dist/${marker}.js`).join("\n");
}

describe("bridge CLI package verification", () => {
  it("accepts every new runtime boundary without confusing nested paths for obsolete modules", () => {
    const bundle = `${runtimeBoundaryLines()}\nconsole.log("bundle");\n`;

    expect(() => assertRuntimeModuleBoundaries(bundle)).not.toThrow();
    expect([...extractRuntimeModuleMarkers(bundle)]).toEqual(REQUIRED_RUNTIME_MODULE_MARKERS);
  });

  it("fails closed for a missing or corrupted runtime boundary", () => {
    const missingRelaySession = runtimeBoundaryLines(
      REQUIRED_RUNTIME_MODULE_MARKERS.filter((marker) => marker !== "relay-session"),
    );
    expect(() => assertRuntimeModuleBoundaries(missingRelaySession)).toThrow(
      /missing runtime modules: relay-session/,
    );

    for (const obsoleteMarker of OBSOLETE_RUNTIME_MODULE_MARKERS) {
      const corrupted = `${runtimeBoundaryLines()}\n// packages/bridge-runtime/dist/${obsoleteMarker}.js\n`;
      expect(() => assertRuntimeModuleBoundaries(corrupted)).toThrow(
        new RegExp(`obsolete runtime modules: ${obsoleteMarker}`),
      );
    }
  });

  it("stamps one provenance marker after the shebang and rejects stale build inputs", () => {
    const firstDigest = computeBuildProvenanceDigest([
      { path: "src/index.ts", content: "export const version = 1;" },
    ], { REGISTRY_URL: "https://registry.example" });
    const secondDigest = computeBuildProvenanceDigest([
      { path: "src/index.ts", content: "export const version = 2;" },
    ], { REGISTRY_URL: "https://registry.example" });
    const stamped = stampBundleBuildProvenance("#!/usr/bin/env node\nconsole.log('ok');\n", firstDigest);

    expect(stamped.split("\n")[1]).toBe(`${BUILD_PROVENANCE_PREFIX}${firstDigest}`);
    expect(() => assertBundleBuildProvenance(stamped, firstDigest)).not.toThrow();
    expect(() => assertBundleBuildProvenance(stamped, secondDigest)).toThrow(/stale bundle/);

    const restamped = stampBundleBuildProvenance(stamped, secondDigest);
    expect(restamped.match(new RegExp(BUILD_PROVENANCE_PREFIX, "g"))).toHaveLength(1);
    expect(() => assertBundleBuildProvenance(restamped, secondDigest)).not.toThrow();
  });

  it("rejects a missing provenance marker and malformed package manifests", () => {
    const digest = "a".repeat(64);
    expect(() => assertBundleBuildProvenance("#!/usr/bin/env node\n", digest)).toThrow(
      /exactly one build provenance marker/,
    );
    expect(() => validatePackManifest({ files: [] })).toThrow(/empty or malformed/);
    expect(() => validatePackManifest({
      files: [
        { path: "dist/index.js" },
        { path: "src/index.ts" },
      ],
    })).toThrow(/unexpected files: src\/index.ts/);
  });
});
