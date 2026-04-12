#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IOS_DIR="$ROOT_DIR/ios"
WORKSPACE_PATH="$IOS_DIR/Clawket.xcworkspace"
SCHEME_NAME="${MACOS_SCHEME:-Clawket}"
CONFIGURATION="${MACOS_CONFIGURATION:-Release}"
DESTINATION="${MACOS_DESTINATION:-platform=macOS,variant=Mac Catalyst}"
ARCHIVE_PATH="${MACOS_ARCHIVE_PATH:-/tmp/Clawket-mac-release.xcarchive}"
ALLOW_SIGNING="${MACOS_ALLOW_SIGNING:-0}"
ALLOW_PROVISIONING_UPDATES="${MACOS_ALLOW_PROVISIONING_UPDATES:-0}"
AUTH_KEY_PATH="${APP_STORE_CONNECT_API_KEY_PATH:-}"
AUTH_KEY_ID="${APP_STORE_CONNECT_API_KEY_ID:-}"
AUTH_ISSUER_ID="${APP_STORE_CONNECT_API_ISSUER_ID:-}"

usage() {
  cat <<'EOF'
Usage:
  npm run archive:macos

Archives the Mac Catalyst app for distribution.

Environment variables:
  MACOS_SCHEME               Xcode scheme (default: Clawket).
  MACOS_CONFIGURATION        Xcode configuration (default: Release).
  MACOS_DESTINATION          xcodebuild destination (default: platform=macOS,variant=Mac Catalyst).
  MACOS_ARCHIVE_PATH         Archive path (default: /tmp/Clawket-mac-release.xcarchive).
  MACOS_ALLOW_SIGNING        Set to 1 to allow code signing.
  MACOS_ALLOW_PROVISIONING_UPDATES Set to 1 to pass -allowProvisioningUpdates.
  APP_STORE_CONNECT_API_KEY_PATH   App Store Connect API key path for xcodebuild auth.
  APP_STORE_CONNECT_API_KEY_ID     App Store Connect API key ID.
  APP_STORE_CONNECT_API_ISSUER_ID  App Store Connect issuer ID.
  FORCE_POD_INSTALL          Set to 1 to force `pod install`.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

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

ensure_distribution_identity() {
  if [[ "$ALLOW_SIGNING" != "1" ]]; then
    return
  fi

  if security find-identity -v -p codesigning 2>/dev/null | grep -q 'Apple Distribution:'; then
    return
  fi

  echo "No Apple Distribution signing identity was found."
  echo "Install the distribution certificate/profile first, or run with MACOS_ALLOW_SIGNING=0."
  exit 1
}

resolve_destination() {
  if [[ -n "${MACOS_DESTINATION:-}" ]]; then
    echo "$MACOS_DESTINATION"
    return
  fi

  local destinations
  destinations="$(xcodebuild -workspace "$WORKSPACE_PATH" -scheme "$SCHEME_NAME" -showdestinations 2>/dev/null || true)"

  if printf '%s\n' "$destinations" | grep -Fq "{ platform:macOS, variant:Mac Catalyst"; then
    echo "$DESTINATION"
    return
  fi

  local mac_id
  mac_id="$(printf '%s\n' "$destinations" | sed -n '/platform:macOS/s/.*id:\([^,}]*\).*/\1/p' | head -n 1 | tr -d ' ')"
  if [[ -n "$mac_id" ]]; then
    echo "id=${mac_id}"
    return
  fi

  echo "$DESTINATION"
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

apply_react_native_jsi_patch() {
  local target_file="$ROOT_DIR/node_modules/react-native/ReactCommon/jsi/jsi/jsi.h"

  if [[ ! -f "$target_file" ]]; then
    echo "Expected file not found: ${target_file}"
    exit 1
  fi

  if grep -Fq 'const_cast<char *>(buffer.data())' "$target_file"; then
    return
  fi

  echo "Applying React Native JSI SDK compatibility patch..."
  TARGET_FILE="$target_file" ruby <<'RUBY'
path = ENV.fetch('TARGET_FILE')
text = File.read(path)
needle = "        buffer.data(),\n"
replacement = "        const_cast<char *>(buffer.data()),\n"

unless text.include?(needle)
  warn "Failed to find JSI buffer.data() call in #{path}"
  exit 1
end

text.sub!(needle, replacement)
File.write(path, text)
RUBY
}

echo "Installing dependencies..."
(cd "$ROOT_DIR" && npm install)

apply_maccatalyst_patch
apply_react_native_jsi_patch
ensure_pods
ensure_distribution_identity

cd "$ROOT_DIR"

RESOLVED_DESTINATION="$(resolve_destination)"

XCODE_ARGS=(
  -workspace "$WORKSPACE_PATH"
  -scheme "$SCHEME_NAME"
  -configuration "$CONFIGURATION"
  -destination "$RESOLVED_DESTINATION"
  -archivePath "$ARCHIVE_PATH"
  archive
)

if [[ "$ALLOW_SIGNING" != "1" ]]; then
  XCODE_ARGS+=(
    CODE_SIGNING_ALLOWED=NO
    CODE_SIGNING_REQUIRED=NO
  )
fi

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

echo "Archiving Mac Catalyst app..."
echo "Using destination: ${RESOLVED_DESTINATION}"
xcodebuild "${XCODE_ARGS[@]}"

echo "Archive: ${ARCHIVE_PATH}"
