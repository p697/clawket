#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OFFICE_GAME_DIR="$ROOT_DIR/office-game"
ANDROID_DIR="$ROOT_DIR/android"
OUTPUT_DIR="$ANDROID_DIR/app/build/outputs/apk/release"
SOURCE_APK="$OUTPUT_DIR/app-release.apk"
TARGET_APK="$OUTPUT_DIR/clawket-pro-temp-release.apk"

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

  local detected_home=""
  if detected_home="$(/usr/libexec/java_home -v 17 2>/dev/null)"; then
    echo "$detected_home"
    return
  fi

  local brew_java_home="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
  if [[ -d "$brew_java_home" ]]; then
    echo "$brew_java_home"
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

echo "Building Office packaged assets..."
(
  cd "$OFFICE_GAME_DIR"
  pnpm build
)

echo "Building Android release variant with temporary Pro unlock enabled..."
(
  cd "$ANDROID_DIR"
  export PATH="$JAVA_HOME_VALUE/bin:$PATH"
  ANDROID_HOME="$ANDROID_HOME_VALUE" \
  JAVA_HOME="$JAVA_HOME_VALUE" \
  EXPO_PUBLIC_UNLOCK_PRO=1 \
  ./gradlew --no-daemon -Dorg.gradle.java.home="$JAVA_HOME_VALUE" \
    app:assembleRelease -x lint -x test --configure-on-demand --build-cache \
    -Pclawket.allowDebugReleaseSigning=true \
    -PreactNativeArchitectures=arm64-v8a
)

if [[ ! -f "$SOURCE_APK" ]]; then
  echo "Expected APK was not produced: $SOURCE_APK"
  exit 1
fi

cp "$SOURCE_APK" "$TARGET_APK"

echo ""
echo "Temporary Pro-unlocked APK ready:"
echo "  $TARGET_APK"
echo ""
echo "Note:"
echo "  - This only enables the in-app Pro override for this build."
echo "  - It does not change the default app behavior for normal builds."
echo "  - The current release variant is still debug-keystore signed in this repo."
