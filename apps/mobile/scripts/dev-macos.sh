#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IOS_DIR="$ROOT_DIR/ios"
METRO_PORT="${METRO_PORT:-8081}"
TIMEOUT_SECONDS="${METRO_BOOT_TIMEOUT_SECONDS:-25}"
DERIVED_DATA_PATH="${MACOS_DERIVED_DATA_PATH:-/tmp/clawket-mac-dev}"
APP_NAME="${MACOS_APP_NAME:-Clawket}"
WORKSPACE_PATH="$IOS_DIR/Clawket.xcworkspace"
SCHEME_NAME="${MACOS_SCHEME:-Clawket}"
CONFIGURATION="${MACOS_CONFIGURATION:-Debug}"
DESTINATION="${MACOS_DESTINATION:-platform=macOS,variant=Mac Catalyst}"
PIDS=()
STARTED_METRO=false
METRO_PID=""

usage() {
  cat <<'EOF'
Usage:
  npm run dev:macos [-- expo start args]

Starts the macOS Catalyst development stack:
  - Expo Metro dev server
  - xcodebuild Debug build for Mac Catalyst
  - opens the built .app

Examples:
  npm run dev:macos
  npm run dev:macos -- --clear
  METRO_PORT=8088 npm run dev:macos
  FORCE_POD_INSTALL=1 npm run dev:macos

Environment variables:
  METRO_PORT                        Metro port (default: 8081).
  METRO_BOOT_TIMEOUT_SECONDS        Wait time for Metro readiness (default: 25).
  MACOS_DERIVED_DATA_PATH           xcodebuild DerivedData path (default: /tmp/clawket-mac-dev).
  MACOS_APP_NAME                    Built app name (default: Clawket).
  MACOS_SCHEME                      Xcode scheme (default: Clawket).
  MACOS_CONFIGURATION               Xcode configuration (default: Debug).
  MACOS_DESTINATION                 xcodebuild destination (default: platform=macOS,variant=Mac Catalyst).
  FORCE_POD_INSTALL                 Set to 1 to force `pod install`.
  DEV_MACOS_KILL_RUNNING_APP        Set to 0 to keep an existing Clawket.app process alive.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

wait_for_metro() {
  echo "Waiting for Metro on :${METRO_PORT}..."
  for ((i = 0; i < TIMEOUT_SECONDS; i++)); do
    if curl -fsS "http://127.0.0.1:${METRO_PORT}/status" 2>/dev/null | grep -q "packager-status:running"; then
      return 0
    fi
    sleep 1
  done

  echo "Metro failed to become ready within ${TIMEOUT_SECONDS}s."
  return 1
}

ensure_pods() {
  local needs_pod_install=false

  if [[ "${FORCE_POD_INSTALL:-0}" == "1" ]]; then
    needs_pod_install=true
  elif [[ ! -d "$IOS_DIR/Pods" || ! -f "$IOS_DIR/Pods/Manifest.lock" ]]; then
    needs_pod_install=true
  elif [[ ! -f "$WORKSPACE_PATH/contents.xcworkspacedata" ]]; then
    needs_pod_install=true
  elif ! cmp -s "$IOS_DIR/Podfile.lock" "$IOS_DIR/Pods/Manifest.lock"; then
    needs_pod_install=true
  fi

  if [[ "$needs_pod_install" == false ]]; then
    return
  fi

  if ! command -v pod >/dev/null 2>&1; then
    echo "CocoaPods is required but `pod` was not found."
    exit 1
  fi

  echo "Running pod install..."
  (
    cd "$IOS_DIR"
    pod install
  )
}

apply_maccatalyst_patch() {
  local target_file="$ROOT_DIR/node_modules/expo-modules-core/ios/Core/SharedObjects/SharedObject.swift"

  if [[ ! -f "$target_file" ]]; then
    echo "Expected file not found: ${target_file}"
    exit 1
  fi

  if grep -q 'SharedObject.emit is disabled on Mac Catalyst' "$target_file"; then
    return
  fi

  echo "Applying Mac Catalyst patch to expo-modules-core..."
  TARGET_FILE="$target_file" ruby <<'RUBY'
path = ENV.fetch('TARGET_FILE')
text = File.read(path)

needle = "#if swift(>=5.9)\n"
replacement = <<~SWIFT
  #if swift(>=5.9)
  #if targetEnvironment(macCatalyst)
  func emit(event: String, arguments: AnyArgument...) {
    log.warn(\"SharedObject.emit is disabled on Mac Catalyst\")
  }
  #else
SWIFT

unless text.include?(needle)
  warn "Failed to find swift version guard in #{path}"
  exit 1
end

text.sub!(needle, replacement)

tail_needle = "  #else // swift(>=5.9)\n"
tail_replacement = <<~SWIFT
  #endif
  #else // swift(>=5.9)
SWIFT

unless text.include?(tail_needle)
  warn "Failed to find closing swift version guard in #{path}"
  exit 1
end

text.sub!(tail_needle, tail_replacement)
File.write(path, text)
RUBY
}

cleanup() {
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
}
trap cleanup EXIT INT TERM

echo "Installing dependencies..."
(cd "$ROOT_DIR" && npm install)
echo ""

apply_maccatalyst_patch
ensure_pods

if curl -fsS "http://127.0.0.1:${METRO_PORT}/status" 2>/dev/null | grep -q "packager-status:running"; then
  echo "Reusing Metro on :${METRO_PORT}"
else
  echo "Starting Expo Metro on :${METRO_PORT}..."
  (
    cd "$ROOT_DIR"
    npx expo start --dev-client --port "$METRO_PORT" "$@"
  ) &
  METRO_PID="$!"
  PIDS+=($METRO_PID)
  STARTED_METRO=true
fi

wait_for_metro || exit 1

if [[ "${DEV_MACOS_KILL_RUNNING_APP:-1}" != "0" ]]; then
  pkill -x "$APP_NAME" >/dev/null 2>&1 || true
fi

echo ""
echo "Building ${APP_NAME}.app for Mac Catalyst..."
cd "$ROOT_DIR"
xcodebuild \
  -workspace "$WORKSPACE_PATH" \
  -scheme "$SCHEME_NAME" \
  -configuration "$CONFIGURATION" \
  -destination "$DESTINATION" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  build

APP_PATH="$DERIVED_DATA_PATH/Build/Products/${CONFIGURATION}-maccatalyst/${APP_NAME}.app"

if [[ ! -d "$APP_PATH" ]]; then
  echo "Built app not found at: $APP_PATH"
  exit 1
fi

echo ""
echo "Metro:       http://127.0.0.1:${METRO_PORT}"
echo "App:         ${APP_PATH}"
echo ""
echo "Opening ${APP_NAME}.app..."
open "$APP_PATH"
echo "JS/TS changes hot reload through Metro."

if [[ "$STARTED_METRO" == true ]]; then
  wait "$METRO_PID"
fi
