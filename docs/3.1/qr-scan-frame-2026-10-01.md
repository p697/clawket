# QR scan frame selection · 2026-10-01

Owner reported a Preview/debug-mode error on the first scan of a Production Codex QR from `npx @p697/clawket@latest pair choose` (Bridge 3.1.8); the next scan connected.

## Observed evidence

Read-only local configuration and Registry/Relay logs confirm the generated Codex device pairing used Production. The iOS 3.1.0 build 15 diagnostics distinguish these two scan outcomes (UTC; Tokyo is UTC+9):

| Time | Evidence |
|---|---|
| 12:29:15.087 | Local `pair_validation`: detected backend OpenClaw, detected environment Preview, selected environment Production; `pairing_preview_requires_debug_mode`. No claim/network operation at this stage. |
| 12:29:26.898–29.329 | Production Codex Registry claim HTTP 200, Relay full-client admission, Mobile claim success and connection ready. |

These are different parsed backend/environment categories. Production Codex payloads do not become Preview through a Registry timeout or a stale debug-mode flag. Raw QR data and camera frames are deliberately absent from diagnostics, so the record does **not** prove which physical QR caused the first validation. An adjacent/older code is a hypothesis, not a measured root cause. This is separate from the September 30 stale-handler investigation.

## Confirmed scanner defect and correction

The visible 250-point scan square was decorative: the full-screen camera accepted the first parseable QR anywhere in its preview. Controlled component tests reproduced an off-frame Preview/OpenClaw code winning before a centred Production/Codex code.

The scanner now measures the square relative to the camera container and checks full containment using Expo's camera-view corners, or positive bounds when corners are unavailable. Missing/malformed geometry and unmeasured/stale layouts cannot select a code. Filtering precedes parsing and deduplication, so moving the same QR into the square still works. Synchronous result bursts accept one code, invalid-code alerts pause selection until retry, and cancel/unmount retire buffered results and delayed retries.

Expo Camera 57.0.5 already iterates iOS metadata objects, but its Android analyzer returned only `barcodes.first()`. A narrow install-time Kotlin patch now emits every result with unchanged data and geometry, allowing the app to select the in-frame code. Android explicitly compiles Expo Camera from source; patch/source/config drift fails verification. No backend/environment admission, invitation, claim, Relay, Bridge or dependency version changed.

## Validation and delivery

Local Jest files ran individually in-band: scanner 12, geometry 23, legacy QR parser 14, QR payload 23, backend pairing profile 21, scanner view 1 (94 total). They cover competing codes, entry into the frame, bounds fallback, both platform corner orders, all edges, corrupt geometry, layout changes, bursts and retired callbacks; existing pairing checks preserve all six pairable backends. Native patch tests passed five cases for source drift, idempotence, all-copy validation, missing dependencies and build/install wiring. Design-system checks and agent docs passed.

Under the exclusive heavy lease, `mobile:sync:native` and Mobile types passed without tracked manifest/lockfile churn. Generated Pods retain Expo Camera 57.0.5 and React Native 0.86.3. Android `:expo-camera:compileDebugKotlin` passed (52 seconds, 59 tasks executed; two workers, bounded in-process Kotlin compilation), compiling the patched analyzer from this task's own dependencies. This was module compilation, not an APK/IPA build, install or physical-camera acceptance.

`expo install --check` reports 11 newer recommended patch versions against the repository's existing pinned baseline, including Camera 57.0.6 versus installed 57.0.5. No dependency upgrade is part of this fix; this compatibility-catalog result is recorded separately from the scanner tests.

These checks establish the scanner defect and correction; they do not reproduce the original physical scene. Physical iOS/Android acceptance remains HT-QR-FRAME-1001: scan one code, then put a second code outside the square, including Production Codex beside Preview OpenClaw, and check the first in-frame scan and cancel/reopen. The installed app needs a separately authorized update; Android also needs the new native camera build. Investigation/fix authorization does not authorize packaging, OTA, npm publication or production deployment.
