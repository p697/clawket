#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IOS_DIR="$ROOT_DIR/ios"
WORKSPACE_PATH="$IOS_DIR/Clawket.xcworkspace"

usage() {
  cat <<'EOF'
Usage:
  npm run dev [-- expo run:ios args]

Opens Expo's iOS device picker by default.
Pass explicit expo run:ios args to keep full control.

Examples:
  npm run dev
  npm run dev -- --configuration Release
  npm run dev -- --device "DEVICE_ID"

Environment variables:
  FORCE_POD_INSTALL                 Set to 1 to force `pod install`.
  CLAWKET_IOS_DEV_UNIVERSAL_LINKS   Set to 1 to require Associated Domains in Debug builds.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

has_newer_native_manifests() {
  if [[ ! -f "$IOS_DIR/Podfile.lock" ]]; then
    return 0
  fi

  local newer_manifest=""
  newer_manifest="$(
    find "$ROOT_DIR/node_modules" "$ROOT_DIR/modules" \
      -type f \
      \( -name '*.podspec' -o -name '*.podspec.json' -o -name 'expo-module.config.json' \) \
      -newer "$IOS_DIR/Podfile.lock" \
      -print \
      -quit 2>/dev/null || true
  )"

  [[ -n "$newer_manifest" ]]
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
  elif has_newer_native_manifests; then
    needs_pod_install=true
  fi

  if [[ "$needs_pod_install" == false ]]; then
    return
  fi

  if ! command -v pod >/dev/null 2>&1; then
    echo "CocoaPods is required but \`pod\` was not found."
    exit 1
  fi

  echo "Running pod install..."
  (
    cd "$IOS_DIR"
    pod install
  )
}

# ---- Install dependencies ----

echo "Installing dependencies..."
(cd "$ROOT_DIR" && npm install --workspaces=false)
ensure_pods
echo ""

# ---- Start Expo ----

if [[ "${CLAWKET_IOS_DEV_UNIVERSAL_LINKS:-0}" != "1" ]]; then
  node "$ROOT_DIR/scripts/prepare-ios-debug-entitlements.mjs"
fi

has_explicit_device_arg=false
if [[ $# -gt 0 ]]; then
  for arg in "$@"; do
    if [[ "$arg" == "--device" || "$arg" == "-d" || "$arg" == --device=* ]]; then
      has_explicit_device_arg=true
      break
    fi
  done
fi

if [[ "$has_explicit_device_arg" == false ]]; then
  echo "Opening Expo device picker..."
  set -- --device "$@"
fi

echo "Starting Expo iOS..."
cd "$ROOT_DIR"
npx expo run:ios "$@"
