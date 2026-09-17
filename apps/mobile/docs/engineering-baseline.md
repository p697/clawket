# Mobile Engineering Baseline

This document records the durable engineering baseline for the Clawket mobile workspace. Product and backend rules remain in `AGENTS.md`; visual rules remain in `docs/design-system.md`.

## Runtime baseline

- Node.js: 22.x
- Expo: SDK 57 (`~57.0.23`), including official Xcode 27 Device Hub and opt-in UIScene support
- React Native: 0.86.3, aligned with Expo SDK 57
- React: 19.2.3
- TypeScript: 6.0, strict mode; explicit Jest/Node/React ambient types
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

Generated `ios/` and `android/` projects are local build products in this repository. The committed `app.config.js`, package manifests, scripts, and lockfiles are the durable configuration sources.

## Dependency policy

1. Prefer exact or Expo-recommended ranges for native packages.
2. Keep root `overrides` synchronized with the mobile manifest; an old override can silently defeat a workspace upgrade.
3. Use `npx expo install --check` as a compatibility signal, not as permission for an automatic major upgrade.
4. Treat navigation, storage, networking, authentication, purchases, and animation upgrades as behavior changes requiring focused tests.
5. Do not copy YouMind-only dependencies, release variants, Sentry wiring, or product-specific Metro aliases into Clawket without a Clawket requirement.
6. `react-native-enriched-markdown` stays on an exact stable pin (1.0.2; retain its reviewed native patch across SDK upgrades). Its `postinstall` needs network access to `registry.npmjs.org` and `github.com` to vendor tree-sitter grammar sources; a failed download degrades code highlighting to a clean no-op build. Feature flags live in the `enriched-markdown` block of `package.json` (root for the download, Mobile for the native build), not in an Expo plugin. The iOS parallel tail-fade patch (`scripts/patch-enriched-markdown-tail-fade.mjs`) is reviewed against that exact version and fails closed when the upstream file drifts.

## Documentation ownership

- `AGENTS.md` is authored.
- `CLAUDE.md` is a relative symlink to `AGENTS.md` in every instructed directory.
- `docs/design-system.md` owns detailed UI values and component contracts.
- `docs/engineering-baseline.md` owns toolchain, dependency, and validation policy.
- `README.md` and `README.zh-CN.md` must stay aligned.

`npm run check:docs` verifies the agent-document topology and key current references. It must fail when a symlink drifts into a copied file or an obsolete path returns.

## iOS deployment targets

The current app minimum is iOS 16.4, matching the SDK 57 support floor. Local module podspecs use the same minimum. Xcode 27 rejects targets below iOS 15, including resource bundles inherited from older podspecs. `plugins/with-ios-pod-deployment-target.js` inserts an idempotent Podfile post-install block after React Native processing. Every explicit Pod target minimum below the greater of the React Native minimum and `ios.deploymentTarget` is raised to that floor; higher minima and inherited settings are preserved. Do not fix generated Pods in Xcode manually: Expo prebuild and every subsequent `pod install` must reproduce the correction. Plugin template drift fails with an actionable error. Future toolchains that require a higher app minimum need an explicit compatibility review.

The same post-install hook runs `scripts/patch-revenuecat-xcode27.cjs` for RevenueCat 5.67.1, moving the existing `PaywallColor` initializer from its extension into the struct exactly as in [upstream commit 8708998](https://github.com/RevenueCat/purchases-ios/commit/870899891ac9a05118ae6ee16d4ae189b2c1eac2). This avoids Swift 6.4 synthesized initializer collisions without changing purchase behavior or dependency versions. The patch accepts the already-fixed source and fails closed on upstream drift; review/remove it when upgrading RevenueCat.

## Xcode 27 and iOS 27 lifecycle

Expo SDK 57 supplies Device Hub support; the temporary SDK 55 CLI backport has been removed. Keep using `npm run mobile:dev:ios`. After an SDK upgrade, run `npm run mobile:sync:native` before the dev command so existing generated projects receive the new native configuration.

`expo-build-properties` enables `ios.enableSceneSupport` (requires Expo 57.0.23+ and build-properties 57.0.20+). Xcode 27 builds otherwise trap in `UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` before JavaScript starts. Follow the [official Expo scene migration](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md); never suppress the UIKit assertion. Keep build-properties after `with-paste-input-setup` in plugin order because config mods execute in reverse order. The app-config gate checks that invariant.

`ClawketSceneDelegate` subclasses the official `ExpoAppSceneDelegate` and registers paste input only after `super.scene` has created the React host. The official delegate retains scene event/deep-link forwarding. Do not restore AppDelegate window creation or duplicate React startup. Splash configuration uses the official `expo-splash-screen` plugin.

`ios.usePrecompiledModules: false` keeps ExpoModulesCore source compilation so the reviewed permission synchronization patch remains effective. React Native core can still use its prebuilt framework. `with-ios-signing` propagates `ios.appleTeamId` to project build settings so generated sharing extensions inherit the same team. Release Associated Domains entitlements remain intact; the dev script only prepares local Debug entitlements.

SDK 57 media access retains existing behavior through `expo-media-library/legacy`; migrate its API separately. `File.copy()` is asynchronous and must complete before saving to Photos. React Native style users now use `StyleSheet.absoluteFill`.

For a lifecycle upgrade, verify Debug with Metro and Release with its embedded JavaScript bundle on a physical iOS device. A successful compile alone does not prove cold startup. Keep Android debug compilation and the complete repository required gate alongside this verification.

## Gradle cache paths

SDK 57's Gradle 9.3.1 has an [upstream Kotlin DSL symlink regression](https://github.com/gradle/gradle/issues/36483): a symlinked `~/.gradle/caches` can report missing `libs` or `KtfmtCheckTask` even when the files exist. Use a `GRADLE_USER_HOME` whose cache directories are real paths (including on an external disk); do not symlink its `caches` or `modules-2`. Do not patch React Native's Gradle sources or disable checks to hide this host setup problem. On this workstation the verified build uses `/Volumes/Lucy-SSD/Relocated/Caches/dev/clawket-sdk57-gradle`.
