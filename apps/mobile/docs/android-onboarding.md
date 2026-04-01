# Android Packaging Onboarding

Use this document on a fresh machine before trying to build a local APK or a Google Play `.aab`.

This is the shortest reliable path to a working Android release environment for Clawket.

## What Must Exist Outside Git

These items are not stored in the repo and must be prepared on each machine:

1. Android SDK
2. JDK 17
3. `apps/mobile/.env.local`
4. Android upload keystore file
5. `apps/mobile/android/app/keystore.properties` or equivalent `CLAWKET_ANDROID_KEY_*` environment variables

Without those, store-ready Android builds will fail even if the code is correct.

## 15-Minute Setup Checklist

From a new macOS machine:

```bash
brew install android-commandlinetools openjdk@17
```

Then install Android SDK components:

```bash
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export PATH="$ANDROID_HOME/platform-tools:$PATH"
export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home

yes | sdkmanager --licenses
sdkmanager --install "platform-tools" "platforms;android-36" "build-tools;36.0.0"
```

Recommended shell config:

```bash
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export PATH="$ANDROID_HOME/platform-tools:$PATH"
export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
```

## Repo-Specific Local Files

Create or copy these files locally:

1. `apps/mobile/.env.local`
2. `apps/mobile/android/app/keystore.properties`

Example keystore properties:

```properties
storeFile=/absolute/path/to/clawket-upload.keystore
storePassword=...
keyAlias=upload
keyPassword=...
```

## Required Env Values For Google Play Builds

At minimum, confirm these are populated in `apps/mobile/.env.local`:

```bash
EXPO_PUBLIC_REVENUECAT_ENABLED=true
EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY=...
EXPO_PUBLIC_REVENUECAT_PRO_ENTITLEMENT_ID=Clawket Pro
EXPO_PUBLIC_REVENUECAT_PRO_OFFERING_ID=default
EXPO_PUBLIC_REVENUECAT_PRO_PACKAGE_ID=$rc_monthly
EXPO_PUBLIC_SUPPORT_EMAIL=...
EXPO_PUBLIC_PRIVACY_POLICY_URL=...
EXPO_PUBLIC_TERMS_OF_USE_URL=...
```

And confirm these are not enabled for store builds:

```bash
EXPO_PUBLIC_REVENUECAT_TEST_API_KEY=
EXPO_PUBLIC_UNLOCK_PRO=
```

## First Validation Commands

Run these before the first Android release build:

```bash
cd apps/mobile
pnpm run config:check:android
```

If Android device work is needed too:

```bash
adb devices
```

## Recommended Build Commands

### Store-ready AAB

```bash
cd apps/mobile
pnpm run build:android:aab
```

Behavior of this script:

1. builds Office packaged assets
2. picks an Android `versionCode`
3. runs `expo prebuild --platform android --no-install`
4. builds a signed release `.aab`

If `EXPO_ANDROID_VERSION_CODE` is set, that exact value is used.

If it is not set, the script auto-picks a safe value based on the current native project version code.

### Local release APK

```bash
cd apps/mobile/android
PATH=/opt/homebrew/opt/openjdk@17/bin:$PATH \
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
ANDROID_HOME=/opt/homebrew/share/android-commandlinetools \
./gradlew --no-daemon -Dorg.gradle.java.home=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
  app:assembleRelease -x lint -x test --configure-on-demand --build-cache \
  -PreactNativeArchitectures=arm64-v8a
```

### Temporary Pro-unlocked APK

```bash
cd apps/mobile
pnpm run build:android:pro-temp
```

Use this only to verify Pro UI and feature gating. It is not a substitute for real Google Play purchase testing.

## Common Failure Modes

### `IBM_SEMERU` / Gradle toolchain failure

Cause:

- wrong JDK 17 picked by the shell

Fix:

- ensure Homebrew `openjdk@17` is installed
- ensure `JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home`

### Play Console says version code already exists

Fix:

```bash
EXPO_ANDROID_VERSION_CODE=10750 pnpm run build:android:aab
```

Or just rerun `pnpm run build:android:aab` on the same machine and let the script auto-increment from the current native project.

### Release signing config missing

Cause:

- missing local keystore or missing `keystore.properties`

Fix:

- create `apps/mobile/android/app/keystore.properties`
- or export `CLAWKET_ANDROID_KEYSTORE_PATH`, `CLAWKET_ANDROID_KEYSTORE_PASSWORD`, `CLAWKET_ANDROID_KEY_ALIAS`, `CLAWKET_ANDROID_KEY_PASSWORD`

### APK install fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`

Cause:

- phone still has another signed build of `com.p697.clawket`

Fix:

```bash
adb uninstall com.p697.clawket
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

Some phones also keep a second user profile or clone profile. Check all users if uninstalling from the main user does not help.

## Final Pre-Upload Checklist

Before uploading to Google Play:

1. `pnpm run config:check:android` passes
2. RevenueCat Android key is present
3. upload keystore is loaded
4. privacy policy URL is set
5. contact email is set
6. package is `com.p697.clawket`
7. current artifact is a new `versionCode`
8. upload the latest file from `android/app/build/outputs/bundle/release/app-release.aab`
