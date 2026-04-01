# Overview

Clawket is a mobile client for OpenClaw (iOS/Android, React Native + Expo) inside the Clawket monorepo.

For OpenClaw protocol details and reference implementations, see: `../../../../openclaw` or `/Users/lucy/Desktop/op/openclaw`

If the task involves Android development or building an Android release package, refer to `docs/android-build.md`.
If the task involves setting up a fresh machine for Android packaging, read `docs/android-onboarding.md` before changing code.

# Android Packaging Notes

For Android release work, keep these facts in mind:

1. The canonical store-build command is `pnpm run build:android:aab`.
2. That script now builds Office assets, runs `expo prebuild --platform android --no-install`, and then builds the signed release `.aab`.
3. Android upload builds depend on local secrets that are not in git:
   - `apps/mobile/.env.local`
   - `apps/mobile/android/app/keystore.properties` or `CLAWKET_ANDROID_KEY_*`
   - the upload keystore file itself
4. The repo supports overriding Play `versionCode` with `EXPO_ANDROID_VERSION_CODE`.
5. If `EXPO_ANDROID_VERSION_CODE` is not set, `build:android:aab` will auto-pick a version code based on the current native project state.
6. On macOS, prefer Homebrew `openjdk@17` at `/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home` for Android builds. This avoids the Gradle `IBM_SEMERU` toolchain issue seen with some other detected JDKs.
7. Local temporary Pro verification uses `pnpm run build:android:pro-temp`. Do not confuse it with real Google Play purchase validation.

# Clawket Ecosystem — Cross-Repository Awareness

This app lives inside the Clawket monorepo. When your task involves connection, pairing, relay, bridge, or protocol issues, you **must** check the sibling workspace folders first:

| Repo | Path | Role |
|------|------|------|
| **mobile** (this app) | `.` | Mobile app (RN + Expo) |
| **relay** | `../relay-registry`, `../relay-worker`, `../../packages/relay-shared` | Cloudflare relay + registry |
| **bridge** | `../bridge-cli`, `../../packages/bridge-core`, `../../packages/bridge-runtime` | Local bridge CLI (pnpm `@p697/clawket`) |

## Language Policy
- All code comments and commit messages **must be in English**.
- No Chinese (or other non-English) text in source files — translations belong exclusively in locale files (`src/i18n/locales/` and `office-game/src/locales/`).

## Gateway Config Safety
- Any flow that patches Gateway config must show a secondary confirmation dialog, because the change will restart Gateway and may interrupt active OpenClaw tasks.

## Global Loading Overlay Rules
- Use the shared global loading overlay for transient app-wide loading states that should appear above the current UI without tearing down the screen underneath.
- Preferred entrypoint: `src/contexts/GlobalLoadingOverlayContext.tsx` with `useGlobalLoadingOverlay()`. The root overlay component is `src/components/ui/GlobalLoadingOverlay.tsx`.
- `useGatewayOverlay`, `GatewayOverlayProvider`, and `GatewaySwitchOverlay` still exist, but they are compatibility aliases. New work should target the global naming rather than adding more Gateway-specific overlay usage.
- Use `LoadingState` only for genuine screen-level loading pages. If the UX should keep the current page visible and show a centered spinner above it, use the global overlay instead.
- If the user can dismiss a modal while an action is still running, pair the global overlay with `usePreventRemove` or equivalent exit confirmation logic so swipes/back actions do not silently interrupt work.

## Release Update Modal
- The Chat first-screen release/update modal content lives in `src/features/app-updates/currentAnnouncement.ts`.
- If the task is “edit the update popup” (copy, button text, version, or jump target), change that file first rather than hunting through Chat UI code.
- Any new user-facing strings added there must also be added to all 6 RN locale files in `src/i18n/locales/{en,zh-Hans,ja,ko,de,es}/chat.json`.
- The modal's local-cache/version gating lives in `src/services/app-update-announcement.ts`; the visual component lives in `src/screens/ChatScreen/components/AppUpdateAnnouncementModal.tsx`.

# Internationalization (i18n) Rules

All user-visible text in Clawket must be internationalized. Hardcoding UI strings is forbidden.

## Supported Locales
- English (`en`) — default/fallback
- Simplified Chinese (`zh-Hans`)
- Japanese (`ja`)
- Korean (`ko`)
- German (`de`)
- Spanish (`es`)

## Two Runtimes

The app has two separate i18n systems that must be kept in sync:

| Runtime | Stack | Translation Files | Usage |
|---------|-------|-------------------|-------|
| **React Native** | `i18next` + `react-i18next` | `src/i18n/locales/{en,zh-Hans,ja,ko,de,es}/{common,chat,config,console}.json` | `useTranslation()` hook → `t('key')` |
| **Office WebView** | `office-game/src/i18n.ts` | `office-game/src/locales/{zh-Hans,ja,ko,de,es}.ts` | `t('key')` from `./i18n` import |

## Key Design
- Natural English text as keys: `t('Save')`, `t('Loading...')`.
- Missing translations fall back to the key itself (readable English).
- RN has 4 namespaces: `common`, `chat`, `config`, `console`. Cross-namespace: `t('common:Save')`.

## Required Rules
1. **Every new user-visible string must use `t()`.** No hardcoded UI text in screens, components, alerts, empty states, button labels, or placeholder text.
2. **Add keys to ALL 6 locale translation files** (`en`, `zh-Hans`, `ja`, `ko`, `de`, `es`) when introducing new strings. Never leave a key present in only some locales.
3. **Translation keys must be natural English text** (e.g. `t('Save')`, `t('Loading...')`). Never use non-English text as keys.
4. **Constants with translatable labels** (e.g. tab arrays, picker options) must be computed inside the component (via `useMemo`) so they have access to `t()`. Do not define translated constants at module level.
5. **Alert.alert() calls** must wrap title, message, and button labels with `t()` or `t('common:...')`.
6. **Office game strings** use the same `t()` pattern from `office-game/src/i18n.ts`. New bubble texts, menu labels, and report comments all need corresponding entries in **all 5** non-English locale files (`zh-Hans.ts`, `ja.ts`, `ko.ts`, `de.ts`, `es.ts`).

## Forbidden Patterns
1. Do not hardcode user-visible English strings in source files — always use `t()`.
2. Do not add a translation key to one locale without adding it to **all 6 locales**. Every key must exist in every locale file.
3. Do not use `t()` for internal identifiers, log messages, or technical strings that users never see.
4. Do not use non-English text as translation keys — keys must always be English.

## How to Add New Strings (RN)
1. Choose the correct namespace (`common` for shared terms, or the screen-specific namespace).
2. Add the key to **all 6** locale files: `src/i18n/locales/{en,zh-Hans,ja,ko,de,es}/<namespace>.json`.
3. Use `const { t } = useTranslation('<namespace>')` in the component, then `t('Your new string')`.

## How to Add New Strings (Office Game)
1. Wrap the string with `t()` from `import { t } from './i18n'`.
2. Add translations to **all 5** non-English locale files: `office-game/src/locales/{zh-Hans,ja,ko,de,es}.ts`.
3. English fallback is automatic (the key itself).

## Locale Delivery
- RN: `expo-localization` detects device locale; `i18next` manages switching.
- Office WebView: RN sends a `LOCALE` bridge message; office calls `setLocale()`.

## Validation Checklist
1. All 6 locale JSON files (`en`, `zh-Hans`, `ja`, `ko`, `de`, `es`) have the same set of keys (no orphans).
2. All 5 Office game locale files have the same set of keys.
3. `pnpm run typecheck` passes.
4. `cd office-game && pnpm run build` passes.

# Analytics Rules

Clawket uses PostHog for product analytics. Keep instrumentation centralized, reusable, and focused on product decisions.

## Required Rules
1. **All critical features must ship with analytics.** This is especially mandatory for subscription, paywall, restore, purchase, and other revenue flows, plus core actions such as connect, send, create, and save.
2. **Reuse the shared analytics layer.** Add semantic event helpers in `src/services/analytics/events.ts` and keep provider/client wiring in `src/services/analytics/`; do not duplicate near-identical `posthog.capture(...)` blocks in multiple screens.
3. **Track meaningful actions, not noise.** Prefer business events and small stable properties (source, mode, count, booleans). Avoid sensitive data and high-cardinality payloads.

## Notes
1. Route-level screen tracking is centralized at the app root; update `src/utils/posthog-navigation.ts` when adding new navigable screens.
2. If a PR changes a core workflow or paywall flow, the PR should update analytics in the same change.

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
5. Run `pnpm run config:check:ios`.
6. Run the affected tests and `pnpm run typecheck`.

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
- Theme tokens: `src/theme/theme.ts`
- Theme mode storage: `src/services/storage.ts`

## Required Rules
1. Use `useAppTheme()` in UI components that need colors.
2. Read colors only from `theme.colors`.
3. Build styles with a factory pattern:
   - `const styles = useMemo(() => createStyles(theme.colors), [theme]);`
4. For text inputs, use themed placeholder colors (`placeholderTextColor={theme.colors.textSubtle}`).
5. For markdown or rich content, generate themed style objects from `theme.colors`.

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
6. Run typecheck: `pnpm run typecheck`.

## Notes
- The architecture supports extension (e.g. high-contrast theme), but only if new UI uses semantic tokens.
- If a component needs a one-off visual state, add a token instead of hardcoding a color.

# Small Button Component Rules

When implementing compact icon-only buttons, always use shared UI components from `src/components/ui`.

## Required Rules
1. Use `IconButton` for bare icon actions (header/toolbar/inline utility actions).
2. Use `CircleButton` only for primary circular actions (send, scroll-to-bottom, FAB-like actions).
3. Use Lucide icons only for button icons; do not use unicode symbol text such as `✕`, `←`, `↑`, `+`.
4. Keep touch target size at least 44 for standalone actions; 36-40 is allowed for tightly grouped inline actions.
5. Prefer `strokeWidth={2}` by default; use `2.5` only for emphasized actions.

# Full-Width Button Rules

Full-width buttons are page-level actions that span the available content width (e.g. Save & Connect, Scan QR Code, Reset Device).

## Standard Spec

| Property | Value | Token |
|----------|-------|-------|
| `paddingVertical` | 11 | — |
| `borderRadius` | 12 | `Radius.md` |
| `fontSize` | 15 | `FontSize.base` |
| `fontWeight` | 600 | `FontWeight.semibold` |
| Inline icon size | 15 | — |
| Inline icon `strokeWidth` | 2 | — |

## Variants

| Variant | Background | Border | Text color |
|---------|------------|--------|------------|
| Primary | `colors.primary` | none | `colors.primaryText` |
| Outline | `colors.surface` | `1px colors.primary` | `colors.primary` |
| Destructive | `colors.surface` | `1px colors.error` | `colors.error` |

## Required Rules
1. All full-width buttons must use `paddingVertical: 11` and `borderRadius: Radius.md` — never deviate for visual parity.
2. Text must be `FontSize.base` + `FontWeight.semibold` — do not use `bold` or a different size.
3. Pressed state: Primary → `opacity: 0.88`; Outline/Destructive → `backgroundColor: colors.surfaceMuted`.
4. Buttons with an icon: use `flexDirection: 'row'`, `alignItems: 'center'`, `gap: Space.sm`, icon size 15, `strokeWidth={2}`.

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
3. After refactor, run `pnpm run typecheck` and verify Chat/Config critical paths still work.

# Unit Testing Rules

The project uses Jest + ts-jest for unit testing. Tests cover utils, services, hooks, and data modules.

## Test Infrastructure
- Config: `jest.config.ts` (ts-jest, node environment)
- Setup: `jest.setup.ts` (mocks for AsyncStorage, expo-linking, expo-secure-store, expo-haptics, expo-clipboard, crypto)
- RN mock: `__mocks__/react-native.ts` (Platform, Alert, StyleSheet, etc.)
- Run: `pnpm test` / `pnpm run test:coverage`

## Post-Change Testing Requirements

After completing any task that modifies logic (not pure UI-only styling changes), you **must**:

1. **Run existing tests:** Execute `pnpm test` and confirm all tests pass. If any test fails due to your change, fix the test or the code — do not leave broken tests.
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
| **Font Size** | `FontSize.xs` | 11 | Badges, timestamps |
| | `FontSize.sm` | 12 | Captions, helper text |
| | `FontSize.md` | 13 | Descriptions, secondary text |
| | `FontSize.base` | 15 | Body text, input text, card titles |
| | `FontSize.lg` | 16 | Screen titles |
| | `FontSize.xl` | 18 | Large headings (rare) |
| | `FontSize.xxl` | 22 | Emoji icons in cards |
| **Font Weight** | `FontWeight.regular` | 400 | Body text |
| | `FontWeight.medium` | 500 | Subtle emphasis |
| | `FontWeight.semibold` | 600 | Titles, card titles, labels |
| | `FontWeight.bold` | 700 | Strong emphasis only |
| **Radius** | `Radius.sm` | 8 | Tags, badges, small cards |
| | `Radius.md` | 12 | Standard cards, modals |
| | `Radius.lg` | 20 | Pill inputs, large buttons |
| | `Radius.full` | 9999 | Perfect circles |
| **Shadow** | `Shadow.sm` | — | Subtle lift (cards) |
| | `Shadow.md` | — | Floating elements (FAB, popover) |
| | `Shadow.lg` | — | Modals, overlays |

## Shared UI Components (`src/components/ui/`)

| Component | Purpose | When to use |
|-----------|---------|-------------|
| `IconButton` | Bare icon touch target | Header actions, toolbar, inline utilities |
| `HeaderActionButton` | Header icon action button | Actions shown inside native-stack headers and `ScreenHeader.rightContent` |
| `HeaderTextAction` | Header text action | Text-only actions inside native-stack headers and `ScreenHeader.rightContent` |
| `CircleButton` | Solid circle + icon | Send, scroll-to-bottom, FAB |
| `ScreenHeader` | Top navigation bar | All Console sub-pages (not Chat — Chat has its own header) |
| `ModalScreenLayout` | Page-level modal shell | Native-stack modal/detail screens with a close-style header |
| `Card` | Rounded surface container | List items, menu items, detail sections |
| `LoadingState` | Centered spinner + message | Full-screen loading |
| `EmptyState` | Icon + title + optional action | Empty lists, no results |
| `SegmentedTabs` | iOS-style segmented tab bar | Any page with 2+ switchable views (Cron Runs/Jobs, Connections Channels/Nodes) |
| `ModalSheet` | Centered card modal with backdrop | All centered-card modals (tool detail, avatar, editor, picker) |
| `SearchInput` | Pill-shaped search field with icon | Any list/page that needs keyword filtering |

**IMPORTANT:** Whenever you create, refactor, or extract a new shared UI component into `src/components/ui/`, you **must** update this table and add corresponding usage rules to this file and `AGENTS.md`.

## Adding New Tokens
1. Add to `src/theme/tokens.ts` with a clear semantic name.
2. Update the token reference table in this file.
3. Prefer extending existing scales (add `Space.xxxl` not `Space.mySpecialPadding`).

# Cross-Tab Navigation Rules

## Architecture
The app uses a bottom-tab navigator with nested stack navigators per tab (e.g. Console tab contains a `ConsoleStack` with `ConsoleMenu` → sub-screens).

## Required Rules
1. **Never use `CommonActions.navigate` with `params: { screen: 'SubScreen' }` to deep-link into a nested stack from another tab.** This replaces the entire stack state with only the target screen — the stack root is lost, so the back button jumps to the previous tab instead of the stack root.
2. When navigating from another tab (e.g. Office) into a nested stack screen (e.g. Console → Usage), explicitly set the stack state with the root screen at the bottom:
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

## Reference
- Helper pattern: see `navigateToConsoleScreen()` in `src/screens/OfficeScreen/OfficeTab.tsx`.

# Office Game Sprite Pipeline

# Office Game Architecture Rules

## Runtime Layout
- Bootstrap and fixed-timestep loop live in `office-game/src/main.ts`.
- React Native remains the source of truth for OpenClaw data. `office-game/src/bridge.ts` only adapts bridge messages into office runtime state.
- Office simulation/domain logic lives in:
  - `office-game/src/world.ts`
  - `office-game/src/pathfinding.ts`
  - `office-game/src/character.ts`
  - `office-game/src/bubbles.ts`
  - `office-game/src/bubble-scheduler.ts`
- Office menu is split by responsibility:
  - `office-game/src/menu.ts` = facade/public API + input routing
  - `office-game/src/menu-state.ts` = mutable menu state only
  - `office-game/src/menu-model.ts` = derived data, filtering, labels, pagination data
  - `office-game/src/menu-layout.ts` = panel geometry and hit rectangles
  - `office-game/src/menu-draw.ts` = canvas drawing only
- Office renderer is split by responsibility:
  - `office-game/src/renderer.ts` = canvas lifecycle, global input handling, render pipeline orchestration
  - `office-game/src/renderer-scene.ts` = floor/furniture/character scene drawing
  - `office-game/src/renderer-overlays.ts` = whiteboard, badges, bubbles, sweat/startle overlays
  - `office-game/src/renderer-shared.ts` = small shared rendering helpers

## Required Refactor Rules
1. Keep `menu.ts` and `renderer.ts` as thin facades. Do not grow them back into thousand-line files.
2. Put pure derivation logic in `menu-model.ts` or other pure helper modules, not in drawing or bridge code.
3. Put mutable singleton UI state in `menu-state.ts`; avoid introducing duplicate ad-hoc module state elsewhere.
4. Put canvas drawing in draw-focused modules and keep side effects limited to rendering and stored hit bounds.
5. Extend office features by data flow order:
   - bridge/domain state
   - simulation/scheduler
   - render/model helpers
   - input/navigation wiring
6. Preserve the public API contracts used by the runtime:
   - `menu.ts` exports menu open/close/input/draw functions
   - `renderer.ts` exports `initRenderer()` and `render()`
7. Do not make `office-game` fetch OpenClaw data directly. RN must continue to own polling, gateway access, and navigation.
8. When adding new office interactions, prefer adding a new bridge/menu action mapping instead of hardcoding navigation logic inside draw modules.

## Office Feature Design Guidance
1. Treat the office as a data-driven management simulation, not a detached mini-game.
2. New “fun” behavior should be grounded in real OpenClaw state whenever possible (sessions, cron, usage, memory, connections, tools).
3. If a feature needs more data, extend the RN → WebView bridge in a backward-compatible message rather than scraping existing UI state in the renderer.
4. Prefer reusable event/scheduler primitives over one-off timers embedded in rendering code.
5. Before adding new office UI, first decide which layer owns it:
   - bridge/domain
   - simulation/scheduler
   - menu model/layout
   - renderer scene/overlay
6. After Office refactors or feature work, run:
   - `pnpm run typecheck`
   - `pnpm test -- --runInBand`
   - `cd office-game && pnpm run build`

## Source
- Pixel art source: `office-game/scripts/sprites/` (palette, tiles, furniture, decorations, characters)
- Generator: `office-game/scripts/generate-sprites.ts`
- Output: `office-game/sprites/` (PNG sheets + `sprites.json` frame map)
- Build: `cd office-game && pnpm dlx tsx scripts/generate-sprites.ts && pnpm run build`

## ⚠️ Sprite Registration Pitfall
`generate-sprites.ts` merges `FURNITURE` and `DECORATIONS` into a single sprite sheet. If you **rename or remove** a key that the merge logic depends on as an insertion anchor, decorations silently vanish from the sheet — `getFrame()` returns `undefined` and the entire canvas render crashes (all furniture disappears).

**Rule:** When adding/removing/renaming sprite entries in `furniture.ts` or `decorations.ts`, always verify `sprites.json` output contains ALL expected keys. Run:
```bash
pnpm dlx tsx scripts/generate-sprites.ts
# Check the "N sprites" count matches expectations
```

## Renderer Fail-Safe Rule
When introducing or changing office sprite keys, renderer code must use safe frame lookup and fallback for optional elements.

1. Use a safe lookup (`getFrameSafe` pattern with `try/catch`) instead of direct `getFrame` for optional/new sprites.
2. If a frame is missing, skip that single element or use a known fallback sprite.
3. Never allow one missing frame to abort the whole render pass.

## Furniture-Disappear Troubleshooting
If all furniture disappears after sprite work, check in this order:

1. Verify the expected key exists in `office-game/sprites/sprites.json`.
2. Regenerate sprite assets and rebuild:
```bash
cd office-game
pnpm dlx tsx scripts/generate-sprites.ts
pnpm run build
```
3. Confirm renderer mapping and fallback paths cover the new key (especially optional decorations).

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
