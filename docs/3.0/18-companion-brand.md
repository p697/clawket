# Companion A — approved brand implementation

The owner selected A after reviewing four ear/face variants. Keep the original high-left/low-right ears and capsule eyes, without the removed cheek mark. This approval supersedes the prior generic no-character/no-loop design constraint only for this branded loading character.

## Implementation

- Shared vector geometry drives native Companion, light/dark launchers, adaptive foreground, favicon and splash. Sharp is a build-time development dependency. Both existing icon preference identifiers remain valid.
- Thread first load distinguishes connection preparation from history loading. Roster first load uses the same character and accessible loading label. Welcome uses the idle character.
- Connecting/loading animate small gaze and breathing movements, with occasional blink. Motion is cancelled for background, reduced motion, idle/error and unmount. Failure is static; the existing actual error banner and retry action remain authoritative. No simulated successful connection or fake progress is introduced.
- Scoped cached messages remain visible during connection/history refresh; session-switch and unresolved-target boundaries still suppress unrelated content. Backend and Agent identity artwork are unchanged.

## Verification

- `npm run check:required` passed (231 Mobile suites / 2,135 tests), including design, localization and documentation gates. The motion test verifies foreground/background cleanup and reduced motion. After shortening the gallery state label, design and localization checks passed again.
- iOS Release (ad-hoc signed, iPhone 17 / iOS 26.5) and Android arm64 Debug builds passed. Final iOS Release is installed on the existing simulator without resetting its data. Android visual acceptance and physical-device motion remain unverified.
- Native screenshots inspected: system launcher; connecting and history-loading poses in light mode; static offline pose; connecting pose in dark mode; first-launch welcome on a separate empty simulator. The extra simulator is shut down. Original theme restored to Follow System.
- OpenClaw and Hermes existing chats reopened with their histories visible and without an observed loading/error banner remaining. This is a bounded chat-entry regression check, not a new send/receive or long-idle stability certification.
- Evidence: `/tmp/clawket-companion-acceptance/` (`launcher.png`, `connecting-light.png`, `connecting-dark.png`, `offline-light.png`, `welcome.png`, plus backend history screenshots). Build logs: `/tmp/clawket-brand-ios-final.log`, `/tmp/clawket-brand-android.log`; required gate: `/tmp/clawket-brand-required-final.log`.

The native Design System page now includes a Clawket tab for inspecting the actual shared loading component. Do not infer connection stability from a Loading animation.

## Loading scenes and the tappable cat (owner-approved 2026-09-27)

The owner asked to unify every loading state and to replace the idle breathing cat, so a wait never teaches users to dislike the brand mark. After reviewing five directions on the design canvas ("Clawket 等待动效方案") the owner kept all of them and asked for the cat to be tappable.

- `LoadingState` draws one scene per wait: Peek, Fetch, Yarn and Listen at 22.5 % each, Pounce at 10 %, never the previous scene, another one after nine seconds of waiting. Sheets alternate Peek and Listen at 60 %.
- Choreography is the approved prototype's keyframes, parsed from CSS keyframe syntax (`src/brand/companion-keyframes.ts`, `companion-scenes.ts`) and sampled on the UI thread into one SVG per scene (`src/components/ui/companion/`). Companion A geometry is unchanged; paws, holes, yarn, cursor, rings and manga marks are additive props.
- Taps (`src/brand/companion-temper.ts`): a soft-toy press plus one weighted flavour (hop, nuzzle, wink, ear wiggle, tilt, surprise); rapid taps warn with airplane ears and an anger mark, then a claw swipe across the glass after five to seven taps and a sulk; a long press is petting with a purr haptic.
- Success exits only through `useLoadingHandoff`, after a wait that was visible (0.4 s grace) and ended in success: the label disappears at once, the cat smiles and the loader fades in 0.2 s, unmounting after 0.26 s (`Motion.loadingExit`). Failures and fast loads hand over immediately. No simulated success and no delayed content; the loader stays in one overlay position above the arriving content (Thread, sessions-first entry, first roster).
- The prototype's scene-specific payoffs (the handed-over chat bubble, the taut yarn, the caught cursor, the echo ring) were removed after the owner's device review on 2026-09-27: at 0.7 s they visibly covered the loaded messages and the stale `Loading history` label.
- Reduced motion keeps the still Companion; scenes, reactions and haptics stop in the background, on success and on unmount.

Verification (2026-09-27): the real App components were rendered at fixed times through a test harness into SVG and compared frame by frame with the prototype (every scene loop, every payoff, every tap flavour and mood). Unit and component suites cover parsing and easing, seamless loops, the weighted pool, the temper rules, taps, rapid taps, petting and the handoff. After the payoffs were replaced by the quick exit, component tests cover the hidden label, the busy state, the smiling mood, the exit duration and a fresh scene for a restarted wait. Physical-device motion, haptics and performance are not yet verified.
