#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_RUNNER="${NODE_BINARY:-$(command -v node)}"
PROFILE="${EAS_BUILD_PROFILE:-}"
PLATFORM="${EAS_BUILD_PLATFORM:-}"

if [[ -z "$NODE_RUNNER" ]]; then
  echo "error: node was not found in PATH." >&2
  exit 1
fi

if [[ "$PLATFORM" != "android" && "$PLATFORM" != "ios" ]]; then
  exit 0
fi

cd "$APP_ROOT"

case "$PROFILE" in
  production|testflight)
    CLAWKET_OFFICIAL_BUILD=1 "$NODE_RUNNER" scripts/check-public-config.mjs "--platform=$PLATFORM"
    ;;
  *)
    "$NODE_RUNNER" scripts/check-public-config.mjs "--platform=$PLATFORM"
    ;;
esac
