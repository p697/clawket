# Chat owner acceptance — 2026-09-06

This iteration addresses the owner's reported chat chrome, Add-sheet handoff, history hierarchy, model API failures, and Hermes Relay readiness. Earlier expansion/task-route fixes remain documented in `14-tool-activity-and-chat-reconciliation.md`.

## Delivered behavior

- Shared sheets use the canvas surface with gray controls. The Add sheet has attachment tiles and quiet Skills/Prompts rows. Its modal/native-picker actions run after dismissal, and shared backdrop identity remains stable across parent renders. Session action → rename/confirmation uses the same dismissal ordering.
- Agent names center when no truthful subtitle is available. Context remaining is shown only from valid usage data; the composer owns the actual model label, shortened by removing the provider prefix and paired with a model icon.
- History has a white light-mode base, gray segments, a clear main-session row, and a single heading per channel family. Internal keys are replaced with “New session” in unnamed-session chrome. Session creation navigates before background roster refresh; duplicate submissions are guarded and failures are visible.
- OpenClaw model reads/writes use supported session/config operations, preserving per-session scope. Hermes remains global. Installed Hermes now returns five parser flags; the Bridge accepts both legacy and current tuples. Subprocess errors cannot expose inline scripts or payloads to the app.
- Hermes Relay explicitly requests fresh Bridge health when a new client attaches. Relay pong expiry is at least three heartbeat intervals, preserving negotiated legacy behavior and both backend policies. Connection-level retries no longer accumulate as chat messages.

## Actual acceptance

Signed iPhone 17 Simulator Release, iOS 26.5, both appearances:

| Path | Observed result |
| --- | --- |
| OpenClaw models | Catalog loaded; searched and reselected the current `gpt-6-astra` successfully, without changing Lucy's active model. |
| OpenClaw new session | Created an isolated session, received `Chat verified`; after the final follow-up, creation enters promptly and the empty title reads `Lucy · 新会话`. |
| Add sheet | Four successful repeated open/close cycles, system photo picker cancel, system file picker cancel, Prompts → editor → cancel, Skills → loaded page → back; no retained dim layer in these paths. |
| History | Light/dark hierarchy and selection inspected; channel history loaded with channel-specific header identity. Rename/confirmation dismissal ordering and duplicate-creation failure recovery have focused automated regressions. |
| Hermes model write | Flash → Pro succeeded with the composer updated; restored Flash successfully. |
| Hermes messaging | Two new replies, including `Still connected.` after sustained connection; cold launch restores both messages and replies. |
| Hermes liveness | Preview Worker metadata, 04:45–04:54 UTC: 17 alarm ticks with a client, 71 delivered responses, zero `client_pruned` events. This is a bounded nine-minute observation, not a long-duration reliability claim. |

Local screenshots: `evidence/chat-owner-acceptance/{add-light,add-dark,history-light,history-dark,hermes-model-switched,hermes-stable-reply,openclaw-reply-dark}.png`. Screenshots were visually inspected; these are actual Simulator captures, not mockups.

Final `npm run check:required` passes: Mobile 229 suites / 2,109 tests, Relay 114 tests, all workspace typechecks, design-system checks, six-locale checks, and documentation checks. Separate v1 replay passes 35 tests. Final signed Release builds and installs. `check:docs` passes after the final instruction update.

## Environment and limits

Hermes QA was paired to an isolated Preview service while the existing managed runtime served Production. Restored its existing private Preview pairing and deployed only Hermes Preview version `1801183a-e546-45fe-8bb2-b3a705001fe6`; no Production Worker deploy or Production pairing change. The Clawket-owned local Hermes Bridge was rebuilt/restarted; external Hermes source was not changed. Simulator appearance was restored to light. QA Pro override is local to the Simulator build.

The reported permanently blocked overlay was not reproduced in every original circumstance; Add → Prompts failing to open was reproduced, fixed, and retested along with related handoffs. Physical camera capture, long-duration background/weak-network operation, and final device feel still require device acceptance. No new YouMind integration change was made in this iteration, and no new full YouMind acceptance is claimed. These limits do not replace the concrete native chat checks above.

## Roster state and feature review — 2026-09-06

The owner requested a replacement for rotating working avatars, main-chat-only unread indicators, a quieter composer model icon with a 4-point inset adjustment, and a usage/purpose review of Prompts, speech language, and reply alerts.

### Delivered and verified

- Shared `AgentAvatar` now uses a stationary, three-bar activity badge at the lower-right corner. No rotating perimeter or decorative repeating animation remains. The same recipe covers roster, header, settings, and sheet sizes; the design gallery exposes all four for review.
- Roster unread previously summed unread sessions across ordinary channel/direct/group sessions, while Thread never called the coordinator's read acknowledgement. It now considers only `agent.mainSessionKey`. Loaded, focused history advances persistent read watermarks, including session revisions received while reading. Retained/background routes do not acknowledge unread history. Since the current contract supplies session timestamps rather than accurate unread-message totals, roster indicators are dots, not fabricated message counts. Attention/failure signals and session-panel data remain independent.
- The composer model icon is `Layers2`, replacing `Cpu`; its leading inset is 4 points smaller, preserving the 44-point touch target.
- Settings labels now explicitly say “Voice input language” and “Reply alerts” (Chinese: “语音输入语言”, “回复完成提醒”), with aligned translations in all six locales.

Native signed iPhone 17 Simulator Release checks: Lucy main-chat open → back clears its unread indicator while the Operator's remains; opening the Operator clears its own indicator. Cold launch retains both acknowledgements. A later real Lucy update produced a new dot, and opening its main chat cleared it again. Lucy's real working roster state was inspected without sending a new test instruction. All four avatar sizes were visually inspected in light/dark gallery captures, plus the actual composer icon/inset and settings labels. Appearance restored to Follow System.

Evidence: `evidence/roster-state-acceptance/` contains `working-roster-light.png`, `roster-read-light.png`, `avatar-sizes-light.png`, `avatar-sizes-dark.png`, `composer-model-light.png`, and `chat-settings-light.png`.

`check:required` passed 229 Mobile suites / 2,115 tests and all workspace/design/i18n/docs gates. Subsequent gallery-only additions passed TypeScript, 2 focused suites / 26 tests, UI-style and six-locale checks. Signed Release built and installed. Backend-neutral unread fixtures cover OpenClaw, Hermes, and YouMind, including 120 channel sessions and a failed scheduled task; no transport, service deployment, or backend capability change was made in this iteration. This is not a new full cross-backend messaging certification.

### PostHog evidence and product recommendation

Queried the owner's browser-authenticated **Clawket / Default project 337268**, not the separately connected YouMind MCP project. Read-only aggregate queries through PostHog AI; no person profiles or prompt contents were inspected. Source: https://us.posthog.com/project/337268/ai?chat=282dcaec-eb60-48a9-b69b-c32851cd5645 . Rolling 30-day window queried on 2026-09-06 (approximately August 7–September 6; project timezone Asia/Shanghai).

| Event | Events | Distinct `person_id` |
| --- | ---: | ---: |
| `chat_send_tapped` | 2,183 | 111 |
| `chat_skill_picker_opened` | 82 | 24 |
| `chat_skill_selected` | 73 | 18 |
| `chat_slash_command_triggered` | 68 | 16 |
| `chat_voice_input_tapped` | 405 | 7 |

Voice breakdown: 202 `action=start`, 203 `action=stop`, each with 7 distinct users. All recorded voice interactions were app version 2.1.1, build 1, iOS; they do not demonstrate 3.0 adoption or successful recognition. No usable test/debug exclusion was available. Counts across features must not be treated as verified intersecting cohorts.

No Prompt feature events exist in the discovered taxonomy, and the current local Prompt picker has no analytics calls. Therefore its usage is **unknown**, not zero. No reply-notification shown/opened events were observed either; current code defines those events, so this is not proof that instrumentation was never implemented. No voice failure events were observed; this is not a measured success rate.

Recommendation: retain Skills; move Prompts out of the primary Add menu rather than deleting users' locally saved snippets. Prefer New conversation and Search this conversation if adding useful shortcuts. This iteration leaves the menu and stored prompts intact; these are product recommendations, not claimed removals.

Speech language selects the native iOS speech-to-text locale for dictation into the editable composer draft. It does not change app language or the Agent's response language. Keep the capability with the clearer label, given observed voice interactions.

Reply alerts are opt-in iOS **local** notifications scheduled after the running app receives a completed assistant reply while the relevant conversation is not being viewed. They are not remote push and cannot guarantee delivery after process termination or OS suspension. Native inspection encountered the simulator's notification permission prompt during completion; it was declined, leaving the in-app preference unchanged. Notification delivery is not claimed as tested, and this simulator currently has notification permission denied. Physical-device notification acceptance remains separate.
