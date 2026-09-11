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
- Keep the client's own pairing handshake separate from owner device/node approvals. Owner pair requests are connection-wide, never session-owned, and must not enter thread history or message cache.
- Scope every live or cached Agent identity by both connection ID and Agent ID. A connection switch must render a neutral identity until the new scope is authoritative and must never persist the previous connection's name, emoji, or avatar.
- Agent usage and profile cost requests include the selected Agent identity. Hermes strips the UI identity at its adapter boundary to preserve its single-Agent wire contract; never retry an owner-scoped OpenClaw query as a global query.
- Store OpenClaw device tokens by both connection scope and role. Operator and node credentials must never overwrite or invalidate each other; node lookups must not fall back to legacy operator tokens.
- Bridge diagnostics may read the CLI version only from a negotiated OpenClaw Relay connect response or Hermes health. Direct OpenClaw and legacy peers report no Bridge version; never relabel the Gateway's `server.version` as a Bridge version.
- Connection removal clears only that connection's credentials, cache generations, roster cache, and unread watermarks. Roll back storage migrations atomically on failure.

## Navigation and pages

- Root surfaces are Onboarding, Roster, Thread, Agent Settings, Account Settings, Search, and Paywall. Session Panel is a Thread-owned sheet, not a route.
- First-run Welcome introduces chatting before showing setup instructions. Account Settings exposes category entries; connection lifecycle lives in shared Connections/Connection routes. Local settings remain usable while an Agent is offline or membership is loading.
- Advanced connection details retain the selected connection scope; do not repeat global connection lists or lifecycle controls on that page.
- History with explicit `hasActiveRun=false` retires unmatched running tools as unknown, including the final user turn. Preserve real success/error results and do not treat missing run metadata as completion.
- Thread identity and history are scoped synchronously by connection and Agent. Never seed a new route from another Agent's global preview. Keep one stable adapter run ID throughout YouMind task/generation/message events.
- A paused connection stays paused across restarts and automatic reconciliation; only an explicit activation/resume/reconnect clears the pause. Reconnect creates a new transport and backend handshake.
- Agent identity avatars use a circular silhouette across roster, header, settings, sheets and message signatures; variants differ in size, not shape. Platform logos retain their own brand artwork. `headerShown` stays false. Use content-owned `FloatingButton`, `HeaderPill`, `ScreenHeader`, or the canonical modal header primitives.
- Each network-backed page must cover loading, empty, error, offline-with-cache, and permission/paywall states. Preserve usable cached content during offline and recoverable errors.
- Every interactive row is at least `ControlSize.settingsRow`; the owner-approved compact model picker uses `ControlSize.floatingButton` rows with 8-point vertical padding, and the message actions capsule uses 44-point-minimum cells. Controls meet the 44-point touch target.
- Use `ConfirmationModal` for destructive or restart-causing confirmation. System `Alert` is reserved for permission, system handoff, transient result, and unrecoverable error messages.

## Design system

Owner testing preference (2026-09-11): visual acceptance is performed by the owner on a physical device by default. Do not operate or connect a simulator for visual acceptance unless explicitly requested; this supersedes earlier per-screen simulator/screenshot requirements, including input-alignment reproduction recipes. Continue appropriate automated checks, code review and log diagnostics. Do not refresh pairing credentials or disturb the owner's active connection for visual QA. Distinguish development-server Fast Refresh from standalone/OTA updates; do not claim a device received a change without evidence.

The owner approved the design-language gallery and connection example for full-app rollout on 2026-09-06. Follow `../../docs/3.0/13-design-rollout.md` for rollout scope and acceptance; approval of the reference does not certify unreviewed screens. Use `SetupPrimitives` for shared headers, intros, choice rows, steps, and command blocks. `ChoiceRow` is the recipe for a decision moment (Onboarding backend choice, Roster add sheet): it may carry a one-line description and a `locked` Pro trailing glyph, unlike default list rows. Approved recipes are neutral/text buttons, plain navigation icons, quiet circles for standalone controls, and ink only for a primary action; all retain 44-point targets. `PlatformMark` is the narrow official-brand artwork exception to Lucide chrome, with provenance in `assets/brands/SOURCES.md`. ThemedSwitch must preserve its native instance and true value; never simulate an off state to initialize colors. Record actual simulator checks separately from automated gates. Move the onboarding palette shortcut into developer access during rollout. `buildInterfaceTheme` keeps global controls neutral; conversation consumers use `ChatPresentationProvider` / `resolveChatTheme`, and the editor commits local color drafts only on Save. Replies carry no model label in the timeline (owner decision 2026-09-11); the composer owns the current model, and per-message `modelLabel` stays metadata for details and diagnostics only. Persist wallpaper preferences before replacing live state or removing the previous image. Global light/dark mode stays separate from chat personalization; expanded backgrounds and bubble-material controls are a recorded follow-up, not a prerequisite for this rollout.

Tool activity uses shared single-line `ToolCallRow` and stable, expandable groups. Keep failures, approvals, media, conversation text, and scheduled results outside automatic grouping. Never append untimed cached tools after fresh chat or emit duplicate timeline IDs; repeated history reconciliation must preserve ordering. Scheduled `RunCard` events have an icon and no status rail. Thread timelines expose a bottom-right return action while reading history, track drag and momentum positions with hysteresis, and defer automatic layout/streaming snaps during an explicit animated return. New drags cancel the return; reduced motion uses an immediate scroll. Thread time separators precede the first timed item, adjacent timed items at least three minutes apart, and local-day changes; ignore system/unknown timestamps, preserve message-based keys and use localized calendar labels. Translate relative-day words through i18next; do not require `Intl.RelativeTimeFormat` in the native runtime. Thread chat rows use 16-point top and 12-point bottom padding; time breaks use 32-point top padding plus 8-point top margin and 12 below, with the first marker retaining 12 above. Keep tool/system activity compact. Thread timelines use chronological layout; expanding activity must not trigger bottom-follow scrolling. Retain route-scoped history and adapter identity across secondary navigation, and never replace an explicit task session with a default selected from a bounded session index. Task routes carry their title/status; runs without a child session open the recorded execution summary.

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
- Tool details use readable names, separate nonwrapping status/timing, and optional execution metadata. Bound initial payload rendering, preserve full raw clipboard content, and never label missing output as successful execution.
- Historical tool calls without results before a later user turn are unavailable, not perpetually running. Preserve explicit unavailable status through cache/protocol projection; never substitute a tool summary for output. “Continue chat” returns to the nearest existing conversation for that connection and Agent, retaining its session and scroll state.
- Sheet backdrops keep stable component identity across caller renders. Add-menu actions that open another modal or native picker run only after dismissal completes. Session creation enters the returned session before background roster refresh; prevent duplicate submissions, surface failures, and never render an internal session key as its display title.
- Model selection artwork uses shared `ModelIcon` (20-point compact in the composer, 24-point in picker rows) and conservative local manufacturer mapping for both composer and picker rows. Prefer recognizable model families over routing providers; unknown, ambiguous or unavailable brands use Orbit. Bundled YouMind artwork provenance lives in `assets/model-icons/SOURCES.md`; preserve original colors/backing and backend selection scope.
- OpenClaw model selection uses `sessions.list` / `sessions.patch` for session scope and `config.get` / `config.patch` for defaults; Hermes keeps its global model operations. Hermes Relay clients actively request fresh Bridge health after socket open because an older Bridge socket may have already emitted its initial event. Connection-level failures stay in connection UI and never accumulate in transcripts.
- The bottom-sheet portal host must be inside the App/theme/navigation providers. Never dismiss a sheet before its first presentation; use its completion callback for navigation after closing.
- Roster unread reflects only the Agent’s canonical main chat, displayed as a dot when the backend has no message count. Advance read watermarks for loaded, focused route history, including updates received while reading. Roster working avatars use a stationary activity badge, never a rotating perimeter; the Thread header never shows that badge (owner found it unreadable, 2026-09-11) and signals a run with `TypingDots` in the pill's subtitle slot instead of a second "Thinking…" label.
- Motion uses shared durations and honors reduced motion. The owner-approved Companion A character is the only branded looping exception: the loading poses animate only while loading and foregrounded, and the `curious` pose (owner-requested 2026-09-11) loops only on the Welcome artwork and inside the roster `ProEntryButton`; both cancel on background, completion, failure, reduced motion and unmount. The reply-wait indicator (`ThinkingIndicator`) breathes the live activity label inside the reply bubble on the `Skeleton` cadence only while a run has produced no text; it is loading state, not decoration, and stops under reduced motion. `TypingDots` (owner-requested 2026-09-11) is the one three-dot loop: three 4-point `inkSecondary` dots lifting in turn on the avatar working cadence, used only in the Thread `HeaderPill` while a run is active, static under reduced motion. Do not add other decorative looping animation.
- Never raise `scripts/ui-style-baseline.json` to hide a finding. New checker logic must fail closed on missing, empty, malformed, or unparseable input and include a corrupted-input regression.
- Long-pressing a user or assistant message lifts it Telegram-style: the row is measured in window coordinates, a clone of the message block (identity chrome dropped, bottom-aligned to the row) renders over the shared scrim in a transparent `Modal`, and a capsule action bar drops below the bubble edge. The bar is one horizontal row of equal 80-point icon-over-caption cells (Copy / Favorite / Share; queued messages show Send now / Edit / Remove / Copy instead), 44-point minimum, `Radius.full`, with a rounded `surface` press highlight and no dividers. Favorite is a toggle: the filled star carries the state and the visible label stays short while the accessibility label says Unfavorite. Layout comes from the pure `messageActionsLayout` engine: the clone moves only as far as the bar needs, taller messages are capped and scroll internally with the pressed content kept stationary, and the bar never leaves the side margins. Copy and Favorite confirm inline in `good` (Copied / Favorited / Removed) before closing on their own; Share and queue actions hand off only after the close animation. Closing re-measures the live row and returns the clone to it, or fades in place when the row is gone. The gesture dismisses the keyboard, fires a light haptic, honors reduced motion, and is absent when no message actions are provided. Do not reintroduce a bottom sheet or a vertical list for message actions.
- Conversation motion and delivery (owner-requested 2026-09-11): a sent turn creates the reply bubble immediately under the live stream id (`streaming`) so the thinking state, the streamed text and the settled reply are one row that never remounts; the reply text fades in only when it replaces the thinking state in that row. `useThreadMessageEntrance` arms an entrance for at most three rows that appear at the newest end after mount and never for history paging, id swaps or bulk reconciliation; the user's row springs in (`MessageEntrance` `sent`) and replies rise in a beat later. User bubbles carry their clock time and a Telegram-style delivery glyph inside the bubble (`MessageMeta`): a clock while the prompt is unconfirmed, one check once the backend accepted it, two accent checks once the run is reported or the Agent visibly answered; `resolveUserMessageStatus` is the only source of that state and queued bubbles keep their caption. Replies carry the clock only, use up to 92% width, and the Agent signature (`ChatMessageIdentity`) is opt-in and off by default. A mostly vertical one-finger downward drag on the compact composer dismisses the keyboard (`shouldCaptureComposerKeyboardDismiss`); a draft taller than the compact cap keeps its scroll. The attachment tray is borderless: 56-point tiles on the composer surface, an ink corner remove badge inside a 44-point target, a quiet add tile, and fade/layout transitions that honor reduced motion.

### Text input and paste

- `CompositionSafeTextInput` is the sole stock React Native `TextInput` host. iOS native-owns marked/composing text; external replacement and clearing must still synchronize. Android remains controlled.
- Use `CompositionSafeBottomSheetTextInput` inside bottom sheets.
- Default iOS single-line `FormTextInput` uses native font metrics, without a forced paragraph line height. Preserve explicit leading for multiline inputs and Android; verify text, placeholder, and caret together before adding optical offsets. A single device screenshot of a low placeholder is not a defect report: reproduce on a clean install and pixel-measure a simulator screenshot first (a stale Fast Refresh / hot-reload placeholder frame clears on the next full layout). Triage steps live in `docs/design-system.md` §9.
- All three composition-safe input hosts apply `NATIVE_INPUT_TEXT_DEFAULTS` before caller styles. Explicit normal tracking prevents stale iOS placeholder kerning after a tracked pairing field; caller overrides must remain effective.
- Thread composition uses `PasteCapableTextInput`. Pasted images/files enter the existing pending-attachment pipeline, respect adapter attachment capability, and share the six-item capacity limit. Text paste remains native.
- Compact and full-screen composition retain one native input and draft; expanding must not remount the input or timeline. Keep native layout hosts stable, restore focus after the mode-change layout, and explicitly reset expanded flex properties on collapse. Measure at most six visual lines with the same native typography, offer expansion from line three, and cap compact growth at five lines. Toolbar actions share 40-point visuals inside 44-point targets. Flush pending draft edits on scope departure. Foreground recovery must not dismiss an editing keyboard. Keyboard/composer resizing follows the bottom only while the reader was already following; never scroll a reader away from history.
- Dictation keeps the trailing composer slot as a stop control for the whole `authorizing`/`listening` lifetime, tinted with the conversation accent (never `bad`), with a two-layer level-driven glow fed by a shared value (no idle loop; static rims under reduced motion), a "Preparing voice input…"/"Listening…" placeholder, a locked draft, and light-impact haptics. The raw native level is linear and nearly static for speech: always pass it through `services/speech/speechLevel.ts` (adaptive dB floor/peak plus envelope) before it drives motion. Never let the first transcript swap the stop control for a disabled Send, and never route the 20 Hz microphone level through React state.
- Do not bypass these primitives with a raw input host. Forward refs and imperative clear/focus behavior must remain compatible with the composer controller.
- A message sent while the session has an active run joins the App-side queue in `src/chat/messageQueue.ts` for every backend; never send a second concurrent prompt to a backend. Delivery goes through the normal send preflight only while the session is idle, history is loaded and no refresh is running; the queued bubble keeps its `usr_` id so it settles in place. Stop, reply failures and failed deliveries hold the queue; a new send, enqueue or "Send now" resumes it. Keep queued bubbles untimed and last in the timeline, tap/long-press opens the shared actions overlay with Send now / Edit / Remove / Copy, and the composer shows a secondary Stop beside the primary Send whenever a draft exists during a run.

## Internationalization and copy

- Account Settings exposes App language independently of speech recognition. Persist the explicit choice before applying it; system mode re-resolves on foreground. Locale changes must refresh memoized labels without remounting connections or navigation.

- All visible copy uses natural-English i18next keys. No user-facing string is hardcoded in a screen or component.
- Keep the four namespaces (`common`, `chat`, `config`, `settings`) synchronized across `en`, `zh-Hans`, `ja`, `ko`, `de`, and `es`.
- Add every key to all six locales in the same change. Constants containing translated labels belong inside a component hook or memo so locale changes update them.
- Default rows and cards do not gain descriptive subtitles or decorative labels. Error/empty/banner copy is one concise sentence plus at most one action.
- Execution history rows include their timestamp to distinguish repeated task names. Execution summaries use readable left-aligned, scrollable text; long schedules use full-width secondary content. Localize standard tool catalog categories without changing backend identifiers or custom labels.
- Source comments, identifiers, tests, and commit messages are English; translated text belongs in locale JSON.

## Analytics, privacy, and subscriptions

- Add semantic analytics helpers in `src/services/analytics/events.ts`; never scatter raw `posthog.capture` calls.
- Events use small enums, booleans, counts, and normalized error codes. Never include message text, prompts, raw IDs, credentials, invitation material, or secret-bearing URLs.
- Navigation exposure is centralized in `src/utils/posthog-navigation.ts`.
- Subscription gates derive from the entitlement/free-connection helpers and adapter capabilities. UI must not infer Pro from the presence of a package or hardcode localized prices.
- RevenueCat prices and offering metadata are authoritative. Purchase cancellation is silent; pending/store/offering failures use normalized low-cardinality reasons.

## Native configuration and dependencies

- Expo config plugins under `plugins/` are the source for generated native edits. Plugins must be idempotent and fail closed when their anchor/template changes.
- Keep direct dependencies tied to production, test, config-plugin, or native-link consumers. Review Knip findings against string-loaded Expo plugins and generated native configuration before removing a package or export.
- Keep root and Mobile lockfiles synchronized. Both root and workspace install entry points must apply required native dependency patches.
- After native dependency or plugin changes, run a clean Expo prebuild, iOS pod install/build, and Android Debug build. Inspect generated changes; do not hand-edit a generated native file unless the build documentation explicitly requires it.
- `@mattermost/react-native-paste-input` requires the checked podspec patch and iOS `PasteInputModule.setup(factory.rootViewFactory)` bridge setup. Preserve both postinstall paths and their tests.
- ExpoModulesCore 55.0.26 requires `scripts/patch-expo-permissions.mjs` to synchronize permission-requester registration and lookup. Both install entry points apply the reviewed, fail-closed patch; retain its corruption/idempotency tests until an upstream fix replaces it.
- Runtime client configuration goes through `src/config/public.ts`. Add public variables to `.env.example` and to the public-config checker; do not read scattered `process.env` values in UI code.

For Android store packaging, use `npm run build:android:aab`. Release signing credentials and upload keystores remain local and uncommitted. A Debug build must never require release credentials, and a Release build must fail closed unless real credentials are present or the explicit local debug-signing override is set.

## Testing and completion

Use the narrowest useful test while iterating, then run the milestone gate. Mobile changes normally require:

1. `npm run mobile:typecheck`
2. `npm run mobile:test`
3. `npm run mobile:check:design-system`
4. `npm run check:required`

Connection/protocol changes additionally require recorded adapter tests, relevant integration tests, and `npm run test:compat`. Native changes additionally require clean iOS Simulator and Android Debug builds. Interactive iOS Release acceptance must use simulator signing (`CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-`); unsigned builds lack the simulated Keychain identity and cannot certify persisted preferences or connections. UI tests cover light/dark themes, capability degradation, page states, accessibility targets, token usage, and composition behavior; simulator screenshots are not an automated acceptance substitute.

Checks must report verified scope, fail when inputs disappear or become malformed, and include a corrupted-input regression for new validation logic. Never delete or weaken tests to reduce line counts.

## Companion brand

The approved identity is Companion A: asymmetric high-left/low-right ears, rounded face, two capsule eyes, no cheek mark. `src/brand/companion.json` is the shared geometry for `Companion` and `scripts/generate-companion-icons.cjs`; ear parts carry a `role` and root `pivot` so `Companion` can rotate them as separate layers under the face, and the icon script ignores those fields; the Sharp dev dependency rasterizes icon assets only and is not bundled into the App. Regenerate launcher/splash assets after geometry edits and run Expo prebuild to propagate both native icon variants. Preserve existing icon preference identifiers. First-load chat/roster use the readable Companion loading state; cached scoped messages remain visible during connection/history refresh. Brand identity never replaces backend or user Agent avatars.

### Email sign-in and conversation contrast

YouMind email sign-in uses one composition-safe native OTP field with six visual cells, system autofill, paste, explicit retry and automatic six-digit verification. Guard requests synchronously and derive resend cooldown from a deadline. Bubble materials must resolve `accentSoft` onto the theme canvas before applying opacity; never replace its tint alpha with material opacity. Keep saved appearance IDs compatible and verify body-text contrast for all six accents, light/dark, all materials and wallpaper extremes. See `../../docs/3.0/19-auth-and-theme-review.md`.

### Roster primary add action

The roster add entry is a persistent bottom-right ink FloatingButton with the primary size (64 points, 32-point plus). Keep 24-point safe-area offsets and enough list-bottom clearance to scroll the last row fully above it. Header retains Search; preserve the existing add menu, capability checks and subscription handoff. Other floating controls retain their 44-point default.

While the user is not subscribed, the header shows `ProEntryButton` directly after the account button: a 32-point component-owned ink capsule whose hitSlop restores the 44-point target (20-point `Companion` in `inverse` tone playing the `curious` loop + `Pro` in `secondary` semibold) with the shared ink floating chrome and press scale, 8 points from the account control. The Companion keeps its background, reduced-motion and unmount cancellation. It is the one text badge allowed in a header, never overlays the account button, and disappears entirely once subscribed. It opens the shared Pro paywall and never gates roster content itself.

### Connection phase diagnostics

A new OpenClaw challenge after readiness starts fresh authentication; duplicate nonces are ignored. Preserve credential scope, reject stale pending requests, and retain readiness deadlines. Emit bounded `connect_phase` timing fields through the analytics privacy boundary for both challenge and health protocols; telemetry failures must never interrupt transport recovery. See `../../docs/3.0/20-connection-diagnostics.md` for triage and evidence limits.

Health probes must verify the same protocol epoch, handshake generation, and transport after awaiting a response or rejection. Disposal rejects probes: it must never resurrect a retired adapter and replace the new adapter's Relay socket.

The default connection coordinator has one process owner across Metro module replacement. Claiming ownership permanently retires the previous coordinator, synchronously detaching its adapter, maintenance timers and store subscription. A stale React effect cannot restart a retired owner; ordinary stop/start remains reusable. Never rely on module-local singleton variables alone to own network resources through Fast Refresh.

Foreground recovery uses the coordinator’s single 20-second presentation window. Preserve scoped history, scroll, draft and keyboard while showing a quiet header status; only sustained failure exposes retry/error UI. Background suspension does not consume the window, retry attempts do not restart it, and healthy evidence, pause, disposal or a connection switch clears it. Never fake readiness or automatically resend an ambiguously accepted message.

Model/run failures retain bounded, credential-redacted backend diagnostics in the shared ReplyFailureSheet. Show a localized actionable summary for authentication, quota and rate-limit failures; preserve unknown details instead of replacing them with generic retry text. Keep diagnostics out of analytics and connection-recovery loops; never automatically resend a failed or ambiguously accepted turn.

Session panel chrome has one Grouped/List switch, plus optional search. Do not reintroduce the All/Needs you/Working filter row; preserve attention and working indicators on session rows and existing kind filtering.

Session Panel browses and switches existing sessions only. Do not expose new-session actions in Agent headers or empty states; backend session-creation capability is independent of this UI policy.

Non-main Thread sessions use the owner-approved read-only Pro preview in `docs/3.0/21-session-preview-pro.md`: latest two content messages, stable reading window, decorative hidden-history placeholder, explicit `sessionHistory` paywall. Gate rendered content and sending centrally; preserve main-chat access, approvals, status/errors and existing grace. Purchase/restore reveals the mounted thread without reconnecting or forcing a bottom scroll. Free search excerpts must not bypass this preview.

Preview loading uses projected visible content for Thread state. Same-session cache can render before network history completes; hidden raw messages must never turn an empty preview into `ready` and suppress its loader.

Subscription lookup must not block the safe two-message session preview or appear as history loading. An authoritative RevenueCat customer-info listener update settles initial subscription loading when it invalidates an older refresh; preserve purchase/restore ownership. Emit `thread_load_state` only for scoped state transitions, using booleans, phase, backend and elapsed time without session identifiers or content.

Paywall uses the owner-approved Lumen presentation: a scoped dark semantic theme, silver Companion artwork and one light primary button, independent of the user's app/chat theme. Never change the global appearance preference to show it. No English artwork caption or rating quote. Use four contextual benefits through `PaywallBenefits`: intrinsic-width group centered within the screen margins, 17-point wrapping text and first-line-aligned icons. Preserve full translated labels and store disclosures; the introduction and checkout share one vertical scroll with the footer bottom-aligned when content fits. Never clip benefits behind fixed checkout. Compact plan titles and prices use nonshrinking intrinsic blocks, with no flex shorthand on the title block or column wrapping. English copy is intentionally concise; do not force single lines by truncation or font shrinking. The paywall opts into multiline Button labels. Use localized live store prices, annual recommendation and lifetime-specific one-time billing; preserve package locks, purchase/restore lifecycle and continuation routing. Silver artwork uses one silhouette mask and material fill, never per-part gradients or detached ear highlights. Reuse `src/brand/companion-motion.ts` for welcome/paywall curiosity; all decorative tracks stop in background, reduced motion and success states. See `docs/design-system.md` for the recipe; headline/benefit wording remains owner-reviewable.

## Send acknowledgement and foreground probes

A rejected prompt acknowledgement is not proof of backend rejection. Preserve one session/connection-scoped uncertain bubble (including attachment references); do not label it sent or automatically refill/replay it. Late failures must hold only the originating queue. Matching backend identity may settle uncertainty. Keep the uncertain flag in local chat cache, and clear in-memory recovery on connection removal. Healthy foreground probes stay ready; only actual failure or adapter recovery changes presentation. Corrupt pause preferences must not prevent registry startup; salvage valid IDs without rewriting a failed read.

## Local model connection

The `local-model` backend is Preview-only and uses the shared chat UI with its own adapter. Six-digit codes and compact QR payloads must retain backend identity through claim. Model switching is global; image controls follow live vision capability. Unsupported Agent management remains capability-gated. `dev:android` and `build:android:preview` use Node scripts on Windows and macOS; debug builds do not publish.

Local-model Relay handshakes use `health`, not the OpenClaw challenge-triggering `connect`; direct sockets retain token-authenticated `connect`. Failed handshakes use transport backoff, and 30-second ticks allow three missed intervals. Keep idle and failure-recovery regressions beside the adapter.
