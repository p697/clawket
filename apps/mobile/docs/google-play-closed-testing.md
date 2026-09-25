# Google Play Closed Testing Checklist

This document is the practical Android release checklist for shipping Clawket to Google Play closed testing with RevenueCat subscriptions enabled.

Use it together with `docs/android-build.md`.

## What Is Already Wired In The Repo

The repo now supports:

- release signing via `android/app/keystore.properties` or `CLAWKET_ANDROID_KEY_*` environment variables
- signed Android App Bundle builds through `npm run build:android:aab`
- EAS Android store builds through `eas build --platform android --profile production`
- Android config validation through `npm run config:check:android`
- blocking store builds when PostHog or RevenueCat is missing, or when `EXPO_PUBLIC_REVENUECAT_TEST_API_KEY` / `EXPO_PUBLIC_UNLOCK_PRO` are enabled

## What You Still Need To Prepare

There are three outside-the-repo prerequisites that cannot be completed locally by code changes alone:

1. Android upload keystore
2. Google Play Console app + closed testing track
3. RevenueCat Android credentials, entitlement, Offering, and product mapping

## 1. Release Environment

The default Android release path should be EAS Build:

```bash
eas build --platform android --profile production
```

Before using EAS, sync local app env into Expo's remote environments:

```bash
cd apps/mobile
npm run eas:env:sync
```

`apps/mobile/.env.local` does not flow into EAS automatically. If you skip this, RevenueCat and other public config can be missing from the remote build even though local builds work.

Only fall back to local Gradle release builds when EAS credentials are unavailable or need emergency recovery.

If you do need a local release machine, prepare:

- JDK 17
- Android SDK
- `JAVA_HOME`
- `ANDROID_HOME`

Then prepare app env values in `apps/mobile/.env.local` or the shell environment:

```bash
EXPO_PUBLIC_REVENUECAT_ENABLED=true
EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY=...
EXPO_PUBLIC_REVENUECAT_PRO_ENTITLEMENT_ID=Clawket Pro
EXPO_PUBLIC_REVENUECAT_PRO_OFFERING_ID=pro
EXPO_PUBLIC_SUPPORT_EMAIL=...
EXPO_PUBLIC_PRIVACY_POLICY_URL=...
EXPO_PUBLIC_TERMS_OF_USE_URL=...
```

Important:

- do not set `EXPO_PUBLIC_REVENUECAT_TEST_API_KEY`
- do not enable `EXPO_PUBLIC_UNLOCK_PRO`
- keep the Android RevenueCat API key separate from the iOS key
- leave `EXPO_PUBLIC_REVENUECAT_PRO_PACKAGE_ID` unset for the standard 3.0 Offering; it is only a legacy fallback
- if Google Play says the version code already exists, set a value above the latest Play build in `EXPO_ANDROID_VERSION_CODE` before rebuilding, for example `30102`

Validate with:

```bash
cd apps/mobile
npm run config:check:android
```

## 2. Android Upload Keystore

You need one upload key that will stay stable for future Play uploads.

If you do not already have one, create it locally:

```bash
keytool -genkeypair \
  -v \
  -storetype PKCS12 \
  -keystore ~/keys/clawket-upload.keystore \
  -alias upload \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

Then configure the repo build with:

```bash
cd apps/mobile
cp android-keystore.properties.example android/app/keystore.properties
```

Fill `android/app/keystore.properties`:

```properties
storeFile=/Users/your-name/keys/clawket-upload.keystore
storePassword=...
keyAlias=upload
keyPassword=...
```

Keep both files private:

- the keystore file itself
- the passwords

## 3. Google Play Console Setup

In Play Console, do these steps:

1. Create or open the app with package name `com.p697.clawket`.
2. Complete organization, payments profile, and app access basics if they are still incomplete.
3. Fill the app listing enough to allow testing distribution.
4. Create a closed testing track.
5. Add tester emails or a Google Group for testers.
6. Add the purchase account under Settings > License testing and complete the testing-track opt-in while signed into that account.

Before the first upload, also complete:

1. App content declarations that block testing rollout in your Play Console account.
2. Privacy policy URL.
3. Contact details.

## 4. Google Play Subscription Products

In Play Console, create the three Android products that correspond to Pro:

- monthly subscription with an active monthly base plan
- yearly subscription with an active yearly base plan
- lifetime one-time product

Use stable product IDs. If you want to keep parity with iOS naming, a reasonable choice is:

- `com.p697.clawket.pro.monthly`
- `com.p697.clawket.pro.yearly`
- `com.p697.clawket.pro.lifetime`

After creating them:

1. set pricing
2. activate them
3. make sure they are available for the test country/accounts you will use
4. do not attach a free trial or introductory offer

## 5. RevenueCat Android Mapping

In RevenueCat:

1. Open the existing Clawket project.
2. Open the Android app inside that project, or add one if only iOS exists today.
3. Set the Android package name to `com.p697.clawket`.
4. Confirm the entitlement is still `Clawket Pro`.
5. Validate the Google service account credentials and required Play permissions before importing or refreshing products.
6. In the `pro` control Offering, map:
   - `$rc_annual` -> Android yearly product/base plan
   - `$rc_lifetime` -> Android lifetime product
   - `$rc_monthly` -> Android monthly product/base plan
7. Configure lifetime as non-consumable and confirm all three packages unlock the same `Clawket Pro` entitlement.
8. Give every experiment Offering the same three package types and valid metadata: `default_package` is `annual` or `monthly`, and `social_proof` is a boolean.
9. Make the control or experiment assignment the customer-specific current Offering. The App deliberately reads `offerings.current` so RevenueCat Experiments and Targeting remain authoritative.
10. Copy the Android public SDK key into `EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY`.

## 6. Build The First Closed-Test Bundle

After env and keystore are ready:

```bash
cd apps/mobile
npm run config:check:android
EXPO_ANDROID_VERSION_CODE=30102 npm run build:android:aab
```

Expected output:

```text
android/app/build/outputs/bundle/release/app-release.aab
```

## 7. Upload To Closed Testing

In Play Console:

1. Open the closed testing track.
2. Create a new release.
3. Upload `app-release.aab`.
4. Save and review the release.
5. Roll out to testers.

Wait until the build is available in the Play Store testing channel before validating purchases.

## 8. Subscription Validation On A Play-Delivered Build

Do not stop at local sideloading. Validate on the Play-installed closed-test build.

Use a license-tester account that opted into the track, and install the build from Play. Test these flows, using separate accounts when active products would conflict:

1. Free user opens a Pro gate and sees the paywall.
2. Monthly purchase succeeds.
3. Yearly purchase succeeds.
4. Lifetime purchase succeeds, persists after reinstall, and cannot be bought twice by the same account.
5. Restore or app reinstall still restores Pro for recurring and lifetime purchases.
6. Cancellation returns silently to the paywall; a pending or declined test payment does not unlock Pro.
7. Existing Pro user opens the paywall and sees the subscribed state.
8. Store-localized prices and the assigned Offering metadata are reflected in the paywall.
9. PostHog records purchase/restore success and normalized failure reasons. Record the Android distribution of `cancelled`, `pending`, `offerings_unavailable`, and `store_error:*`; repeated `store_error:ITEM_UNAVAILABLE` points to product, track, account, or country availability rather than UI persuasion.

## 9. Evidence To Record

Record these items in the release evidence without copying credentials or account identifiers:

1. AAB version code, signing-key fingerprint, testing track, and rollout status.
2. Active status for monthly, yearly, and lifetime products; omit product IDs if the report will be shared publicly.
3. RevenueCat credential validation status, current Offering identifier, package count/types, and metadata validation status.
4. License-test results for purchase, cancellation/pending, reinstall, and restore.
5. PostHog failure-reason counts for Android 3.0.0.
