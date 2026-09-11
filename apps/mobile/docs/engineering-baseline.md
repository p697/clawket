# Mobile Engineering Baseline

This document records the durable engineering baseline for the Clawket mobile workspace. Product and backend rules remain in `AGENTS.md`; visual rules remain in `docs/design-system.md`.

## Runtime baseline

- Node.js: 22.x
- Expo: SDK 55, kept on the current compatible patch line
- React Native: Expo SDK 55 compatible patch line
- React: 19.2
- TypeScript: strict mode
- Package manager: npm workspaces with committed lockfiles

Do not cross an Expo or React Native minor/major boundary as incidental cleanup. Patch updates within the active Expo SDK are allowed only when `npx expo install --check`, TypeScript, focused backend tests, the full mobile test suite, native dependency sync, and at least one native platform build are evaluated together.

## Required commands

From the monorepo root:

```bash
npm run check:required
```

For focused mobile work:

```bash
npm run mobile:typecheck
npm run mobile:test -- --runInBand
npm run mobile:check:design-system
npm run check:docs
```

The repository required gate is intentionally broader than the focused commands and also covers relay and bridge workspaces. It runs only self-contained checks suitable for a clean CI host. The broader `npm test` command additionally includes bridge tests that require the external read-only Hermes checkout; run `npm run test:hermes-integration --workspace @clawket/bridge-runtime` directly when diagnosing that boundary.

## Native synchronization

After changing Expo, React Native, an Expo module, or another native dependency:

1. Run `npm run mobile:sync:native` from the monorepo root.
2. Confirm `npx expo install --check` reports compatible dependencies.
3. Inspect the generated Pod/Gradle dependency changes; do not accept unrelated native churn.
4. Build the affected native platform.
5. Verify both OpenClaw and Hermes connection entry points remain reachable.

Generated `ios/` and `android/` projects are local build products in this repository. The committed `app.config.ts`, package manifests, scripts, and lockfiles are the durable configuration sources.

## Dependency policy

1. Prefer exact or Expo-recommended ranges for native packages.
2. Keep root `overrides` synchronized with the mobile manifest; an old override can silently defeat a workspace upgrade.
3. Use `npx expo install --check` as a compatibility signal, not as permission for an automatic major upgrade.
4. Treat navigation, storage, networking, authentication, purchases, and animation upgrades as behavior changes requiring focused tests.
5. Do not copy YouMind-only dependencies, release variants, Sentry wiring, or product-specific Metro aliases into Clawket without a Clawket requirement.
6. `react-native-enriched-markdown` stays on an exact stable pin (1.0.2, Expo SDK 55 / React Native 0.83 compatible). Its `postinstall` needs network access to `registry.npmjs.org` and `github.com` to vendor tree-sitter grammar sources; a failed download degrades code highlighting to a clean no-op build. Feature flags live in the `enriched-markdown` block of `package.json` (root for the download, Mobile for the native build), not in an Expo plugin. The iOS parallel tail-fade patch (`scripts/patch-enriched-markdown-tail-fade.mjs`) is reviewed against that exact version and fails closed when the upstream file drifts.

## Documentation ownership

- `AGENTS.md` is authored.
- `CLAUDE.md` is a relative symlink to `AGENTS.md` in every instructed directory.
- `docs/design-system.md` owns detailed UI values and component contracts.
- `docs/engineering-baseline.md` owns toolchain, dependency, and validation policy.
- `README.md` and `README.zh-CN.md` must stay aligned.

`npm run check:docs` verifies the agent-document topology and key current references. It must fail when a symlink drifts into a copied file or an obsolete path returns.
