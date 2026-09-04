# Android Development & Build Guide

This document covers two separate workflows:

1. Daily Android real-device development
2. APK packaging and installation

Do not treat them as the same thing:

- Daily development should use the installed `debug` app + Metro.
- APK packaging is only for first install, native changes, or distribution verification.

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

### Important Note About Current Release Signing

The repo currently builds the `release` variant, but the Gradle config still signs it with the debug keystore.

That means:

- `app-release.apk` is still useful for testing the release build variant
- but it is **not yet a properly release-signed distribution artifact**

If real release signing is needed later, update `android/app/build.gradle` to use a dedicated release signing config and then update this document.

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

## Release Keystore Notes

There was an earlier plan to keep a dedicated release keystore at:

```text
android/app/clawket-release.keystore
```

But the current Gradle config does not use it yet.

So for now:

- keep any release-keystore planning information separate from the actual build commands
- do not assume `assembleRelease` is already producing a formally release-signed APK

When real release signing is wired into Gradle, document these items together:

- keystore file path
- alias
- password sourcing method
- local/private storage rules
- CI or local signing steps

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
cd android && ./gradlew app:assembleRelease -x lint -x test --configure-on-demand --build-cache -PreactNativeArchitectures=arm64-v8a
```
