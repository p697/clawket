# Google Play Closed Testing Checklist

This document is the practical Android release checklist for shipping Clawket to Google Play closed testing with RevenueCat subscriptions enabled.

Use it together with `docs/android-build.md`.

## What Is Already Wired In The Repo

The repo now supports:

- release signing via `android/app/keystore.properties` or `CLAWKET_ANDROID_KEY_*` environment variables
- signed Android App Bundle builds through `pnpm run build:android:aab`
- Android config validation through `pnpm run config:check:android`
- blocking store builds when `EXPO_PUBLIC_REVENUECAT_TEST_API_KEY` or `EXPO_PUBLIC_UNLOCK_PRO` are enabled

## What You Still Need To Prepare

There are three outside-the-repo prerequisites that cannot be completed locally by code changes alone:

1. Android upload keystore
2. Google Play Console app + closed testing track
3. RevenueCat Android product mapping

## 1. Local Release Environment

On the release machine, prepare:

- JDK 17
- Android SDK
- `JAVA_HOME`
- `ANDROID_HOME`

Then prepare app env values in `apps/mobile/.env.local` or the shell environment:

```bash
EXPO_PUBLIC_REVENUECAT_ENABLED=true
EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY=...
EXPO_PUBLIC_REVENUECAT_PRO_ENTITLEMENT_ID=Clawket Pro
EXPO_PUBLIC_REVENUECAT_PRO_OFFERING_ID=default
EXPO_PUBLIC_REVENUECAT_PRO_PACKAGE_ID=$rc_monthly
EXPO_PUBLIC_SUPPORT_EMAIL=...
EXPO_PUBLIC_PRIVACY_POLICY_URL=...
EXPO_PUBLIC_TERMS_OF_USE_URL=...
```

Important:

- do not set `EXPO_PUBLIC_REVENUECAT_TEST_API_KEY`
- do not enable `EXPO_PUBLIC_UNLOCK_PRO`
- keep the Android RevenueCat API key separate from the iOS key
- if Google Play says the version code already exists, set a higher `EXPO_ANDROID_VERSION_CODE` before rebuilding, for example `10701`

Validate with:

```bash
cd apps/mobile
pnpm run config:check:android
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

Before the first upload, also complete:

1. App content declarations that block testing rollout in your Play Console account.
2. Privacy policy URL.
3. Contact details.

## 4. Google Play Subscription Products

In Play Console, create the Android subscription products that correspond to Pro:

- monthly plan
- yearly plan

Use stable product IDs. If you want to keep parity with iOS naming, a reasonable choice is:

- `com.p697.clawket.pro.monthly`
- `com.p697.clawket.pro.yearly`

After creating them:

1. set pricing
2. activate them
3. make sure they are available for the test country/accounts you will use

## 5. RevenueCat Android Mapping

In RevenueCat:

1. Open the existing Clawket project.
2. Open the Android app inside that project, or add one if only iOS exists today.
3. Set the Android package name to `com.p697.clawket`.
4. Confirm the entitlement is still `Clawket Pro`.
5. In the `default` offering, map:
   - `$rc_monthly` -> Android monthly product
   - `$rc_annual` -> Android yearly product
6. Confirm both packages unlock the same `Clawket Pro` entitlement.
7. Copy the Android public SDK key into `EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY`.

If your current app always preselects one package, set `EXPO_PUBLIC_REVENUECAT_PRO_PACKAGE_ID` to the package you want selected by default.

## 6. Build The First Closed-Test Bundle

After env and keystore are ready:

```bash
cd apps/mobile
pnpm run config:check:android
EXPO_ANDROID_VERSION_CODE=10701 pnpm run build:android:aab
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

Test these flows:

1. Free user opens a Pro gate and sees the paywall.
2. Monthly purchase succeeds.
3. Yearly purchase succeeds.
4. Restore or app reinstall still restores Pro.
5. Existing Pro user opens the paywall and sees the subscribed state.
6. Config screen diagnostics show the expected RevenueCat entitlement and offering.

## 9. What To Send Back To Codex

When you want me to take the next step, send me whichever of these you have completed:

1. `I created the keystore`
2. `I filled .env.local`
3. `I created the Play subscriptions`
4. `I mapped the products in RevenueCat`
5. `I am ready to build the first AAB`

If you get stuck on a Play Console or RevenueCat page, send me the exact field names or a screenshot and I will translate that into the precise next action.
