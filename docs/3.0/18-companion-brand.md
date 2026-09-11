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
- OpenClaw, Hermes and YouMind existing chats reopened with their histories visible and without an observed loading/error banner remaining. This is a bounded chat-entry regression check, not a new send/receive or long-idle stability certification.
- Evidence: `/tmp/clawket-companion-acceptance/` (`launcher.png`, `connecting-light.png`, `connecting-dark.png`, `offline-light.png`, `welcome.png`, plus backend history screenshots). Build logs: `/tmp/clawket-brand-ios-final.log`, `/tmp/clawket-brand-android.log`; required gate: `/tmp/clawket-brand-required-final.log`.

The native Design System page now includes a Clawket tab for inspecting the actual shared loading component. Do not infer connection stability from a Loading animation.
