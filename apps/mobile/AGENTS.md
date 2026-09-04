# Overview

Clawket is a multi-backend mobile client for OpenClaw and Hermes (iOS/Android, React Native + Expo) inside the Clawket monorepo.

For OpenClaw protocol details and reference implementations, see: `../../../../openclaw` or `/Users/lucy/Desktop/op/openclaw`
Hermes source at `/Users/lucy/.hermes/hermes-agent` is read-only reference material unless the user explicitly asks to modify it.
For modern mobile engineering patterns, UI primitives, and quality gates, `/Users/lucy/Desktop/youmind/youmind-mobile` is a read-only reference. Borrow structure and discipline, not YouMind product assumptions or literal design values.

If the task involves Android development or building an Android release package, refer to `docs/android-build.md`.
If the task is to prepare a fresh machine for Android packaging, read `docs/android-onboarding.md` first.
For the supported Node/Expo/React Native baseline, dependency update policy, native synchronization, and required checks, read `docs/engineering-baseline.md`.

# Android Packaging Notes

When touching Android release packaging, keep these rules in mind:

1. Use `npm run build:android:aab` as the default Google Play packaging command.
2. That script is responsible for:
   - syncing Expo native Android config through `expo prebuild`
   - producing the signed release `.aab`
3. Store-ready Android builds depend on local files and secrets that are not committed:
   - `apps/mobile/.env.local`
   - `apps/mobile/android/app/keystore.properties` or `CLAWKET_ANDROID_KEY_*`
   - the upload keystore file
4. `EXPO_ANDROID_VERSION_CODE` can override the Play version code when needed.
5. If no explicit Android version code is provided, `build:android:aab` auto-increments from the current native project state so repeat uploads do not stay stuck on an old value.
6. On macOS, prefer Homebrew `openjdk@17` at `/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home` for Android builds to avoid the Gradle `IBM_SEMERU` issue.
7. `npm run build:android:pro-temp` is only for local Pro UI verification and must not be treated as a real subscription or Play-delivered validation flow.

# Clawket Ecosystem — Cross-Repository Awareness

Clawket now lives in a monorepo. This app is the client-facing frontend; relay and bridge live in sibling workspace folders.

## Dual Backend Compatibility Rule

This mobile app must keep both OpenClaw and Hermes usable during the migration period.

1. Do not ship Hermes fixes that regress OpenClaw chat, pairing, config, or session behavior.
2. Preserve legacy OpenClaw interfaces and expectations; Hermes-specific behavior should use isolated backend-aware handling.
3. When touching shared chat state, message parsing, history merge, or connection code, verify the behavior still makes sense for both OpenClaw and Hermes.
4. Treat Hermes source at `/Users/lucy/.hermes/hermes-agent` as read-only external code unless the user explicitly approves changing Hermes itself.

## Backend Architecture Rule

For all new mobile work, use this model:

1. `backendKind` is the product backend: `openclaw` or `hermes`.
2. `transportKind` is the connection route: `local`, `relay`, `tailscale`, `cloudflare`, or `custom`.
3. Legacy `mode` fields may still exist for compatibility, but new logic should prefer `backendKind` + `transportKind`.
4. Do not add new screen-level or component-level branching that treats Hermes as just another `mode`.
5. Put backend differences behind shared helpers, capability registries, or adapters in `src/services/` or backend-specific modules.
6. When adding Console or Config features, define whether they are shared, OpenClaw-only, or Hermes-only before writing UI code.
7. Unsupported backend actions must be hidden or disabled via centralized capability checks, not by optimistic requests that fail later.
8. Treat `src/services/gateway-backends.ts` as the primary source of truth for backend capability metadata; extend it before wiring new backend-specific UI affordances.
9. OpenClaw and Hermes Console menus are intentionally implemented as **separate top-level screens** (for example `OpenClawConsoleMenuScreen` and `HermesConsoleMenuScreen`), dispatched via `selectByBackend()`. Do not try to merge them into a single cross-backend menu. Inside each per-backend menu screen, prefer descriptor-driven item lists over hand-written per-item conditional JSX so the menu stays maintainable as that backend grows.
10. Keep `src/services/gateway.ts` focused on transport, connection, caching, and event orchestration. Backend-specific request semantics should live in dedicated operations/helpers such as `gateway-backend-operations.ts`.
11. When a screen or hook needs multiple gateway resources together, prefer a shared bundle loader in `src/services/` over duplicating `Promise.all(...)` request orchestration inside the view layer.
12. Treat the Console dashboard/Home page the same way: aggregate capability-gated gateway reads in a dedicated service loader rather than building a long inline `Promise.allSettled(...)` block inside the screen.
13. Treat Console entry metadata the same way: page titles, descriptions, docs links, and Hermes/OpenClaw action cards should come from shared descriptor/resolver helpers in `src/services/`, not from repeated object literals embedded in screens.
14. `Discover` and `ClawHub` are part of the backend support matrix too. Do not assume they are always available; gate them through backend capabilities or shared entry descriptors before exposing them in Console.
15. Apply the same separation to connection setup. Gateway config editors, QR scan results, and saved configs must model `backendKind` and `transportKind` independently. Do not re-introduce new Hermes-only editor modes when a backend/transport combination is what the product actually needs.
16. During the Hermes phase-1 rollout, treat `hermes + local/tailscale/cloudflare/custom` as direct-bridge transports. Reserve `relay` as a separate transport track that will later plug into backend-aware relay infrastructure rather than being faked through direct URLs.
17. Default connection UX copy to backend-neutral language (`Connection`, `pairing QR code`, etc.). Mention OpenClaw explicitly only for genuinely OpenClaw-specific flows such as auth-file guidance, permission repair, or config-management screens.
18. When deciding whether a config should use relay connection behavior, key off `transportKind === 'relay'` or `resolveGatewayTransportKind(...)`, not `mode === 'relay'`. Hermes relay may still retain legacy `mode: 'hermes'` for compatibility.

## Hermes Model Selection Rule

When adding Hermes model-selection UI or behavior in mobile:

1. Treat Hermes model selection as `global` only for now. The current Hermes API-server integration used by Clawket does not provide stable per-session model overrides.
2. Any Hermes `/model` command handling and Console model-setting flows must converge on shared gateway/bridge operations instead of separate screen-specific logic.
3. Do not hardcode Hermes custom-provider slug rules in screens or components. Provider canonicalization belongs in shared services/bridge helpers.
4. If a future page appears to need session-scoped Hermes models, stop and re-evaluate the bridge/runtime contract before implementing UI.

## Sister Repositories

| Repo | Path | Role |
|------|------|------|
| **mobile** (this app) | `.` | React Native mobile app — Chat, Live, Console, and Config UI |
| **relay** | `../relay-registry`, `../relay-worker`, `../../packages/relay-shared` | Cloudflare Workers + Durable Objects — WebSocket relay, registry, pairing |
| **bridge** | `../bridge-cli`, `../../packages/bridge-core`, `../../packages/bridge-runtime` | Node.js CLI + npm package — local bridge between relay and OpenClaw Gateway |

## Architecture Flow

```
[Clawket App] ←WS→ [OpenClaw Relay] ←WS→ [Bridge CLI] ←WS→ [OpenClaw Gateway]
[Clawket App] ←WS→ [Hermes Local Bridge or isolated Hermes Relay] ←→ [Hermes Agent]
```

## When to Look at Sister Repos

You **must** read the sister repo's code (start with its `AGENTS.md` and `CLAUDE.md`) when:

1. **Connection issues** — If the bug involves WebSocket connectivity, handshake failures, "challenge timed out", or reconnection, the cause may be in relay or bridge, not in this app.
2. **Pairing flow** — QR code generation, `accessCode` claiming, token verification spans all three repos.
3. **Message protocol** — The WS frame format, control frames (`__clawket_relay_control__:` prefix), and `connect`/`challenge` handshake are defined in relay and bridge.
4. **Relay behavior** — Offline message caching, gateway owner lease, heartbeat/alarm logic live in `clawket-relay`.
5. **Bridge lifecycle** — Demand-driven gateway connection, lazy connect/disconnect, service install/uninstall live in `clawket-bridge`.
6. **Gateway API** — The app calls Gateway methods (`chat.*`, `config.*`, `models.*`, `cron.*`, etc.) through the relay+bridge tunnel. Understanding what the Gateway supports requires checking OpenClaw source at `../../../../openclaw` or `/Users/lucy/Desktop/op/openclaw`.

## How to Read Sister Repos

1. **Always read the closest `AGENTS.md` first.** `CLAUDE.md` is only a compatibility symlink to the same content.
2. Then look at the specific code relevant to your task.
3. Do not modify sister repos without understanding their conventions.

## Language Policy
- All code comments and commit messages **must be in English**.
- No Chinese (or other non-English) text in source files — translations belong exclusively in locale files under `src/i18n/locales/`.

## Gateway Config Safety
- Any flow that patches Gateway config must show a secondary confirmation dialog, because the change will restart Gateway and may interrupt active OpenClaw tasks.

## Relay Liveness Compatibility

1. Relay client URLs advertise `relay.client-pong.v1`; clients must answer only Relay ticks that explicitly request that capability acknowledgement.
2. Treat WebSocket `open`, first valid frame, and backend `ready` as separate lifecycle stages. OpenClaw reconnect backoff resets only after `connect_ready`; direct backends reset after a valid first frame.
3. Unknown tick fields and close codes remain non-fatal so new Relay workers stay compatible with old App releases and new Apps stay compatible with old Relay workers.

## Preview Relay Environment

1. Preview is selected only from Debug Mode and changes the official Registry/Relay environment used for new OpenClaw Relay pairing. It is not a transport or backend option.
2. Official Production and Preview QR codes must match the selected environment. Reject an official Preview QR while Debug Mode is off; do not apply this restriction to custom/self-hosted Registry URLs.
3. Persist the developer's environment choice, but use Production as the effective default whenever Debug Mode is off.
4. Keep saved connections environment-isolated through their Registry URL and gateway identity. Existing Preview connections remain clearly labeled and must not overwrite Production credentials.

## Secure Pairing Invitation Rule

1. Universal/App Links and pairing codes must decrypt locally, parse through `qrPayload.ts`, and reuse the existing backend-aware claim/save/reconnect flow.
2. Accept official pairing links only from configured Clawket Registry environments; keep custom and self-hosted pairing available through the existing QR path.
3. Preview invitations require Debug Mode. Legacy QR scanning and both OpenClaw and Hermes connection paths must remain unchanged.
4. Present OpenClaw Relay pairing as one primary path: run the environment-specific pairing command, obtain a pairing code, enter it, and connect. Keep QR scanning/upload as a collapsed compatibility path so legacy and self-hosted flows remain available without competing with the default onboarding.

## Global Loading Overlay Rules
- Reuse the shared global loading overlay for app-wide in-flight states that should float above the current screen without replacing its layout.
- Preferred API: `src/contexts/GlobalLoadingOverlayContext.tsx` via `useGlobalLoadingOverlay()` and the root-rendered `GlobalLoadingOverlay`.
- The older Gateway-named exports (`useGatewayOverlay`, `GatewayOverlayProvider`, `GatewaySwitchOverlay`) are compatibility aliases only. Do not introduce new feature work against the Gateway-specific names unless you are touching legacy code that already uses them.
- Do not replace a whole screen with `LoadingState` when the intended UX is a transient global spinner above the existing UI. Use `LoadingState` for true full-screen loading pages only.
- If an in-flight action can be interrupted by dismissing a modal screen or swiping down a native-stack modal, add an explicit confirmation before leaving; do not assume the global overlay itself prevents dismissal.

## Release Update Modal
- The unified release/update history lives in `src/features/app-updates/releases.ts`.
- When the user asks to change update-popup copy, CTA labels, target version, or destination, edit that file first instead of searching across Chat screen files.
- Any new user-facing strings introduced there must also be added to all 6 React Native locale files under `src/i18n/locales/{en,zh-Hans,ja,ko,de,es}/chat.json`.
- The display/cache logic for that modal is implemented in `src/services/app-update-announcement.ts`; UI lives in `src/screens/ChatScreen/components/AppUpdateAnnouncementModal.tsx`.

# Internationalization (i18n) Rules

## Supported Locales

| Locale | Code | Status |
|--------|------|--------|
| English | `en` | Default / fallback |
| Simplified Chinese | `zh-Hans` | Full coverage |
| Japanese | `ja` | Full coverage |
| Korean | `ko` | Full coverage |
| German | `de` | Full coverage |
| Spanish | `es` | Full coverage |

## Runtime Architecture

| Runtime | Tech | Translation source |
|---------|------|--------------------|
| React Native | i18next + `react-i18next` | `src/i18n/locales/{locale}/{namespace}.json` (4 namespaces: `common`, `chat`, `config`, `console`) |

## Key Design
- Use natural English text as translation keys: `t('Save')`, `t('Loading...')`.
- Missing translations fall back to the key itself (readable English).

## Required Rules
1. **All new features must include i18n for every supported locale.** No feature is complete until translations exist for **all 6 locales**.
2. **Hardcoded user-facing strings are forbidden.** Every visible string in RN screens must go through `t()`.
3. When adding a new RN translation key, add it to **all 6 locale directories**: `en`, `zh-Hans`, `ja`, `ko`, `de`, `es`. Never add a key to only one or two locales.
4. Translation keys must always be **natural English text** (e.g. `t('Save')`, `t('Loading...')`). Never use non-English text as keys.
5. Constants with translatable labels (e.g. tab arrays, picker options) must use `useMemo` + `t()` inside the component so translations update with locale changes.
6. `Alert.alert()` title, message, and button labels must be wrapped with `t()`.

## Forbidden Patterns
1. Do not hardcode UI strings in screen or component source files.
2. Do not use Chinese text directly in source code — only in locale JSON files.

## How to Add Strings — React Native
1. Add key to **all 6** locale JSON files under `src/i18n/locales/{en,zh-Hans,ja,ko,de,es}/{namespace}.json`.
2. The `en` value should equal the key (natural English). Other locales provide the translated value.
3. Use `const { t } = useTranslation('{namespace}')` in the component.
4. Render with `t('Your new string')`.

## Validation Checklist
1. All 6 locale JSON files (`en`, `zh-Hans`, `ja`, `ko`, `de`, `es`) have the same set of keys (no orphans).
2. `npx tsc --noEmit` passes.

# Analytics Rules

Clawket uses PostHog for product analytics. Analytics work must stay centralized and low-noise.

## Required Rules
1. **Any new critical feature must include analytics.** This is mandatory for subscription/paywall/purchase flows and for core product actions such as connect, send, create, save, and major Console entry points.
2. **Do not scatter raw `posthog.capture(...)` calls across the app.** Add or reuse semantic helpers in `src/services/analytics/events.ts`, and keep client/config wiring inside `src/services/analytics/` plus the existing root hooks.
3. **Prefer business events over UI-noise events.** Track outcome-oriented actions (`gateway_connect_saved`, `paywall_subscribe_tapped`) instead of every close button, minor filter toggle, or transient interaction.
4. **Keep event properties compact and stable.** Prefer booleans, small enums, counts, and source labels; avoid high-cardinality raw IDs, large text, message contents, tokens, URLs with secrets, or other sensitive data.

## Notes
1. Page exposure is handled centrally from the navigation root; new navigable screens should be added to `src/utils/posthog-navigation.ts`.
2. When adding subscription or payment-related UI, update analytics in the same change. The feature is not complete until the critical paywall/purchase events are covered.

# Mobile Environment Variable Rules

Use a single documented flow for all mobile env changes. Do not invent one-off release steps.

## Required Rules
1. Add every new mobile env variable to `apps/mobile/.env.example` with a safe placeholder or empty default.
2. If the variable is used by client-side React Native code, name it with the `EXPO_PUBLIC_*` prefix.
3. Read mobile runtime config through `src/config/public.ts` or another shared config module. Do not scatter new `process.env.*` access through screens, hooks, or components.
4. If the variable enables or configures analytics, billing, support links, legal links, docs links, or release endpoints, update `scripts/check-public-config.mjs` so the release checks stay authoritative.
5. If the variable affects iOS release behavior, verify it works through direct Xcode `Build` / `Archive` by keeping it in `.env.local`. `ios/.xcode.env` already sources `.env` and `.env.local`; do not add a separate sync script unless the build system changes.
6. If the variable becomes required for a shipping flow, update `docs/ios-app-store-release.md` in the same change.

## Standard Change Checklist
1. Add the new key to `apps/mobile/.env.example`.
2. Wire it into `src/config/public.ts` or the appropriate shared config module.
3. Update `scripts/check-public-config.mjs` if release validation should enforce it.
4. Update the relevant docs.
5. Run `npm run config:check:ios`.
6. Run the affected tests and `npm run typecheck`.

# Chat Runtime Rules (RN Only)

All Chat feature work now targets a single runtime:
1. React Native chat (`FlashList` path).

## Responsibilities
1. Keep chat rendering, interaction, and modal behavior fully in React Native components.
2. Keep one data source in RN (`useChatController`) and avoid introducing parallel rendering pipelines.
3. Prefer extracting reusable RN components/hooks over adding runtime-specific branches.

## Common Pitfalls
1. Re-introducing a second chat runtime or runtime-toggle code path.
2. Splitting message rendering behavior across multiple disconnected data flows.
3. Re-adding gateway event subscriptions in view components that should stay presentation-focused.
4. Letting multiple chat run-recovery paths independently fire `chat.history` probes for the same session. Foreground recovery, reconnect recovery, watchdog probes, tool-result reloads, and final reconciliation must share single-flight coordination or they can multiply one active run into hot-room traffic bursts.

## RN Chat Maintainability
1. Keep `useChatController` focused on orchestration; move domain-specific state machines to dedicated hooks.
2. Prefer extracting reusable hooks for complex subdomains (for example voice input, model/command pickers, viewport, message selection).
3. Preserve `useChatController` return-shape contract during refactors, and validate with focused hook tests plus full test runs.

# Clawket UI Theming Rules

## Scope
This project uses a centralized light/dark theming architecture.
All new UI work must follow these rules so dark mode works automatically.

## Source of Truth
- Theme provider: `src/theme/ThemeProvider.tsx`
- Semantic color tokens: `src/theme/theme.ts`
- Structural tokens: `src/theme/tokens.ts`
- Full specification: `docs/design-system.md`
- Theme mode storage: `src/services/storage.ts`

## Required Rules
1. Use `useAppTheme()` in UI components that need colors.
2. Read colors only from `theme.colors`.
3. Build styles with a factory pattern:
   - `const styles = useMemo(() => createStyles(theme.colors), [theme]);`
4. For text inputs, use themed placeholder colors (`placeholderTextColor={theme.colors.textSubtle}`).
5. For markdown or rich content, generate themed style objects from `theme.colors`.
6. Use `LineHeight` with `FontSize`; do not create intermediate type steps with arithmetic.
7. Use `StyleSheet.hairlineWidth` for ordinary surface edges.

## Forbidden Patterns
1. Do not hardcode hex/rgb/rgba colors inside screen/component files.
2. Do not define local color palettes in business UI files.
3. Do not branch on dark/light manually in multiple places when a token can represent the intent.

## How To Add New Colors
1. Add semantic token(s) to both light and dark palettes in `src/theme/theme.ts`.
2. Name tokens by intent, not literal color (example: `surfaceElevated`, `textMuted`).
3. Consume the new token via `theme.colors.<token>` in components.

## Validation Checklist (PR Self-Check)
1. `Follow System` mode: switching OS light/dark updates UI correctly.
2. Manual `Light` mode renders correctly.
3. Manual `Dark` mode renders correctly.
4. Chat and Config tabs keep consistent theme when switching tabs.
5. Status bar style matches background contrast.
6. Run typecheck: `npx tsc --noEmit`.
7. Run the design-system gate: `npm run check:design-system`.

## Notes
- The architecture supports extension (e.g. high-contrast theme), but only if new UI uses semantic tokens.
- If a component needs a one-off visual state, add a token instead of hardcoding a color.

# Button and Control Rules

1. Page-level text CTAs use shared `Button`; do not hand-roll `Pressable` plus primary/error chrome in screens.
2. Compact icon chrome uses `ActionButton`. `IconButton` is retained for legacy bare-icon call sites; migrate it when touching that surface. `CircleButton` remains for specialized primary circular actions such as send and scroll-to-bottom.
3. Standard standalone controls are `ControlSize.standard` (44). Compact grouped controls may use `ControlSize.compact` (36); settings rows use `ControlSize.settingsRow` (56).
4. Use Lucide icons only for button icons; do not use unicode symbol text such as `✕`, `←`, `↑`, `+`.
5. Button/action callers may override layout only. Background, edge, radius, typography, pressed, disabled, and loading behavior belong to the shared component.
6. `Button` variants are `primary`, `secondary`, `ghost`, and `destructive`; sizes are `sm`, `md`, and `lg`.
7. Special brand/media/export controls may keep custom presentation, but ordinary app chrome around them still uses shared controls.

# Top Navigation Bar Rules

All page-level top navigation bars must follow the same visual system as Chat header.

## Required Rules
1. Use a consistent header container style:
   - `paddingHorizontal: 4`
   - `paddingBottom: 2`
   - Push/back headers use the safe-area inset directly (`insets.top` or `topInset`) with no extra offset.
   - Modal/close headers use compact top padding; prefer `ModalScreenLayout` or `ScreenHeader` with `dismissStyle="close"` for content headers.
2. Use `IconButton` + Lucide for header icon actions (back/menu/refresh/add/edit/delete/play).
   - When the action is rendered inside a header slot, prefer `HeaderActionButton`.
   - For text-only header actions such as `Save`, `Done`, or `Edit`, use `HeaderTextAction`.
3. Header icon color must be `theme.colors.textMuted` for visual consistency across pages.
4. Keep header title style consistent: centered, `fontSize: 16`, `fontWeight: '600'`, `color: theme.colors.text`.
5. Keep left/right action slot widths symmetric (typically `44`) so title alignment is stable.
6. Avoid page-specific accent colors for header icons; only use disabled state colors (for example `theme.colors.textSubtle`) when interaction is unavailable.

## Native Modal Header Rules
1. Standard modal list/detail/display pages should use `useNativeStackModalHeader()` instead of rendering a page-level `ScreenHeader` inside content.
2. Use `HeaderActionButton` for native-stack header actions; do not hand-roll `IconButton` + themed Lucide icon in each screen.
3. Reserve native-stack modal headers for standard pages with simple title + close + 0-2 actions.
4. Keep custom in-content `ScreenHeader` only for pages that need richer layout, embedded tabs above the content, or page-specific visual structure that native-stack headers cannot express cleanly.
5. When a screen moves to `useNativeStackModalHeader()`, the first content section must still keep a deliberate top gap (`Space.sm` or `Space.md`) so cards/lists do not visually stick to the navigation bar.

## Custom Header Rules
1. Use `ScreenHeader` for non-native page headers only when the page needs content-owned chrome, such as embedded segmented tabs, complex multi-action toolbars, or layouts reused both as standalone pages and embedded sections.
2. Custom `ScreenHeader` pages must keep the same visual contract as native modal headers:
   - centered title
   - symmetric `44` left/right slots
   - `theme.colors.surface` background
   - `theme.colors.textMuted` icon color
3. Use `HeaderActionButton` for icon actions inside `ScreenHeader.rightContent`.
4. Use text actions in the header sparingly. Prefer a single semibold action label; keep it short (`Save`, `Edit`, `Done`) and render it with `HeaderTextAction`.
5. After a custom `ScreenHeader`, content should start with a deliberate section rhythm:
   - list/filter surfaces: `Space.sm`
   - card/form/detail content: `Space.md` to `Space.lg`
6. If a page currently renders `ScreenHeader` only for back/close + one simple action, prefer migrating it to `useNativeStackModalHeader()` instead of adding more custom header code.

## First-Screen Rhythm Rules
1. Use shared helpers from `src/components/ui/screenLayout.ts` for page content spacing instead of hand-tuning one-off `paddingTop` and `paddingBottom` values in each screen.
2. Standard list/detail pages should start from these defaults:
   - list content: `createListContentStyle()`
   - card/detail scroll content: `createCardContentStyle()`
   - list header/banner spacing: `createListHeaderSpacing()`
3. For list screens with empty states, prefer `grow: true` content containers so `EmptyState` stays vertically balanced.
4. Search bars, filter chips, and top summary banners should align to the same first-section offset as the list content below them; do not create a separate larger top rhythm unless the page is intentionally hero-led.
5. Empty states should feel centered within the content region, not glued to the header and not pushed too far down the screen.

# Componentization & Logic Split Rules

## Screen Layer Responsibilities
1. `src/screens/*` only orchestrates page-level state and wiring (navigation, gateway lifecycle, high-level composition).
2. For complex pages, prefer screen-as-folder layout: `src/screens/FeatureScreen/index.tsx + use*.ts + *Layout.tsx`.
3. Avoid putting large render blocks directly in screen files; move stable UI sections to `src/components/**`.
4. Avoid putting parsing/normalization/business transformations in screens; move them to `src/utils/**`.

## Hook vs Utils Boundaries
1. Put React stateful, side-effectful reusable logic in `src/hooks/**` (examples: picker state, modal interaction state, form state).
2. Put pure deterministic functions in `src/utils/**` (examples: message parsing, payload shaping, label formatting).
3. Hooks should return explicit action methods (`save`, `reset`, `pickImage`) instead of exposing scattered internal state updates.

## Component Granularity (Do / Don't)
1. Do extract by semantic section (Header, Composer, Sidebar, HelpSection), not by tiny primitives.
2. Don't over-split one-off markup into many micro-components that add prop-drilling without reuse value.
3. Prefer “container screen + presentational component” split for complex screens.

## Types & Contracts
1. Shared cross-screen UI contracts go to `src/types/**` (example: chat UI message, pending attachment).
2. Keep component prop types local to component files unless reused in multiple places.
3. When moving logic out of screens, preserve existing behavior and event ordering first, then optimize.

## Refactor Safety Checklist
1. Keep the Gateway event flow behavior unchanged when extracting hooks/components.
2. Preserve existing user-visible copy and interaction behavior unless explicitly requested.
3. After refactor, run `npx tsc --noEmit` and verify Chat/Config critical paths still work.

# Unit Testing Rules

The project uses Jest + ts-jest for unit testing. Tests cover utils, services, hooks, and data modules.

## Test Infrastructure
- Config: `jest.config.ts` (ts-jest, node environment)
- Setup: `jest.setup.ts` (mocks for AsyncStorage, expo-linking, expo-secure-store, expo-haptics, expo-clipboard, crypto)
- RN mock: `__mocks__/react-native.ts` (Platform, Alert, StyleSheet, etc.)
- Run: `npm test` / `npm run test:coverage`

## Post-Change Testing Requirements

After completing any task that modifies logic (not pure UI-only styling changes), you **must**:

1. **Run existing tests:** Execute `npm test` and confirm all tests pass. If any test fails due to your change, fix the test or the code — do not leave broken tests.
2. **Evaluate whether new tests are needed.** Add tests when your change:
   - Adds or modifies a pure function in `src/utils/` or `src/services/`
   - Changes event handling, parsing, formatting, or data transformation logic
   - Adds or modifies a custom hook's stateful logic in `src/hooks/`
   - Changes GatewayClient behavior (event dispatch, message extraction, state transitions)
   - Fixes a bug — add a regression test that would have caught the bug
3. **Skip new tests** when the change is purely:
   - UI layout / styling (colors, spacing, component arrangement)
   - Adding a new screen with no novel logic (just wiring existing hooks/utils)
   - Updating static data (e.g. adding an entry to a list with no new logic)

## How to Write Tests

- **File placement:** Test files go next to source — `foo.ts` → `foo.test.ts`
- **Structure:** Use `describe` / `it` blocks with clear English descriptions
- **Pure functions:** Test directly — import and call with various inputs, assert outputs
- **Hooks:** Use `renderHook` from `@testing-library/react-native`, or mock `react` primitives if the hook is too coupled to RN
- **Services with external deps:** Mock WebSocket, AsyncStorage, expo modules — never make real network calls
- **Edge cases to cover:** null/undefined inputs, empty arrays, boundary values, error paths
- **Test names:** Describe the behavior, not the implementation (e.g. "returns empty string for null input" not "checks if input is null")

## What NOT to Test
- React component rendering / UI layout — only logic
- Third-party library internals
- Trivial pass-through functions with no branching

# Design Tokens

All structural style values (spacing, font size, border radius, shadows, animation presets) must come from `src/theme/tokens.ts`.

## Token Reference

| Category | Token | Value | Usage |
|----------|-------|-------|-------|
| **Spacing** | `Space.xs` | 4 | Tight gaps, icon margins |
| | `Space.sm` | 8 | Standard inner padding |
| | `Space.md` | 12 | Card padding, section gaps |
| | `Space.lg` | 16 | Screen padding, generous spacing |
| | `Space.xl` | 24 | Section separators, large gaps |
| | `Space.xxl` | 32 | Major section breaks |
| | `Space.xxxl` | 48 | Bottom padding for scroll content |
| **Font Size** | `FontSize.nano` / `micro` | 9 / 10 | Exceptional dense labels only |
| | `FontSize.xs` | 11 | Badges, timestamps |
| | `FontSize.sm` | 12 | Captions, helper text |
| | `FontSize.md` | 13 | Descriptions, secondary text |
| | `FontSize.bodySm` | 14 | Compact body/control text |
| | `FontSize.base` | 15 | Body text, input text, card titles |
| | `FontSize.lg` | 16 | Screen titles |
| | `FontSize.xl` | 18 | Large headings (rare) |
| | `FontSize.displaySm` | 20 | Compact display text |
| | `FontSize.xxl` | 22 | Emoji icons in cards |
| | `FontSize.displayMd` | 26 | Compact display values |
| | `FontSize.xxxl` | 28 | Display numerals and hero text |
| | `FontSize.displayLg` | 36 | Large identity emoji/display text |
| **Line Height** | `LineHeight.xs` → `LineHeight.xxxl` | 14 → 34 | Matched leading for every font step |
| **Font Weight** | `FontWeight.regular` | 400 | Body text |
| | `FontWeight.medium` | 500 | Subtle emphasis |
| | `FontWeight.semibold` | 600 | Titles, card titles, labels |
| | `FontWeight.bold` | 700 | Strong emphasis only |
| **Radius** | `Radius.xs` | 4 | Compact indicators and tight inner corners |
| | `Radius.sm` | 8 | Tags, badges, small cards |
| | `Radius.md` | 12 | Standard cards and grouped controls |
| | `Radius.lg` | 18 | Inputs and large buttons |
| | `Radius.xl` | 24 | Modal cards and large floating surfaces |
| | `Radius.full` | 9999 | Perfect circles |
| **Border** | `BorderWidth.hairline` | platform | Ordinary semantic edges |
| | `BorderWidth.strong` | 2 | Deliberate selection/artifact frames only |
| | `BorderWidth.emphasis` | 3 | Scanner corners and high-visibility presentation marks only |
| **Presentation** | `PresentationColor.*` | — | Theme-independent media overlays, exported artwork, and data visualization only |
| **Control Size** | `ControlSize.compact` | 36 | Grouped toolbar controls |
| | `ControlSize.standard` | 44 | Standard actions and search |
| | `ControlSize.large` / `field` | 48 | Large CTA / form field |
| | `ControlSize.settingsRow` | 56 | Grouped settings rows |
| | `ControlSize.settingsIcon` | 32 | Semantic settings icon badges |
| **Shadow** | `Shadow.xs` | — | Selected chips and subtle capsules |
| | `Shadow.sm` | — | Subtle lift (cards) |
| | `Shadow.md` | — | Floating elements (FAB, popover) |
| | `Shadow.lg` | — | Modals, overlays |

## Shared UI Components (`src/components/ui/`)

| Component | Purpose | When to use |
|-----------|---------|-------------|
| `Button` | Shared text CTA | Save, connect, retry, confirm, destructive actions |
| `ActionButton` | Shared compact icon chrome | Header, toolbar, composer, floating utility actions |
| `IconButton` | Bare icon touch target | Header actions, toolbar, inline utilities |
| `HeaderActionButton` | Header icon action button | Actions shown inside native-stack headers and `ScreenHeader.rightContent` |
| `HeaderTextAction` | Header text action | Text-only actions inside native-stack headers and `ScreenHeader.rightContent` |
| `CircleButton` | Solid circle + icon | Send, scroll-to-bottom, FAB |
| `ScreenHeader` | Top navigation bar | All Console sub-pages (not Chat — Chat has its own header) |
| `ModalScreenLayout` | Page-level modal shell | Native-stack modal/detail screens with a close-style header |
| `Card` | Shared surface container | List items, menu items, detail sections; use variants rather than local chrome |
| `LoadingState` | Centered spinner + message | Full-screen loading |
| `EmptyState` | Icon + title + optional action | Empty lists, no results |
| `SegmentedTabs` | iOS-style segmented tab bar | Any page with 2+ switchable views (Cron Runs/Jobs, Connections Channels/Nodes) |
| `ModalSheet` | Centered card modal with backdrop | All centered-card modals (tool detail, avatar, editor, picker) |
| `SearchInput` | Pill-shaped search field with icon | Any list/page that needs keyword filtering |
| `FormTextInput` | Shared form field | Standard single-line/multiline forms; use sunken mode inside cards/modals |
| `SettingsIcon` | Semantic settings icon badge | Accent/info/success/warning/danger/neutral settings affordances |
| `ThemedSwitch` | Theme-aware binary control | All ordinary toggles; do not use native `Switch` directly |
| `SettingsGroup` / `SettingsRow` / `SettingsDivider` | Grouped settings chrome | Settings screens and settings-like modal sections |

**IMPORTANT:** Whenever you create, refactor, or extract a new shared UI component into `src/components/ui/`, update this table and `docs/design-system.md`. `CLAUDE.md` is a symlink and must not be edited separately.

## Adding New Tokens
1. Add to `src/theme/tokens.ts` with a clear semantic name.
2. Update the token reference table in this file.
3. Prefer extending existing scales (add `Space.xxxl` not `Space.mySpecialPadding`).
4. Ordinary surface chrome must flow through `createSurfaceStyle`; raw shadow tokens are reserved for documented presentation previews.
5. `PresentationColor` is limited to media, export, scanner, and data-viz content. Never use it instead of `theme.colors` for ordinary app chrome.

# Cross-Tab Navigation Rules

## Architecture
The app uses a bottom-tab navigator with nested stack navigators per tab (e.g. Console tab contains a `ConsoleStack` with `ConsoleMenu` → sub-screens).

The root tab navigator must use `@react-navigation/bottom-tabs` on every platform. Do not reintroduce `@bottom-tabs/react-navigation`, `react-native-bottom-tabs`, SF Symbols tab descriptors, or a native Liquid Glass path. JS tabs already occupy layout space; never add `tabBarHeight` to ordinary screen, drawer, list, composer, or scroll padding. Use `useTabBarHeight()` only for full-screen overlays or keyboard policies that need the physical measurement. Root tab availability remains capability-gated so OpenClaw and Hermes preserve their supported page sets.

## Required Rules
1. **Never use `CommonActions.navigate` with `params: { screen: 'SubScreen' }` to deep-link into a nested stack from another tab.** This replaces the entire stack state with only the target screen — the stack root is lost, so the back button jumps to the previous tab instead of the stack root.
2. When navigating from another tab (for example Live) into a nested stack screen (for example Console → Usage), explicitly set the stack state with the root screen at the bottom:
   ```typescript
   navigation.dispatch(
     CommonActions.navigate({
       name: 'Console',
       params: {
         state: {
           routes: [
             { name: 'ConsoleMenu' },
             { name: 'Usage' },
           ],
         },
       },
     }),
   );
   ```
3. For navigating to just the tab root (no sub-screen), `navigation.navigate('Console')` is fine.

## Live Product Structure
1. The root tab and internal navigation route are both named `Live`. It uses the shared Lucide `Activity` icon, is intentionally headerless, and begins below the platform safe area.
2. Live may show only state backed by real gateway signals such as sessions, run lifecycle events, tool events, usage, cron failures, and pairing requests.
3. Do not infer task completion from message volume or session recency. Completion and failure labels must come from explicit runtime events; recency may be labeled only as working, recent, or standby.
4. Preserve backend-aware session scope. OpenClaw sessions are agent-prefixed; Hermes uses global session keys and must not be filtered through OpenClaw prefix assumptions.
5. Bring personality into Live through real member identity, restrained status motion, tool activity, and explicit completion feedback. Respect the system reduce-motion setting and keep information legibility ahead of decoration.
6. Keep Live implementation under `src/screens/LiveScreen/` and its pure aggregation logic in `src/services/live-dashboard.ts`.

# Tab UI Rules

All tabbed page layouts must use the shared `SegmentedTabs` component (`src/components/ui/SegmentedTabs.tsx`).

## Required Rules
1. **Always use `SegmentedTabs`** for switchable tab views — never hand-roll tab bar UI.
2. Define tab items as a typed constant array outside the component:
   ```typescript
   const MY_TABS: { key: MyTab; label: string }[] = [
     { key: 'first', label: 'First' },
     { key: 'second', label: 'Second' },
   ];
   ```
3. Place `<SegmentedTabs>` directly below `<ScreenHeader>` in the page layout.
4. Each tab's content should be a separate component (not inline JSX) to keep the main screen file clean.

## Usage
```tsx
import { SegmentedTabs } from '../../components/ui';

<SegmentedTabs tabs={MY_TABS} active={tab} onSwitch={setTab} />
```

# Centered Modal Rules

All centered-card modals (confirmation dialogs, pickers, detail views, editors) must use the shared `ModalSheet` component (`src/components/ui/ModalSheet.tsx`).

## Required Rules
1. **Always use `ModalSheet`** for centered-card modals — never hand-roll `<Modal>` + backdrop + card + header.
2. Pass `title` for a standard header with title text + X close button. Omit `title` for custom header layouts.
3. Use `headerRight` for extra elements between the title and close button (e.g. duration badge, status indicator).
4. Use `maxHeight` to control card height (default `'75%'`).
5. Content goes as `children` — `ModalSheet` handles the outer shell only.

## When NOT to use ModalSheet
- Bottom-sheet modals (e.g. `ModelPickerModal`, `CommandOptionPickerModal`) that are bottom-aligned with top-rounded-only corners and `FlatList` — these have a different layout pattern.

## Usage
```tsx
import { ModalSheet } from '../../components/ui';

<ModalSheet visible={visible} onClose={onClose} title="Edit Connection" maxHeight="70%">
  <ScrollView>{/* modal content */}</ScrollView>
</ModalSheet>
```

# Modal Screen Layout Rules

All native-stack modal/detail pages that use a close-style header should use the shared `ModalScreenLayout` component (`src/components/ui/ModalScreenLayout.tsx`) unless the screen is already delegating to a reusable view with its own header API.

## Required Rules
1. **Always use `ModalScreenLayout`** for page-level modal/detail screens that need close semantics instead of back semantics.
2. Pass `onClose` and let the layout render the close affordance; do not hand-roll a separate modal-page header.
3. Use `rightContent` for lightweight title-bar actions such as save/edit/run.
4. Keep scrolling inside the screen body; `ModalScreenLayout` only owns the outer shell and header.

# OpenClaw Native Setup Handoff

1. Official setup credentials are an internal onboarding mechanism, not a user-selectable auth mode or compatibility setting.
2. Use the setup credential only for the temporary node-role handshake, then persist the operator handoff token with the exact scopes returned by OpenClaw and reconnect automatically.
3. Sign device auth with the timestamp from `connect.challenge`; do not substitute the local clock.
4. Keep stored token records gateway-scoped, migrate legacy raw token strings, and clear stale tokens on structured token or scope mismatch errors.
5. Older Relay responses without strategy metadata remain legacy-bound bootstrap responses. Preserve existing token/password and Hermes connection paths.
6. Advertise `openclaw.bootstrap.mobile-setup.v1` only on the OpenClaw bootstrap request. Missing or unknown capability metadata must remain compatible with legacy Bridge responses and must never surface as a user-selectable mode.

# Secure Short-Code Pairing

1. Six-digit pairing codes must use the scoped version-2 Relay handshake; never use six decimal digits directly as a payload decryption key.
2. Pairing-ticket sockets may carry only `pairing.secure.*` control frames and must close before the normal Relay claim/reconnect flow begins.
3. Verify the Bridge's code-bound response proof before decrypting its ephemeral TweetNaCl box payload.
4. Continue accepting legacy 12-character codes and the compact QR payload so new Apps remain compatible with older Bridge/Registry deployments.

# iOS Local Signing Compatibility

1. Release builds keep the Associated Domains entitlement for Universal Links.
2. `npm run dev` derives a Debug-only entitlement file without Associated Domains by default so an existing local provisioning profile can still install the App; the `clawket://` pairing fallback remains available.
3. Set `CLAWKET_IOS_DEV_UNIVERSAL_LINKS=1` only when intentionally testing Universal Links with a provisioning profile that includes Associated Domains.
