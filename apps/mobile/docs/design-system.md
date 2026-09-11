# Clawket Mobile Design System

This is the durable implementation guide for Clawket 3.0 mobile UI. Product decisions and exact recipes live in `docs/3.0/05-visual-system.md`; this document records how those decisions map to the Mobile workspace.

## Lumen paywall — owner-selected September 11

The approved A study (`docs/3.0/mockups/paywall-studies`) is the paywall presentation exception: graphite canvas, silver Companion, calm orbital line and light primary action. `theme/paywall.ts` provides a scoped semantic palette through `ThemeContext`, never `Appearance.setColorScheme`; shared Button, Skeleton and PaywallPlanCard consume that scope. Keep the standard five type tokens; center title and subtitle, use four benefit rows, then a stable checkout. Owner-approved typography refinement uses `PaywallBenefits`: 17-point body text / 24-point line height, 16-point row gaps on the shared spacing grid, intrinsic-width centering with a 100% width cap, shrinkable untruncated labels and icons aligned with the scaled first line. Subtitle uses the nearest shared body token (17, rather than the HTML study’s 16); price uses the 20-point title token. All six catalogs must retain their full text. Content and checkout share one vertical scroll at every size; the footer settles at the bottom when content fits and follows the complete benefits otherwise. This avoids hiding longer translations behind a fixed checkout. Restore uses a short localized visible label and the full purchase-restoration accessibility label; paywall CTA opts into the shared Button’s multiline layout. Compact plan-copy height is intrinsic: do not inherit `flex: 1` into it, and do not allow column wrapping. Titles, prices and details cannot shrink vertically; recommendation pills share the title baseline. Annual/lifetime use compact side-by-side cards where width and font scale permit, otherwise wrapping rows; monthly is disclosed on request. Plan titles identify periods, store totals stay prominent, and one-time purchases must not display subscription cancellation text. Renewal captions retain live total, period, automatic renewal and anytime cancellation; store-specific cancellation instructions remain available as an accessibility hint. “Recommended” is a preference, not an unqualified cheapest-price claim.

`PaywallLumenHero` draws the approved asymmetric geometry with SVG gradients; the artwork gradient palette and geometry are a brand-artwork exception. Avoid live blur/shader dependencies. Ear and face paths form one white SVG mask over a single silver fill, so overlapping parts cannot create material seams; do not add detached highlight strokes at the ear roots. The mask ears and eyes reuse the welcome choreography from `src/brand/companion-motion.ts`, with gentler tilt/ear amplitudes, frequent blinks and an occasional double blink. The orbit stays still while the head floats. All native tracks pause under reduced motion, backgrounding and success, and are cancelled on unmount. Remove the English artwork caption and all rating quotes. Context still selects copy and artwork orientation while purchase/restore routing and analytics preserve their existing identities. The English-first copy says “Your agents, elevated.” / “Your AI world, in your pocket.”; four benefits cover connections/Agents, channel/task conversations, personality/memory and OpenClaw management. Future copy refinement does not change entitlements or backend capabilities. Native visual acceptance remains with the owner under the current device workflow.

## Owner review — September 2026

The owner approved the reference language for full-app rollout on 2026-09-06. The reviewed reference and evidence are in `docs/3.0/12-design-language-review.md`; rollout scope and remaining acceptance are in `docs/3.0/13-design-rollout.md`. This supersedes the historical screenshot deferral below: inspect actual rendered pages, keyboard states, theme changes, and sheet interactions before declaring a screen accepted. Automated token/render tests do not certify visual quality.

Review recipes reuse the existing theme and primitives: `Button` primary (and the compatible neutral variant) is the high-emphasis monochrome action, ghost is secondary, and text is low emphasis; loading retains action contrast while disabled neutral actions use a quiet surface. `FloatingButton` plain is unraised navigation. `FormTextInput` quiet is a flat input. `SetupPrimitives` owns the symmetric `FlowHeader`, `PageIntro`, borderless `ChoiceRow`, numbered `FormStep`, and wrapping monospace `CommandBlock`. These approved variants should replace legacy recipes through the tracked rollout, with each consumer checked in context. The gallery is a component catalog and may display the complete type hierarchy.

### Feedback iteration

- Navigation/toolbars: `FloatingButton appearance="plain"`; standalone actions: `quiet`, with a visible neutral fill; the single high-priority action may use `ink`. Destructive controls retain their semantic treatment. Every variant has a 44-point target. `plain` is the default. Explicit `surface` is reserved for media overlays and the timeline return-to-bottom overlay, never ordinary page navigation. Header pills use a quiet neutral surface.
- Compact pill segments use 4-point inner padding and a 36-point selected capsule inside a 44-point control.
- `FormTextInput errorMessage` places a small semantic alert and readable correction below a quiet input, and exposes the correction as an accessibility hint. Existing invalid-only consumers remain stable until rollout.
- `Banner tone="neutral"` is for recoverable connectivity with an optional icon and a 44-point retry target. Warning/error tones remain available for stronger conditions.
- `ThemedSwitch tone="neutral"` uses a white thumb and monochrome track. It never remounts or momentarily reports false to initialize colors; native state remains truthful through theme changes. Neutral is the default for all consumers.
- Official platform artwork is a brand-identity exception to Lucide application chrome. `PlatformMark` owns bundled assets with provenance in `assets/brands/SOURCES.md`; no remote image requests or accent recoloring.
- Hermes uses the official App artwork with its own safe area and rounded shape, without another clipping radius. Default iOS single-line `FormTextInput` omits paragraph line height so UIKit centers native font metrics; multiline and Android retain explicit leading. Check actual glyphs, placeholders, and caret before introducing per-page offsets.
- Normal input tracking is explicitly zero in `NATIVE_INPUT_TEXT_DEFAULTS`, shared by stock, bottom-sheet, and paste-capable composition-safe hosts. Apply it before caller styles so pairing-code tracking still works. Test navigation away from a tracked field plus type/clear cycles; a clean first mount alone cannot certify placeholder typography.

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
- center: a title or `HeaderPill`;
- right: one 44-point `FloatingButton` or an empty 44-point slot.

Content begins below the safe area plus floating header. Full-screen pages use the same safe-area treatment on iOS and Android and reserve 16 points above Android's gesture area.

Backend identity and transport identity never select a visual route directly. Route availability and controls come from capability metadata.

## 6. Canonical 3.0 primitives

| Component | Contract |
|---|---|
| `FloatingButton` | 44-point circle, Lucide 22 icon, optional accent dot or bad numeric badge, 0.96 press scale |
| `HeaderPill` | 40-point capsule with 28-point Agent avatar, name, and the one allowed header subtitle |
| `AgentAvatar` | Stable palette square with an optional backend image, initials/emoji fallback, and working, attention, done, offline, or locked state |
| `RosterRow` | 88-point borderless row; avatar, name, one preview line, time, unread/attention/lock state |
| `Bubble` | One assistant/user shape recipe with Markdown-compatible content |
| `SystemEventRow` | One centered supporting line with Lucide icon and optional disclosure |
| `RunCard` | Quiet scheduled/subagent event with category icon, no status rail, and compact time/status |
| `ApprovalCard` | Run-card shell plus command preview and primary/secondary capsule actions |
| `Composer` | Add button, composition-safe growing capsule input, mic, and send/stop action |
| `CompositionSafeTextInput` | Sole stock `TextInput` host; iOS native-owns composing text while external replacement/reset still syncs |
| `CompositionSafeBottomSheetTextInput` | Gorhom input with the same native-owned iOS composition and external sync contract |
| `PasteCapableTextInput` | Composition-safe Thread input that sends pasted images/files through the pending attachment pipeline; text paste stays native |
| `Sheet` | Shared bottom/iPad presentation chrome, handle, backdrop, title, and close action |
| `SettingsGroup` / `SettingsRow` | 14-radius grouped card, 52-point rows, internal hairlines only |
| `Skeleton` | 1.2-second breathing block that respects reduced motion |
| `Banner` | Neutral recovery by default; warning/bad only when the state requires emphasis |
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

Each shipped page covers loading, empty, error, offline-with-cache, and permission/paywall states. Loading uses `Skeleton`; offline and error preserve usable cached content and add one-action `Banner` feedback. Unsupported actions are absent or locked from capability metadata—they do not fail after navigation.

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

Sheets use the canvas surface; search and segmented controls use the contrasting secondary surface. The Add menu uses three attachment tiles plus quiet capability-gated rows. Modal handoffs wait for dismissal completion. Conversation headers omit absent subtitles entirely and reserve their secondary line for activity or measured remaining context; current model selection lives beside shared manufacturer artwork in the composer. Grouped history renders the main session as a single named row and channel names as one section level. Advanced connection details expose only the server host, never URL credentials or query parameters.

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

- **Send.** The user's row enters with `MessageEntrance` `sent`: opacity, a 16-point rise and a 0.92→1 scale on a duration-based spring (`Motion.duration.slow`, damping ratio 0.82); reduced motion fades over `fast`. The reply row uses `reply`: an 8-point rise over `normal` after a 60 ms beat. Entrances are armed by `useThreadMessageEntrance` only for rows that appear at the newest end after mount (at most three per update); history paging, optimistic→server and streaming→final id swaps, and bulk reconciliation never animate.
- **Reply placeholder.** `ThreadView` inserts an assistant row with the live stream id `streaming` while a run has produced no text, so the wait, the streamed text and the settled reply share one row. Inside it, `ThinkingIndicator` renders the live activity (`Thinking…`, `Using exec…`) in message typography breathing between 0.36 and 0.9 opacity on the `Skeleton` cadence; the bubble keeps an 88-point minimum width. The markdown fades in over `normal` only when it replaces the thinking state in that row.
- **Delivery.** `MessageMeta` places the 24-hour clock (`inkTertiary`, caption, tabular figures) and, for the user's own messages, a 14-point Lucide glyph: `Clock` while the prompt is unconfirmed, `Check` once the backend accepted it, `CheckCheck` in `accent` once the run was reported or the Agent visibly answered. `resolveUserMessageStatus` derives this from the timeline plus the controller's `unconfirmedMessageIds` / `runAcknowledged`; queued bubbles keep their existing caption. The user bubble overlays the meta on an invisible tail of the last text line so it wraps to its own line only when needed; attachment-only sends show it as a row under the gallery. Replies show the clock at their bottom-right after streaming ends. No model label appears in the timeline.
- **Header while working.** `HeaderPill` takes `working`: the subtitle slot shows `TypingDots` (three `Space.xs` dots, `Space.xs` gap, `inkSecondary`, each lifting 2 points and brightening from 0.32 to 1 in turn over `Motion.avatarWorkingLoop`, bounce `slow`) with the same 120 ms fade as a subtitle change; no text repeats the bubble's "Thinking…" and the avatar shows no working badge in the header. Reconnecting still reads as text. Reduced motion keeps the three dots still at rest opacity.
- **Width and signature.** Reply bubbles may use 92% of the row; user bubbles keep 82%. `ChatMessageIdentity` (avatar + name) is off by default and opt-in through Chat Appearance; the "Show Model Name" row was removed.
- **Keyboard.** The compact composer captures a mostly vertical one-finger downward drag past 10 points while its input is focused and dismisses the keyboard; a draft that scrolls keeps the drag. The timeline keeps `interactive` (iOS) / `on-drag` (Android) dismissal.
- **Attachment tray.** `PendingImageBar` is borderless on the composer surface: 56-point `Radius.card` tiles, file tiles with icon and name, an ink remove badge with a `surface` hairline centered on the corner inside a 44-point target, a quiet canvas add tile, and `FadeIn` / `FadeOut` / `LinearTransition` on the shared durations (none under reduced motion).

## Thread time separators

The shared Thread timeline uses the YouMind Mobile three-minute inactivity rule: show time above the first timed item, after an adjacent timed-item gap of at least three minutes, and at local midnight. Continuous activity does not gain periodic labels. System/unknown timestamps do not reset the interval. Keep source ordering, tool grouping and message-identity separator keys through streaming and history pagination.

Use centered caption text without an icon, `inkSecondary` on a small canvas backing for wallpaper readability. Today shows 24-hour time; yesterday adds the localized day; the previous six days use weekdays; older dates include month/day and a year when needed. Future dates stay explicit. Use local calendar arithmetic, refresh on day changes, and reuse Intl date/time formatters across rows. Yesterday comes from the existing i18next catalog; native Hermes does not guarantee `Intl.RelativeTimeFormat`.

Conversation message rows use 16-point top and 12-point bottom padding (28 points between adjacent messages). Tool/system rows retain 4-point padding. Time separators use 32-point top padding plus 8-point top margin (40 points above) and 12 below to distinguish a new time group; the first marker keeps 12 points above so history does not start with excessive empty space. Message bubble interiors and attachment spacing stay unchanged.

### Foreground connection recovery

For a previously connected chat, use the existing HeaderPill subtitle (“Reconnecting…”) while automatic recovery runs. Retain the timeline and editable composer; enable Send only after health/handshake readiness. The coordinator owns a 20-second foreground grace window shared by both backends and the roster. No red banner or full-content loading replaces cached chat during that window. Sustained failures retain retry; explicit pause and actionable pairing/authentication failures remain distinct.

### Unconfirmed sends

A prompt acknowledgement failure keeps one original bubble with a neutral `CircleAlert` delivery glyph and the localized “Send unconfirmed” accessibility status. It must not receive a sent/delivered check based on unrelated subsequent activity. The existing failure banner provides details; the composer stays available for a new draft without automatically duplicating the failed text. This is a connection-scoped recovery record across navigation, not an automatic retry queue. Cached messages retain the uncertainty marker. Healthy foreground health probes do not present a reconnecting banner or disable sending.
