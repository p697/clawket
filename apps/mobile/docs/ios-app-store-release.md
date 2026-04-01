# iOS App Store Release Checklist

This document tracks the local Xcode release process and App Store Connect items needed to ship Clawket with RevenueCat-powered subscriptions.

## Current App Identifiers

- App name: `Clawket`
- Bundle ID: `com.p697.clawket`
- Apple Team ID: keep local to the release environment
- App Store Connect app ID: keep local to the release environment
- RevenueCat entitlement: `Clawket Pro`
- RevenueCat offering: `default`
- RevenueCat packages:
  - `$rc_monthly`
  - `$rc_annual`
- App Store subscription group: `Clawket Pro`
- App Store products:
  - `com.p697.clawket.pro.monthly`
  - `com.p697.clawket.pro.yearly`

## 1. App Store Connect Checklist

### Account and agreement

- [ ] `Paid Applications Agreement` is active
- [ ] Banking is configured
- [ ] Tax forms are configured

### Subscription products

- [ ] `Clawket Pro Monthly` is configured
- [ ] `Clawket Pro Yearly` is configured
- [ ] Both are in the same subscription group: `Clawket Pro`
- [ ] Both have pricing configured
- [ ] Both have required localizations
- [ ] Both have a review screenshot
- [ ] Both are attached to the app version that will be submitted for review

### App metadata

- [ ] App privacy answers are complete
- [ ] Age rating is complete
- [ ] Export compliance is configured in `Info.plist` via `ITSAppUsesNonExemptEncryption = NO`
- [ ] Sign-in / demo / review notes are complete if needed
- [ ] Support URL is valid
- [ ] Marketing URL is valid if you use one
- [ ] Release notes / "What's New" text is ready

## 2. RevenueCat Checklist

- [ ] App Store app exists in RevenueCat
- [ ] In-App Purchase Key is uploaded
- [ ] App Store Connect API Key is uploaded
- [ ] `default` offering uses:
  - [ ] `$rc_monthly` -> `com.p697.clawket.pro.monthly`
  - [ ] `$rc_annual` -> `com.p697.clawket.pro.yearly`
- [ ] `Clawket Pro` entitlement is attached to both products
- [ ] No app build is using `EXPO_PUBLIC_REVENUECAT_TEST_API_KEY`

## 3. Local Build Environment Checklist

- [ ] Start from `.env.example` for local env shape
- [ ] `pnpm run config:check:ios` passes
- [ ] `.env.local` or local shell environment contains `EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY`
- [ ] `.env.local` or local shell environment contains `EXPO_PUBLIC_REVENUECAT_PRO_ENTITLEMENT_ID=Clawket Pro`
- [ ] `.env.local` or local shell environment contains `EXPO_PUBLIC_REVENUECAT_PRO_OFFERING_ID=default`
- [ ] `EXPO_PUBLIC_REVENUECAT_TEST_API_KEY` is not set for TestFlight / production
- [ ] `EXPO_PUBLIC_UNLOCK_PRO` is not set for TestFlight / production
- [ ] `ios/.xcode.env` still contains the generated env-source block for `.env` and `.env.local`
- [ ] Xcode is signed into the Apple Developer account that owns the app
- [ ] The correct team is selected for the `Clawket` target
- [ ] A valid iOS Distribution or Apple Distribution signing identity is available on this Mac

### When Adding A New Mobile Environment Variable

Use this checklist in the same PR:

- [ ] Add the key to `apps/mobile/.env.example`
- [ ] If React Native client code reads it, use the `EXPO_PUBLIC_*` prefix
- [ ] Wire it through `src/config/public.ts` or another shared config module
- [ ] Update `scripts/check-public-config.mjs` if release validation should enforce it
- [ ] Update this release checklist if the new variable is required for TestFlight or App Store builds
- [ ] Re-run `pnpm run config:check:ios` before archiving

## 4. Pre-Build Commands

Build the WebView assets before any release or TestFlight build:

```bash
cd office-game && pnpm run build && cd ..
```

Optional validation:

```bash
pnpm dlx tsc --noEmit
pnpm test -- --runInBand
```

## 5. Refresh Native Project If Needed

If Expo config, plugins, permissions, bundle identifiers, or other managed native settings changed since the last iOS release build, refresh the iOS native project before archiving:

```bash
pnpm dlx expo prebuild --platform ios
```

If the native iOS project is already up to date and no Expo-managed native config changed, you can skip this step.

## 6. Open Xcode Workspace

Open:

- `ios/Clawket.xcworkspace`

Before archiving, verify:

- signing is correct for the main app target
- the selected scheme is `Clawket`
- the selected destination is `Any iOS Device (arm64)`
- the marketing version and build number match the release you intend to upload

## 7. Archive In Xcode

Use Xcode:

1. `Product` -> `Archive`
2. Wait for Organizer to open
3. Select the new archive
4. Click `Distribute App`
5. Choose `App Store Connect`
6. Choose `Upload`
7. Keep the default validation and upload options unless this release needs a specific override
8. Complete the upload

If Xcode reports signing or capability issues, fix them locally before retrying the archive.

## 8. Upload Targets

### TestFlight upload

Use the local archive flow above, then distribute the uploaded build to internal or external testers from App Store Connect.

### Final App Review build

Use the same local archive and upload flow, then attach the uploaded build to the app version you submit for review in App Store Connect.

## 9. TestFlight Validation Checklist

Before submitting to App Review, verify on a TestFlight or store-distribution build:

- [ ] Free user sees the Pro paywall at the correct gated entry points
- [ ] Monthly purchase succeeds
- [ ] Yearly purchase succeeds
- [ ] Restore purchases succeeds after reinstall
- [ ] Membership card shows the correct plan type
- [ ] Existing Pro user sees the read-only paywall state
- [ ] Debug-only RevenueCat App User ID is hidden unless Debug Mode is enabled

## 10. Known Expected Warning Before Review

RevenueCat may show warnings like:

- product status is `READY_TO_SUBMIT`
- offering packages point at products that are not yet approved

This is expected before App Review. These warnings should disappear after the subscription products are submitted with the app version and approved by Apple.

## 11. Recommended Release Order

1. Finish App Store Connect metadata
2. Build Office assets and run optional validation
3. Refresh the iOS native project if needed with `pnpm dlx expo prebuild --platform ios`
4. Archive locally in Xcode
5. Upload to TestFlight from Xcode Organizer
6. Confirm the build appears in App Store Connect / TestFlight
7. Re-run monthly / yearly / restore validation
8. Archive and upload the final review build locally from Xcode
9. Attach both subscription products to the app version
10. Submit the app version for review
