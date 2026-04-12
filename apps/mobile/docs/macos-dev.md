# macOS Dev

Use the Mac Catalyst development script:

```bash
npm run dev:macos
```

What it does:

- Runs `npm install` in the app and `office-game`.
- Reapplies the local `expo-modules-core` Mac Catalyst patch if `npm install` overwrote it.
- Runs `pod install` only when CocoaPods is missing or out of sync. Set `FORCE_POD_INSTALL=1` to force it.
- Starts the `office-game` Vite server.
- Starts Expo Metro in dev-client mode.
- Builds the Mac Catalyst Debug app with `xcodebuild`.
- Opens the built `.app`.

Notes:

- You do not need to run `npx expo prebuild` for normal macOS development. This repo already has a native `ios` project and local Catalyst changes. Running `prebuild` can overwrite local native work.
- You do not need to run `pod install` before every launch. The script checks whether Pods are missing or out of sync and runs it when needed.
- If you change native iOS dependencies or manually edit the `ios` project, rerun `npm run dev:macos`. If Pods are still in sync but you want a clean refresh, run `FORCE_POD_INSTALL=1 npm run dev:macos`.
- The built app goes to `/tmp/clawket-mac-dev/Build/Products/Debug-maccatalyst/Clawket.app` by default.
- If Metro is already running on port `8081`, the script reuses it.
- The release/build scripts now auto-fallback to the first available macOS destination if `platform=macOS,variant=Mac Catalyst` is not exposed by the current Xcode toolchain on this machine.

Useful variants:

```bash
npm run dev:macos -- --clear
FORCE_POD_INSTALL=1 npm run dev:macos
METRO_PORT=8088 npm run dev:macos
MACOS_DERIVED_DATA_PATH=/tmp/clawket-mac-alt npm run dev:macos
```

Release build and archive:

```bash
npm run build:macos
npm run archive:macos
npm run export:macos
```

Signing notes:

- By default, `build:macos` and `archive:macos` run with signing disabled so you can validate the pipeline without App Store certificates.
- To attempt a real signed build or archive on a machine that already has the right Apple certificates and provisioning set up, use:

```bash
MACOS_ALLOW_SIGNING=1 npm run build:macos
MACOS_ALLOW_SIGNING=1 npm run archive:macos
```

- For App Store submission, the final archive must be signed correctly in Xcode or via `xcodebuild` with the right team, distribution certificate, and release entitlements.
- The macOS archive path now uses a Mac-only entitlements file so App Sandbox and outbound network access are configured for Catalyst without changing the iOS entitlements path.
- The current project still uses a local `expo-modules-core` Mac Catalyst patch. The scripts reapply it automatically after `npm install`, but this is still a temporary engineering workaround rather than a clean upstream fix.
- `export:macos` uses `ios/ExportOptions-macos-appstore.plist` and expects a signed archive from `MACOS_ALLOW_SIGNING=1 npm run archive:macos`.
