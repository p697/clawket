# Clawket Mobile Design System

This document is the implementation source of truth for Clawket's mobile UI. It borrows the discipline of YouMind Mobile—semantic colors, structural tokens, shared primitives, and ratcheted style checks—while keeping an independent visual language.

Clawket should feel like a calm technical workspace: cool layered surfaces, compact but readable controls, restrained elevation, and a configurable accent. It must not inherit YouMind's neutral black-and-white palette or its product-specific component vocabulary.

## 1. Sources of truth

- Color palettes and semantic colors: `src/theme/theme.ts`
- Accent scales: `src/theme/accents.ts`
- Structural tokens: `src/theme/tokens.ts`
- Theme-independent media/data-viz palette: `PresentationColor` in `src/theme/tokens.ts`
- Shared surface recipe: `createSurfaceStyle()` in `src/theme/tokens.ts`
- Theme provider: `src/theme/ThemeProvider.tsx`
- Shared UI primitives: `src/components/ui/`
- Root tab metrics: `src/navigation/root-tab-bar.ts`
- Automated style guard: `npm run check:design-system`

Business screens consume these sources; they do not define local palettes or parallel spacing/type scales.

## 2. Visual character

Clawket deliberately differs from YouMind in three ways:

1. The neutral ramp is cool graphite rather than neutral black. Light mode starts from a blue-gray app canvas; dark mode uses deep blue-charcoal surfaces.
2. The default accent is `iceBlue`, with additional Clawket-owned accent scales. Accent selection remains a supported product feature.
3. Information density is slightly tighter. The body type step is 15 rather than 16, cards use a 12-point standard radius, and the largest common surface radius is 24.

These values are product decisions. Do not replace them with YouMind palette values during component migration.

## 3. Color model

Use intent-based values from `theme.colors`:

| Layer | Tokens | Purpose |
|---|---|---|
| App canvas | `background` | Root screen background |
| Standard surface | `surface` | Cards, rows, navigation chrome |
| Quiet surface | `surfaceMuted` | Recessed controls, pressed states, grouped backgrounds |
| Raised surface | `surfaceElevated` | Modals, floating controls, WebView-adjacent chrome |
| Edges | `border`, `borderStrong` | Hairline separation and deliberate emphasis |
| Text | `text`, `textMuted`, `textSubtle` | Primary, secondary, tertiary hierarchy |
| Actions | `primary`, `primaryText`, `primarySoft` | Accent-driven actions and selected states |
| Feedback | `success`, `warning`, `error` and matching `*Soft` values | Semantic status and quiet status backgrounds |
| Information | `info`, `infoSoft` | Non-accent informational affordances |

Rules:

1. UI files use `useAppTheme()` and semantic tokens; do not hardcode hex/rgb/rgba colors.
2. Add a missing semantic token to both light and dark palettes before using it.
3. Name tokens by purpose, never literal hue.
4. Avoid per-component `theme.scheme` branches when a token can express the state.
5. Text input placeholders use `theme.colors.textSubtle`.
6. Theme-independent media overlays and data-viz colors use `PresentationColor`; never use it as a shortcut for ordinary app chrome.

## 4. Structural tokens

Spacing follows a 4-point grid: `Space.xs` 4, `sm` 8, `md` 12, `lg` 16, `xl` 24, `xxl` 32, `xxxl` 48.

Typography uses `FontSize`, matching `LineHeight`, and `FontWeight`. Named steps cover micro labels through display values, including the common 14- and 20-point steps. Do not create intermediate sizes with arithmetic.

Radii use `Radius.xs` 4, `sm` 8, `md` 12, `lg` 18, `xl` 24, and `full` for circles/capsules. Standard cards use `Radius.md`; modal cards use `Radius.xl`.

Standalone controls have at least a 44-point target (`HitSize.md`). `ControlSize` owns visible control and settings-row metrics. A 36-point target (`HitSize.sm`) is allowed only inside compact grouped toolbars.

Raised surfaces use `createThemedShadowStyle()`. Light mode gets a quiet edge and lift; dark mode uses a hairline edge without a black halo. Normal surface borders use `StyleSheet.hairlineWidth`; use `BorderWidth.strong` for deliberate selection/artifact framing and `BorderWidth.emphasis` only for high-visibility presentation marks such as scanner corners.

Every ordinary card, input, button, search field, grouped-settings container, and modal must get its edge/elevation from `createSurfaceStyle()`, either directly or through a shared component. Its four tiers are:

| Tier | Use |
|---|---|
| `flat` | Grouped cards, list rows, standard content cards |
| `raised` | Inputs, search, primary controls, composer chrome |
| `floating` | FABs, detached toolbars, popovers |
| `overlay` | Modal cards and top-level overlays |

Do not spread `Shadow.*` or assemble background + border + shadow independently in new business UI. A special media/export surface may own custom chrome when it cannot follow the app theme; keep that exception local and documented.

## 5. Root bottom navigation

The root navigator uses `@react-navigation/bottom-tabs` on both iOS and Android.

Non-negotiable rules:

1. Do not add `@bottom-tabs/react-navigation` or `react-native-bottom-tabs`.
2. Do not add a native Liquid Glass/SF Symbols tab path. One JS implementation must serve all supported OS versions.
3. Root tabs show a Lucide icon and short localized label. Active state is expressed by the current accent, not a platform-only material effect.
4. Backend capability metadata decides which routes exist. Backend identity must not be modeled as a transport or a tab implementation branch.
5. JS tabs occupy layout space. Screens, drawers, lists, composers, and scroll containers must not add tab height as a bottom inset. Use `useTabBarHeight()` only for full-screen overlays or keyboard policies that need the measured physical height.
6. Keep the tab layout stable while the keyboard moves; do not add `tabBarHideOnKeyboard` or focus-driven remounting.
7. Full-bleed overlays use `getRootTabBarMetrics()` so their edge stops above the actual bar and safe area.

## 6. Shared component decisions

| Component | Use |
|---|---|
| `Card` | Standard flat/raised/pressable content surface; use `elevation`, `tone`, `padding`, and `selected` rather than recreating chrome |
| `Button` | Page-level text CTA with `primary`, `secondary`, `ghost`, or `destructive` intent |
| `ActionButton` | Theme-owned compact icon chrome (`bare`, `surface`, `accent`, `destructive`) |
| `IconButton` | Legacy bare icon action; prefer `ActionButton` when the component should own icon chrome |
| `HeaderActionButton` | Lucide icon action inside a page header |
| `HeaderTextAction` | Short text-only action inside a page header |
| `CircleButton` | Primary circular action such as send or FAB |
| `ScreenHeader` | Content-owned header when native stack chrome is insufficient |
| `ModalScreenLayout` | Close-style full-screen modal shell |
| `ModalSheet` | Centered card modal |
| `SearchInput` | Standard searchable-list input |
| `FormTextInput` | Standard single-line or multiline form field; use `surface="sunken"` inside an existing surface |
| `SegmentedTabs` | Two or more switchable views inside a page |
| `LoadingState` | True full-page loading state |
| `GlobalLoadingOverlay` | Transient app-wide in-flight state |
| `EmptyState` | Empty list or unavailable-content state |
| `ThemedSwitch` | Theme-aware binary control |
| `SettingsIcon` | Semantic accent/info/success/warning/danger/neutral icon badge for settings-like rows |
| `SettingsGroup` / `SettingsRow` / `SettingsDivider` | Grouped Settings and settings-like modal sections |
| `ScreenLayout` | Shared first-section and scroll-content rhythm |

Prefer these components over copied markup. Add a primitive only when at least two product surfaces share the same interaction and visual contract.

Shared component `style` props are for layout (margin, flex, width, alignment), not chrome. If a caller needs a different semantic background, border, radius, text treatment, or pressed state, add a named variant to the shared component instead of overriding it locally.

### Control states

| State | Shared behavior |
|---|---|
| Default | Semantic surface and text tokens |
| Pressed | Primary fill lowers opacity; surface controls use `surfaceMuted` |
| Selected | `primarySoft` fill; selection is not represented by a thicker border |
| Disabled | Opacity only; layout and border remain stable |
| Loading | Action remains the same size; progress replaces content and disables repeat submission |
| Invalid | Form edge uses `error`; pair it with readable error text |

Theme/accent swatches, camera/QR overlays, share posters, visual previews, charts, and media controls may use specialized presentation. Their surrounding app chrome still uses shared components where practical.

The intentional native-control exceptions are explicit and guarded by the style checker:

- `ChatComposer`, `FileEditorView`, and `SkillContentScreen` own specialized native text editing behavior.
- `ChatSharePosterModal` owns the switch and fixed-layout typography used by its exported chat artifact.
- `StatsPosterModal` owns a fixed-layout palette and typography because the rendered poster is an exported artifact, not application chrome.
- `ChatAppearancePreviewCard` may render a raw shadow because the shadow is previewed content rather than application chrome.

When Debug Mode is enabled, open Settings → Design System to inspect the shared controls, four surface tiers, all built-in accents, and light/dark states on a real device.

## 7. Page rhythm

- Screen horizontal inset: `Space.lg`.
- First list/card section: `Space.md` below the header.
- Standard card gap: `Space.md`.
- Major section gap: `Space.xl`.
- Scroll bottom breathing room: `Space.xxxl`.
- Page headers keep centered 16-point semibold titles and symmetric 44-point action slots.

Use `createListContentStyle()`, `createCardContentStyle()`, and `createListHeaderSpacing()` before defining a page-local spacing recipe.

## 8. Theme and backend verification

For UI work, verify:

1. Follow System updates after an OS appearance change.
2. Manual Light and Dark modes render every changed surface.
3. Active/inactive tab contrast is readable in both schemes.
4. OpenClaw and Hermes keep the same connection, Chat, Console, and Settings reachability they had before the UI change.
5. Unsupported backend pages remain capability-gated rather than failing after navigation.
6. `npm run typecheck`, affected tests, and `npm run check:design-system` pass.

## 9. Style ratchet

`scripts/check-ui-style.mjs` rejects new hardcoded colors, numeric radius/font/border values, FontSize arithmetic, React Native `KeyboardAvoidingView` imports, raw `Shadow.*` use, unapproved native `TextInput`/`Switch` use, and native bottom-tab dependencies. Existing legacy debt is counted per file and rule in `scripts/ui-style-baseline.json`; counts may only decrease.

Do not update the baseline to make a new violation pass. `--update` is only for ratcheting the baseline downward after intentional cleanup.
