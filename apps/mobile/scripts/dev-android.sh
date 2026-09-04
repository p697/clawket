#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
METRO_PORT="${METRO_PORT:-8081}"

usage() {
  cat <<'EOF'
Usage:
  npm run dev:android [-- expo start args]

Starts the Android real-device dev stack:
  - adb reverse for the Metro port
  - Expo Metro bundler

Examples:
  npm run dev:android
  ANDROID_SERIAL=9a7c8276 npm run dev:android
  npm run dev:android -- --clear
  npm run dev:android -- --tunnel

Environment variables:
  ANDROID_SERIAL                     Specific Android device serial to use.
  METRO_PORT                        Metro port (default: 8081).
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

resolve_adb() {
  if [[ -n "${ANDROID_HOME:-}" && -x "${ANDROID_HOME}/platform-tools/adb" ]]; then
    echo "${ANDROID_HOME}/platform-tools/adb"
    return
  fi

  if command -v adb >/dev/null 2>&1; then
    command -v adb
    return
  fi

  local default_adb="/opt/homebrew/share/android-commandlinetools/platform-tools/adb"
  if [[ -x "$default_adb" ]]; then
    echo "$default_adb"
    return
  fi

  echo ""
}

setup_reverse() {
  local adb_bin="$1"
  local device="$2"

  echo "Configuring adb reverse for ${device}..."
  "$adb_bin" -s "$device" reverse "tcp:${METRO_PORT}" "tcp:${METRO_PORT}"
  echo "  tcp:${METRO_PORT} -> tcp:${METRO_PORT}"
}

resolve_device() {
  local adb_bin="$1"

  if [[ -n "${ANDROID_SERIAL:-}" ]]; then
    local explicit_state
    explicit_state="$("$adb_bin" devices | awk -v serial="$ANDROID_SERIAL" '$1 == serial { print $2 }')"
    if [[ "$explicit_state" == "device" ]]; then
      echo "$ANDROID_SERIAL"
      return
    fi

    echo "Requested ANDROID_SERIAL=${ANDROID_SERIAL}, but that device is not available." >&2
    exit 1
  fi

  local devices=()
  local serial
  while IFS= read -r serial; do
    [[ -n "$serial" ]] || continue
    devices+=("$serial")
  done < <("$adb_bin" devices | awk 'NR > 1 && $2 == "device" { print $1 }')

  if [[ "${#devices[@]}" -eq 0 ]]; then
    echo ""
    return
  fi

  if [[ "${#devices[@]}" -eq 1 ]]; then
    echo "${devices[0]}"
    return
  fi

  for serial in "${devices[@]}"; do
    if [[ "$serial" != 00000000_* ]]; then
      echo "$serial"
      return
    fi
  done

  echo "${devices[0]}"
}

ADB="$(resolve_adb)"
if [[ -z "$ADB" ]]; then
  echo "Failed to find adb."
  echo "Install Android platform-tools or set ANDROID_HOME."
  exit 1
fi

export PATH="$(dirname "$ADB"):$PATH"

echo "Installing dependencies..."
(cd "$ROOT_DIR" && npm install --workspaces=false)
echo ""

DEVICE="$(resolve_device "$ADB")"
if [[ -z "$DEVICE" ]]; then
  echo ""
  echo "No Android device detected."
  echo "Connect your phone, enable USB debugging, then run:"
  echo "  adb reverse tcp:${METRO_PORT} tcp:${METRO_PORT}"
  exit 1
fi

echo ""
echo "Device:        ${DEVICE}"
echo ""

setup_reverse "$ADB" "$DEVICE"

echo ""
echo "Starting Expo Metro on :${METRO_PORT}..."
echo "Open the installed Android debug app manually."
echo "JS/TS changes hot reload through Metro."
cd "$ROOT_DIR"
npx expo start --port "$METRO_PORT" "$@"
