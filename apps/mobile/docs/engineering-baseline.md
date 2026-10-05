# Mobile Engineering Baseline

This document records the durable engineering baseline for the Clawket mobile workspace. Product and backend rules remain in `AGENTS.md`; visual rules remain in `docs/design-system.md`.

## Runtime baseline

- Node.js: 22.x
- Expo: SDK 57 (`~57.0.23`), including official Xcode 27 Device Hub and opt-in UIScene support
- React Native: 0.86.3, aligned with Expo SDK 57
- React: 19.2.3
- TypeScript: 6.0, strict mode; explicit Jest/Node/React ambient types
- Package manager: npm workspaces with committed lockfiles

The client is prepared at version 3.1.1. `apps/mobile/package.json` drives Expo's runtime version; `app.json` and both lockfiles mirror it. Locally generated native projects are ignored by Git and should be resynchronized before a build. Android's 3.1.1 base `versionCode` is 30101 (already used by Play 3.1.0); the owner-authorized 3.1.1 Play submission uses explicit code 30102. The store bundle script advances beyond a code already in the native project; use `EXPO_ANDROID_VERSION_CODE` if Play needs a higher code. iOS build numbers are managed separately by EAS.

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

## Composer attachment scope

Composer attachment ownership uses the route's connection/Agent/session, with a new in-memory generation on each scope entry. The mounted controller's real image-picker and paste consumers are covered in `src/chat/useChatController.contract.test.ts`: selected trays retire on session changes; gallery/recent/camera/file/paste completions and retained setters cannot survive A→B→A. Same-scope adapter reconnect and history reload retain the tray. These deferred-consumer tests do not prove native picker timing or physical navigation acceptance. Text draft persistence, held outbox recovery, encoding and backend wire contracts remain independent.

## History prepend stage characterization

`src/screens/Thread/historyPrependNativeStages.test.tsx` connects the real `ThreadView` and its history anchor to the installed FlashList source. Its host facade separates four inputs: an early Shadow content-size report; application of the real requested offset against the old child's maximum; independent child mounting; and a later native scroll event through the SDK. Host cell measurement uses fixed synthetic message/date heights, and ignores unrelated header/composer intrinsic geometry. It records both staged React holder coordinates and the independently applied child coordinates; neither represents Native paint.

The late event does not directly invoke restore. If the real SDK schedules another commit, `ThreadView`'s real commit callback may retry; the test retains that outcome instead of inventing a size callback or target ACK. Separate controls place the child before the command, supply an explicitly additional real size callback after a clamp, and deliver an old command event after a fresh reader displacement. Fake timers only settle existing SDK entry/ignore/reveal timers before the stages; no delay is treated as a mount acknowledgement. This is a consumer contract characterization, not a production fix or a determination of the 063 phone jump's cause.

The fifth regression retains the real Thread's reading flag while the early command applies to the old child. The anchor can associate its previously unknown clamp only from the native scroll event's finite content/viewport heights: an unseen same-scope/list target exceeds the event maximum, the content height matches retired geometry and the offset equals that maximum. It retains the original target, row and pending state; repeated feedback uses the same ledger association. Existing clamp associations and genuine displacement at other offsets remain unchanged. A fresh drag retires seen commands. The equal-offset user/programmatic ambiguity remains explicit; passing this controlled host case would not establish 063/073 causality or Native paint.

With only the two production files restored to prerequisite `7bf33d97`, the selected fifth case failed at the missing clamp acknowledgement. The candidate passes all five stage cases and all 29 anchor cases, including absent/nonfinite/zero event viewport and displacement away from the actual maximum. The first full run exposed a test expectation that counted the repeated clamp only once; its assertion was corrected without changing host stages or production. Mobile types and documentation checks pass. These are controlled consumer results; phone acceptance remains separate.

## Native synchronization

After changing Expo, React Native, an Expo module, or another native dependency:

1. Run `npm run mobile:sync:native` from the monorepo root.
2. Confirm `npx expo install --check` reports compatible dependencies.
3. Inspect the generated Pod/Gradle dependency changes; do not accept unrelated native churn.
4. Build the affected native platform.
5. Verify both OpenClaw and Hermes connection entry points remain reachable.

Generated `ios/` and `android/` projects are local build products in this repository. The committed `app.config.js`, package manifests, scripts, and lockfiles are the durable configuration sources.

`plugins/with-xcode-env.js` loads the local `.xcode.env.local` override before Release public-config validation. Xcode GUI phases may not find Node on `PATH`; the override supplies an executable `NODE_BINARY`. Keep this order even though React Native also loads the override afterward. Changes to the plugin must be synchronized into the local generated `ios/.xcode.env`; shell-level regression checks use a restricted GUI-style PATH without creating an Archive.

## Dependency policy

1. Prefer exact or Expo-recommended ranges for native packages.
2. Keep root `overrides` synchronized with the mobile manifest; an old override can silently defeat a workspace upgrade.
3. Use `npx expo install --check` as a compatibility signal, not as permission for an automatic major upgrade.
4. Treat navigation, storage, networking, authentication, purchases, and animation upgrades as behavior changes requiring focused tests.
5. `react-native-enriched-markdown` stays on an exact stable pin (1.0.2; retain its reviewed native patch across SDK upgrades). Its `postinstall` needs network access to `registry.npmjs.org` and `github.com` to vendor tree-sitter grammar sources; a failed download degrades code highlighting to a clean no-op build. Feature flags live in the `enriched-markdown` block of `package.json` (root for the download, Mobile for the native build), not in an Expo plugin. The iOS parallel tail-fade patch (`scripts/patch-enriched-markdown-tail-fade.mjs`) is reviewed against that exact version and fails closed when the upstream file drifts.

## Documentation ownership

- `AGENTS.md` is authored.
- `CLAUDE.md` is a relative symlink to `AGENTS.md` in every instructed directory.
- `docs/design-system.md` owns detailed UI values and component contracts.
- `docs/engineering-baseline.md` owns toolchain, dependency, and validation policy.
- `README.md` and `README.zh-CN.md` must stay aligned.

`npm run check:docs` verifies the agent-document topology and key current references. It must fail when a symlink drifts into a copied file or an obsolete path returns.

## Opt-in chat geometry QA

Development bundles expose `globalThis.__CLAWKET_CHAT_GEOMETRY_QA__` for an already attached React Native Inspector. It is absent in production bundles and capture is off by default. While the QA Thread is focused and its connection is active, evaluate these expressions in that app's Inspector JavaScript context:

```js
globalThis.__CLAWKET_CHAT_GEOMETRY_QA__.start()
JSON.stringify(globalThis.__CLAWKET_CHAT_GEOMETRY_QA__.read())
globalThis.__CLAWKET_CHAT_GEOMETRY_QA__.stop()
```

`start()` returns `started`, `already_active` or `unavailable`; it does not change page state. `read()` returns a copied, bounded memory ring, including after `stop()`. No UI button, console/logcat delivery, disk write, network request or analytics is involved. Save extracted metadata with the private screenshot/recording evidence; do not extract a different app or thread context. An Inspector expression is an extraction route, not proof that the actual QA device has that Inspector attached.

The observer samples at most once per second, waiting one second after each UI response, with one outstanding query across scope retirement and Fast Refresh. It retains the latest 256 samples and counts overwritten samples. A capture expires after 20 minutes, even if its UI query never returns. Navigation, focus loss, connection/session scope change, list/native binding replacement, background and unmount stop capture and fence late responses; foreground never restarts it. A pending old query prevents a new capture until it returns.

Each record contains only fixed enums, booleans and bounded numeric geometry/counters. Invalid or unavailable numbers are `null`; absent raw events are reported separately from raw registration availability. Raw sequence and data revision are capture-local counters, not stable identities. The data revision counts sampled array changes, not React commits.

The UI raw snapshot and the later JS/public-SDK read are not an atomic measurement. Raw event age is calculated on the UI thread; it does not include a delayed delivery back to JS. Record Inspector extraction times and compare successive records rather than claiming both layers were observed on one frame.

| Layer | Evidence | Limit |
|---|---|---|
| Existing raw Reanimated `useEvent` registration | Last native scroll event offset, content/viewport heights, event kind, sequence and age | Available only when the existing native tag registration succeeds (currently Android follow binding). No event does not prove no native scroll. |
| FlashList public ref | SDK offset, first-item offset, content/viewport heights, visible start/end and at most four nearby layouts | `computeVisibleIndices()` describes SDK coordinates. There is no public engaged-window or paint acknowledgement. |
| Existing Thread refs | Last JS offset/content/viewport, reading/follow/paging flags and row count | SDK-ignored native events may never reach the JS scroll callback. |

The core raw/SDK observer does not call scroll, measure, interaction/viewability reset, projection or private manager APIs, add a native event registration, or set React state. The separately gated native observer below adds passive listeners only after accepted Start. Neither can fix or reveal a blank page by itself. Compare a captured blank screenshot with the next single user scroll and the associated raw/SDK coordinates. Matching coordinates do not rule out clipping, opacity or native text rendering; divergent coordinates do not prove the cause of a specific earlier incident. Keep screenshot/video observations distinct from injected SDK test timing.

### Viewport stage observations

With all four Android QA cache gates below satisfied, an accepted capture also records existing Thread layout callbacks, content/viewport sizes, scroll requests, reader events and the anchor's existing correction classification. The version-2 snapshot adds a latest-32-event `viewport` ring. Layout, size, command and ACK stages are never throttled; ordinary `reader_scroll` events are sampled at most once per 100 ms. Every admitted attempt advances the bounded sequence; `dropped`, `throttled` and `rejected` expose losses, with `sequence = dropped + throttled + rejected + events.length`. A 32-event ring is a retained window, not complete scenario coverage.

Events contain fixed kinds and bounded numbers/booleans only. `commandSequence` links an offset correction to the command observed in the same capture. It comes from the existing JS offset/clamp ledger, not an independently returned native command token. A late ACK from an earlier Inspector capture is still observed but has a null link. `follow_glide` and `follow_snap` record app requests; they do not enumerate UI-thread spring frames. `layout_commit` contains public SDK coordinates read by the existing callback, not a native commit or paint acknowledgement. Observed drawing distance is read from a ref rather than adding a layout-control callback dependency.

QA-only React Fragments observe cell layout-effect mount, recycle and unmount indices after accepted Start, without a native wrapper or measurement. Before Start, range is unreported; cells already present at Start may never commit again. `initialIncomplete` therefore stays true, and `mountedStart`/`mountedEnd`/`mountedCount` describe only incomplete React lifecycle bookkeeping. The index map is capped at 256 entries and reports truncation. It is not the SDK engaged range, native mounted range or visible paint. Focus loss retires capture without changing the QA Fragment shape or restarting it on return. Other builds retain the original `renderItem` and cell tree.

Capture retirement, one outstanding raw query and cache-write limits remain as below. The encoder strictly reconstructs version 2 and still accepts exact old version-1 snapshots; the fixed cache filename remains unchanged. A host extractor that freezes/transpiles the encoder must now also freeze and explicitly link its pure `chatViewportQa` import. Old single-module extraction helpers remain frozen and do not validate version 2; update the extractor independently before using a new snapshot.

The injected FlashList/anchor phase regression models delayed native sizing, command application and SDK ACK separately. Its intermediate geometric row candidate is not native mounted text or paint, and the public API does not promise an atomic child-layout/offset update. The encoded 050 QA09–11 to QA24–27 transition and the earlier idle blank restored by a finger scroll remain physical observations with unproven causes. Neither equal sampled offsets nor this recorder fixes or explains them. The separate native text-input retention patch is not a blank-window fix.

### Optional Android native viewport observations

`modules/clawket-qa-viewport` registers no scroll/layout/mount listeners until the existing sampler accepts explicit Start. JS checks the four cache gates; native additionally requires the exact QA package, debuggable flag, RN 0.86.3 without a prerelease and a Fabric UI manager. Resolve the public scroll ref once, then retain weak references to that exact Android `ReactScrollView` and its direct content child. The raw tag is used only in memory at binding and never enters a snapshot. An accepted or unknown native arm is consumed for this app process, including ReactHost/module replacement.

RN's existing helper delivers host layout, direct child layout, scroll/drag/momentum callbacks; a listener on the captured Fabric manager observes `mount_begin`/`mount_end`. Every record checks UI-thread, bound object and generation, then reads current child/host integer geometry in that callback. `child_layout` is observed after RN's direct-child layout/clamp callback; it does not prove descendant cells are laid out. Fabric mount phases cover that manager's drained batch, may include unrelated/command-only work and work queued until root attachment, and may precede another SDK batch. Listener registration order is not an MVCP ordering guarantee. They are observations, not a native command token, all-cell acknowledgement or paint. Initial `bind_snapshot` observes whatever child exists at binding.

The native ring retains at most 64 events without per-event bridge traffic. Every recorded attempt advances `sequence`; `dropped` and `rejected` expose the retained window's loss (`sequence = dropped + rejected + events.length`). Native dimensions and offsets use `*Px` integer fields. The single finite `density` value is captured at binding; JS/RN coordinates are normally dp. Do not compare them without explicit unit conversion, and do not assume density remained unchanged after a device configuration change. `elapsedMs` uses Android `uptimeMillis()` relative to this native capture; JS capture elapsed time has a different origin. No clock synchronization or same-frame association is claimed. Native event order can distinguish observed old/new child geometry and offset transitions within its retained window, but cannot identify which JS command caused them or timestamp that command on the native clock.

Background, Activity destruction, module destruction, host detach, direct-child replacement or the 20-minute bound retire the native binding; callbacks check expiry without a timer. Binding retires before independent listener removal, so a snapshotted late callback is inert. A Stop carries only its captured generation. A late async bind completion after JS scope/list/focus retirement repeats best-effort cleanup of that same generation; it cannot stop another capture. There is no automatic rebind or rearm. Unknown bind/read/callback failures expose only the fixed unavailable reason, never exception text.

The existing cache writer can await `api.readForCache()` to copy the captured native ring under its shared one-flight gate. It performs no new raw/SDK or native geometry query. Read does not recheck host attachment or child identity: `capturing` means the historical capture has not yet observed retirement, not fresh liveness. A pending native call may stall the cache writer; it is not retried or overlapped. Module absence/unreported lookup preserves exact V2 and its synchronous read path; present-module bind/read failure produces a fixed unavailable V3 section. `api.read()` and the Inspector's existing core API stay V2. V3 strictly reconstructs `viewport` plus `nativeViewport` and keeps V1/V2 compatibility; size remains 256 KiB. A new host extractor must freeze/link the encoder's pure `chatViewportQa` and `chatNativeViewportQa` modules. Leave earlier V1/V2 extractors unchanged. Source/host contracts do not attest the installed APK, actual listeners or paint; native debug compilation and physical same-capture evidence remain separate.

### Android QA cache extraction

When an Inspector cannot expose the exact QA page, a separate development route can copy the existing memory ring to one app-private cache file. It requires `__DEV__`, Android, native application ID exactly `com.p697.clawket.qa`, and a newly loaded bundle with `EXPO_PUBLIC_CHAT_GEOMETRY_QA_CACHE=1`. All other builds remain disabled. Registering the fixed **QA Geometry Start** and **QA Geometry Stop** Dev Menu controls performs no sampling or file I/O; these are development diagnostics, not product controls.

Focus the selected QA chat, choose Start once before the scenario, and dismiss the Dev Menu before reproducing it. That explicit action shows the fixed Android QA Toast `QA Geometry started` or `QA Geometry unavailable`; started reports the sampler accepting the arm, not a completed cache write. Registration shows no Toast, and a stale menu callback stays silent if the four gates are no longer satisfied. A reported unavailable/already-active refusal does not consume the arm; only `started` does. Unknown Start outcomes block further attempts. The accepted arm and shared pending-write gate survive Fast Refresh; menu callbacks resolve the current collector at invocation. Thread/session replacement, background or unmount retains the stopped old ring and never automatically starts the new context. After an accepted capture, starting another requires a new app process.

The sink reads only memory snapshots through `api.read()` or the optional native-ring copy described above, without another raw/SDK geometry query, React update or scroll command. It revalidates and reconstructs the fixed scalar schema (at most 256 geometry samples/four layouts per sample, 32 JS viewport stage events, 64 native events when compiled and 256 KiB), writes UTF-8 to `clawket-chat-geometry-qa-v1.tmp`, and renames it to `clawket-chat-geometry-qa-v1.json` in `FileSystem.cacheDirectory`. There is at most one ring-copy/file-write flight across module replacement, with one snapshot every ten seconds after the prior write settles, at most 122 attempts and no new write after 20 minutes. Explicit Stop saves the stopped ring when the existing write settles. File failure retires sampling without retry. An already pending retired write may finish once; it cannot rearm or overlap another writer.

The sandbox cache is best-effort evidence: the supported Expo API does not attest chmod, fsync, crash durability or a final file after a stalled/late write. Root may read only `cache/clawket-chat-geometry-qa-v1.json` through the exact QA package's `run-as` under the Android lease, bounded to 256 KiB, and save the revalidated result privately. Do not read a whole database/directory or open a UI recovery button. Record loaded bundle/PID, extraction time and file freshness independently; an old file is not proof of a new capture. A captured raw/SDK discrepancy remains an observation, not an established cause of the earlier idle blank.

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

SDK 57's Gradle 9.3.1 has an [upstream Kotlin DSL symlink regression](https://github.com/gradle/gradle/issues/36483): a symlinked `~/.gradle/caches` can report missing `libs` or `KtfmtCheckTask` even when the files exist. Use a `GRADLE_USER_HOME` whose cache directories are real paths (including on an external disk); do not symlink its `caches` or `modules-2`. Do not patch React Native's Gradle sources or disable checks to hide this host setup problem. On this workstation the verified build uses `/Volumes/External-SSD/Relocated/Caches/dev/clawket-sdk57-gradle`.

## Android incoming text files

`patch-expo-sharing.mjs` preserves `EXTRA_STREAM` for text/plain sends and classifies text MIME streams as files in the raw parser, reviewed against expo-sharing 57.0.20. A MIME type alone does not imply an `EXTRA_TEXT` body. Both root and Mobile postinstall apply this idempotent, fail-closed patch; the required gate exercises source drift and missing-dependency failures. Keep URL/text bodies on their existing path and never resolve shared web URLs automatically. Android `expo.autolinking.android.buildFromSource` explicitly includes `expo-sharing`; SDK 57 otherwise links the unpatched prebuilt AAR even when the Kotlin source was changed. The regression checks this configuration. Remove or review the patch when upgrading Expo Sharing. See [Expo precompiled modules](https://docs.expo.dev/guides/prebuilt-expo-modules/).

## System-gallery image payloads

Expo Image Picker 57.0.18 on Android uses `CompressionImageExporter` at the existing quality 0.8. Its base64 export is JPEG while `MediaHandler` reports the original provider MIME; a GIF label skips send preparation, and a failed PNG re-encode retains that mismatch. `useChatImagePicker` therefore checks at most 12 decoded bytes for JPEG, the full PNG signature, GIF87a/GIF89a or RIFF/WebP before storing `PendingImage`. Unknown signatures retain the declared/default MIME. Keep URI, bytes, quality, six-image capacity and scope fences unchanged; this neither restores exported GIF animation nor validates an entire image. Hook tests exercise send preparation and the actual Codex frame serializer. Device gallery/export behavior remains a separate acceptance check.

## Camera barcode delivery

`scripts/patch-expo-camera-barcodes.mjs`, reviewed against expo-camera 57.0.5, delivers every Android MLKit result instead of only `barcodes.first()`. The app selects the code inside its measured scan frame; otherwise an off-frame first result can indefinitely hide the intended code. Preserve each result's data, corners, rotated dimensions and image cleanup. Both root and Mobile postinstall apply the idempotent patch and fail on missing/drifted source; CI checks patch integrity and install wiring. Android `expo.autolinking.android.buildFromSource` includes `expo-camera` so the patched Kotlin is compiled. iOS already delivers all detected QR objects. Review this patch when upgrading Expo Camera; the package version stays unchanged.

## Android presence animation

`PresenceRing` uses the public React Native `Animated` native driver on Android for its rotation and opacity only; other platforms retain Reanimated. Working turns take 1.4 seconds. Attention precomputes one complete forward/reverse quadratic cycle over twice `Motion.avatarWorkingLoop`, so `Animated.loop` remains native and its endpoint is continuous. Both native properties stay explicit across tone changes, loops use `isInteraction: false`, and Android resets on inactive/background or reduced motion and stops on unmount. The SVG, container, status and accessibility contract are shared.

Reviewed against RN 0.86.3's stable configuration (`useSharedAnimatedBackend=false`): Android `PropsAnimatedNode` calls `FabricUIManager.synchronouslyUpdateViewOnUIThread`, then `SynchronousMountItem` → `SurfaceMountingManager.updatePropsSynchronously` → the View manager's property update. This avoids a ShadowTree commit for each decorative frame; the method's synchronous commit counter is a mounting diagnostic, not a ShadowTree commit. No feature flags, native dependency patches or changes to Markdown/scroll state are involved. [Native-driver support](https://reactnative.dev/docs/animations#using-the-native-driver) and [native loops](https://reactnative.dev/docs/animated#loop) are public APIs. Recheck this path when upgrading RN. The Android approval transition still requires physical retesting: fewer competing commits does not establish the cause or resolution of the captured commit-exhaustion crash.

## Android SVG group opacity

`scripts/patch-react-native-svg-group-opacity.mjs`, reviewed against react-native-svg 15.15.4 (the root's hoisted 15.15.3 and the newest 15.15.5 carry the same `GroupView`), keeps a translucent `<G>`'s offscreen layer canvas private to that group. Upstream ([#2450](https://github.com/software-mansion/react-native-svg/pull/2450)) keeps the canvas a group was drawn into while its opacity is 1 and calls `setBitmap` on it once the opacity changes again. When that canvas is a translucent ancestor's layer, the ancestor's save stack is emptied mid-draw and its `restore()` throws `Underflow in restore - more restores than saves`, which kills the app. The Companion Fetch scene hit it on the owner's SM-A566B: a dirt `<G>` whose animated opacity rounds to exactly 1.0f inside the hidden mound `<G>`. The patched group draws into a local canvas and resets only its own layer. Both root and Mobile postinstall apply this idempotent, fail-closed patch; the required gate checks source drift, missing dependencies and install wiring. React Native autolinking compiles react-native-svg from source, so no `buildFromSource` entry is needed. Installed apps receive the fix only with a new native build. Review the patch when upgrading react-native-svg.

## Android Reanimated missing-view sync updates

`scripts/patch-reanimated-sync-props.mjs` is reviewed only against Reanimated 4.5.5 and React Native 0.86.3. Reanimated's draw-pass event path replays retained synchronous props; SVG layout and screen-transition events can repeatedly reach a tag whose Android view is absent. The RN86 reflective update then prints a complete exception stack for each attempt. The owner-saved QA log contained 2,629 failures in three short bursts, rather than evidence of a continuously running animation or an entire destroyed Surface.

The patch calls the existing `preserveMountedTags` helper inside the original sync-update `try`. A confirmed missing/preallocated view skips that attempt without removing retained props, so later mounts can still apply them. A false helper result retains the original invoke path; unknown lookup/invoke exceptions retain the original warning boundary. It does not change React Native, SVG, registry retirement, global flags or animation semantics. Both install entry points resolve the dependency from Mobile's package consumer, matching its Android autolink target, and validate versions/source before writes. The unrelated root transitive Reanimated 4.2.1 remains untouched. The CI-safe required gate covers actual installed source, version/corruption/idempotency checks and standalone/hoisted/linked consumer resolution.

These checks establish installation/source integrity. Native compilation and a physical missing-view → later-mounted update remain separate acceptance steps, including non-UI-thread and unknown-error handling. Installed apps need a new Android native build; this patch is not evidence that timeline blanking, pagination jumps or measured performance have been fixed. Review/remove it when changing either pinned native dependency.

## Brace expansion security pins

`node-forge` (through `expo` → `@expo/cli` → `@expo/code-signing-certificates`) has no release fixing GHSA-86w9-cpqp-85rv. It is an owner-approved audit exception in `scripts/ci/dependency-audit.mjs` until 2026-11-01; upgrade and remove the exception once a fix ships. Root and standalone Mobile manifests keep matching major-scoped `brace-expansion` overrides: 1.x → 1.1.21, 2.x → 2.1.7 and 5.x → 5.0.12. Both lockfiles must resolve those patched releases for nested glob/minimatch consumers. This addresses the [upstream denial-of-service advisories](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr), including recursive stack exhaustion; retain high-severity audit gates rather than suppressing findings.

## Android paste input state ownership

`patch-paste-input-android-state.mjs` is reviewed against `@mattermost/react-native-paste-input` 2.0.1 and React Native 0.86.3. Its copied Android shadow node stores attributed text fragments in `AndroidTextInputState`. `ShadowView(*this)` also copies the previous state, so successive controlled edits can retain a chain of prior states; clearing the input can destroy that chain recursively. The QA R5S SIGSEGV backtrace repeatedly traversed Android text-input state, attributed-string fragments and ShadowView destruction. This matches the ownership risk; source and patch tests alone do not attest the old installed APK or prove the physical failure is resolved.

The patch clears only each text fragment's copied `props` and `state`, following React Native's existing `BaseTextShadowNode::shadowViewFromShadowNode` contract. It preserves the tag, component, event emitter, layout metrics, text attributes and all input/event-count/IME/paste behavior. Stock RN AndroidTextInput has the same copied-ShadowView shape; this fix is limited to the paste component used by the composer. Stock React Native sources and architecture flags are unchanged. Both root and standalone Mobile postinstall apply it; `npm run paste-input:patch` in Mobile applies the podspec and Android patches explicitly. The required script gate checks exact versions, single-anchor drift, idempotence, missing dependencies, install wiring and validation of every install before writes. These tests verify installation/source integrity, not Android state destruction or paint.

A new native QA build is required. The dependency's Gradle `patchPasteTextInputCodegen` task copies the patched `android/src/codegen-patch/.../ShadowNodes.cpp` into generated JNI sources after codegen. Before building, verify the install patch and inspect those generated sources; build the debug QA variant (`-Pclawket.qa=true`, same package `com.p697.clawket.qa` and version) under the Android/heavy leases, following [android-build.md](android-build.md). On the device, verify long controlled editing followed by clear/Send, repeated edits, selection/composition and paste; preserve the one-dispatch/no-replay rule. A passing compile is separate from physical acceptance. No dependency version, release package, store install or publication is part of this fix. Review or remove the patch on either dependency upgrade.
