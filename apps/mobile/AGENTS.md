# Clawket Mobile workspace

This Expo/React Native app is the Clawket 3.0 client for OpenClaw, Hermes, and YouMind Sprite. Repository-wide rules still apply; this file contains only Mobile-specific implementation rules.

## Sources of truth

1. For the 3.0 rebuild, read `../../docs/3.0/README.md`, `00-decisions.md`, the relevant specification, `08-milestones.md`, and `PROGRESS.md` before changing behavior.
2. Current implementation, tests, native plugins, and build scripts are authoritative when older documentation disagrees.
3. Read `docs/engineering-baseline.md` before dependency, Expo, React Native, Node, or native-project changes.
4. Read `docs/design-system.md` before UI work. Exact product recipes live in `../../docs/3.0/05-visual-system.md`.
5. Read `docs/android-build.md` for Android packaging and `docs/android-onboarding.md` for a fresh build machine.
6. Release/update announcement content lives in `src/features/app-updates/releases.ts`.

OpenClaw may be inspected at `../../../../openclaw` or `/Users/lucy/Desktop/op/openclaw`. Hermes at `/Users/lucy/.hermes/hermes-agent` is read-only unless the user explicitly asks to modify it. `/Users/lucy/Desktop/youmind/youmind-mobile` is a read-only implementation reference, not a product specification.

`AGENTS.md` is the authored instruction file. Keep `CLAUDE.md` as a relative symlink to it; never maintain a copied sibling.

## Product architecture

- The app has one root native stack with content-owned headers. There is no bottom navigation; `@react-navigation/bottom-tabs` is a forbidden legacy dependency.
- Backend identity answers which product is connected: `openclaw` or `hermes` (with YouMind Sprite represented by its dedicated adapter). Transport identity answers how it connects: local, relay, tailscale, cloudflare, or custom. Never model Hermes or Preview as a transport.
- UI and feature code consume `src/connection/` through the registry, adapters, descriptors, and capability metadata. Do not import wire transports or branch on backend in screens.
- Only the active connection owns a live adapter. Other connections remain visible through cached roster/session state. Switching must stop the old adapter before the new one is authoritative.
- Unsupported actions are hidden or locked from centralized capabilities; do not issue a request and wait for an `unsupported` error.
- Keep the OpenClaw and Hermes paths equally complete. Shared chat, storage, pairing, retry, and lifecycle changes require tests for both where applicable.
- Hermes model selection is global-scoped. Do not add per-session Hermes model state.
- Preserve one chat runtime. Recovery, foreground, reconnect, watchdog, and final reconciliation must share coordination rather than independently probing history.

### Connection and protocol safety

- Treat socket open, a valid frame, handshake completion, and backend ready as distinct stages. Successful health evidence resets reconnect backoff; raw WebSocket open does not.
- Relay pong expiry applies only when `relay.client-pong.v1` was negotiated. Legacy clients are not expired merely for application-level silence.
- Check the final serialized frame on every path. Exactly 8 MiB is valid; larger frames fail locally as `frame_too_large` and are not sent.
- Preview is an isolated OpenClaw Relay service environment. Debug mode selects it for new official pairing; it remains `backendKind=openclaw` and `transportKind=relay`.
- Official Production and Preview invitations are environment-checked. Custom/self-hosted Registry QR payloads remain supported and are not classified as official.
- Pairing links and six-character codes must decrypt/resolve into the same backend-aware claim/save/reconnect path as legacy QR pairing. Never persist fragment keys, plaintext invitation payloads, raw passwords, or transport credentials in descriptors or logs.
- Store OpenClaw device tokens by both connection scope and role. Operator and node credentials must never overwrite or invalidate each other; node lookups must not fall back to legacy operator tokens.
- Bridge diagnostics may read the CLI version only from a negotiated OpenClaw Relay connect response or Hermes health. Direct OpenClaw and legacy peers report no Bridge version; never relabel the Gateway's `server.version` as a Bridge version.
- Connection removal clears only that connection's credentials, cache generations, roster cache, and unread watermarks. Roll back storage migrations atomically on failure.

## Navigation and pages

- Root surfaces are Onboarding, Roster, Thread, Agent Settings, Account Settings, Search, and Paywall. Session Panel is a Thread-owned sheet, not a route.
- `headerShown` stays false. Use content-owned `FloatingButton`, `HeaderPill`, `ScreenHeader`, or the canonical modal header primitives.
- Each network-backed page must cover loading, empty, error, offline-with-cache, and permission/paywall states. Preserve usable cached content during offline and recoverable errors.
- Every interactive row is at least `ControlSize.settingsRow`; controls meet the 44-point touch target.
- Use `ConfirmationModal` for destructive or restart-causing confirmation. System `Alert` is reserved for permission, system handoff, transient result, and unrecoverable error messages.

## Design system

Business UI consumes semantic theme values and shared primitives; it does not assemble local palettes, type scales, shadows, or sheet chrome.

Canonical structural families are `Space`, `FontSize`, `LineHeight`, `FontWeight`, `Radius`, `BorderWidth`, `ControlSize`, `StatusSize`, `PresentationColor`, and `Shadow`. `createSurfaceStyle` is transitional shared surface plumbing. Do not add aliases or revive removed token members.

Canonical colors are `canvas`, `canvasGrouped`, `surface`, `surfaceFloating`, `ink`, `inkSecondary`, `inkTertiary`, `line`, `accent`, `accentSoft`, `onAccent`, `scrim`, `good`, `goodSoft`, `warn`, `warnSoft`, `bad`, and `badSoft`. Ordinary UI must not hardcode colors. Use `PresentationColor` only for media, exported artifacts, and charts.

Required transitional and input primitives documented by the automated gate are `ActionButton`, `Button`, `Card`, `CompositionSafeBottomSheetTextInput`, `CompositionSafeTextInput`, `FormTextInput`, `PasteCapableTextInput`, `SearchInput`, `SettingsGroup`, `SettingsIcon`, and `ThemedSwitch`. New 3.0 work should prefer the complete canonical set in `src/components/ui/` instead of copying markup.

Additional rules:

- Lists are borderless. Settings groups may have internal hairlines; status rings and presentation framing use the documented border exceptions.
- Use only regular 400 and semibold 600. Default page chrome uses two visible type sizes; the documented title/detail/paywall exceptions may use a third.
- Use Lucide icons, not emoji literals or platform-specific symbol branches, for application chrome.
- Use semantic radii and spacing directly; do not recreate intermediate values through arithmetic.
- Use canonical Sheet primitives. Business components must not instantiate `BottomSheetModal`, backdrop, handle, header, or `FullWindowOverlay` chrome themselves. iPad presentation stays detached and centered.
- Motion uses the shared 120/200/320 ms durations and honors reduced motion. Do not introduce typing-dot or decorative looping animation.
- Never raise `scripts/ui-style-baseline.json` to hide a finding. New checker logic must fail closed on missing, empty, malformed, or unparseable input and include a corrupted-input regression.

### Text input and paste

- `CompositionSafeTextInput` is the sole stock React Native `TextInput` host. iOS native-owns marked/composing text; external replacement and clearing must still synchronize. Android remains controlled.
- Use `CompositionSafeBottomSheetTextInput` inside bottom sheets.
- Thread composition uses `PasteCapableTextInput`. Pasted images/files enter the existing pending-attachment pipeline, respect adapter attachment capability, and share the six-item capacity limit. Text paste remains native.
- Do not bypass these primitives with a raw input host. Forward refs and imperative clear/focus behavior must remain compatible with the composer controller.

## Internationalization and copy

- All visible copy uses natural-English i18next keys. No user-facing string is hardcoded in a screen or component.
- Keep the four namespaces (`common`, `chat`, `config`, `settings`) synchronized across `en`, `zh-Hans`, `ja`, `ko`, `de`, and `es`.
- Add every key to all six locales in the same change. Constants containing translated labels belong inside a component hook or memo so locale changes update them.
- Default rows and cards do not gain descriptive subtitles or decorative labels. Error/empty/banner copy is one concise sentence plus at most one action.
- Source comments, identifiers, tests, and commit messages are English; translated text belongs in locale JSON.

## Analytics, privacy, and subscriptions

- Add semantic analytics helpers in `src/services/analytics/events.ts`; never scatter raw `posthog.capture` calls.
- Events use small enums, booleans, counts, and normalized error codes. Never include message text, prompts, raw IDs, credentials, invitation material, or secret-bearing URLs.
- Navigation exposure is centralized in `src/utils/posthog-navigation.ts`.
- Subscription gates derive from the entitlement/free-connection helpers and adapter capabilities. UI must not infer Pro from the presence of a package or hardcode localized prices.
- RevenueCat prices and offering metadata are authoritative. Purchase cancellation is silent; pending/store/offering failures use normalized low-cardinality reasons.

## Native configuration and dependencies

- Expo config plugins under `plugins/` are the source for generated native edits. Plugins must be idempotent and fail closed when their anchor/template changes.
- Keep root and Mobile lockfiles synchronized. Both root and workspace install entry points must apply required native dependency patches.
- After native dependency or plugin changes, run a clean Expo prebuild, iOS pod install/build, and Android Debug build. Inspect generated changes; do not hand-edit a generated native file unless the build documentation explicitly requires it.
- `@mattermost/react-native-paste-input` requires the checked podspec patch and iOS `PasteInputModule.setup(factory.rootViewFactory)` bridge setup. Preserve both postinstall paths and their tests.
- Runtime client configuration goes through `src/config/public.ts`. Add public variables to `.env.example` and to the public-config checker; do not read scattered `process.env` values in UI code.

For Android store packaging, use `npm run build:android:aab`. Release signing credentials and upload keystores remain local and uncommitted. A Debug build must never require release credentials, and a Release build must fail closed unless real credentials are present or the explicit local debug-signing override is set.

## Testing and completion

Use the narrowest useful test while iterating, then run the milestone gate. Mobile changes normally require:

1. `npm run mobile:typecheck`
2. `npm run mobile:test`
3. `npm run mobile:check:design-system`
4. `npm run check:required`

Connection/protocol changes additionally require recorded adapter tests, relevant integration tests, and `npm run test:compat`. Native changes additionally require clean iOS Simulator and Android Debug builds. UI tests cover light/dark themes, capability degradation, page states, accessibility targets, token usage, and composition behavior; simulator screenshots are not an automated acceptance substitute.

Checks must report verified scope, fail when inputs disappear or become malformed, and include a corrupted-input regression for new validation logic. Never delete or weaken tests to reduce line counts.
