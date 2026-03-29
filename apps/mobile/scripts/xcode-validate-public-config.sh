#!/usr/bin/env bash
set -euo pipefail

IOS_ROOT="${PROJECT_DIR:-$(cd "$(dirname "$0")/../ios" && pwd)}"
APP_ROOT="$(cd "$IOS_ROOT/.." && pwd)"

if [[ -f "$IOS_ROOT/.xcode.env" ]]; then
  # shellcheck disable=SC1091
  source "$IOS_ROOT/.xcode.env"
fi

if [[ -f "$IOS_ROOT/.xcode.env.local" ]]; then
  # shellcheck disable=SC1091
  source "$IOS_ROOT/.xcode.env.local"
fi

NODE_RUNNER="${NODE_BINARY:-$(command -v node)}"

if [[ -z "$NODE_RUNNER" ]]; then
  echo "error: NODE_BINARY is not configured and node was not found in PATH." >&2
  exit 1
fi

cd "$APP_ROOT"
if [[ "${CONFIGURATION:-}" == *Debug* ]]; then
  exit 0
fi

CLAWKET_REQUIRE_POSTHOG=1 CLAWKET_REQUIRE_REVENUECAT=1 "$NODE_RUNNER" scripts/check-public-config.mjs --platform=ios
