#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OFFICE_GAME_DIR="$ROOT_DIR/office-game"
HOST="${DEV_HOST:-0.0.0.0}"
OFFICE_PORT="${OFFICE_DEV_PORT:-5174}"
TIMEOUT_SECONDS="${WEBVIEW_BOOT_TIMEOUT_SECONDS:-25}"
PIDS=()

usage() {
  cat <<'EOF'
Usage:
  pnpm dev [-- expo run:ios args]

Opens Expo's iOS device picker by default.
Pass explicit expo run:ios args to keep full control.

Examples:
  pnpm dev
  pnpm dev -- --configuration Release
  pnpm dev -- --device "DEVICE_ID"

Environment variables:
  OFFICE_DEV_PORT                   Office dev server port (default: 5174).
  DEV_HOST                          Dev server bind host (default: 0.0.0.0).
  WEBVIEW_BOOT_TIMEOUT_SECONDS      Wait time for Vite readiness (default: 25).
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

find_wifi_interface() {
  local iface=""
  iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}' || true)"
  if [[ -n "$iface" ]]; then
    echo "$iface"
    return
  fi

  iface="$(networksetup -listallhardwareports 2>/dev/null | awk '
    BEGIN { is_wifi = 0 }
    /^Hardware Port: (Wi-Fi|AirPort)$/ { is_wifi = 1; next }
    /^Hardware Port:/ { is_wifi = 0 }
    is_wifi && /^Device:/ { print $2; exit }
  ' || true)"
  echo "$iface"
}

find_wifi_ip() {
  local iface="$1"
  if [[ -z "$iface" ]]; then
    return
  fi
  ipconfig getifaddr "$iface" 2>/dev/null || true
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

# ---- Install dependencies ----

echo "Installing dependencies..."
(cd "$ROOT_DIR" && pnpm install --workspaces=false)
(cd "$OFFICE_GAME_DIR" && pnpm install)
echo ""

# ---- Detect network ----

WEBVIEW_IFACE="$(find_wifi_interface)"
WEBVIEW_IP="$(find_wifi_ip "$WEBVIEW_IFACE")"

if [[ -z "$WEBVIEW_IP" ]]; then
  echo "Failed to detect a WiFi IP address."
  echo "Set EXPO_PUBLIC_OFFICE_DEV_URL manually and retry."
  exit 1
fi

export EXPO_PUBLIC_OFFICE_DEV_URL="http://${WEBVIEW_IP}:${OFFICE_PORT}"

echo "Detected interface: ${WEBVIEW_IFACE}"
echo "Detected WiFi IP:   ${WEBVIEW_IP}"
echo ""

# ---- Clean ports ----

kill_port_listener "$OFFICE_PORT"

# ---- Start dev servers ----

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
  pnpm dev -- --host "$HOST" --port "$OFFICE_PORT" --strictPort
) &
PIDS+=($!)

# ---- Wait for server ----

wait_for_server "$OFFICE_PORT" "office-game" || exit 1

echo ""
echo "Office Game:   ${EXPO_PUBLIC_OFFICE_DEV_URL}"
echo ""

# ---- Start Expo ----

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
