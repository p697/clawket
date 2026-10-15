# Native iOS application

Root instructions apply. This maintained SwiftUI application targets iOS 16.4 and later. Reusable native code lives in `packages/apple`; this host owns app lifecycle, permissions, persistence, entitlement integration and presentation binding. Do not embed React Native, JavaScript or a web shell to implement the interface.

The development bundle is `com.p697.clawket.nativeqa`. It installs beside the store app. Keep signing teams, profiles and operator credentials out of project files. Local development builds are allowed; signed distribution archives, uploads and releases require explicit owner authorization.

Read `docs/native-ios/PLAN.md`, `RESEARCH.md` and `PARITY.md` before extending product behavior. Keep missing capability rows pending until actual adapter, persistence and device evidence exists. Presentation actions must have real handlers or remain unavailable. Preview fixtures never supply the shipping composition.

Use WebDriver for the owner's USB test phone; verify its USB serial against CoreDevice wired transport before each session. Do not use a wireless personal phone, iPhone Mirroring, or an app name alone as device identity. Keep identifiers and captured personal screens in ignored local evidence. Follow simulator, iOS and heavy leases; place DerivedData on the configured worktree SSD.

The QA sandbox cannot prove an in-place store upgrade. A future same-bundle importer must validate and preserve Expo Keychain identity/tokens, the connection registry, AsyncStorage, chats, drafts, purchases and extension data before marking migration complete. Empty native preferences never authorize deleting legacy data or generating a replacement device identity.

The app owns the main-bundle `Localizable.xcstrings`; see `docs/native-ios/LOCALIZATION.md` for coverage and producer rules. Localize fixed app text with literal resources at its producer. Keep user/backend messages, names, commands, models and paths verbatim; never turn arbitrary presentation strings into localization keys. Four-language initial QA coverage does not complete the 19-language parity gate.
