# macOS App Store Submission

> macOS and Mac Catalyst remain outside the Clawket 3.0 release scope. The scripts and this future release checklist are retained but are not part of 3.0 acceptance.

This document describes the remaining steps to submit the Mac Catalyst version of Clawket to the Mac App Store without changing the existing iOS shipping path.

## Current State

The repository now has a dedicated Mac Catalyst submission chain:

```bash
npm run build:macos
npm run archive:macos
npm run export:macos
```

Important boundaries:

- iOS still uses `ios/Clawket/Clawket.entitlements`.
- Mac Catalyst uses `ios/Clawket/Clawket.maccatalyst.entitlements`.
- The share extension target is now iOS-only and excluded from Mac Catalyst.
- Widget code has been removed from both iOS and macOS paths.

## What You Need Before Submission

Before a real signed Mac App Store archive can succeed, this machine needs:

1. An `Apple Distribution` certificate in the login keychain.
2. Working signing for your Apple Developer team.
3. Xcode logged into the correct Apple Developer account, or an App Store Connect API key.
4. A macOS platform added to the existing app record in App Store Connect.

You can verify that with:

```bash
security find-identity -v -p codesigning
```

## App Store Connect Setup

In App Store Connect:

1. Open the existing Clawket app.
2. Click `Add Platform`.
3. Add `macOS`.
4. Keep the same bundle ID: `com.p697.clawket`.
5. Fill in macOS-specific metadata:
   - description
   - promotional text
   - screenshots
   - app review notes

Official references:

- [Add platforms](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-platforms)
- [Create a Mac version of an iPad app](https://developer.apple.com/help/account/capabilities/create-a-mac-version-of-an-ipad-app/)
- [Upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds)

## Local Signing Setup

You have two workable paths.

### Option A: Xcode account-based signing

Use this when building locally from Xcode or shell on your Mac:

1. Open Xcode.
2. Go to `Settings` -> `Accounts`.
3. Sign into the Apple Developer account that owns the app.
4. Make sure Xcode can access the `Apple Distribution` certificate.
5. If Xcode asks to manage signing assets, allow it.

### Option B: App Store Connect API key

Use this when you want command-line or CI-friendly auth:

1. Create an App Store Connect API key.
2. Save the `.p8` file locally.
3. Export these environment variables before archive/export:

```bash
export APP_STORE_CONNECT_API_KEY_PATH="/absolute/path/to/AuthKey_XXXX.p8"
export APP_STORE_CONNECT_API_KEY_ID="XXXX"
export APP_STORE_CONNECT_API_ISSUER_ID="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
```

The scripts already support those variables.

## Exact Command Flow

### 1. Unsigned validation build

Use this first to verify the Mac pipeline itself:

```bash
npm run build:macos
npm run archive:macos
```

This does not require distribution signing.

### 2. Signed archive

Once `Apple Distribution` exists on the machine:

```bash
MACOS_ALLOW_SIGNING=1 \
MACOS_ALLOW_PROVISIONING_UPDATES=1 \
npm run archive:macos
```

If you are using an App Store Connect API key, add:

```bash
APP_STORE_CONNECT_API_KEY_PATH="/absolute/path/to/AuthKey_XXXX.p8" \
APP_STORE_CONNECT_API_KEY_ID="XXXX" \
APP_STORE_CONNECT_API_ISSUER_ID="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX" \
MACOS_ALLOW_SIGNING=1 \
MACOS_ALLOW_PROVISIONING_UPDATES=1 \
npm run archive:macos
```

Expected artifact:

```bash
/tmp/Clawket-mac-release.xcarchive
```

### 3. Export or upload

After a signed archive exists:

```bash
MACOS_ALLOW_PROVISIONING_UPDATES=1 \
npm run export:macos
```

Or with API-key auth:

```bash
APP_STORE_CONNECT_API_KEY_PATH="/absolute/path/to/AuthKey_XXXX.p8" \
APP_STORE_CONNECT_API_KEY_ID="XXXX" \
APP_STORE_CONNECT_API_ISSUER_ID="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX" \
MACOS_ALLOW_PROVISIONING_UPDATES=1 \
npm run export:macos
```

The export uses:

- `ios/ExportOptions-macos-appstore.plist`

That plist is configured for:

- `method = app-store-connect`
- `destination = upload`
- automatic signing
- your Apple Developer team

## If You Prefer Xcode Organizer

You can also use Xcode after the archive step:

1. Open Xcode Organizer.
2. Select the Mac Catalyst archive.
3. Click `Distribute App`.
4. Choose `App Store Connect`.
5. Follow the signing and upload prompts.

This is still a valid path if command-line export hits signing edge cases.

## What You Do Not Need

- Do not run `npx expo prebuild` for normal submission work.
- Do not add Widget targets back.
- Do not change the iOS entitlements file for Mac submission work.

## Known Temporary Workaround

Mac Catalyst still depends on a local `expo-modules-core` patch in `node_modules`.

The scripts automatically reapply it after `npm install`, but this is not a clean upstream fix. If the Expo or React Native dependency graph changes, revalidate:

```bash
npm run build:macos
```

## Recommended Next Action

The next external action is:

1. Install or make available an `Apple Distribution` certificate for your Apple Developer team.
2. Add the `macOS` platform in App Store Connect for `com.p697.clawket`.
3. Run:

```bash
MACOS_ALLOW_SIGNING=1 \
MACOS_ALLOW_PROVISIONING_UPDATES=1 \
npm run archive:macos
```

4. If the archive succeeds, run:

```bash
MACOS_ALLOW_PROVISIONING_UPDATES=1 \
npm run export:macos
```

5. If export/upload fails, use the exact Xcode or App Store Connect error as the next debugging input.
