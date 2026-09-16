# Overnight QA — 2026-09-15 (JST)

Owner authorized a single delayed simulator run, including real OpenClaw/Hermes messages, lifecycle changes and synthetic attachments. This is an evidence log, not a release certification.

## Environment and limits

- iPhone 17 simulator / iOS 26.5, existing native Debug app and saved Lucy/OpenClaw + dedicated Hermes QA Relay connections.
- Actual initial shell inspection 00:51:47 JST; first chat 01:03:36; final simulator check 02:12. This is ~81 minutes including setup, ~69 minutes from first chat, with interleaved backend coverage (not two simultaneous one-hour soaks). Scheduled wake time is not actual test duration.
- 16 delivered test prompts: Lucy 6 across main + an independent test session; Hermes 10 in main. One additional H7 attempt failed before send and was manually retried. Two synthetic images and six real tool executions (one web search, five terminal calls).
- Setup included replacing Metro 8081 with the existing development-only `EXPO_PUBLIC_UNLOCK_PRO=1` override. No entitlement code changed, no purchase. Normal Metro was restored on 8081 at completion, without the override.
- AX actions work; coordinate actions report `noWindowsAvailable`. Native limited-photo selector exposes no AX children in this automation environment. This limits exact native-picker interaction and animation judgement; successful AX actions are verified against subsequent screenshots/state.
- Two generated images contain only QA colors/numbers (orange 42, blue 37). No user photos are sent. Simulator photo permission was explicitly allowed for this test library.

## Actual cases

| JST | Case | Observed evidence |
|---|---|---|
| 01:03 | Lucy A1, general reliability question | One user bubble; roster 工作中 then 有新消息. Complete reply persisted through cold start and a Hermes round-trip. |
| 01:12 | Cold start after development reload left black surface | Process terminate/launch restored saved roster and connection. Developer-menu sequence is not classified as a production connection bug. |
| 01:14 | Hermes H1, terminal 43×47 and short discussion | One completed tool row, result 2021, complete reply. Returned history retains one row after switching to Lucy. |
| 01:16–01:21 | First photo authorization | Confirmed Add sheet's FullWindowOverlay covers iOS limited-library selector. Fixed permission presentation to run after full sheet dismissal. Full-access path manually completed, reopened recent strip works. Limited selector completion itself unavailable through current AX tooling. |
| 01:22 | Lucy A2 with two synthetic images, then switch to Hermes while working | Single initial sending bubble; roster 工作中. 01:26 and 01:32 return/cold-start/manual-recovery screenshots retain exactly one bubble with both images; Lucy read orange 42 and blue 37. |
| 01:23 | Hermes H2 contextual follow-up, immediately background App | Returned around 01:25 (~3 minutes, not five); one message and complete reply retained. H3 subsequent send succeeded. |
| 01:27–01:29 | OpenClaw independent test Session, request web search then terminate App during run | Cold start restored saved connections. Search result and completed tool appeared in the independent Session; main draft stayed separate. |
| 01:29 | Unsent main draft after Session switch and process kill | Exact QA draft recovered, then cleared deliberately. Two-image album still one message. |
| 01:31–01:33 | OpenClaw manual pause, process kill, reopen and resume | Pause survived cold start, no automatic reconnect. Thread showed resume action. Resumed and A3 got correct contextual answer (42/37). |
| 01:34–01:36 | Hermes H4 45-second terminal operation, switch Lucy and independent Session | Background backend work completed (3127); returning Hermes showed one completed tool, one reply, no permanently spinning tool. |
| 01:37 | Restart dedicated Hermes QA Relay via launchd SIGTERM | QA service restarted automatically (new PID); H5 reply recalled 3127. Ordinary Hermes/Production services not stopped for this injection. |
| 01:38 | Hermes software keyboard, three-line draft and expanded composer | Compact composer above keyboard; expand retained all text. Initial toolbar sleep action did not lock; that time is excluded. Confirmed lock through Cmd-L at 01:41. |
| 01:41–01:46 | Actual lock/unlock (~5 minutes) with expanded three-line Hermes draft | Exact draft retained. H6 sent successfully from expanded editor, one reply `lock recovery passed.` |
| 01:52:48–01:53:38 | SIGSTOP/SIGCONT dedicated QA Relay for 50 seconds; send during freeze | Send preflight failed, no sent bubble, full draft retained. Automatic connection recovery; explicit resend H7 produced one message/reply, still one after cold start. |
| 01:55–01:59 | H8 90-second tool, switch to Lucy and return before completion | **Confirmed defect:** running tool appeared unavailable, working state/Stop missing. Final response arrived, but two tool rows were retained. This phase used the previously installed local Bridge bundle. |
| 01:55 and 02:03 | Intentionally send identical Lucy text twice | Two distinct user messages and two OK replies preserved after switching. No over-aggressive text deduplication. |
| 02:03 onward | Replace only local Hermes Bridge with freshly built candidate; keep Hermes API and Relay services | Candidate adds active-run history snapshot. H9 repeats 90-second tool/switch/back: running tool, thinking and Stop restored before completion. |
| 02:04–02:07 | H9 on candidate active-run snapshot | Working state/Stop recovered, but completion exposed a second identity defect: native call ID vs live call ID produced two rows and one stale spinner. |
| 02:09–02:12 | H10 after active-call identity fix, including cold start and local Bridge restart | Running tool restored with the live ID; completion updates that same single row to success (1147). Still one completed row after App and Bridge restart. |

## Confirmed changes

`ThreadAddSheet` dismisses before requesting first photo authorization. It does not chain another picker when authorization resolves: iOS can still be presenting its limited-library selector at that point. Reopening Add reads the allowed recent photos, or offers the system picker after denial. Existing camera/file/system-picker actions keep their dismissal ordering. This is a deliberate first-use extra tap rather than an overlapping native-modal stack.

Regression: both granted/denied first authorization run only after dismissal, repeated presses coalesce, denial remains usable on next open. Thread sheet + recent-photo hook: 2 suites / 12 tests passed. Final full required gate passed (268 Mobile suites / 2,659 tests, Bridge Runtime 27 files / 211 tests, all other workspace/design/i18n/docs gates). Legacy compatibility replay: 5 files / 39 tests passed. One intermediate packet test failed solely because it strictly expected the old history shape; it now explicitly checks the additive idle flag while leaving the historical fixture unchanged, and the full gate was rerun green.

Hermes `chat.history` now provides authoritative, session-scoped `hasActiveRun` plus the already-supported `inFlightRun` shape (ID, partial text, start time, abortability). Snapshot is read after async history/model work, so a just-finished/cancelled run is not resurrected. No new polling, retry, persistent transcript, or external Hermes change. Real streaming and terminal-race tests cover the Bridge; mobile regression verifies Hermes snapshot ingestion. Historical packet replay keeps the old fixture intact and explicitly expects the additive idle flag.

Active Hermes tools now expose their existing in-memory tool queue to history reconciliation. A unique match by tool name, complete arguments and close timestamp binds the native call to its live ID before a result exists; the existing bounded alias store keeps that identity across restart. Ambiguous/repeated/truncated argument matches are deliberately not guessed. No duplicate tool execution or new background polling is introduced. The two QA runs made before this fix retain their already-cached duplicate cards; no speculative deletion of old cached/user history was performed.

## Cleanup and installation

- Restored normal Metro on 8081 without the temporary Pro override. Stopped the localhost file server and inspector capture; terminated the simulator App so it does not hold a client connection. Saved pairings/history retained.
- Built/packed and installed the tested CLI tarball locally only; installed bundle hash matches the candidate. Previous installed package backed up under the private temporary artifact directory. Replaced only the managed local Hermes Bridge with the installed candidate, reusing the existing Hermes API and configuration. QA Relay is running, not suspended. OpenClaw Gateway and cloud deployments were not restarted/deployed for this fix.
- Paused the one-shot heartbeat to prevent duplicate work. No Production deployment, npm registry publication, purchase or external Hermes edits.

## Transport evidence

- Both local Bridge and cloud lifecycle records inspected. Cloud events tool rejects some results because its response schema lacks outcome/eventType; grouped calculations work. This is a log-tool limitation, not proof of absent events.
- From 00:51:47–01:39 cloud aggregates recorded 21 OpenClaw Preview socket opens / 24 closes and 10 Hermes QA opens / 9 closes, including deliberate switching, cold starts and the QA restart. One OpenClaw client replacement was present; this is not a repeated replacement loop.
- Local ordinary Production and Hermes Relay connections had 1006 closures near 01:19 and recovered. At 01:30:31/33 both OpenClaw owners missed ~40 seconds of inbound traffic; watchdog scheduler delays were 1/0 ms, then bounded reconnect recovered. These are real host/Relay interruptions, not evidence of a phone failure and not eliminated by this run. No timeout inflation or extra polling was added.
- Local `clawket logs` caps output at 2,000 lines despite a larger requested count, so multiple narrow time-window captures are kept. Global counts from a capped capture are not treated as complete.
- Read-only OpenClaw transcript query: A1, A2, A3 and S1 each persisted once; A2 has media metadata. UI independently confirms two images and a single bubble after recovery.
- Hermes in this configured capability set hides Photos/Files. Media transmission there is not claimed as supported or tested.

## Remaining coverage limits

- File upload was attempted using a synthetic localhost text download. The native Safari download sheet exposes no actionable AX children and coordinate interaction fails in this environment; no file was sent, so file-picker/send is **not passed**.
- Native limited-photo selection completion and frame-by-frame animation smoothness remain unverified. Simulator screenshots/AX can confirm layout/state but not real-device frame pacing.
- This run uses saved pairings, not a fresh six-digit invitation on two real phones; it does not establish mainland network reachability.


## Follow-up investigation and fixes — 09:42 onward JST

The owner requested continued reproduction and repair, rather than stopping at the overnight findings.

### Confirmed fixes

- **Old Hermes tool copies:** additive, page-scoped `toolCallAliases` carries the existing bounded confirmed native-to-live ID mapping. The Hermes adapter reconciles a cached alias only against a same-role/name canonical tool on that page. OpenClaw ignores the field; missing/malformed/ambiguous identities are retained. Actual H8/H9/H10 each now show one completed tool, without deleting chat history.
- **Late cloud status response:** Hermes status fetches are abortable and bounded to 10 seconds. Socket replacement/stop cancels them; late HTTP or JSON-body completion cannot recycle a replacement socket. Only explicit boolean `hasBridge: false` acts as offline evidence. Hung probes leave the healthy socket open and allow the next normal probe after timeout.
- **Retired local socket:** late local Bridge text/binary frames cannot enter the current Relay session. Deterministic replacement tests cover both cloud and local sides.
- **Idle cloud traffic:** only an explicit validated zero-client control suppresses periodic local `tick`/`health` forwarding. Real replies/responses, transport ping/pong and local probes remain active. Unknown presence and old servers preserve forwarding; every new cloud socket resets presence to unknown. No extra request, timer or polling frequency was added.
- **User-bubble metadata collision:** A4 visibly overlapped the outgoing timestamp with the last words. Its invisible reservation is now one nonbreaking tabular run; the same screenshot after reload has a separate, unobstructed time/status line. No layout measurement loop.

### Fresh real-device-simulator observations

- 09:55: Hermes history loaded with H8/H9/H10 as one completed card each.
- 09:56–09:58: H11 invoked terminal, waited 35 seconds and returned 1763. Roster displayed working; switched to Lucy, sent A4, returned to Hermes and saw one tool and reply.
- 09:57 A4: Lucy received one new QA message and replied once. It could not recall the prior-night cards. Read-only host configuration confirms daily session reset at hour 5; preserved App history is not proof of continued model context. No model/reset settings changed.
- 10:03:48: restarted only the dedicated QA Relay while a draft was visible. Draft survived. 10:04 H12 manual send returned `connection recovered.` once. App terminate/launch retained one message/reply and the completed tool history.
- 10:05:30–10:07:30 UTC 01:05:30–01:07:30: cloud query for Hermes Preview returned no `bridge_message_dropped_without_active_client`, versus 60 in the 6-minute 00:27–00:33 UTC baseline. Local QA log contains eight cloud transport pongs and zero disconnects in the post-fix two-minute window. Two cloud rehydrations remained; this is not a claim of zero cloud cost.
- 10:09 H13 after the idle interval returned `idle recovery passed.` once. Screenshot confirms successful sending and readable timestamps after the idle optimization.

### Network evidence and scope limits

- Before this follow-up began, ordinary Hermes and both OpenClaw owner connections had an interruption around 00:30 UTC. Preview/Production observed ~40 seconds of inbound silence with only ~3 ms watchdog scheduling delay, then recovered. This is shared host/cloud-path evidence; its precise upstream cause remains unproven. Do not attribute it to the phone or claim these race fixes caused that incident.
- Periodic ~90-second proxy TCP entries correspond to the existing status request cadence, while WS pong logs continued every ~15 seconds. TCP opens alone are not evidence of a reconnect loop.
- The external Hermes SSE schema supplies truncated previews and no native tool ID. Exact aliasing deliberately declines ambiguous/truncated matches; broader complex-tool identity coverage remains needed, rather than guessing and collapsing real calls.
- File-picker and limited-photo-picker end-to-end coverage remains limited by the previously recorded automation surface issue. This follow-up did not exercise those paths or Android.
- Release criterion is no known critical defect in the exercised recovery matrix, preserved drafts/messages, no automatic ambiguous-send replay, bounded retries/resources, and passing compatibility gates. External network loss itself cannot be prevented by changing App code. These observations alone are not a full release certification.

### Validation and local rollout

- Full `npm run check:required` passed after the final UI correction: Mobile 268 suites / 2662 tests; Bridge Runtime 27 files / 214 tests. `npm run test:compat`: 5 files / 39 tests passed. Design-system, typechecks and agent docs passed.
- Test development caught three fixture issues: millisecond/second mismatch in a tiny synthetic adapter timestamp, a socket-replacement test accidentally asserting that a retired socket should forward, and an exact-text assertion including the newly nonbreaking invisible reservation. Each was corrected with its intended invariant preserved; no test was skipped or disabled.
- Built and packed the candidate locally; installed CLI bundle hash equals the repo bundle. Restarted the existing local service once (OpenClaw Production/Preview owners both reported health), then stopped the temporary foreground Hermes candidate. The existing 30-second service watchdog started the installed Hermes Bridge (PID 43807) at 10:12:48, reusing the existing authenticated API. The associated local socket retry interval backed off to five seconds while the port was absent; those controlled local failures are not spontaneous cloud outages.
- No Worker deployment, npm registry publication, external Hermes edit or pairing reset. The rollout is local only; a production release still needs the normal versioned publishing/deployment gates.

- 10:15 A5 after installing/restarting the actual managed service: OpenClaw accepted one QA message and returned `ready` once. This follow-up added five real prompts (Hermes H11/H12/H13, Lucy A4/A5) and one terminal execution; it is separate from the overnight totals.
- Follow-up cleanup at approximately 10:17 JST: simulator App terminated; normal Metro restored without the temporary Pro override. Existing pairings remain; QA Relay and installed service remain running, no suspended processes/fault timers. The prior one-shot automation remains paused.
