# Clawket Mobile Design System

This is the durable implementation guide for Clawket 3.0 mobile UI. Product decisions and exact recipes live in `docs/3.0/05-visual-system.md`; this document records how those decisions map to the Mobile workspace.

## 1. Sources of truth

- Semantic colors and Agent palette: `src/theme/theme.ts`
- Preserved user accent identifiers: `src/theme/accents.ts`
- Structural tokens and shared surface helpers: `src/theme/tokens.ts`
- Theme provider: `src/theme/ThemeProvider.tsx`
- Canonical primitives: `src/components/ui/`
- Root route contract: `src/navigation/root-stack.ts`
- Automated guard: `npm run check:design-system`

Business screens consume these sources. They must not create local palettes, type scales, elevation recipes, navigation chrome, or backend-specific visual branches.

## 2. Visual character

Clawket 3.0 is a quiet, content-first interface:

1. Content reaches the transparent status bar; there is no bottom tab bar or system navigation header.
2. Navigation and primary actions float above the page in self-drawn controls.
3. Lists have no cards, outlines, or separators. Spacing and two levels of text provide hierarchy.
4. Color belongs mainly to Agent avatars. Accent is reserved for actions, selection, links, viewing state, and unread indicators.
5. Status is carried by avatar treatment, an icon, or a small dot—not a decorative text label.
6. Only `400` and `600` weights are valid.

Do not introduce Liquid Glass, SF Symbols, native tab bars, Material ripples, blur navigation chrome, emoji interface icons, typing-dot animations, colored status text, or gradients outside the paywall hero.

## 3. Semantic color model

New UI uses the canonical values on `theme.colors`:

| Layer | Tokens | Purpose |
|---|---|---|
| Canvas | `canvas`, `canvasGrouped` | Content pages; grouped settings pages |
| Surfaces | `surface`, `surfaceFloating` | Assistant bubbles and pressed rows; floating chrome |
| Text | `ink`, `inkSecondary`, `inkTertiary` | Primary, supporting, and time/placeholder text |
| Allowed line | `line` | Hairlines inside a settings group and dark floating-surface edges only |
| Action | `accent`, `accentSoft` | Primary actions, selection, user bubbles, links, unread |
| Feedback | `good`, `warn`, `bad` and matching `*Soft` | Status rings, badges, and failure surfaces; pair color with an icon or text |
| Agent identity | `agentPalette` | Stable Agent avatar color selected by Agent id hash |

Rules:

1. Use `useAppTheme()`; ordinary UI must not hardcode hex, rgb, or rgba values.
2. Add a missing semantic value to both schemes before using it.
3. Prefer purpose names over hue names and avoid `theme.scheme` branches when a token expresses the state.
4. `PresentationColor` is only for media overlays, exported artifacts, and data visualization.
5. Legacy aliases such as `background`, `text`, `primary`, `surfaceMuted`, and `info` exist only while pre-3.0 screens are deleted. New code must not use them.

## 4. Structural tokens

Spacing uses `Space` on a four-point grid: 4, 8, 12, 16, 24, and 32. Do not derive intermediate values with arithmetic.

Typography uses matching `FontSize` and `LineHeight` entries:

| Step | Size / line | Use |
|---|---|---|
| `display` | 28 / 34 | One onboarding or paywall hero title |
| `title` | 20 / 26 | Settings or sheet title |
| `body` | 17 / 24 | Message body, row title, input, button |
| `secondary` | 15 / 20 | Preview, trailing value, system event |
| `caption` | 13 / 18 | Time, legal copy, numeric badge |

`FontWeight` exposes regular 400 and semibold 600. A page's default UI uses two visible type steps; a third is allowed only for a page title, expanded detail, onboarding, or paywall. User content is excluded from that count.

`Radius` contains named 3.0 shapes: bubble 20, card 16, settings group 14, the four avatar sizes, YouMind-derived sheet radii, and `full` for controls. `BorderWidth` may be used only for documented status rings, dark raised-surface hairlines, settings-group separators, and presentation framing—not list-row cards.

`ControlSize` owns the 40-point pill, 44-point floating button, 52-point settings row, and 88-point roster row. `HitSize` provides accessible touch targets. Icons use `IconSize` or the component-owned recipe.

`Shadow` is an implementation ingredient for shared primitives. Business screens never spread it directly. `createThemedShadowStyle()` owns light-mode lift and the dark-mode hairline. Transitional primitives may still call `createSurfaceStyle()` until their old callers are removed; new 3.0 UI chooses a canonical primitive instead of assembling a surface locally.

## 5. Navigation and page ownership

The App has one native stack whose system header is always hidden. Root routes are Roster, Thread, Agent Settings, Account Settings, Search, and Paywall, with detail routes layered above them. Bottom tabs, tab-height insets, and system back buttons are forbidden.

Every page owns a symmetric header contract:

- left: one 44-point `FloatingButton` or an empty 44-point slot;
- center: a title or `HeaderPill`;
- right: one 44-point `FloatingButton` or an empty 44-point slot.

Content begins below the safe area plus floating header. Full-screen pages use the same safe-area treatment on iOS and Android and reserve 16 points above Android's gesture area.

Backend identity and transport identity never select a visual route directly. Route availability and controls come from capability metadata.

## 6. Canonical 3.0 primitives

| Component | Contract |
|---|---|
| `FloatingButton` | 44-point circle, Lucide 22 icon, optional accent dot or bad numeric badge, 0.96 press scale |
| `HeaderPill` | 40-point capsule with 28-point Agent avatar, name, and the one allowed header subtitle |
| `AgentAvatar` | Stable palette square with initials/emoji content and working, attention, done, offline, or locked state |
| `RosterRow` | 88-point borderless row; avatar, name, one preview line, time, unread/attention/lock state |
| `Bubble` | One assistant/user shape recipe with Markdown-compatible content |
| `SystemEventRow` | One centered supporting line with Lucide icon and optional disclosure |
| `RunCard` | Quiet card with a 3-point semantic state rail and one compact description |
| `ApprovalCard` | Run-card shell plus command preview and primary/secondary capsule actions |
| `Composer` | Add button, composition-safe growing capsule input, mic, and send/stop action |
| `Sheet` | Shared bottom/iPad presentation chrome, handle, backdrop, title, and close action |
| `SettingsGroup` / `SettingsRow` | 14-radius grouped card, 52-point rows, internal hairlines only |
| `Skeleton` | 1.2-second breathing block that respects reduced motion |
| `Banner` | One sentence and one action on a warn/bad soft surface |
| `SegmentedTabs` | Full capsule, 44-point standard or 32-point compact track; at most three filters |
| `SearchInput` | 44-point composition-safe capsule; use the sheet variant inside `Sheet` |

Use the primitive rather than copying its markup. A shared `style` prop is for layout only; add a semantic variant when chrome must change.

## 7. Transitional primitives

Pre-3.0 screens still consume `ActionButton`, `Button`, `Card`, `FormTextInput`, `SettingsIcon`, and `ThemedSwitch`. Keep their public behavior stable while those callers are migrated. New 3.0 screens may use `Button`, composition-safe inputs, and switches only where the product recipe explicitly calls for them; they must not revive card tone variants or legacy icon chrome.

Intentional native or presentation exceptions remain narrowly scoped:

- `ChatComposer` and `FileEditorView` own specialized text editing.
- `SkillContentScreen` owns its editor interaction while the legacy screen remains.
- `ChatSharePosterModal` and `StatsPosterModal` render exported artifacts.
- `ChatAppearancePreviewCard` previews a shadow as content.

No exception permits ordinary application chrome to bypass the semantic system.

## 8. State, copy, and motion

Each shipped page covers loading, empty, error, offline-with-cache, and permission/paywall states. Loading uses `Skeleton`; offline and error preserve usable cached content and add one-action `Banner` feedback. Unsupported actions are absent or locked from capability metadata—they do not fail after navigation.

Default copy has two levels. Rows and controls do not carry explanatory subtitles. Empty, error, banner, and system-event copy is one sentence (up to 8 English words or 16 Chinese characters) plus one action word. Text badges are limited to unread numbers and `Pro`; trailing settings values are a single value, not a sentence. Filters appear only when a list exceeds one screen and are capped at three.

Animation durations are 120, 200, and 320 ms with ease-out. Reduced motion removes positional motion and freezes the working ring. Rows change surface on press; floating buttons scale; bubbles do not animate on press. New messages fade and move four points, session switches cross-fade, and sheets rise over 320 ms.

## 9. Verification and style ratchet

For every UI batch run affected render tests in both light and dark schemes, `npm run typecheck`, and `npm run check:design-system`. Tests assert capability degradation, all five page states, no row border, and the set of rendered font sizes; screenshots are reserved for human device acceptance.

`scripts/check-ui-style.mjs` rejects new hardcoded colors, numeric radii/fonts/borders, `FontSize` arithmetic, outlined list rows, emoji icon literals, more than three `FontSize.*` references per screen, React Native `KeyboardAvoidingView`, raw `Shadow.*`, unapproved native `TextInput`/`Switch`, and bottom-tab dependencies. Existing debt is stored per file and rule in `scripts/ui-style-baseline.json`; counts only decrease. Never update the baseline to hide a regression.

The docs checker verifies canonical and transitional exports, the `BorderWidth`, `ControlSize`, `FontSize`, `LineHeight`, `PresentationColor`, `Radius`, `Shadow`, and `Space` families, plus `createSurfaceStyle`. Remove transitional names from this document and its checker only in the same change that deletes the last real caller.
