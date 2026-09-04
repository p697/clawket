# Android Development & Build Guide

This document covers three separate workflows:

1. Daily Android real-device development
2. Local APK packaging and installation
3. Store-ready Android App Bundle packaging for Google Play

If this is a fresh machine, read `docs/android-onboarding.md` first.

Do not treat them as the same thing:

- Daily development should use the installed `debug` app + Metro.
- APK packaging is only for first install, native changes, or distribution verification.
- Google Play closed testing requires a release-signed `.aab`, not a debug-signed APK.

## Environment Setup

```bash
# JDK 17
brew install --cask zulu@17
# JAVA_HOME=$(/usr/libexec/java_home -v 17)

# Android SDK command line tools
brew install --cask android-commandlinetools
# ANDROID_HOME=/opt/homebrew/share/android-commandlinetools

# SDK components
sdkmanager --install "platform-tools" "platforms;android-36" "build-tools;36.0.0"
```

## Shell Environment (`~/.zshrc`)

```bash
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export PATH="$ANDROID_HOME/platform-tools:$PATH"
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
```

Reload shell after editing:

```bash
source ~/.zshrc
```

## Development Workflow

### Recommended Daily Flow

For Android real-device development, the normal loop is:

1. Install the `debug` app once on the phone
2. Run the Android dev script
3. Open the already-installed app manually on the phone
4. Edit code and rely on hot reload

Command:

```bash
npm run dev:android
```

What this script does:

- installs root dependencies
- configures `adb reverse` for `tcp:8081` -> Metro
- starts Expo Metro on port `8081`

### What Hot Reloads

These changes update without rebuilding the APK:

- React Native `JS/TS` code under `src/`

### What Requires Rebuild/Reinstall

These changes require rebuilding and reinstalling the Android app:

- new native dependency
- changes under `android/`
- Expo config/plugin changes that affect native code
- permission / manifest / package / native module changes

In those cases, rebuild the `debug` app:

```bash
npx expo run:android
```

Or use Gradle directly:

```bash
cd android
ANDROID_HOME=/opt/homebrew/share/android-commandlinetools \
JAVA_HOME=$(/usr/libexec/java_home -v 17) \
./gradlew app:assembleDebug -x lint -x test --configure-on-demand --build-cache
```

Artifact:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

### First-Time Device Setup

Make sure:

- Developer options are enabled on the phone
- USB debugging is enabled
- the device is visible in `adb devices`

Check:

```bash
adb devices
```

If the phone is not listed, fix that before starting Metro.

## Packaging Workflow

Use packaging only when needed:

- first install to a device
- validating production-like behavior
- generating an APK to share manually
- generating a signed `.aab` for Google Play

### Debug APK

```bash
cd android
ANDROID_HOME=/opt/homebrew/share/android-commandlinetools \
JAVA_HOME=$(/usr/libexec/java_home -v 17) \
./gradlew app:assembleDebug -x lint -x test --configure-on-demand --build-cache
```

Artifact:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Recommended use:

- first install for development
- reinstall after native changes

### Release APK

```bash
cd android
ANDROID_HOME=/opt/homebrew/share/android-commandlinetools \
JAVA_HOME=$(/usr/libexec/java_home -v 17) \
./gradlew app:assembleRelease -x lint -x test --configure-on-demand --build-cache \
-PreactNativeArchitectures=arm64-v8a
```

Artifact:

```text
android/app/build/outputs/apk/release/app-release.apk
```

`-PreactNativeArchitectures=arm64-v8a` builds only arm64. This keeps APK size lower.  
Remove it to include `armeabi-v7a` for older devices, at the cost of a larger APK.

If you need to upload a replacement build to Google Play and the previous `versionCode` is already used, rebuild with a higher override:

```bash
EXPO_ANDROID_VERSION_CODE=10701 npm run build:android:aab
```

### Store-ready AAB

Preferred command:

```bash
cd apps/mobile
npm run build:android:aab
```

This script is the canonical Google Play packaging flow. It now:

1. auto-selects an Android `versionCode` unless `EXPO_ANDROID_VERSION_CODE` is explicitly provided
2. runs `expo prebuild --platform android --no-install`
3. builds the signed release `.aab`

Artifact:

```text
android/app/build/outputs/bundle/release/app-release.aab
```

### Release Signing Modes

The Android Gradle config now supports two release-signing modes:

1. **Real release signing** for Google Play upload
2. **Explicit debug-sign fallback** for temporary local verification only

Release builds now require one of these:

- a real release keystore configured through environment variables, or
- a local `android/app/keystore.properties` file, or
- the explicit Gradle property `-Pclawket.allowDebugReleaseSigning=true`

If neither a release keystore nor the debug-sign fallback flag is present, Gradle will stop the build with an error.

## Install APK on Device

Install debug APK:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Install release APK:

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

## Signature Switching

If you switch between differently signed builds, Android may reject the install with:

```text
INSTALL_FAILED_UPDATE_INCOMPATIBLE
```

When that happens:

```bash
adb uninstall com.p697.clawket
adb install android/app/build/outputs/apk/release/app-release.apk
```

## Release Keystore Setup

For store upload, create or obtain an Android upload keystore and keep it outside git.

The repo supports two configuration methods.

### Option A: Local `keystore.properties`

1. Copy:

```bash
cp android-keystore.properties.example android/app/keystore.properties
```

2. Fill in:

```properties
storeFile=/absolute/path/to/clawket-upload.keystore
storePassword=...
keyAlias=upload
keyPassword=...
```

Notes:

- `android/app/keystore.properties` is ignored by git.
- `storeFile` can point anywhere on disk; it does not need to live inside the repo.
- This is the easiest local setup for signed bundles.

If local signing is needed, the recovery flow is:

```bash
cd apps/mobile
./scripts/restore-android-signing.sh
```

That script recreates `android/app/keystore.properties` from:

- `CLAWKET_ANDROID_KEYSTORE_PATH`
- `CLAWKET_ANDROID_KEY_ALIAS` (defaults to `upload`)
- passwords stored in macOS Keychain or passed via env vars

The expected Keychain service names are:

- `clawket-android-keystore-store-password`
- `clawket-android-keystore-key-password`

### Option B: Environment Variables

You can also provide signing values at build time:

```bash
export CLAWKET_ANDROID_KEYSTORE_PATH=/absolute/path/to/clawket-upload.keystore
export CLAWKET_ANDROID_KEYSTORE_PASSWORD=...
export CLAWKET_ANDROID_KEY_ALIAS=upload
export CLAWKET_ANDROID_KEY_PASSWORD=...
```

This is the better fit for CI or ephemeral shell sessions.

## Store-Ready AAB Build

The default Android release path should be EAS Build:

```bash
eas build --platform android --profile production
```

Important:

- `apps/mobile/.env.local` is local-only and is not uploaded to EAS automatically.
- Before the first remote Android build on a machine, sync the current app env into EAS:

```bash
cd apps/mobile
npm run eas:env:sync
```

- Store-distribution Android EAS builds now run a pre-install validation step and will fail if RevenueCat is missing or if `EXPO_PUBLIC_REVENUECAT_TEST_API_KEY` / `EXPO_PUBLIC_UNLOCK_PRO` are enabled.

Use the local Gradle path below only as a fallback or recovery flow.

Google Play closed testing can also use a release-signed local `.aab`.

Fallback local build command:

```bash
npm run build:android:aab
```

What it does:

- patches the known Android Gradle source-set issue in `@react-native-menu/menu` and `react-native-keyboard-controller`
- restores the ignored local signing file
- normalizes the generated Expo `android/app/build.gradle` release signing block
- runs `./gradlew app:bundleRelease`
- expects release signing credentials to be configured first

Artifact:

```text
android/app/build/outputs/bundle/release/app-release.aab
```

The fallback local AAB build restores the ignored local signing file automatically before Gradle runs, but it still requires `CLAWKET_ANDROID_KEYSTORE_PATH` plus the keystore passwords.

If dependencies are reinstalled, `npm install` now also runs `./scripts/patch-android-native-deps.sh` via `postinstall`, so the Kotlin source-set fix is re-applied automatically.

For a locally installable release APK signed with the same upload key, use:

```bash
npm run build:android:apk
```

If you only want a temporary local release build and do not have the keystore yet, keep using the existing APK path with the debug-sign fallback:

```bash
./gradlew app:assembleRelease -Pclawket.allowDebugReleaseSigning=true
```

That fallback is only for local testing. Do not upload those artifacts to Google Play.

## EAS Build Option

The repo already includes store distribution profiles in `eas.json`.

If you prefer EAS-managed Android credentials and cloud builds, use one of these:

```bash
eas build -p android --profile production
eas build -p android --profile preview
```

Recommended usage:

- use `production` for the Play Console upload build
- use `preview` only for internal distribution

For the first Play upload with EAS, let Expo manage Android credentials unless you already have a keystore you need to preserve.

## Google Play Closed Testing Checklist

Before uploading the first closed-test build, verify:

1. Package name stays `com.p697.clawket`.
2. Version code increases for every uploaded build.
3. Release signing uses the same upload key across future Play uploads.
4. `npm run config:check:android` passes before the build.
5. `EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY` is present in `.env.local` or the shell environment.
6. `EXPO_PUBLIC_REVENUECAT_PRO_ENTITLEMENT_ID` matches the RevenueCat entitlement used by the paywall.
7. `EXPO_PUBLIC_REVENUECAT_PRO_OFFERING_ID` and `EXPO_PUBLIC_REVENUECAT_PRO_PACKAGE_ID` point at the packages you intend to sell in Google Play.
8. `EXPO_PUBLIC_REVENUECAT_TEST_API_KEY` is not set.
9. `EXPO_PUBLIC_UNLOCK_PRO` is not set.
10. Privacy policy URL and support email are configured in the app and Play listing.
11. You upload `app-release.aab`, not `app-release.apk`.

## Android Subscription Readiness

Clawket already uses RevenueCat and the same paywall code path on Android, but Google Play still needs its own billing-side setup and validation.

Before starting Play closed testing, verify:

1. A Google Play app exists for `com.p697.clawket`.
2. Payments profile, tax, and merchant setup are complete in Play Console.
3. Google Play subscription products are created for the Android app.
4. Those products are attached to the same RevenueCat entitlement used on iOS.
5. The RevenueCat `default` offering maps the intended Google Play products to the packages used by the app, usually `$rc_monthly` and `$rc_annual`.
6. The Android build uses `EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY`, not the Apple key.
7. A closed-test build is installed from Play, not only sideloaded locally.

Recommended validation on a Play-delivered closed-test build:

1. Free user sees the Pro paywall at the correct gated entry points.
2. Monthly purchase succeeds.
3. Yearly purchase succeeds.
4. Restore / re-login / reinstall still resolves the active entitlement.
5. Existing Pro user sees the correct read-only paywall state.
6. RevenueCat diagnostics in the Config screen show the expected entitlement and offering IDs.

## Maven Mirror for Mainland China

`android/build.gradle` already places Aliyun Maven mirrors before `google()` and `mavenCentral()`:

- `https://maven.aliyun.com/repository/google`
- `https://maven.aliyun.com/repository/central`
- `https://maven.aliyun.com/repository/gradle-plugin`

Without these mirrors, Gradle may fail in mainland China because Google Maven TLS/network access is unstable.

## Troubleshooting

### Google Maven TLS Handshake Failure

Symptom:

- `expo-modules-core:configureCMakeRelWithDebInfo` fails
- Gradle cannot fetch from `https://dl.google.com/...`

Cause:

- Google Maven is unstable from mainland China networks

Fix:

- keep Aliyun mirrors before `google()` in `android/build.gradle`

### APK Install Failure (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`)

Symptom:

- `adb install -r` fails while switching build signatures

Cause:

- Android does not allow overwriting an installed app signed with a different certificate

Fix:

```bash
adb uninstall com.p697.clawket
adb install android/app/build/outputs/apk/release/app-release.apk
```

### Release Signing Config Missing

Symptom:

- `bundleRelease` or `assembleRelease` fails before building
- Gradle reports missing Android release signing config

Cause:

- no `keystore.properties`
- no `CLAWKET_ANDROID_KEY_*` variables
- no explicit debug-sign fallback flag

Fix:

- configure real signing for store builds, or
- rerun local-only APK verification with `-Pclawket.allowDebugReleaseSigning=true`

### USB Connection Instability

Symptom:

- `adb devices` intermittently stops showing the device

Mitigation:

- reconnect the cable
- verify `adb devices` before starting the dev stack or installing an APK

## Practical Summary

Use this for daily Android development:

```bash
npm run dev:android
```

Use this when native code changed:

```bash
npx expo run:android
```

Use this when you need a packaged release-variant APK:

```bash
cd android && ./gradlew app:assembleRelease -x lint -x test --configure-on-demand --build-cache -Pclawket.allowDebugReleaseSigning=true -PreactNativeArchitectures=arm64-v8a
```

Use this when you need a store-ready signed AAB for Google Play:

```bash
npm run build:android:aab
```
