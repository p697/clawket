# Native iOS development

Open `Clawket.xcodeproj` and select the shared `Clawket` scheme. The maintained SwiftUI host uses the local `../../packages/apple` package, supports iPhone and iPad on iOS 16.4 or later, and contains no JavaScript runtime. Dependencies are pinned; no Node installation, Expo build or maintainer credentials are needed to compile a simulator app.

The application is **Clawket Native**, bundle `com.p697.clawket.nativeqa`, version 3.1.2. Its app-specific Keychain service and sandbox isolate it from the installed store app. Select a personal development team locally only if installing a development build on the owner's verified USB test device. Do not commit that team or prepare an archive/export.

Follow root worktree/resource rules. Use the worktree's SSD DerivedData path and at most two build jobs:

```sh
node scripts/worktree.mjs paths derived-data
xcodebuild -project apps/ios/Clawket.xcodeproj -scheme Clawket \
  -destination 'generic/platform=iOS Simulator' -configuration Debug \
  -derivedDataPath /absolute/worktree-derived-data -jobs 2 CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- build
```

For the five focused recovery/Keychain tests, hold `heavy` and `simulator`, use an available simulator ID with `-destination 'platform=iOS Simulator,id=…'`, and run `test -only-testing:ClawketTests -parallel-testing-enabled NO`. Simulator signing is local ad hoc (`CODE_SIGN_IDENTITY=-`), requires no account and permits real Keychain verification; an unsigned compile alone does not establish credential storage. Other projects' active native builds or UI tests also require waiting. WebDriver acceptance uses the physical USB identity checks documented by the program owner; never choose a personal wireless device by name.

The app host binds real native adapters, securely saves pairing results, and owns drafts, an explicit outbox and generation-scoped UI updates. A failed single-use claim is never automatically retried. An interrupted send becomes uncertain; an undispatched queue becomes held on recovery. Neither condition automatically replays a write. Incomplete parity remains tracked in `docs/native-ios/PARITY.md`; this development host is not a store replacement or evidence of an in-place upgrade.
