# Clawket Mobile Design System

This is the durable implementation guide for Clawket 3.0 mobile UI. Product decisions and exact recipes live in `docs/3.0/05-visual-system.md`; this document records how those decisions map to the Mobile workspace.

## Lumen paywall — owner-selected September 11

The approved A study (`docs/3.0/mockups/paywall-studies`) is the paywall presentation exception: graphite canvas, silver Companion, calm orbital line and light primary action. `theme/paywall.ts` provides a scoped semantic palette through `ThemeContext`, never `Appearance.setColorScheme`; shared Button, Skeleton and PaywallPlanCard consume that scope. Keep the standard five type tokens; center title and subtitle, use four benefit rows, then a stable checkout. Owner-approved typography refinement uses `PaywallBenefits`: 17-point body text / 24-point line height, 16-point row gaps on the shared spacing grid, intrinsic-width centering with a 100% width cap, shrinkable untruncated labels and icons aligned with the scaled first line. Subtitle uses the nearest shared body token (17, rather than the HTML study’s 16); price uses the 20-point title token. All 19 catalogs must retain their full text. Content and checkout share one vertical scroll at every size; the introduction grows when content fits, assigning spare height to the artwork above the heading. The complete benefits sit 32 points above checkout; the footer has no automatic top margin. The artwork keeps its adaptive 104–164-point minimum, with no fixed maximum; its SVG fits within the expanded region. Long copy and enlarged text continue into scrolling instead of clipping. This avoids hiding longer translations behind a fixed checkout. Restore uses a short localized visible label and the full purchase-restoration accessibility label; paywall CTA opts into the shared Button’s multiline layout. Compact plan-copy height is intrinsic: do not inherit `flex: 1` into it, and do not allow column wrapping. Titles, prices and details cannot shrink vertically; recommendation pills share the title baseline. Annual/lifetime use compact side-by-side cards only when exactly two cards are shown and width and font scale permit, otherwise wrapping rows; monthly is disclosed on request. Members see the owned card (`Current plan` pill, `surface` fill, locked, never dimmed; the accent outline belongs to the selected card alone) plus the plans they can still move to, with locked alternatives omitted; when the selection is the owned plan the checkout button and billing caption are absent and `Manage subscription` is the only action. Whenever the monthly disclosure link is absent, the checkout block keeps a 12-point top margin from the plans and `Manage subscription` sits 12 points below the checkout. Plan titles identify periods, store totals stay prominent, and one-time purchases must not display subscription cancellation text. Renewal captions retain live total, period, automatic renewal and anytime cancellation; store-specific cancellation instructions remain available as an accessibility hint. “Recommended” is a preference, not an unqualified cheapest-price claim.

`PaywallLumenHero` draws the approved asymmetric geometry with SVG gradients; the artwork gradient palette and geometry are a brand-artwork exception. Avoid live blur/shader dependencies. Ear and face paths form one white SVG mask over a single silver fill, so overlapping parts cannot create material seams; do not add detached highlight strokes at the ear roots. The mask ears and eyes reuse the welcome choreography from `src/brand/companion-motion.ts`, with gentler tilt/ear amplitudes, frequent blinks and an occasional double blink. The orbit stays still while the head floats. All native tracks pause under reduced motion, backgrounding and success, and are cancelled on unmount. Remove the English artwork caption and all rating quotes. Context still selects copy and artwork orientation while purchase/restore routing and analytics preserve their existing identities. Owner-approved September 16 copy leads with “More conversations with your Agents” / “和你的 Agent，聊得更多”; four benefits cover full chat/task history, connections/Agents, personality/memory and OpenClaw management, in that order. The generic page has no subtitle (owner device feedback September 16); its four benefits already explain the value, and freed space belongs to the artwork. Contextual allowance explanations and purchase status subtitles remain. Headlines describe the action being unlocked: Agent access, memory/files, OpenClaw logs, full conversation/message, models or usage. Avoid roster/main jargon, guaranteed repairs, or claims of recovering any message. Chinese plans use 按年订阅 / 终身使用, monthly equivalents start with 折合, and the CTA says 升级到 Pro (the Agent gate names using more Agents). Entitlements and backend capabilities are unchanged. Native visual acceptance remains with the owner under the current device workflow.

## Owner review — September 2026

The owner approved the reference language for full-app rollout on 2026-09-06. The reviewed reference and evidence are in `docs/3.0/12-design-language-review.md`; rollout scope and remaining acceptance are in `docs/3.0/13-design-rollout.md`. This supersedes the historical screenshot deferral below: inspect actual rendered pages, keyboard states, theme changes, and sheet interactions before declaring a screen accepted. Automated token/render tests do not certify visual quality.

Review recipes reuse the existing theme and primitives: `Button` primary (and the compatible neutral variant) is the high-emphasis monochrome action, ghost is secondary, and text is low emphasis; loading retains action contrast while disabled neutral actions use a quiet surface. `FloatingButton` plain is unraised navigation. `FormTextInput` quiet is a flat input. `SetupPrimitives` owns the symmetric `FlowHeader`, `PageIntro`, borderless `ChoiceRow`, numbered `FormStep`, and wrapping monospace `CommandBlock`, and the collapsible `MessagePreview` (a message the user forwards rather than reads: two secondary lines plus a chevron, expanded on tap, so the action below it stays the focus). These approved variants should replace legacy recipes through the tracked rollout, with each consumer checked in context. The gallery is a component catalog and may display the complete type hierarchy.

### Feedback iteration

- Navigation/toolbars: `FloatingButton appearance="plain"`; standalone actions: `quiet`, with a visible neutral fill; the single high-priority action may use `ink`. Destructive controls retain their semantic treatment. Every variant has a 44-point target. `plain` is the default. Explicit `surface` is reserved for media overlays and the timeline return-to-bottom overlay, never ordinary page navigation. Header pills use a quiet neutral surface.
- Compact pill segments use 4-point inner padding and a 36-point selected capsule inside a 44-point control.
- `FormTextInput errorMessage` places a small semantic alert and readable correction below a quiet input, and exposes the correction as an accessibility hint. Existing invalid-only consumers remain stable until rollout.
- `Banner tone="neutral"` is for product messaging that legitimately owns layout (grace, Pro, unsupported, bridge update). Connection state uses `ConnectionStatusPill` instead (owner-requested 2026-09-16); see §8.
- `ThemedSwitch tone="neutral"` uses a white thumb and monochrome track. It never remounts or momentarily reports false to initialize colors; native state remains truthful through theme changes. Neutral is the default for all consumers.
- Official platform artwork is a brand-identity exception to Lucide application chrome. `PlatformMark` owns bundled assets with provenance in `assets/brands/SOURCES.md`; no remote image requests or accent recoloring.
- Hermes uses the official App artwork with its own safe area and rounded shape, without another clipping radius. The one exception is the Agent profile's 24-point avatar corner mark (owner-requested 2026-09-16): a corner badge must be round, so the 20-point artwork is clipped by the disc there, which only trims its own white safe area. Default iOS single-line `FormTextInput` omits paragraph line height so UIKit centers native font metrics; multiline and Android retain explicit leading. Check actual glyphs, placeholders, and caret before introducing per-page offsets.
- Normal input tracking is explicitly zero in `NATIVE_INPUT_TEXT_DEFAULTS`, shared by stock, bottom-sheet, and paste-capable composition-safe hosts. Apply it before caller styles so pairing-code tracking still works. Test navigation away from a tracked field plus type/clear cycles; a clean first mount alone cannot certify placeholder typography.

### Settings refinement — September 13

Account Settings opts into `SettingsGroup density="comfortable"` and carries that recipe through membership, preference sheets, Appearance/chat customization, Help, release history, and Connections/detail. The default 52-point / 14-radius recipe remains for other consumers; comfortable groups use `ControlSize.settingsRowComfortable` (64 minimum), `Radius.xl` (22), 12-point vertical padding and 16-point content gaps. Icons occupy 32 points, using neutral `SettingsIcon` with a 20-point glyph at 1.75 stroke; icon hairlines start at the 64-point text edge and end 16 points inward, using logical start/end for RTL. Long row titles and values wrap without a line cap. Selected choices gain an inset rounded neutral fill (4-point vertical / 8-point horizontal inset, 14-point radius, drawn behind the row so text alignment is untouched) plus a check and an accessibility selection state; a ref guards overlapping saves.

The home has a separate Companion membership card (56-point ink tile, static inverse 40-point cat; title plus membership status), a four-entry common group (connections, appearance, notifications, language) and a support group (help, about). `AccountProCard` also heads membership details and keeps existing paywall gates. Settings headers share `AccountSettingsPageHeader`, including connection pages; editing screens retain their Save action. Connection list artwork comes from `PlatformMark` at 32 points. All preferences, restore, maintenance confirmations, backend gating and dark-mode semantics remain intact. Visual study is illustrative; device acceptance stays with the owner.

## Usage page — owner-approved September 16

The Agent usage section (`screens/AgentSettings/UsageSection.tsx`) returns the 2.0 information density inside the 3.0 system: a hero card (leading `title` tabular number and label, a second number on the right, and a four-segment `SegmentBar`), a 2×2 row of stat tiles (messages, tool calls, sessions, cache hit rate) built from the Agent profile stat-card recipe, a daily `UsageBarChart`, and `ShareRow` lists for models and tools. Every card is `SettingsGroup` + `SettingsRow layout="column"` on `canvasGrouped`; the screen uses exactly `title`, `secondary` and `caption`.

Charts are monochrome by construction: the interface theme maps `accent` to `ink`, so the selected bar and the first segment are `ink`, de-emphasised bars are `inkTertiary`, the segment ramp runs `ink → inkSecondary → inkTertiary → line`, and grid lines are `line`. Do not introduce chart-only colors; the legend and the selected-value label carry identity in text. Bars are at most 22 points wide with a 4-point rounded top and a square baseline, and grow from the baseline over `Motion.duration.slow` (static under reduced motion). Axis and legend text are `caption`; values are `tabular-nums`.

The leading measure is dollars only when the backend priced the range (`cost` capability, presentation mode not `unknown` / `included`, total above zero); otherwise tokens lead and cost becomes the secondary number (`Included`, `—`, or the amount with an `Estimated` / `Partial` label). Zero-cost breakdowns and the daily date list are gone; the tools card renders only when there were tool calls. The stats poster opens from the header's trailing `Share` `FloatingButton`, not from a button at the end of the page.

Today is free; 7D and 30D are the Pro value of the page (owner decision 2026-09-16: a veil the user almost sees through, never a locked tab). A free user can switch to either range: the data loads and renders as usual inside `ProGate` with a six-row teaser (`ControlSize.settingsRow * 6`, so the hero and tile numbers show through the veil), then the lock, `See the whole week and month`, one sentence, and the full-width ink `Unlock usage trends` button that opens the paywall with reason `usage` (`generic` hero, `See where every token goes`). Tapping a past day in the single-day trend also opens the paywall. The veil disappears with `isPro`; no continuation is needed. Do not add lock glyphs to the segmented control or disable the tabs.

Range switching never shows another range's numbers: `useUsageDashboard` caches per adapter, Agent, range and date window, shows the layout-mirroring skeleton for an unloaded range, applies late responses only to their own range, prefetches the other ranges once per scope after the first range lands (the single-day view also loads the week for its trend context), and keeps loaded data visible with a Retry `Banner` when a refresh fails. Content cross-fades over `Motion.duration.normal` when its data changes.

## Skills management — owner-approved September 13

Skills uses the white `canvas` with a quiet `SearchInput`, one total/enabled summary, and borderless rows with an 88pt minimum height. Each row has a 17pt semibold name, a 15pt single-line description, a small directional detail chevron, and a separate neutral `ThemedSwitch` with a 44pt target. Long names and accessibility text may increase height. Only unmet requirements add a warning icon and concise reason; ordinary rows do not repeat Active. Required `always` skills show Always on; adapters without update capability show read-only status. Enabled is configuration (`!disabled`), distinct from eligibility; missing tools, environment names, configuration paths, operating systems and allowlist restrictions remain visible without exposing credential values.

Rows remain alphabetically stable when toggled. Keep each native switch mounted during the write and quiet status refresh, reject duplicate writes, retain the previous value on failure, and retain an acknowledged value if only the refresh fails. Offline cached rows remain readable with writes disabled. The native stack pushes Discover from a quiet Compass header button, gated by capability and operation, preserving installed search/scroll on return. Discovery keeps both sources, descriptions, detail metadata and Install via Chat; enter the selected Agent's chat only after the request succeeds and the detail sheet dismisses. Detail uses a scrollable canonical Sheet at 68%/92%, truthful enable/status/source fields, all missing requirements, and capability-gated uninstall through ConfirmationModal after dismissal. `SearchInput appearance="quiet"` provides a flat surface without altering existing floating consumers. Skills is an explicit description-line exception to the ordinary settings-row copy budget.

Roster recovery: the banner retry is independent of native pull-to-refresh. Keep cached rows and header spacing stable while retrying; only a real pull gesture owns the native refresh indicator. Position that indicator below the content-owned header and disable automatic inset adjustment on the roster list.

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

Acceptance workflow (owner update, 2026-09-11): the owner performs visual acceptance on a physical device. Simulator interaction, connection and screenshot review are opt-in only when the owner explicitly requests them; older simulator-first recipes in this document are conditional on that request. Automated tests, design-system checks and code/log investigation continue normally. Preserve the owner's active pairing during QA. Development-server Fast Refresh can deliver compatible JS changes; native changes and standalone builds require their appropriate build/update flow.

Clawket 3.0 is a quiet, content-first interface:

1. Content reaches the transparent status bar; there is no bottom tab bar or system navigation header.
2. Navigation uses plain icons; quiet standalone controls and monochrome main actions carry the approved hierarchy.
3. Lists have no cards, outlines, or separators. Spacing and two levels of text provide hierarchy.
4. Color belongs to Agent identity and conversation personalization. Global controls, selection, and navigation remain neutral across saved chat colors.
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
| Contextual accent | `accent`, `accentSoft` | Neutral in the interface; saved color in the conversation palette |
| Foreground / overlay | `onAccent`, `scrim` | Content on accent fills; the shared 40% modal backdrop |
| Feedback | `good`, `goodSoft`, `warn`, `warnSoft`, `bad`, `badSoft` | Status rings, badges, and failure surfaces; pair color with an icon or text |
| Agent identity | `agentPalette` | Stable Agent avatar color selected by Agent id hash |

Rules:

1. Use `useAppTheme()`; ordinary UI must not hardcode hex, rgb, or rgba values.
2. Add a missing semantic value to both schemes before using it.
3. Prefer purpose names over hue names and avoid `theme.scheme` branches when a token expresses the state.
4. `PresentationColor` is only for media overlays, exported artifacts, and data visualization.
5. Pre-3.0 aliases such as `background`, `text`, `primary`, `surfaceMuted`, and `info` are removed. The design-system gate rejects their definitions and use in production or test sources.

### Cron management (owner-approved 2026-09-14)

The white-canvas list defaults to Jobs, retaining Runs as a useful second view. A header plus opens creation through the existing native stack. Borderless rows show name, human schedule, server-provided next execution and an independent neutral switch; previous failure is a separate condition, never a replacement for enabled/paused state. Keep the 88pt minimum, 17pt semibold name and 15pt supporting copy, with growing rows and 44pt controls. Heartbeat remains a secondary capability-gated entry. Preserve visible row order during writes and refresh, disable duplicate writes synchronously, and retain acknowledged data when only refresh fails.

Create has two stages: choose custom or one of eight templates (four initially visible), then configure task name, natural-language instructions, daily/weekly/interval/once controls, timezone and an estimated next-three-run preview. Weekly supports multiple days and workday/weekend shortcuts. Date/time uses the existing native picker; keyboard-aware pages preserve long prompt editing. Thread's Schedule a task skips templates and seeds that editor only. Edit opens directly in a full page, reuses the visual time controls, and saves only on explicit Save; dirty native back gestures and navigation use ConfirmationModal. Keep history, run-now on the saved job, delete confirmation and existing heartbeat controls.

Cron expressions are advanced. Recognize only losslessly convertible schedules; keep arbitrary existing expressions, timezone, stagger and interval anchors intact. New/changed expressions use portable five-field validation. Pure-JS Croner 10.0.1 performs validation and estimates without scheduling callbacks, matching OpenClaw's parser/version. Server timestamps remain authoritative; unknown Agent timezone produces no invented absolute preview. `cronTimeZone` gates independent timezone choice; `cronAdvanced` gates execution options and creation-time pause. Hermes retains the shared guide with Agent timezone, whole-minute interval precision and enabled creation. Existing payload/delivery metadata is preserved, advanced supported fields remain editable, and execution success never implies notification delivery. Both list and editor use adapter/Agent-scoped memory cache and late-completion guards. This owner-approved form and schedule context is an exception to ordinary settings-row subtitle limits.

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

`FontWeight` exposes only `regular` 400 and `semibold` 600. A page's default UI uses two visible type steps; a third is allowed only for a page title, expanded detail, onboarding, or paywall. User content is excluded from that count.

`Radius` contains named 3.0 shapes: bubble 20, card 16, settings group 14, the four avatar sizes, YouMind-derived sheet radii, and `full` for controls. `BorderWidth` may be used only for documented status rings, dark raised-surface hairlines, settings-group separators, and presentation framing—not list-row cards.

`ControlSize` owns the 40-point pill, 44-point floating button, 52-point settings row, and 88-point roster row. `HitSize` provides accessible touch targets. Icons use `IconSize` or the component-owned recipe. `StatusSize` owns the 6-point list status dot and 12-point attention marker.

`Shadow` is an implementation ingredient for shared primitives. Business screens never spread it directly. `createThemedShadowStyle()` owns light-mode lift and the dark-mode hairline. Transitional primitives may still call `createSurfaceStyle()` until their old callers are removed; new 3.0 UI chooses a canonical primitive instead of assembling a surface locally.

## 5. Navigation and page ownership

The App has one native stack whose system header is always hidden. Root routes are Roster, Thread, Agent Settings, Account Settings, Search, and Paywall, with detail routes layered above them. Bottom tabs, tab-height insets, and system back buttons are forbidden.

Every page owns a symmetric header contract:

- left: one 44-point `FloatingButton` or an empty 44-point slot;
- center: a title or `HeaderPill`; while the connection is recovering, offline or failed, the title yields this slot to `ConnectionStatusPill` (Roster's empty centre hosts it directly, Thread's `HeaderPill` subtitle already carries the state);
- right: one 44-point `FloatingButton` or an empty 44-point slot.

Content begins below the safe area plus floating header. Full-screen pages use the same safe-area treatment on iOS and Android and reserve 16 points above Android's gesture area.

Backend identity and transport identity never select a visual route directly. Route availability and controls come from capability metadata.

## 6. Canonical 3.0 primitives

| Component | Contract |
|---|---|
| `FloatingButton` | 44-point circle, Lucide 22 icon, optional accent dot or bad numeric badge, 0.96 press scale |
| `HeaderPill` | 40-point capsule with 28-point Agent avatar, name, and the one allowed header subtitle |
| `AgentAvatar` | Stable palette circle (roster, header, settings, sheet, panel sizes) with an optional backend image, initials/emoji fallback, and working, attention, done, offline, or locked state; `AvatarWorkingBadge` is the shared stationary activity marker |
| `RosterRow` | 88-point borderless row; avatar, name, one preview line, time, unread/attention/lock state |
| `Bubble` | One assistant/user shape recipe with Markdown-compatible content |
| `SystemEventRow` | One centered supporting line with Lucide icon and optional disclosure |
| `RunCard` | Quiet scheduled/subagent event with category icon, no status rail, and compact time/status |
| `ApprovalCard` | Run-card shell plus command preview and primary/secondary capsule actions |
| `Composer` | Add button, composition-safe growing capsule input, mic, and send/stop action |
| `CompositionSafeTextInput` | Sole stock `TextInput` host; iOS native-owns composing text while external replacement/reset still syncs |
| `CompositionSafeBottomSheetTextInput` | Gorhom input with the same native-owned iOS composition and external sync contract |
| `PasteCapableTextInput` | Composition-safe Thread input that sends pasted images/files through the pending attachment pipeline; text paste stays native |
| `Sheet` | Shared bottom/iPad presentation chrome, handle, backdrop, title (or a `titleContent` node such as the Session Panel Agent pill), close action, and an optional `footer` slot pinned to the visible bottom edge at every detent (safe-area padded; the body reserves its measured height) |
| `SettingsGroup` / `SettingsRow` | 14-radius grouped card, 52-point rows, internal hairlines only |
| `SwipeableRow` | Trailing swipe tray on a list row: up to three 80-point icon-over-caption cells that stretch to the row height (`surface` + `ink` neutral, `bad` + `onAccent` destructive), slides in with the row, closes after a press; `useSwipeableRowGroup` keeps one tray open per list and `closeAll` runs on scroll begin. Never the only route to an action |
| `RenameSheet` | One-input rename recipe in a `Sheet`: composition-safe input, Cancel / Save, Save disabled for an empty or unchanged name, a rejected submit keeps the draft |
| `Skeleton` | 1.2-second breathing block that respects reduced motion |
| `Banner` | Product messaging that owns layout (grace, Pro, unsupported, bridge update); never connection state |
| `ProGate` | Last-step Pro gate: real content dimmed beneath an SVG veil that dissolves into the page surface (no native blur), hidden from touch and accessibility, then a lock glyph, one `body` title, one `secondary` sentence and one primary CTA naming the feature; `teaserHeight` defaults to four settings rows and `surfaceColor` to `canvasGrouped` |
| `ConnectionStatusPill` | 40-point `surface` capsule (`inline`) or lifted floating overlay (`floating`) for reconnecting / offline / error; caption message, one semibold action word, whole capsule is the 44-point target; reconnecting breathes on the Skeleton cadence |
| `SegmentedTabs` | Full capsule, 48-point standard or 44-point compact track; at most three filters |
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

Each shipped page covers loading, empty, error, offline-with-cache, and permission/paywall states. Loading uses `Skeleton`; offline and error preserve usable cached content and add one-action feedback. Unsupported actions are absent or locked from capability metadata—they do not fail after navigation.

### Connection state lives in the chrome — September 16

Owner feedback: returning from the background produced a grey `Banner` at the top of every page that pushed content down and then vanished. Connection state (recovering, offline, connection error) never takes layout space any more; it is rendered by `ConnectionStatusPill` in the header chrome:

- Roster: the empty header centre between the account/Pro controls and Search. The slot is narrow, so the capsule carries the glyph plus one action word (`Reconnect` / `Retry`) and states the full status in its accessibility label. `Reconnecting…` shows while the coordinator's 20-second recovery window is open; product banners (grace, Pro) stay in the list.
- Thread: the `HeaderPill` subtitle keeps stating `Reconnecting…` / `Offline · reconnecting`; a floating capsule at the top of the timeline carries only the `Reconnect` action, or the actionable error message (`Pairing required · Pair again`, `Bridge is not running · Help`). The expanded editor notice uses the inline capsule.
- Title pages (Agent profile, Agent settings sections, Account settings, Message details, Cron editor): the title yields its slot to the capsule (Telegram's "Connecting…" pattern) and returns when the state clears; content and header height never change. Logs, Tools and Channels keep their own in-place offline copy.
- Search and Session Panel have no title slot to yield (search field; Agent switcher pill), so the inline capsule leads the results/list.

Recovering (`recovering` from the runtime snapshot, scoped to the page's connection) is the quiet, action-less state with a breathing label; only sustained offline or a connection error shows a glyph and the one action word. Reduced motion stops the breath and the fade. Errors keep the red `CircleAlert` glyph on the neutral surface instead of a red block; product `Banner` tones are unchanged.

Default copy has two levels. Rows and controls do not carry explanatory subtitles. Empty, error, banner, and system-event copy is one sentence (up to 8 English words or 16 Chinese characters) plus one action word. Text badges are limited to unread numbers and `Pro`; trailing settings values are a single value, not a sentence. Filters appear only when a list exceeds one screen and are capped at three.

`Motion` is the sole timing token: animations use its 120, 200, and 320 ms durations with ease-out. `SpringPreset` and `TimingPreset` are removed, and the design-system gate rejects their reintroduction. Working avatars use a small stationary activity badge at the lower right, with three contrasting bars; no rotating perimeter or looping decoration. Reduced motion removes positional motion. Rows change surface on press; floating buttons scale; bubbles do not animate on press. New messages fade and move four points, session switches cross-fade, and sheets rise over 320 ms.

## 9. Verification and style ratchet

For every UI batch run affected render tests in both light and dark schemes, `npm run typecheck`, and `npm run check:design-system`. Tests assert capability degradation, all five page states, no row border, and the set of rendered font sizes; screenshots are reserved for human device acceptance.

`scripts/check-ui-style.mjs` scans every production and test TypeScript source and rejects any member outside the exact canonical `Space`, `FontSize`, `LineHeight`, `FontWeight`, `Radius`, and `ControlSize` sets. It also rejects removed motion and semantic-color aliases and malformed source input, alongside hardcoded colors, numeric radii/fonts/borders, `FontSize` arithmetic, outlined list rows, emoji icon literals, more than three `FontSize.*` references per screen, React Native `KeyboardAvoidingView`, raw `Shadow.*`, unapproved native `TextInput`/`Switch`, and bottom-tab dependencies. Existing debt is stored per file and rule in `scripts/ui-style-baseline.json`; counts only decrease. Never update the baseline to hide a regression.

The docs checker verifies canonical and transitional exports, all 18 canonical `theme.colors`, the `BorderWidth`, `ControlSize`, `FontSize`, `LineHeight`, `PresentationColor`, `Radius`, `Shadow`, `Space`, and `StatusSize` families, plus `createSurfaceStyle`. Removed color aliases must stay absent from `theme.ts`; remove transitional component names from this document and its checker only in the same change that deletes the last real caller.

### Keyboard reveal on iOS (2026-09-11)

Screens that must keep one region just above the keyboard (Onboarding pairing code + Connect) use keyboard-controller's padding `KeyboardAvoidingView` to shrink the viewport plus `useKeyboardRevealScroll` (`src/components/ui/`) on a `Reanimated.ScrollView`. The hook measures the anchored region once (layout/focus), re-derives its on-screen position from the live scroll offset on every keyboard transition, and scrolls only the remaining shortfall in step with the keyboard's real height progress. Do not use RN `automaticallyAdjustKeyboardInsets` (a third-party keyboard's transient frame over-scrolls by the full keyboard height) or the library `KeyboardAwareScrollView` (its cached input position is not refreshed after scrolling, so a keyboard resize re-adds the whole distance and bounces back). Number-pad inputs omit `returnKeyType` so React Native does not attach an accessory toolbar that changes the keyboard frame again; the visible primary button is the submit path. Android keeps adjustResize.

### Triage for "placeholder / text sits low" reports (2026-09-11)

A single device screenshot is not evidence of a layout defect. The YouMind email field was reported with a low Chinese placeholder on a phone; the same build on a clean simulator install measured 18.67 / 18.33 points above / below the glyphs inside the 52-point field (centered), in light and dark, and a plain UIKit probe with the identical configuration (system 15, inset `textRectForBounds`, `defaultTextAttributes`, CJK and Latin `attributedPlaceholder`, RN prop order) centered every variant. The phone rendered correctly after a reinstall. Before changing `FormTextInput`, `CompositionSafeTextInput`, or any input typography:

1. Reproduce on a clean build, not a Fast Refresh / hot-reloaded session or a stale install; a stale `UITextField` placeholder frame disappears on the next full layout and is not a code bug.
2. Pixel-measure a simulator screenshot (`xcrun simctl io booted screenshot` and count field rows against glyph rows) rather than judging by eye; report the field height and the above/below space.
3. Compare typed text, placeholder, and caret in the same field; if only one of them is off, isolate whether UIKit or RN differs with a minimal UIKit probe before adding optical offsets.
4. If it only reproduces on one OS version (device fleet includes iOS 26.0–27.0 betas), record the version; do not add a hack for a beta-only rendering change.

## Tool activity

Owner-approved tool rows use one 44-point neutral line with a shared category icon, localized action, optional muted argument preview, and quiet completion check. Full payloads remain in the tool detail sheet. Adjacent calls use an expandable summary anchored by the oldest call ID, with expansion preserved through streaming; errors, approvals, media and prose interrupt groups. Scheduled results keep independent icon-led `RunCard` events and allow long titles to wrap. No decorative rail or repeated completed subtitle on tools.

## Conversation presentation boundary

`buildInterfaceTheme` supplies neutral control colors and retains saved color in `chatColors`; `resolveChatTheme` selects that palette only for conversation content. `ChatPresentationProvider` supplies the saved appearance/font or a local editor draft. `Bubble`, the native thread, and `ChatAppearancePreviewCard` share that boundary and bubble resolver. A theme draft must not change global settings until Save; Discard keeps the saved preference. Global Appearance contains light/dark/system, Chat theme, and App icon; it has no separate accent row.

`ChatMessageIdentity` owns the optional avatar/model labels in preview and real messages. The thread must honor background, bubble, font, avatar, and model preferences rather than exposing inert controls. Expanded preset backgrounds and new material effects remain a follow-up.

### Chat acceptance refinement (2026-09-06)

Sheets use the canvas surface; search and segmented controls use the contrasting secondary surface. The Add sheet rests on fixed 62% / 92% detents with a 16-point inset: an iOS recent-photo strip (camera tile, newest photos) with ordered accent selection badges and an ink `Attach N photos` button in the Sheet `footer` slot (reachable at the resting 62% detent, not only at 92%), three same-height attachment tiles before access is granted, skeleton tiles while the sheet rises, and hairline-separated groups of 48-point rows with a 36-point ink glyph box and chevrons (file, skills, commands; schedule a task, tools). Commands open the canonical `CommandsSheet`; the typed `/` autocomplete stays a borderless floating list. Modal handoffs wait for dismissal completion. Conversation headers omit absent subtitles entirely and reserve their secondary line for activity or measured remaining context; current model selection lives beside shared manufacturer artwork in the composer. Grouped history renders the main session as a single named row and channel names as one section level. Advanced connection details expose only the server host, never URL credentials or query parameters.

Roster unread dots represent canonical main-chat activity only; do not label aggregate session counts as unread messages. Loaded, focused threads advance their scoped read watermark. Model controls use shared `ModelIcon` artwork (20-point compact in the composer, 24-point in picker rows) and a 4-point inner inset next to Add. The model sheet opens at 68% (expandable to 92%); compact model rows use 44-point minimum targets and 8-point vertical padding. Picker rows use the same resolver: recognizable model family first, exact provider/namespace or unambiguous display name second, Orbit fallback otherwise. Original locally bundled brand colors/backings are the owner-authorized artwork exception; provenance is in `assets/model-icons/SOURCES.md`.

### Composer refinement (2026-09-06)

The owner requested a substantial composer upgrade, including Telegram-style long-form expansion. Compact input uses the quiet surface, 17/24 typography, 8-point padding, and bounded growth to five visual lines. From the third visual line, a top-right expand action opens full-screen writing with a collapse action, a keyboard-dismiss action, and the existing toolbar. Both presentations keep the same native input, selection, attachment pipeline, and route-scoped draft. The underlying timeline remains mounted and retains its compact composer placeholder during expansion.

All composer actions share 40-point visual circles in 44-point targets and 20-point Lucide icons. Add is a contrasting neutral surface; Send/Stop uses ink without a floating shadow. Empty composition has a stable disabled Send slot, or dictation when supported; text/attachments switch that slot to Send. Attachment-only messages are sendable when the controller permits them. The attachment tray stays inside the composer, after the full-screen header. Expanded offline editing keeps a connection notice visible.

### Dictation feedback (2026-09-11)

The owner reported that 3.0 dictation gave no visible response and no way to stop once text appeared; 2.0 had a red stop control with a level ring that in practice barely moved, and a "Listening…" placeholder. The 3.0 composer now keeps the trailing slot as a stop-dictation control for the whole dictation lifetime (`authorizing` and `listening`), so the first transcript never swaps it for a disabled Send. The control uses the shared 40/44-point recipe tinted with the conversation accent from `useConversationTheme` (the same palette as the user's bubble) with an `onAccent` filled Square; it is marked busy while authorizing, and the trailing slot returns to Send when dictation ends. The alert `bad` color is not used for dictation.

The glow is two translucent accent discs behind the control, driven by a Reanimated shared value on the UI thread so the 20 Hz level stream never re-renders the thread: an inner layer (scale 1.04→1.32, opacity 0.22→0.38, quick spring) that snaps to syllables and an outer layer (1.08→1.5, 0.1→0.2, lazy spring) that swells behind it, with the surface itself breathing to 1.05. The outer disc peaks at 60 points and stays inside the toolbar padding. There is no idle loop; reduced motion keeps static rims. The native module still emits `min(rms × 5.5, 1)`, which is linear and barely moves for speech; `services/speech/speechLevel.ts` converts it to decibels against an adaptive noise floor (fast down, slow up, capped at −24 dB) and a decaying recent peak (3 dB/s, 12–45 dB range, 3 dB gate), then applies a fast-attack / ~175 ms-release envelope so soft and loud speakers both fill the meter and pauses read as dips. The placeholder reads "Preparing voice input…" then "Listening…", the native input is non-editable during dictation because the next transcript would overwrite manual edits, and both mic and stop taps fire the light impact haptic. Copy comes from `ThreadCopy` (`stopVoice`, `listening`, `preparingVoice`); `ThreadView` ignores voice state when no voice handler is available.

Fabric's paste-capable input does not reliably emit content-size events for native-owned text in a constrained shell. A non-accessible native Text measurement, limited to six lines and matched to the input's width/font metrics, sizes the compact shell without replacing marked text. Height changes use the shared fast timing and respect reduced motion. The existing keyboard-controller drives iOS padding on the UI thread; Android retains native adjustResize. Header position stays fixed, and list viewport changes only follow the bottom when the reader was already following. User-triggered expansion and history reading suspend forced bottom scrolling. Evidence and platform limits: `docs/3.0/16-composer-upgrade.md`.


### Companion A (owner approved)

Use the original asymmetric cat silhouette and capsule eyes from `src/brand/companion.json`. No cheek mark. The `Companion` primitive is a brand-artwork geometry exception, not a general icon family. Use its idle, connecting, loading, curious and error poses; pending motion stops in the background and under reduced motion. `curious` is the looping pose for the Welcome artwork and the roster Pro entry: a data-driven choreography in `CURIOUS_CHOREOGRAPHY` whose tracks (head tilt, gaze, blink, per-ear flicks, eye widening) each sum to `Motion.companionCuriosity`, with ears rotated as separate layers about their geometry pivots. Pivots are applied as translate/transform/translate-back pairs; never combine `transformOrigin` with an animated transform, which blanks the layer on the new architecture. The Welcome screen offers a single primary action — the display title, the character and one `lg` primary `Button` (52-point settings-row height, body label) lifted 24 points above the safe-area bottom with its supported-backends caption; no secondary tagline. The YouMind entry lives on the platform chooser. `LoadingState` provides a readable status and a single accessible busy region. Use full-content loading only before content exists; retain scoped cached messages during refresh. Existing failures retain their real error and retry action, with a static error pose when there are no messages.

### What's New sheet (owner approved 2026-09-16)

`AppUpdateAnnouncementSheet` (`src/features/app-updates/`) is the once-per-update announcement and the third `curious` surface: a canonical `Sheet` on a single 92% detent, no header title, `BottomSheetScrollView` body with `Space.xl` insets. Order: a 148-point ink `Companion` playing `curious` (fades in over `Motion.duration.slow`; still under reduced motion; the loop ends with the sheet because dismissal unmounts the content), the release hero — `display` title (`release.title`, else `What's New`), `secondary` `inkSecondary` summary, `caption` `inkTertiary` `v{{version}}` — then the release entries (`AppUpdateAnnouncementEntryList`: 40-point `surface` icon tiles with 20-point Lucide glyphs from the bounded `AppUpdateAnnouncementIcon` vocabulary, `secondary` 600 title with an optional accent `New` badge, `caption` subtitle, chevron only on link/paywall entries) and the ink `Continue` in the `footer` slot. Several skipped releases stack under `caption` `v{{version}}` labels; a developer preview adds the `warn` debug hint. Copy keys live in `releases.ts` and are registered as a dynamic i18n origin. The Release Notes history page reuses the catalog as inert comfortable settings rows (version + localized date heading); entries never navigate there.

Native default/light and alternate/dark launcher assets, adaptive foreground and splash share the same geometry. Rebuild them with `node scripts/generate-companion-icons.cjs` from the mobile directory; run Expo prebuild afterward. Motion timing uses the Companion token family.

Agent identity refinement: all shared `AgentAvatar` variants use `Radius.full`. Roster, header, profile, sheets and message signatures share the circular silhouette for emoji, images and initials; loading placeholders follow that shape. Preserve existing sizes, spacing and status indicators. Platform logos, App icons and non-identity controls keep their own shapes.

### Message actions (long press)

Long-pressing a user or assistant message uses the Telegram-style focus pattern from YouMind Mobile, rebuilt on the 3.0 tokens with a different menu form. The row measures itself in window coordinates; `ThreadMessageActionsOverlay` opens a transparent `Modal` with the shared 40% `scrim`, renders a clone of the message block through the same `ThreadMessageRowContent` (identity chrome dropped, bottom-aligned to the measured row so it covers the original from the first frame), and drops a capsule action bar below the bubble edge (left for assistant, right for user).

The bar is one horizontal `overlay` surface with `Radius.full`, 4-point padding and no dividers. Cells are equal 80-point columns (44-point minimum height, 4-point padding, 4-point gap): a 20-point Lucide icon in `ink` above a caption label in `inkSecondary`, single line, with a `Radius.full` `surface` press highlight. Equal cells keep the capsule the same size in every locale and during confirmations, so the anchored edge never moves. Standard cells are Copy, Favorite and Share; Favorite is a toggle whose filled star (`accent`) shows the current state while the visible label stays short and the accessibility label reads Unfavorite. Locally queued messages replace them with Send now (when the queue is paused), Edit, Remove (`bad` tint) and Copy.

`messageActionsLayout.ts` is the pure layout engine and is unit-tested: the clone slides only as far as the bar needs (8-point safe-area margins, 12-point gap), a message taller than the remaining space is capped and scrolls internally while the inner scroll offset keeps the pressed content stationary, and the bar is clamped inside 16-point side margins. Copy and Favorite flip their cell to a `good` confirmation (Copied / Favorited / Removed) and close on their own after two slow durations; Share and queue actions close first and hand off after one fast duration so a following modal never races the dismissing overlay. Closing re-measures the live row and animates the clone back onto it; if the row is gone, off screen, or the clone was scroll-compensated, it fades in place instead. The scrim fades over the normal duration, positional motion uses the normal duration with ease-out, and reduced motion removes all positional motion. The gesture dismisses the keyboard, fires a light impact, and confirmations fire a selection haptic. Copy and Share are disabled for messages without text.

### Timeline return to bottom

A 44-point ArrowDown surface button floats 16 points from the right and 12 points above the timeline bottom, naturally clearing the composer and keyboard. Light mode uses the shared soft shadow; dark mode uses the shared floating surface/hairline. Reveal beyond 88 points from the bottom and dismiss within 16 points, using 200 ms opacity and an 8-point translation; reduced motion removes translation and scroll animation. Hidden chrome receives neither touches nor accessibility focus. Native return scrolling is issued once, followed by a final alignment for content received in flight; a new drag cancels the return. History expansion still suspends automatic following.

### Email sign-in and bubble contrast (2026-09-07)

Email sign-in uses a borderless canvas, left-aligned display title and concise secondary guidance, one quiet email field and one primary action. The OTP step shows the destination email, six flexible cells backed by one `CompositionSafeTextInput`, automatic completion, a retry button and quiet resend/change-email actions. The screen owns one keyboard-avoiding scroll region; cells use semantic surfaces, hairlines and the shared type scale. No borrowed hero artwork.

Conversation tint and material opacity are separate: composite `accentSoft` onto `canvas` first, then apply material opacity. Solid has an opaque backing; soft/glass retain bounded opacity. `MessageBubble`, `Bubble` and the appearance preview share the resolver. Saved blue/purple/etc. and material IDs remain intact; users do not need to clear cached settings. Contrast regression spans both message roles, six accents, two schemes, three materials, three opacities and black/white/canvas backdrops (648 combinations).

### Roster primary add action

The roster add entry is a persistent bottom-right ink FloatingButton with the primary size (64 points, 32-point plus). Keep 24-point safe-area offsets and enough list-bottom clearance to scroll the last row fully above it. Header retains Search; preserve the existing add menu, capability checks and subscription handoff. Other floating controls retain their 44-point default.

While the user is not subscribed, the header shows `ProEntryButton` directly after the account button: a 32-point component-owned ink capsule whose hitSlop restores the 44-point target (20-point `Companion` in `inverse` tone playing the `curious` loop + `Pro` in `secondary` semibold) with the shared ink floating chrome and press scale, 8 points from the account control. The Companion keeps its background, reduced-motion and unmount cancellation. It is the one text badge allowed in a header, never overlays the account button, and disappears entirely once subscribed. It opens the shared Pro paywall and never gates roster content itself.

### Conversation motion and delivery (2026-09-11)

The owner asked for a conversation that feels like messaging a person. The recipe keeps the existing surfaces and adds motion and state where a person would expect them.

- **Send.** `MessageEntrance` retains final bubble size and full opacity from the first frame. Only vertical position animates (sent 16 points / reply 8 points, `Motion.duration.normal`, ease-out), without scaling or a spring; reduced motion stays still. `useThreadMessageEntrance` arms at most three new tail rows and owns a played ledger across cell recycling/remounts. FlashList measurement cells do not consume entrances. History paging, exact echo identity swaps and bulk reconciliation remain quiet.
- **Tool-separated replies.** Keep text/tool boundaries and row identities through finalization and history refresh. Completion updates the shown rows in place; an aggregate final must not collapse earlier paragraphs or move tools below them. A text segment records all tools preceding it, including consecutive tool calls.
- **Reply placeholder.** The controller supplies the waiting assistant row with a stable local `renderKey` across server run-ID adoption, streamed text and finalization; committed tool-separated text segments have distinct keys. `ThreadView` retains a fallback placeholder for callers without a live row. `ThinkingIndicator` remains until the pacer has visible text, breathing between 0.36 and 0.9 opacity on the `Skeleton` cadence. The reply retains an 88-point minimum width. There is no whole-body fade on the switch to Markdown; only the native appended text tail animates.
- **Streaming text (2026-09-11).** Chunks arrive in socket-sized bursts; `useSmoothedStreamText` (`src/chat`) paces them through `streamTextPacer` into word-aligned increments on a 33 ms tick (CJK advances per character, long messages publish every 2nd/3rd tick, reduced motion bypasses the pacer) and `remend` terminates open bold/italic/code/link syntax on the paced prefix. The native markdown view's `streamingAnimation` fades in only the appended tail — the Clawket postinstall patch keeps several tails fading in parallel over 250 ms so the stream reads as a cascade. There is no cursor glyph: a synthetic trailing character would absorb that fade. The clock meta is reserved below the first visible text (hidden from accessibility while streaming), then revealed in place once the pacer has drained.
- **Delivery.** `MessageMeta` places the 24-hour clock (`inkTertiary`, caption, tabular figures) and, for the user's own messages, a 14-point Lucide glyph: `Clock` while the prompt is unconfirmed, `Check` once the backend accepted it, `CheckCheck` once the run was reported or the Agent visibly answered — with a 1.75 stroke. Inside the user bubble the time and glyph share `tone="accent"`: the accent at 62% container opacity over `accentSoft`, which settles on a mid tone of the bubble's own hue the way Telegram's outgoing ticks do (the full accent clashed, plain gray looked detached); reply bubbles keep `inkTertiary`; only an uncertain send uses `warn`. `resolveUserMessageStatus` derives this from the timeline plus the controller's `unconfirmedMessageIds` / `runAcknowledged`; queued/held bubbles use the same time and fixed-width glyph slot (clock/pause), with full opacity and no external caption. The local creation timestamp and image preview stay unchanged across network preparation and exact history echoes. The user bubble overlays the meta on an invisible tail of the last text line so it wraps to its own line only when needed; attachment-only sends show it as a row under the gallery. Replies show the clock at their bottom-right after streaming ends. No model label appears in the timeline.
- **Header while working.** `HeaderPill` takes `working`: the subtitle slot shows `TypingDots` (three `Space.xs` dots, `Space.xs` gap, `inkSecondary`, each lifting 2 points and brightening from 0.32 to 1 in turn over `Motion.avatarWorkingLoop`, bounce `slow`) with the same 120 ms fade as a subtitle change; no text repeats the bubble's "Thinking…" and the avatar shows no working badge in the header. Reconnecting still reads as text. Reduced motion keeps the three dots still at rest opacity. The dots sit `Space.xs` in from the name's left edge so they do not read as hanging off the pill.
- **Width and signature.** Reply bubbles may use 92% of the row; user bubbles keep 82%. `ChatMessageIdentity` (avatar + name) is off by default and opt-in through Chat Appearance; the "Show Model Name" row was removed.
- **Placeholder.** The composer placeholder is the messenger word, not a question: `Message` / `输入消息` / `メッセージ` / `메시지` / `Nachricht` / `Mensaje` (owner decision 2026-09-12, matching Telegram). It no longer names the Agent; the legacy `Message...` catalog key keeps its id, its rendered copy has no ellipsis. Dictation still swaps in "Preparing voice input…" / "Listening…".
- **Keyboard.** The compact composer captures a mostly vertical one-finger downward drag past 10 points while its input is focused and dismisses the keyboard; a draft that scrolls keeps the drag. The timeline keeps `interactive` (iOS) / `on-drag` (Android) dismissal.
- **Attachment tray.** `PendingImageBar` is borderless on the composer surface: 56-point `Radius.card` tiles, file tiles with icon and name, an ink remove badge with a `surface` hairline centered on the corner inside a 44-point target, a quiet canvas add tile, and `FadeIn` / `FadeOut` / `LinearTransition` on the shared durations (none under reduced motion).
- **Message album (2026-09-14).** Images attached to a sent message render as one `MessageAttachmentAlbum` below the bubble: an album clipped at `Radius.bubble`, aligned to the message side, 76% of the row content width. One photo keeps its own aspect ratio (clamped between 1:2 and 3:2, no taller than 1.25× the album width); two or more pack Telegram-style into rows of at most three that split the album width in proportion to their aspect ratios, fuller rows last (4 → 2+2, 5 → 2+3, 6 → 3+3), with 3-point gaps and row heights clamped to 30–75% of the album width so wide photos never collapse and screenshots never dominate; tiles use `cover`. Sizes come from `imageMetas` (picker / history cache) or resolve through `useImageDimensions`, with unknown sizes laid out as squares meanwhile. Every photo is visible — no `+N` truncation and no horizontal scrolling inside the timeline — and each tile is an `imagebutton` labelled `Photo N of M` that opens the viewer at that index; a long press on a photo lifts the same message actions as the bubble. `attachmentAlbumLayout.ts` holds the pure geometry with its own tests.

## Thread time separators

The shared Thread timeline uses the YouMind Mobile three-minute inactivity rule: show time above the first timed item, after an adjacent timed-item gap of at least three minutes, and at local midnight. Continuous activity does not gain periodic labels. System/unknown timestamps do not reset the interval. Keep source ordering, tool grouping and message-identity separator keys through streaming and history pagination.

Use centered caption text without an icon, `inkSecondary` on a small canvas backing for wallpaper readability. Today shows 24-hour time; yesterday adds the localized day; the previous six days use weekdays; older dates include month/day and a year when needed. Future dates stay explicit. Use local calendar arithmetic, refresh on day changes, and reuse Intl date/time formatters across rows. Yesterday comes from the existing i18next catalog; native Hermes does not guarantee `Intl.RelativeTimeFormat`.

Timeline rhythm (owner-requested unification, 2026-09-16): rows own no vertical padding of their own. `withThreadRhythm` in `screens/Thread/model.ts` assigns every row one `gapAbove` toward the older row above it, and `ThreadView` maps it to a single `paddingTop`: `stack` = `Space.sm` (8) between rows of one voice — consecutive tool rows or an expanded activity group, an activity stack and the reply it produced, repeated bubbles from one speaker; `turn` = `Space.lg` (16) where the user's voice and the Agent's meet, and on both sides of a system notice; `section` = `Space.xl` (24) above a time label, which carries `Space.md` (12) below itself; `none` for the row after a time label and for the oldest row, which the list's 16-point content insets frame. Approval cards belong to the Agent's voice whatever their wire role. The intra-message gap between a bubble, its attachments and the favorite star stays `Space.xs` (4), so the ladder reads 4 / 8 / 16 / 24 with no intermediate values. The gap wrapper sits outside the measured message row so the long-press overlay clone (which renders the row alone) keeps identical geometry. Bubble interiors are unchanged.

### Foreground connection recovery

For a previously connected chat, use the existing HeaderPill subtitle (“Reconnecting…”) while automatic recovery runs. Retain the timeline and editable composer; enable Send only after health/handshake readiness. The coordinator owns a 20-second foreground grace window shared by both backends and the roster. No banner or full-content loading replaces cached chat during that window. Sustained failures retain retry through the floating `ConnectionStatusPill` (see §8); explicit pause and actionable pairing/authentication failures remain distinct.

### Unconfirmed sends

A prompt acknowledgement failure keeps one original bubble with a neutral `CircleAlert` delivery glyph and the localized “Send unconfirmed” accessibility status. It must not receive a sent/delivered check based on unrelated subsequent activity. The existing failure banner provides details; the composer stays available for a new draft without automatically duplicating the failed text. This is a connection-scoped recovery record across navigation, not an automatic retry queue. Cached messages retain the uncertainty marker. Healthy foreground health probes do not present a reconnecting banner or disable sending.

### Identity form and Agent files — September 16

Owner decision: one place per document. The Identity page is a native-stack form, not a row list — `ScreenHeader` titled Identity with a ghost Save that enables only on a dirty draft, then a centered roster-size `AgentAvatar` preview that follows the emoji draft, three labelled `FormTextInput` fields (Agent name, Emoji, and a multiline Vibe; caption semibold labels, `Space.sm` label gap, `Space.lg` between fields; no Avatar field — the avatar is preview only) and, after a `Space.md` gap, a secondary New Agent and a destructive Delete Agent button. Offline shows the shared banner and disables inputs; a read-only backend shows a quiet "Read only" line under the avatar and no Save. Dirty back navigation and route removal ask through `ConfirmationModal` (Discard / Keep editing). Persona, memory and user documents never appear here.

The Files page is the only editor for SOUL.md, MEMORY.md, USER.md, AGENTS.md and BOOTSTRAP.md (Hermes: MEMORY.md and USER.md). Rows stay `SettingsRow` with the size as the trailing value; an absent core file shows `Create` and opens an empty editor when editing is available, or `Missing` disabled otherwise. The detail keeps its current sheet: plain selectable text, a secondary Edit button, then Cancel / Save side by side while editing; cancelling an uncreated file closes the sheet. Pro gates the save, not the read. A resumed purchase may save only the still-mounted, unchanged document draft on the current online adapter. Ignore superseded reads and allow only one write at a time.

### Skill source documents

Installed skill details expose SKILL.md when content reading is supported. Dismiss details before presenting the 93% source sheet: one gesture-integrated vertical scroll, selectable Markdown at body size, a quiet filename label, 44-point Pencil (edit) / Check (save) FloatingButton header actions, composition-safe source input with autocorrection disabled, stationary errors and no keyboard-following footer. Dirty dismissal asks before discarding; rejected saves keep the draft. Binary/protected skills remain read-only; Pro unlocks eligible saves, not backend permissions.

### OpenClaw management

Agent Profile lists management actions directly, without an Advanced management sheet. Management uses one comfortable card of full-width icon rows leading to OpenClaw config, Permissions, Diagnostics and Backups (owner-requested 2026-09-16: each row carries a one-line `caption` description — the same allowance as `ChoiceRow` at a decision moment — and a trailing value only when the menu already has it locally: pending exec approvals with a red dot, the newest restore point's age); do not squeeze these translated names into an equal-width segmented control. Each section has its own title and returns to the menu. Configuration exposes collapsible top-level keys rather than a full JSON dump; detailed reports use a bounded, scrollable Sheet. The menu performs no configuration/diagnostic requests until a section is selected.

Management lists share account settings' comfortable row density and neutral rounded SettingsIcon tiles. Show explicit diagnostic progress with LoadingState instead of faint skeleton strips; retain real approval actions but omit empty approval groups. Present diagnostic conclusions first and move raw output behind Details.

Free users preview every section with real data (owner decision 2026-09-16; the earlier `Pro required for this agent` banner hid the whole section and converted nobody). Configuration lists real keys; an expanded key shows its JSON under a `ProGate` veil on `surfaceFloating` and Edit opens the paywall. Permissions shows the three real statuses; a detail row, the rules group (veiled) and Repair Now open the paywall. Diagnostics runs for free: the summary line and the first two checks are readable, the remaining checks sit under the veil titled with their count, and Details / Attempt Fix open the paywall. Backups is titled `Back up OpenClaw config` (owner: a bare `Backups` explained nothing) and opens with a comfortable intro group — Archive tile plus one `body` sentence saying the copy lives on this phone and restores in one tap — then the `Create backup` button and the list, or the one-sentence empty state; Create and the restore confirmation open the paywall. A section that is still loading gives the ScrollView content `flexGrow: 1` so the Companion `LoadingState` sits in the middle of the viewport rather than under the header (owner feedback 2026-09-16; the same rule applies to any Companion loading state inside a scroll container). The `OpenClaw logs` page (renamed from `Logs`) shows the newest three entries, veils the next four, stops live polling and gates the tail. Every gate passes a continuation so the action resumes after purchase.

Photo authorization: dismiss the Add sheet before asking iOS for library access, because its limited-library selector must not sit behind FullWindowOverlay. After choosing access, reopen Add for the granted recent-photo strip; denial keeps the system picker available. Do not launch a second picker on permission resolution.
