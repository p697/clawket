#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OFFICE_GAME_DIR="$ROOT_DIR/office-game"
HOST="${DEV_HOST:-0.0.0.0}"
METRO_PORT="${METRO_PORT:-8081}"
OFFICE_PORT="${OFFICE_DEV_PORT:-5174}"
TIMEOUT_SECONDS="${WEBVIEW_BOOT_TIMEOUT_SECONDS:-25}"
PIDS=()

usage() {
  cat <<'EOF'
Usage:
  npm run dev:android [-- expo start args]

Starts the Android real-device dev stack:
  - office-game Vite dev server
  - adb reverse for Metro and Office ports
  - Expo Metro bundler

Examples:
  npm run dev:android
  ANDROID_SERIAL=9a7c8276 npm run dev:android
  npm run dev:android -- --clear
  npm run dev:android -- --tunnel

Environment variables:
  ANDROID_SERIAL                     Specific Android device serial to use.
  DEV_HOST                          Dev server bind host (default: 0.0.0.0).
  METRO_PORT                        Metro port (default: 8081).
  OFFICE_DEV_PORT                   Office dev server port (default: 5174).
  WEBVIEW_BOOT_TIMEOUT_SECONDS      Wait time for Vite readiness (default: 25).
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

kill_port_listener() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    return
  fi

  echo "Cleaning existing listeners on port ${port}: ${pids}"
  kill $pids >/dev/null 2>&1 || true

  sleep 0.6
  local remaining
  remaining="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$remaining" ]]; then
    echo "Force killing remaining listeners on port ${port}: ${remaining}"
    kill -9 $remaining >/dev/null 2>&1 || true
  fi
}

wait_for_server() {
  local port="$1"
  local name="$2"
  echo "Waiting for ${name} on :${port}..."
  for ((i = 0; i < TIMEOUT_SECONDS; i++)); do
    if curl -fsS "http://127.0.0.1:${port}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "${name} failed to become ready within ${TIMEOUT_SECONDS}s."
  return 1
}

setup_reverse() {
  local adb_bin="$1"
  local device="$2"

  echo "Configuring adb reverse for ${device}..."
  "$adb_bin" -s "$device" reverse "tcp:${METRO_PORT}" "tcp:${METRO_PORT}"
  "$adb_bin" -s "$device" reverse "tcp:${OFFICE_PORT}" "tcp:${OFFICE_PORT}"
  echo "  tcp:${METRO_PORT} -> tcp:${METRO_PORT}"
  echo "  tcp:${OFFICE_PORT} -> tcp:${OFFICE_PORT}"
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
(cd "$OFFICE_GAME_DIR" && npm install)
echo ""

kill_port_listener "$OFFICE_PORT"

cleanup() {
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
  kill_port_listener "$OFFICE_PORT"
}
trap cleanup EXIT INT TERM

echo "Starting office-game dev server (:${OFFICE_PORT})..."
(
  cd "$OFFICE_GAME_DIR"
  npm run dev -- --host "$HOST" --port "$OFFICE_PORT" --strictPort
) &
PIDS+=($!)

wait_for_server "$OFFICE_PORT" "office-game" || exit 1

DEVICE="$(resolve_device "$ADB")"
if [[ -z "$DEVICE" ]]; then
  echo ""
  echo "No Android device detected."
  echo "Connect your phone, enable USB debugging, then run:"
  echo "  adb reverse tcp:${METRO_PORT} tcp:${METRO_PORT}"
  echo "  adb reverse tcp:${OFFICE_PORT} tcp:${OFFICE_PORT}"
  exit 1
fi

echo ""
echo "Device:        ${DEVICE}"
echo "Office Game:   http://127.0.0.1:${OFFICE_PORT} (via adb reverse)"
echo ""

setup_reverse "$ADB" "$DEVICE"

echo ""
echo "Starting Expo Metro on :${METRO_PORT}..."
echo "Open the installed Android debug app manually."
echo "JS/TS changes hot reload through Metro; Office changes hot reload through Vite."
cd "$ROOT_DIR"
npx expo start --port "$METRO_PORT" "$@"
