#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/android"
APK_PATH="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"

normalize_release_signing_gradle() {
  local build_gradle="$ANDROID_DIR/app/build.gradle"

  if [[ ! -f "$build_gradle" ]]; then
    echo "Android build.gradle not found: $build_gradle"
    exit 1
  fi

  python3 - "$build_gradle" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()

debug_bad = """        debug {
            if (hasReleaseSigningConfig) {
                signingConfig signingConfigs.release
            } else {
                signingConfig signingConfigs.debug
            }
        }"""

debug_good = """        debug {
            signingConfig signingConfigs.debug
        }"""

release_bad = """        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug"""

release_good = """        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            if (hasReleaseSigningConfig) {
                signingConfig signingConfigs.release
            } else {
                signingConfig signingConfigs.debug
            }"""

if debug_bad in text:
    text = text.replace(debug_bad, debug_good)

if release_bad in text:
    text = text.replace(release_bad, release_good)

path.write_text(text)
PY
}

resolve_android_home() {
  if [[ -n "${ANDROID_HOME:-}" ]]; then
    echo "$ANDROID_HOME"
    return
  fi

  local default_home="/opt/homebrew/share/android-commandlinetools"
  if [[ -d "$default_home" ]]; then
    echo "$default_home"
    return
  fi

  echo ""
}

resolve_java_home() {
  if [[ -n "${JAVA_HOME:-}" ]]; then
    echo "$JAVA_HOME"
    return
  fi

  local brew_java_home="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
  if [[ -d "$brew_java_home" ]]; then
    echo "$brew_java_home"
    return
  fi

  local detected_home=""
  if detected_home="$(/usr/libexec/java_home -v 17 2>/dev/null)"; then
    echo "$detected_home"
    return
  fi

  echo ""
}

ANDROID_HOME_VALUE="$(resolve_android_home)"
JAVA_HOME_VALUE="$(resolve_java_home)"

if [[ -z "$ANDROID_HOME_VALUE" ]]; then
  echo "ANDROID_HOME is not set and no default Android SDK path was found."
  exit 1
fi

if [[ -z "$JAVA_HOME_VALUE" ]]; then
  echo "JAVA_HOME is not set and no default JDK 17 path was found."
  exit 1
fi

echo "Validating Android public release config..."
(
  cd "$ROOT_DIR"
  CLAWKET_REQUIRE_POSTHOG=1 CLAWKET_REQUIRE_REVENUECAT=1 node scripts/check-public-config.mjs --platform=android
)

echo "Restoring Android signing config..."
"$ROOT_DIR/scripts/restore-android-signing.sh"

echo "Patching Android native dependency Gradle files..."
"$ROOT_DIR/scripts/patch-android-native-deps.sh"

echo "Syncing Expo Android native config..."
(
  cd "$ROOT_DIR"
  npx expo prebuild --platform android --no-install
)

echo "Normalizing Android release signing config..."
normalize_release_signing_gradle

echo "Building signed Android release APK..."
(
  cd "$ANDROID_DIR"
  export PATH="$JAVA_HOME_VALUE/bin:$PATH"
  ANDROID_HOME="$ANDROID_HOME_VALUE" \
  JAVA_HOME="$JAVA_HOME_VALUE" \
  ./gradlew --no-daemon -Dorg.gradle.java.home="$JAVA_HOME_VALUE" \
    app:assembleRelease -x lint -x test --configure-on-demand --build-cache
)

if [[ ! -f "$APK_PATH" ]]; then
  echo "Expected release APK was not produced: $APK_PATH"
  exit 1
fi

echo ""
echo "Signed Android release APK ready:"
echo "  $APK_PATH"
