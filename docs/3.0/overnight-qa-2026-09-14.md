# Overnight QA — 2026-09-14 (JST)

Owner explicitly authorized simulator testing for this run. This is an ongoing evidence log, not a release certification.

## Environment

- iPhone 17 simulator, iOS 26.5; fresh native Debug build completed.
- Temporary existing `EXPO_PUBLIC_UNLOCK_PRO=1` development override, no purchase or entitlement source-code bypass. Stopped that Metro process and restarted the ordinary workspace command without the override at the end.
- Existing Lucy connection and dedicated Hermes Preview QA connection; only active connection owns a mobile adapter by design.
- Hermes Preview requires the existing local QA runtime, separate from the ordinary Hermes Relay service.

## Timeline

| JST | Action | Evidence / result |
|---|---|---|
| 00:08–00:34 | Build/setup, repair local Hermes service, enable simulator keyboard control | Setup time is not counted as chat soak. Hermes API was absent while local bridge remained alive. |
| 00:35 | Lucy main: English question, no tools | Delivered and complete reply persisted after roster round-trip. |
| 00:36 | Lucy main: Chinese continuation, leave while generating | Roster visibly showed 工作中; reply remained when returning later. |
| 00:37–00:40 | Switch Hermes; investigate health-frame timeout | Saved simulator connection used dedicated Preview QA Relay, while ordinary Relay had been started. Restoring correct QA runtime cleared timeout. |
| 00:40 | Hermes: Chinese introductory question | Delivered, complete Chinese reply. |
| 00:45 | Hermes: contextual follow-up, roster then Lucy | Reply completed; no duplicate message. Lucy prior reply/history restored. |
| 00:47 | OpenClaw independent network-check session | Existing history loaded; new question received a complete answer. |
| 00:48 | Software keyboard, multiline mixed-script/emoji draft, expanded editor | Composer above keyboard; expand retained text. |
| 00:49–00:54 | Lock with unsubmitted draft in expanded editor | Foreground telemetry recorded 300,888 ms away. Draft intact; subsequent message received a contextual reply without a red connection banner. |
| 00:57 | Hermes terminal: sum of squares 1…100 | Correct result 338350, but tool timestamps showed 1970 and native/live tool rows duplicated. |
| 01:02–01:04 | Terminate the Clawket-owned Hermes API process, then send again | Exit → ready 31.394 s (30 s cooldown + ~1 s cold start), one recovery attempt. Contextual reply after recovery succeeded. |
| 01:06–01:09 | Hermes 12 s / 45 s terminal waits; roster and stop UI | Roster showed 使用工具. Tools completed before stop was processed: these attempts do **not** establish interruption of a running tool. |
| 01:10 | Rebuild/install; terminal 17×23 | Timestamp corrected. Duplicate persisted, exposing native persistence arriving after the initial hydration read. |
| 01:16 | Return to Lucy main, ask terminal 23×19 and recall earlier topic | Reply 437 and correct context. No tool event in UI **or** OpenClaw's local main transcript. Execution cannot be verified from the assistant's assertion alone. |
| 01:19–01:24 | Install late-native reconciliation fix; Hermes terminal 29×31 | One tool row, result 899. Detail sheet shows exact command/output and 1.2 s; closing preserves reading position. Previously cached duplicate from 01:10 remains in old history. |
| 01:25–01:32 | Lock while Hermes is active, unlock and send | Foreground telemetry recorded 401,444 ms away; reply correctly recalled 899, no repeated red banner observed. |
| 01:35–01:36 | Real stop during a 90 s terminal task, then send again | Clicked while tool row said running. Read-only Hermes API status confirmed `cancelled` / `run.cancelled`; matching test process absent before 90 s. Follow-up replied 可以继续聊天. |
| 01:37 | Reload native history after Bridge restart | The 01:19 tool duplicated again: in-memory alias fix alone was insufficient across process restart. Added bounded persistent ID metadata and restart regression. |
| 01:41 | Lucy main after ~66 minutes of alternating tests | Delivered and complete two-sentence contextual response; thinking indicator visible. |
| 01:42 | Hermes terminal 37×41 after ~62 minutes | One tool row, correct result 1517. Local file confirmed one ID alias and no persisted messages. Restart follow-up recorded below. |
| 01:44–01:45 | Restart Bridge and reopen Hermes | New native history loaded (assistant ID changed from live-final to native-history); same live tool ID, still exactly one card. Alias metadata survived restart. |

## Confirmed changes

- CLI doctor process lookup resolves global CLI symlinks (12 diagnostics tests passed).
- MessageEntrance no longer writes shared animation state during render; recycled history restores visibility. Two targeted regression tests plus two DirectionalIcon tests passed.
- DirectionalIcon forwardRef wrapper accepts React’s two-argument contract, removing a development warning.
- Managed Hermes API exit recovery: owned child only, local bounded backoff, coalesced health probes, stop-generation guards. Six regression tests and the actual process-exit recovery above passed. A warm API inherited from a previous runtime remains externally owned; this change deliberately does not kill or replace it.
- Normalize Hermes seconds to protocol milliseconds for tool timestamps and durations. Keep live Bridge tool identity when native persistence later reports another ID; correlate only unambiguous exact tool arguments within a bounded time window. Five regressions cover immediate/late native history, restart identity, ambiguous/truncated arguments, bounded metadata and corrupt records. Persist at most 512 identity aliases per session, clear on reset, and store no duplicate transcript content.
- Local QA environment repair: dedicated Hermes Preview launchd service now uses the existing explicit local proxy. Removed the extra manually started QA process; one launchd QA owner remains. No pairing credentials or cloud bindings changed.
- Found that Hermes user stop only aborted SSE locally. Explicit stop now sends a scoped authenticated upstream `/stop` request with a five-second deadline first. A failed/unsupported request leaves the stream observable instead of pretending the backend stopped. Existing `upstreamCancelled: false` remains honest because acceptance is not process-exit confirmation. Three additional regressions cover ordering and upstream 404/503 failures; recorded WebSocket contract remains unchanged.

## Verification and artifacts

- Fresh simulator native build: 0 errors, 1 warning.
- Final `npm run check:required`: passed; Mobile 262 suites / 2,580 tests, all workspace typechecks/self-contained tests, UI/i18n/docs gates. v1 compatibility replay: 5 files / 36 tests passed.
- Latest exact implementation gate logs: `check-required-aliases.log` and `compat-aliases.log`. Final docs and `git diff --check` also passed. Intermediate failures (missing new stop route in a controlled fixture, then corrected) were fixed before local installation; no failed gate was deployed.
- Local CLI packed, globally installed and managed services restarted with the rebuilt implementation. This is not an npm publication, cloud deployment or TestFlight update.
- Build, gate, packaging and Metro logs: `/tmp/clawket-overnight-0914/`. Screenshots were inspected through Simulator during the run; no claim of a complete every-page visual audit.
- Conversation observation windows: Lucy 00:35–01:41 (~66 min), Hermes 00:40–01:42 (~62 min), alternating rather than simultaneous live adapters. 6 Lucy prompts across two sessions and 12 Hermes prompts, including controlled tool/cancellation cases; setup time excluded.
- Recovery adds no cloud polling: existing local health checks coalesce, retry 30/60/120/240/300 seconds, never replace live/external processes or credential-rejecting APIs. This is a bounded implementation and local recovery observation, not a measurement of the entire Cloudflare bill.

## Limits / follow-up

- No cloud deployment performed.
- Broad local runtime test command also collected external integration tests and failed on the absent old Hermes checkout. CI-safe required and compat gates passed separately; external Hermes source was not changed to make tests pass.
- OpenClaw tool execution visibility with the current CLI-backed provider remains unverified. Its raw local transcript contained only user/assistant text for the 23×19 request, so the missing UI tool card is not proven to be a Clawket rendering loss.
- Hermes Session Panel exposes only existing sessions and this account has one main session; multi-session switching was exercised on OpenClaw, not asserted for Hermes.
- Old cached duplicate test rows created before the persistent-alias fix can remain: their prior Bridge identity mapping was already lost. The fix preserves new runs across restart; no broad deletion of user history or speculative old-message matching was performed.
- This Mac/proxy + iOS Debug simulator run does not certify overnight real-device networking, Windows, Android, carrier changes, airplane mode, or release-frame performance. Stop live verification is recorded below rather than inferred from unit tests.


## Lucy real-tool follow-up — 03:04–03:18 JST

The owner explicitly requested another real web-search and five-minute scheduled-task test. Both were sent through the simulator's Lucy main chat, without changing model, Bridge or cloud configuration.

- 03:04:49: requested a public search for Cloudflare Durable Objects WebSocket hibernation. The raw Claude CLI transcript records `mcp__openclaw__web_search` at 03:05:04, a matching tool result at 03:05:05, Brave provider, six results, and official Cloudflare documentation links. This verifies execution independently of Lucy's prose. It does not retroactively verify the earlier arithmetic request.
- 03:05:53: `mcp__openclaw__automations` created `Clawket QA 5min 20260914`, an `at` job for 03:10:30 JST, `deleteAfterRun: true`, `sessionTarget: current`, `delivery.mode: none`. Actual delay was about 4m37s, as Lucy disclosed, rather than exactly five minutes.
- Read-only central OpenClaw receipts show the job started at 03:10:30.046, finished at 03:10:37.354 with status `ok`, and was removed from the jobs table. The child-session transcript contains “Clawket 五分钟定时任务已触发”. No external-channel delivery was requested.
- At 03:18 the actual App Session Panel listed the named automation; opening it displayed the reminder in the task child session. Despite `sessionTarget: current`, this OpenClaw execution persisted in a cron child session, not as a new main-chat reply. The ordinary free-account read-only preview was sufficient to inspect the result.

### Fix and verification

- Confirmed Mobile history loss: OpenClaw's CLI history coalesces tool calls and results inside one assistant envelope, and may put results inside a user envelope. The singular mapper extracted only the first call and dropped embedded results, so real completed searches appeared as “结果未记录”.
- Added block expansion at the Gateway history adapter boundary: preserve each identified call/result, tool ID, error and output; keep ordinary text, and avoid fake user bubbles for tool-result envelopes. Existing standalone Hermes tool results retain their path.
- After normal Metro restart/reload, the real history showed completed tool activity. The `automations` detail sheet displayed the actual returned job JSON, including its one-shot configuration.
- Four focused suites / 81 tests passed (embedded history, adapter lifecycle, history projection, recorded adapter packets). Latest full required/typecheck is **not green**: concurrent scheduled-task editor changes have unrelated type errors in AgentSettings sections and cron-model tests. Those files were not reverted or rewritten for this follow-up. Logs: `embedded-tools-regression.log`, `check-required-embedded.log`, `typecheck-tools-final.log` under the existing artifact directory.
- No cloud deployment, CLI publication, new entitlement override, or external-source edit. Normal Metro restarted after stale module resolution caused by concurrent dependency relocation.

### Remaining observations

- Coalesced history lacks per-block timing, and the tool detail currently shows `<1 ms` for equal envelope timestamps; this is not a measured execution duration.
- The mixed CLI/Gateway history also exposes aggregated assistant text alongside individual replies, and the cron child displays a lengthy scheduler prompt as a user bubble. These are separate presentation/history follow-ups; this test does not claim they are resolved.
