# macOS Adaptation Plan

Updated: 2026-03-15

> Clawket 3.0 enables the shared iPhone/iPad target, but macOS and Mac Catalyst
> remain outside the 3.0 release scope. This document is a future plan only.

## Conclusion

Clawket should target `Mac Catalyst` first.

Reason:

- The current app is already an iOS native app with a full `ios/` Xcode project.
- React Native 0.83 already exposes `Platform.isMacCatalyst`, so most adjustments can stay inside the existing iOS codepath instead of creating a separate macOS app.
- Apple officially supports bringing an iPad app to Mac with Mac Catalyst.
- The lighter "run iPhone/iPad app on Apple Silicon Mac" route is not enough here because it only covers Apple Silicon Macs and does not provide a Catalyst target.

## What I found in this repo

### Native project state

- `app.json` sets `ios.supportsTablet` to `true` for the 3.0 adaptive iPad layout.
- `ios/Podfile` explicitly sets `:mac_catalyst_enabled => false`.
- Xcode build settings currently show:
  - `SUPPORTED_PLATFORMS = iphoneos iphonesimulator`
  - `SUPPORTS_MACCATALYST = NO`
  - `TARGETED_DEVICE_FAMILY = 1,2` after Expo prebuild
- `ios/Clawket/Info.plist` is still an iOS-only plist with `LSRequiresIPhoneOS = true`.

This means the project is not "almost already on Mac". The app now supports
iPhone and iPad, but its native target is still configured without Catalyst.

### JavaScript/runtime state

- React Native in this repo already includes `Platform.isMacCatalyst` in `node_modules/react-native/Libraries/Utilities/Platform.ios.js`.
- The QR flow is already split into:
  - live camera scanner in `src/contexts/GatewayScannerContext.tsx`
  - QR import from image in the same file
- Chat attachments are already split into:
  - photo library
  - camera capture
  - file picker
  in `src/hooks/useChatAttachments.ts`
- There are many `Platform.OS === 'ios'` checks across the app. On Mac Catalyst, `Platform.OS` is still `ios`, so some current "iPhone/iPad only" assumptions would incorrectly apply to Mac too.

## Recommended product approach

Keep one app, one codebase, and one UI system.

Do not build a separate "desktop-first" interface. Reuse the current mobile/iPad layout and only add targeted platform adjustments where Mac interaction is meaningfully different.

That matches your requirement and is also the lowest-risk path.

## Recommended technical route

### Route A: Mac Catalyst

This should be the main shipping path.

Expected work:

1. Turn the iOS target into an iPad-capable target.
2. Enable Mac Catalyst in the iOS native project.
3. Add a small runtime helper such as `isAppleDesktop`.
4. Gate or swap a few features that do not map cleanly to Mac.
5. Test and trim unsupported extensions/features for Mac App Store submission.

### Route B: "Designed for iPad/iPhone" on Apple Silicon Macs

This is only a fallback or temporary internal test path.

Why not treat this as the main solution:

- It does not give a real Mac app target.
- It is limited to Apple Silicon Macs.
- It does not solve current iPhone-only configuration.
- Store presentation and desktop affordances are weaker than a Catalyst build.

## Concrete app areas that need adjustment

### 1. QR scanning

This is the cleanest change.

Current state:

- Config screen already supports both "Scan QR Code" and "Upload QR Image".
- QR image decode already uses `Camera.scanFromURLAsync(...)`.

Recommended Mac behavior:

- Hide live camera scanning on Mac Catalyst.
- Make "Upload QR Image" the primary action.
- Keep the same QR payload parsing logic.

Impact:

- Low risk.
- Mostly UI branching, not business logic changes.

### 2. Chat image capture

Current state:

- Chat attachment menu offers `Take Photo`, `Photo Library`, and `Choose File`.
- Agent node handlers also expose camera capture and image picking.

Recommended Mac behavior:

- Replace `Take Photo` with `Choose Image` or route it to the image library/file chooser.
- Keep `Choose File`.
- Keep `Photo Library` only if it behaves well under Catalyst; otherwise collapse to one image-picker action.

### 3. iOS-only assumptions that would misfire on Mac

Examples in the current code:

- `ActionSheetIOS` usage in `src/screens/ConfigScreen/ConfigScreenLayout.tsx`
- many `Platform.OS === 'ios'` branches in `App.tsx`
- device identity reported as iOS/iPhone in `src/services/gateway.ts` and `src/services/node-client.ts`
- node device info reporting `systemName: 'iOS'` in `src/services/node-handlers.ts`

Recommended fix:

- Introduce a shared helper:
  - `isMacCatalyst`
  - `isAppleDesktop`
  - `isTouchFirstApple`
- Migrate feature gating from raw `Platform.OS === 'ios'` to intent-based checks.

This is one of the most important cleanup items before enabling Catalyst.

### 4. Widgets and share extension

Current state:

- The native project includes `ExpoWidgetsTarget`.
- The native project includes `expo-sharing-extension`.
- `expo-widgets` is documented as iOS-focused.
- `expo-sharing` share-into-app support is documented as iOS-specific and experimental.

Recommendation:

- Treat widgets and share extension as likely non-essential for the first Mac release.
- First Catalyst build should focus on the main app target.
- If these targets block Mac builds, exclude them from the Mac configuration rather than forcing parity on day one.

### 5. Orientation and windowing

Current state:

- `app.json` sets `orientation: "portrait"`.

For Mac:

- Portrait-only assumptions are a poor fit for resizable desktop windows.
- We should move to iPad-friendly layout behavior before Catalyst.

This does not mean creating a desktop layout. It means making the current layout survive wider windows.

### 6. Save/share flows

Current state:

- Some flows save to photo library.
- Some flows use iOS share sheet behavior.

Mac follow-up:

- Saving images/files may be better routed to file export or normal sharing instead of Photos.
- These should be checked after the first Catalyst build compiles.

## Proposed implementation order

### Phase 0: Feasibility spike

Goal: get a local Mac Catalyst build running as early as possible.

Tasks:

1. Enable iPad support in Expo/native config.
2. Enable Mac Catalyst in the Podfile/Xcode target.
3. Attempt a local Catalyst build.
4. Identify native modules/targets that fail.

Deliverable:

- a compiled local Mac build, even if some features are temporarily disabled.

### Phase 1: Runtime compatibility cleanup

Goal: stop treating Mac Catalyst as a normal iPhone.

Tasks:

1. Add a platform helper module.
2. Update raw `Platform.OS === 'ios'` checks in high-risk areas.
3. Fix device/system labels sent to Gateway.
4. Prefer non-camera import flows on Mac.

### Phase 2: UX polish for Mac

Goal: keep the app looking like Clawket, but avoid obviously mobile-only behavior.

Tasks:

1. Make QR import the default connect path on Mac.
2. Adjust attachment menus.
3. Review modal sizing, tab widths, and scroll regions on wider windows.
4. Disable or defer unsupported extras.

### Phase 3: Store readiness

Goal: prepare for Mac App Store review.

Tasks:

1. Confirm signing/capabilities for the Mac variant.
2. Verify all privacy permission strings still make sense on Mac.
3. Validate entitlements and unsupported extension targets.
4. Test release build and App Store packaging flow.

## Expected risk level by area

- Low risk:
  - QR import flow
  - attachment picker relabeling
  - runtime helper and JS gating
- Medium risk:
  - iPad/window layout cleanup
  - App Store/store-review/share behavior differences
- Higher risk:
  - native target changes for Catalyst
  - widgets/share-extension coexistence in Mac build
  - any third-party native module with incomplete Catalyst support

## Recommendation for the next coding step

The next practical step is not broad UI work.

It is this:

1. turn on the native prerequisites for iPad + Mac Catalyst in a working branch
2. try a real local Catalyst build
3. fix the first layer of native blockers
4. then start the JS-level feature gating

That will tell us very quickly whether the project can ship as a Catalyst app with small adjustments, or whether a native dependency forces a different path.

## External references

- Apple: [Mac Catalyst](https://developer.apple.com/mac-catalyst/)
- Apple: [Creating a Mac version of your iPad app](https://developer.apple.com/documentation/uikit/creating-a-mac-version-of-your-ipad-app)
- Apple: [Distributing your iPhone or iPad app on Macs with Apple silicon](https://developer.apple.com/documentation/appstoreconnectapi/managing-your-app-s-availability/distributing-your-ios-app-on-macs-with-apple-silicon)
- Expo: [Additional platform support](https://docs.expo.dev/modules/additional-platform-support/)
- Expo: [expo-camera](https://docs.expo.dev/versions/latest/sdk/camera/)
- Expo: [expo-sharing](https://docs.expo.dev/versions/latest/sdk/sharing/)
- Expo: [expo-widgets](https://docs.expo.dev/versions/latest/sdk/widgets/)
