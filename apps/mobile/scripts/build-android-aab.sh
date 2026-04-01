#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OFFICE_GAME_DIR="$ROOT_DIR/office-game"
ANDROID_DIR="$ROOT_DIR/android"
OUTPUT_DIR="$ANDROID_DIR/app/build/outputs/bundle/release"
AAB_PATH="$OUTPUT_DIR/app-release.aab"

compute_base_version_code() {
  local package_json_path="$1"
  node - "$package_json_path" <<'EOF'
const packageJson = require(process.argv[2]);
const version = String(packageJson.version || '0.0.0').split('-')[0];
const parts = version.split('.').map((part) => {
  const value = Number.parseInt(part, 10);
  return Number.isFinite(value) ? value : 0;
});
while (parts.length < 3) {
  parts.push(0);
}
process.stdout.write(String((parts[0] * 10000) + (parts[1] * 100) + parts[2]));
EOF
}

read_native_version_code() {
  local build_gradle="$ANDROID_DIR/app/build.gradle"
  if [[ ! -f "$build_gradle" ]]; then
    echo ""
    return
  fi

  rg -o 'versionCode[[:space:]]+[0-9]+' "$build_gradle" \
    | tail -n 1 \
    | awk '{ print $2 }'
}

resolve_android_version_code() {
  if [[ -n "${EXPO_ANDROID_VERSION_CODE:-}" ]]; then
    echo "$EXPO_ANDROID_VERSION_CODE"
    return
  fi

  local base_code
  base_code="$(compute_base_version_code "$ROOT_DIR/package.json")"

  local existing_code=""
  if existing_code="$(read_native_version_code)"; then
    :
  else
    existing_code=""
  fi

  if [[ -n "$existing_code" ]] && [[ "$existing_code" =~ ^[0-9]+$ ]] && (( existing_code >= base_code )); then
    echo $((existing_code + 1))
    return
  fi

  echo "$base_code"
}

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

bad = """    buildTypes {
        debug {
            if (hasReleaseSigningConfig) {
                signingConfig signingConfigs.release
            } else {
                signingConfig signingConfigs.debug
            }
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            if (hasReleaseSigningConfig) {
                signingConfig signingConfigs.release
            } else {
                signingConfig signingConfigs.debug
            }"""

good = """    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            if (hasReleaseSigningConfig) {
                signingConfig signingConfigs.release
            } else {
                signingConfig signingConfigs.debug
            }"""

if bad in text:
    text = text.replace(bad, good)

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

ANDROID_VERSION_CODE_VALUE="$(resolve_android_version_code)"

if [[ ! "$ANDROID_VERSION_CODE_VALUE" =~ ^[0-9]+$ ]] || (( ANDROID_VERSION_CODE_VALUE <= 0 )); then
  echo "Resolved invalid Android version code: $ANDROID_VERSION_CODE_VALUE"
  exit 1
fi

echo "Building Office packaged assets..."
(
  cd "$OFFICE_GAME_DIR"
  pnpm build
)

echo "Validating Android public release config..."
(
  cd "$ROOT_DIR"
  node scripts/check-public-config.mjs --platform=android
)

echo "Syncing Expo Android native config with versionCode $ANDROID_VERSION_CODE_VALUE..."
(
  cd "$ROOT_DIR"
  EXPO_ANDROID_VERSION_CODE="$ANDROID_VERSION_CODE_VALUE" \
  npx expo prebuild --platform android --no-install
)

echo "Normalizing Android release signing config..."
normalize_release_signing_gradle

echo "Building signed Android App Bundle..."
(
  cd "$ANDROID_DIR"
  export PATH="$JAVA_HOME_VALUE/bin:$PATH"
  ANDROID_HOME="$ANDROID_HOME_VALUE" \
  JAVA_HOME="$JAVA_HOME_VALUE" \
  EXPO_ANDROID_VERSION_CODE="$ANDROID_VERSION_CODE_VALUE" \
  ./gradlew --no-daemon -Dorg.gradle.java.home="$JAVA_HOME_VALUE" \
    app:bundleRelease -x lint -x test --configure-on-demand --build-cache
)

if [[ ! -f "$AAB_PATH" ]]; then
  echo "Expected app bundle was not produced: $AAB_PATH"
  exit 1
fi

echo ""
echo "Signed Android App Bundle ready:"
echo "  $AAB_PATH"
echo "  versionCode=$ANDROID_VERSION_CODE_VALUE"
