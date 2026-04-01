#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ARCHIVE_PATH="${MACOS_ARCHIVE_PATH:-/tmp/Clawket-mac-release.xcarchive}"
EXPORT_PATH="${MACOS_EXPORT_PATH:-/tmp/Clawket-mac-export}"
EXPORT_OPTIONS_PLIST="${MACOS_EXPORT_OPTIONS_PLIST:-$ROOT_DIR/ios/ExportOptions-macos-appstore.plist}"
ALLOW_PROVISIONING_UPDATES="${MACOS_ALLOW_PROVISIONING_UPDATES:-0}"
AUTH_KEY_PATH="${APP_STORE_CONNECT_API_KEY_PATH:-}"
AUTH_KEY_ID="${APP_STORE_CONNECT_API_KEY_ID:-}"
AUTH_ISSUER_ID="${APP_STORE_CONNECT_API_ISSUER_ID:-}"

usage() {
  cat <<'EOF'
Usage:
  pnpm export:macos

Exports/uploads a signed Mac Catalyst archive using xcodebuild -exportArchive.

Environment variables:
  MACOS_ARCHIVE_PATH                Archive path (default: /tmp/Clawket-mac-release.xcarchive).
  MACOS_EXPORT_PATH                 Export path (default: /tmp/Clawket-mac-export).
  MACOS_EXPORT_OPTIONS_PLIST        Export options plist path.
  MACOS_ALLOW_PROVISIONING_UPDATES  Set to 1 to pass -allowProvisioningUpdates.
  APP_STORE_CONNECT_API_KEY_PATH    App Store Connect API key path for xcodebuild auth.
  APP_STORE_CONNECT_API_KEY_ID      App Store Connect API key ID.
  APP_STORE_CONNECT_API_ISSUER_ID   App Store Connect issuer ID.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ ! -d "$ARCHIVE_PATH" ]]; then
  echo "Archive not found: ${ARCHIVE_PATH}"
  echo "Run MACOS_ALLOW_SIGNING=1 pnpm archive:macos first."
  exit 1
fi

if [[ ! -f "$EXPORT_OPTIONS_PLIST" ]]; then
  echo "Export options plist not found: ${EXPORT_OPTIONS_PLIST}"
  exit 1
fi

XCODE_ARGS=(
  -exportArchive
  -archivePath "$ARCHIVE_PATH"
  -exportPath "$EXPORT_PATH"
  -exportOptionsPlist "$EXPORT_OPTIONS_PLIST"
)

if [[ "$ALLOW_PROVISIONING_UPDATES" == "1" ]]; then
  XCODE_ARGS+=(-allowProvisioningUpdates)
fi

if [[ -n "$AUTH_KEY_PATH" || -n "$AUTH_KEY_ID" || -n "$AUTH_ISSUER_ID" ]]; then
  if [[ -z "$AUTH_KEY_PATH" || -z "$AUTH_KEY_ID" || -z "$AUTH_ISSUER_ID" ]]; then
    echo "APP_STORE_CONNECT_API_KEY_PATH, APP_STORE_CONNECT_API_KEY_ID, and APP_STORE_CONNECT_API_ISSUER_ID must all be set together."
    exit 1
  fi
  XCODE_ARGS+=(
    -authenticationKeyPath "$AUTH_KEY_PATH"
    -authenticationKeyID "$AUTH_KEY_ID"
    -authenticationKeyIssuerID "$AUTH_ISSUER_ID"
  )
fi

echo "Exporting Mac Catalyst archive..."
xcodebuild "${XCODE_ARGS[@]}"

echo "Export path: ${EXPORT_PATH}"
