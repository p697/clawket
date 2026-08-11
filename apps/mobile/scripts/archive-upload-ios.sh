#!/bin/bash
# Local iOS archive + TestFlight upload (no EAS).
# Usage: archive-upload-ios.sh [ISSUER_ID]
set -euo pipefail

# Homebrew rsync breaks xcodebuild -exportArchive (-E flag).
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

ISSUER="${1:-69a6de7f-ceb3-47e3-e053-5b8c7c11a4d1}"
KEY_ID="${APP_STORE_CONNECT_API_KEY_ID:-H93L552576}"
KEY_PATH="${APP_STORE_CONNECT_API_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8}"
TEAM="${DEVELOPMENT_TEAM:-5Y7NBCKHJP}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist"
mkdir -p "$OUT"
WORKSPACE="$ROOT/ios/Clawket.xcworkspace"
SCHEME="Clawket"
ARCHIVE="$OUT/Clawket-iOS.xcarchive"
LOG=/tmp/clawket-archive-ios.log

AUTH=(-authenticationKeyID "$KEY_ID" -authenticationKeyIssuerID "$ISSUER" -authenticationKeyPath "$KEY_PATH" -allowProvisioningUpdates -allowProvisioningDeviceRegistration)

{
  echo "=== ARCHIVE ios $(date) ==="
  echo "workspace=$WORKSPACE scheme=$SCHEME team=$TEAM key=$KEY_ID"
  xcodebuild archive \
    -workspace "$WORKSPACE" \
    -scheme "$SCHEME" \
    -destination "generic/platform=iOS" \
    -archivePath "$ARCHIVE" \
    -configuration Release \
    DEVELOPMENT_TEAM="$TEAM" \
    CODE_SIGN_STYLE=Automatic \
    PROVISIONING_PROFILE_SPECIFIER="" \
    "${AUTH[@]}"

  echo "=== EXPORT+UPLOAD ios $(date) ==="
  cat > "$OUT/export-ios.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>destination</key>
	<string>upload</string>
	<key>teamID</key>
	<string>$TEAM</string>
	<key>uploadSymbols</key>
	<true/>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>manageAppVersionAndBuildNumber</key>
	<false/>
</dict>
</plist>
PLIST

  xcodebuild -exportArchive \
    -archivePath "$ARCHIVE" \
    -exportOptionsPlist "$OUT/export-ios.plist" \
    -exportPath "$OUT/export-ios" \
    "${AUTH[@]}"

  echo "=== DONE ios ==="
} >"$LOG" 2>&1
ec=$?
echo "EXIT:$ec" >>"$LOG"
exit $ec
